// Real (non-mock) session gate. Everything else in tests/e2e/ drives the
// mock journey (`?mock=1`), which never touches a camera, a microphone, or
// the real Whisper pipeline -- so it could never have caught MEDIUM-2 (the
// production bug where whisper.worker.ts resolved its model path against
// the wrong base URL and 404'd on every real transcription, see
// src/speech/whisperClient.ts's header). This spec drives an actual
// recording through actual transcription, end to end, headless, using
// Chromium's fake-media-device flags:
//   --use-fake-ui-for-media-stream       (auto-accept the permission prompt)
//   --use-fake-device-for-media-stream   (synthetic camera + mic devices)
//   --use-file-for-fake-audio-capture    (the fake mic *plays* a real WAV
//                                          file instead of silence, so
//                                          there is real speech content for
//                                          Whisper to transcribe -- the same
//                                          fixture tests/integration's node
//                                          test uses, see whisper.test.ts)
//
// Three things this proves that no other test in this repo does:
//   (a) transcription actually runs and produces a non-empty transcript --
//       MEDIUM-2's regression test. Face metrics are expected to be zero
//       (the fake camera has no face for MediaPipe to find); that's fine,
//       this spec only cares about the speech path.
//   (b) MEDIUM-1 / HIGH-2's zero-network guarantee holds even in a full
//       real session with the MediaPipe FaceTracker actually running (and
//       actually calling landmarker.close() on Stop, which is what
//       triggers the CSP-blocked telemetry attempt this repo's privacy
//       copy now describes) -- not just the mock journey, which never
//       spins up MediaPipe at all.
//   (c) the model config fetch succeeds from the document-relative
//       '/models/' path, not the pre-fix '/assets/models/' 404.
//
// Whisper-tiny.en (q8, CPU, WASM) transcribing ~16s of audio is genuinely
// slow, especially on a shared CI runner -- hence the generous timeouts
// throughout. See ci.yml for how this spec is wired into (or gated out of)
// the CI run if its real-world runtime doesn't fit inside the e2e job.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const FAKE_AUDIO_FILE = path.resolve(TEST_DIR, '..', 'integration', 'fixtures', 'spoken.wav');

const RECORD_MS = 16_000;
const REPLAY_TIMEOUT_MS = 250_000; // model load + real CPU inference of ~16s audio
const TEST_TIMEOUT_MS = 300_000;

test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${FAKE_AUDIO_FILE}`,
    ],
  },
});

test.describe('real (non-mock) session', () => {
  test('records real audio, transcribes it for real, and never lets a request off-origin succeed', async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    if (!baseURL) throw new Error('playwright config must set use.baseURL for this check');

    await context.grantPermissions(['camera', 'microphone'], { origin: baseURL });

    // Only *finished* (successful) off-origin requests fail this test -- a
    // request that gets blocked by CSP (the MediaPipe telemetry attempt
    // this repo's privacy copy now names explicitly) fires 'requestfailed',
    // never 'requestfinished'. This spec makes no assertion about whether
    // that blocked attempt happens at all; it only asserts that if it does,
    // it never succeeds. `blob:`/`data:` are excluded: unlike the mock
    // journey (privacy.spec.ts), this is a *real* session, so replay gets a
    // real MediaRecorder blob, and the replay <video>'s
    // `URL.createObjectURL(replayBlob)` src is a local in-memory read, not
    // network egress -- the CSP's own `media-src 'self' blob:` already says
    // so.
    const finishedOffOrigin: string[] = [];
    page.on('requestfinished', (request) => {
      const url = request.url();
      if (url.startsWith('blob:') || url.startsWith('data:')) return;
      if (!url.startsWith(baseURL)) finishedOffOrigin.push(url);
    });

    const responses: Array<{ url: string; status: number }> = [];
    page.on('response', (response) => {
      responses.push({ url: response.url(), status: response.status() });
    });

    await page.goto('./');
    await expect(page.locator('[data-screen="consent"]')).toBeVisible();
    await page.getByRole('button', { name: 'Accept and continue' }).click();
    await expect(page.locator('[data-screen="home"]')).toBeVisible();

    await page.getByRole('button', { name: 'Rehearse' }).click();
    await expect(page.locator('[data-screen="question"]')).toBeVisible();
    await page.getByRole('button', { name: /ready/i }).click();
    await expect(page.locator('[data-screen="session"]')).toBeVisible();

    // Real capture: camera + FaceTracker (MediaPipe) + AudioMeter + Recorder
    // all spin up here (see src/ui/screens/session.ts's start()).
    await expect(page.locator('.rec-indicator')).toBeVisible({ timeout: 30_000 });

    // D10 regression: browser Back or a reload mid-recording used to
    // silently discard the take with no warning at all (session.ts had no
    // beforeunload guard). Dispatching a synthetic, cancelable
    // 'beforeunload' event and reading window.dispatchEvent()'s own return
    // value (false iff some listener called preventDefault()) proves the
    // guard is actually installed, without triggering a real navigation or
    // needing to handle a native dialog. Polled rather than checked once:
    // the guard is installed in the same synchronous turn that flips
    // .rec-indicator visible, but MediaPipe's own WASM/graph startup
    // logging around that exact moment can leave a very short externally-
    // observable gap between "indicator visible" and "listener attached"
    // becoming visible to the CDP session driving this test.
    await expect
      .poll(() => page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true }))), {
        message: 'waiting for the beforeunload guard to be installed while recording',
        timeout: 5_000,
      })
      .toBe(true);

    // Real time on the clock: the fake mic is playing the WAV fixture
    // (~14s of real speech, see tests/integration/whisper.test.ts), so the
    // recorded audio needs to actually span that long to capture it.
    await page.waitForTimeout(RECORD_MS);

    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.locator('[data-screen="processing"]')).toBeVisible();

    // (c) The model config fetch resolves from the document-relative
    // '/models/' path, not the pre-fix worker-relative '/assets/models/'
    // 404. Checked as soon as it's possible to (replay may take minutes),
    // but the fetch itself happens early in transcription, well before
    // Stop's wait below completes.
    await expect
      .poll(() => responses.find((r) => r.url.includes('/models/whisper-tiny.en/config.json')), {
        message: 'waiting for the Whisper model config.json request',
        timeout: 60_000,
      })
      .toBeTruthy();
    const configResponse = responses.find((r) => r.url.includes('/models/whisper-tiny.en/config.json'));
    if (!configResponse) throw new Error('unreachable: just asserted truthy above');
    expect(configResponse.status).toBe(200);
    expect(configResponse.url).not.toContain('/assets/models/');

    await expect(page.locator('[data-screen="replay"]')).toBeVisible({ timeout: REPLAY_TIMEOUT_MS });

    // (a) Non-empty transcript evidence: fluency() (src/core/fluency.ts)
    // returns wpm: 0 exactly when wordCount is 0, so a positive wpm is
    // direct proof Whisper returned real words, not an empty transcript
    // silently swallowed into a zeroed scorecard. Face-derived stats (eye
    // contact, blinks) are expected to read as zero/absent here -- the fake
    // camera has no face -- which is fine, this assertion doesn't touch them.
    const statsText = (await page.locator('.stats-row').textContent()) ?? '';
    const wpmMatch = statsText.match(/(\d+)\s*wpm/i);
    expect(wpmMatch, `expected a "<n> wpm" stat in the scorecard, got: ${statsText}`).toBeTruthy();
    const wpm = Number(wpmMatch![1]);
    expect(wpm).toBeGreaterThan(0);

    // (b) Zero successful off-origin requests, across the whole session --
    // camera setup, MediaPipe init + close(), real transcription, replay.
    expect(finishedOffOrigin).toEqual([]);
  });
});
