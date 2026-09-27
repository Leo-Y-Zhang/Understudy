// The two ways a real (non-mock) take can go wrong before it reaches the
// replay screen, driven in a real browser: the camera is refused, and
// transcription fails.
//
//  (a) Camera refused. session.ts hides the REC indicator with the `hidden`
//      attribute until recording has actually started, and again when it
//      shows its error panel -- but `.rec-indicator` is a `display: flex`
//      row, and an author `display` rule beats the browser's own
//      `[hidden] { display: none }`. So "Recording 0:00" sat on screen (and
//      in the accessibility tree) while the camera was still being set up,
//      and right beside "We couldn't reach your camera". The app must never
//      say it is recording when it is not.
//
//  (b) Transcription failed, then "Try again". processing.ts keeps the
//      recording in memory precisely so a failed transcription can be
//      retried -- but the retry used to go back to the same Whisper worker,
//      which keeps its failed model load (and onnxruntime-web keeps a failed
//      WASM start-up) for the rest of its life, so "Try again" failed the
//      same way forever and the only way out was a reload that throws the
//      recording away. processingRetry.test.ts and whisperClient.test.ts pin
//      the two halves of the retry contract in isolation; this is the only
//      test that forces a real transcription failure and retries it. The
//      failed attempt also has to take its progress bar with it (the same
//      `[hidden]` override as (a), on `.progress-wrap`).
//
// Both run in real mode on the project's fake camera and microphone
// (playwright.config.ts). The model's weights are made to fail by aborting
// their requests, which page.route() sees from the transcription worker too,
// and then let through for the retry.

import { test, expect } from '@playwright/test';

test.describe('failure paths (real mode)', () => {
  test('a refused camera shows the error and never a Recording indicator', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    });

    await page.goto('./');
    await page.getByRole('button', { name: 'Accept and continue' }).click();
    await page.getByRole('button', { name: 'Rehearse' }).click();
    await page.getByRole('button', { name: /ready/i }).click();
    await expect(page.locator('[data-screen="session"]')).toBeVisible();

    await expect(page.getByRole('alert')).toContainText('couldn’t reach your camera or microphone');
    await expect(page.locator('.rec-indicator')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Stop' })).toBeHidden();
  });

  test('a failed transcription can be retried on the same recording', async ({ page, context, baseURL }) => {
    test.setTimeout(240_000);
    if (!baseURL) throw new Error('playwright config must set use.baseURL for this check');
    await context.grantPermissions(['camera', 'microphone'], { origin: baseURL });

    let failModelDownloads = true;
    await page.route('**/models/whisper-tiny.en/onnx/**', (route) =>
      failModelDownloads ? route.abort('failed') : route.continue()
    );

    await page.goto('./');
    await page.getByRole('button', { name: 'Accept and continue' }).click();
    await page.getByRole('button', { name: 'Rehearse' }).click();
    await page.getByRole('button', { name: /ready/i }).click();

    // Stop is enabled in the same step that shows the REC indicator, once
    // the camera, face tracker, audio meter and recorder are all running.
    const session = page.locator('[data-screen="session"]');
    await expect(session.getByRole('button', { name: 'Stop' })).toBeEnabled({ timeout: 60_000 });
    await expect(session.locator('.rec-indicator')).toBeVisible();
    await page.waitForTimeout(3_000);
    await session.getByRole('button', { name: 'Stop' }).click();

    const processing = page.locator('[data-screen="processing"]');
    await expect(processing.getByRole('alert')).toContainText('couldn’t be analysed', { timeout: 120_000 });
    await expect(processing.locator('progress')).toBeHidden();

    failModelDownloads = false;
    await processing.getByRole('button', { name: 'Try again' }).click();

    await expect(page.locator('[data-screen="replay"]')).toBeVisible({ timeout: 180_000 });
  });
});
