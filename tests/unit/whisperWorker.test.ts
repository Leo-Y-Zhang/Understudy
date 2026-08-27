// Guards on whisper.worker.ts's message handler (CodeQL js/missing-origin-check,
// scripts/fetch-assets.mjs's sibling alert covered by the hash pin instead).
//
// The worker takes two strings straight off a postMessage and turns both into
// fetch targets: `modelBasePath` becomes `env.localModelPath` and `siteBasePath`
// becomes the `wasmPaths` prefix for onnxruntime-web's WASM runtime. README.md's
// privacy section spells out that a module worker is *not* covered by the page's
// `connect-src 'self'` -- so an off-origin base path here is this app's "nothing
// you record ever leaves your device" guarantee broken in the one place the CSP
// cannot catch it. That is not a hypothetical failure mode in this codebase:
// the exact same worker already shipped onnxruntime-web fetching itself from
// cdn.jsdelivr.net until a real-mode E2E test caught it.
//
// The worker is exercised as a module, not as a real Worker: it assigns
// `self.onmessage` at eval time, so the test installs a fake `self` (a real
// `URL` for `location`, a capturing `postMessage`) on the global before
// importing it, then calls the handler it registered. `./asr` and
// `@huggingface/transformers` are mocked so nothing here loads a real model or
// the ONNX runtime.
//
// What this proves: the handler ignores a message carrying a foreign origin,
// rejects base paths that resolve off-origin or to a different directory than
// the string it was sent, and still runs a normal same-origin job. Each
// rejection is checked against `createTranscriber` never being called -- i.e.
// the load genuinely did not happen -- not merely against the error message.
// What this does NOT prove: it does not spawn a real Worker, does not assert on
// browser-reported `MessageEvent.origin` values (the empty string the handler
// accepts is the spec's behaviour for a worker's implicit port, asserted here
// only as the input the real client produces), and does not exercise
// whisperClient.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimedWord } from '../../src/core/types';

const { createTranscriber } = vi.hoisted(() => ({ createTranscriber: vi.fn() }));

vi.mock('../../src/speech/asr', () => ({ createTranscriber }));
vi.mock('@huggingface/transformers', () => ({ env: { backends: { onnx: { wasm: {} } } } }));

// A Vite-built module worker is served from under /assets/, not the site root
// -- the whole reason the base paths are passed in rather than derived here.
const WORKER_URL = 'https://leo-y-zhang.github.io/Understudy/assets/whisper.worker-a1b2c3.js';
const SITE_BASE_PATH = '/Understudy/';
const MODEL_BASE_PATH = '/Understudy/models/';
const WORDS: TimedWord[] = [{ text: 'hello', t0: 0, t1: 0.4 }];

type OutMessage = { type: string; message?: string; words?: TimedWord[] };
type Handler = (ev: MessageEvent) => void;

let posted: OutMessage[];
let handler: Handler;

function send(data: unknown, origin = ''): void {
  handler({ data, origin } as unknown as MessageEvent);
}

function transcribeMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'transcribe',
    audio: new Float32Array(16),
    modelBasePath: MODEL_BASE_PATH,
    siteBasePath: SITE_BASE_PATH,
    ...overrides,
  };
}

beforeEach(async () => {
  posted = [];
  createTranscriber.mockReset();
  createTranscriber.mockResolvedValue(() => Promise.resolve(WORDS));

  const fakeSelf = {
    location: new URL(WORKER_URL),
    postMessage: (msg: OutMessage): void => {
      posted.push(msg);
    },
    onmessage: null as Handler | null,
  };
  (globalThis as unknown as { self: typeof fakeSelf }).self = fakeSelf;

  // The worker memoizes its transcriber and its wasmPaths setup at module
  // scope, so every case needs a genuinely fresh module, not a re-run handler.
  vi.resetModules();
  await import('../../src/speech/whisper.worker');
  if (!fakeSelf.onmessage) throw new Error('whisper.worker did not register an onmessage handler');
  handler = fakeSelf.onmessage;
});

describe('whisper.worker message guards', () => {
  it('runs a normal same-origin job', async () => {
    send(transcribeMessage());
    await vi.waitFor(() => expect(posted).toHaveLength(1));

    expect(createTranscriber).toHaveBeenCalledWith(MODEL_BASE_PATH);
    expect(posted[0]).toEqual({ type: 'result', words: WORDS });
  });

  it('ignores a message carrying a foreign origin', async () => {
    send(transcribeMessage(), 'https://evil.example');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createTranscriber).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });

  it('accepts a message carrying this context own origin', async () => {
    send(transcribeMessage(), new URL(WORKER_URL).origin);
    await vi.waitFor(() => expect(posted).toHaveLength(1));

    expect(posted[0]).toEqual({ type: 'result', words: WORDS });
  });

  // Every one of these "starts with a slash", which is why the handler
  // re-resolves through `new URL()` instead of pattern-matching the string.
  const offOriginPaths: Array<[string, string]> = [
    ['protocol-relative host', '//evil.example/models/'],
    ['traversal out of the site root', '/Understudy/../../models/'],
    ['backslash separator', '/Understudy\\models/'],
  ];

  for (const [label, badPath] of offOriginPaths) {
    it(`rejects a modelBasePath using a ${label}`, async () => {
      send(transcribeMessage({ modelBasePath: badPath }));
      await vi.waitFor(() => expect(posted).toHaveLength(1));

      expect(createTranscriber).not.toHaveBeenCalled();
      expect(posted[0]?.type).toBe('error');
    });

    it(`rejects a siteBasePath using a ${label}`, async () => {
      send(transcribeMessage({ siteBasePath: badPath }));
      await vi.waitFor(() => expect(posted).toHaveLength(1));

      expect(createTranscriber).not.toHaveBeenCalled();
      expect(posted[0]?.type).toBe('error');
    });
  }

  it('rejects a fully-qualified off-origin URL as a base path', async () => {
    send(transcribeMessage({ modelBasePath: 'https://evil.example/models/' }));
    await vi.waitFor(() => expect(posted).toHaveLength(1));

    expect(createTranscriber).not.toHaveBeenCalled();
    expect(posted[0]?.type).toBe('error');
  });

  it('reports rejection rather than dropping it, so the caller promise settles', async () => {
    send(transcribeMessage({ modelBasePath: '//evil.example/models/' }));
    await vi.waitFor(() => expect(posted).toHaveLength(1));

    // whisperClient.ts only settles on 'result' or 'error'; a silent return
    // here would hang the transcription forever.
    expect(posted[0]).toEqual({
      type: 'error',
      message: 'whisper worker: base paths must be same-origin absolute paths',
    });
  });

  it('ignores a message that is not a transcribe request', async () => {
    send({ type: 'something-else' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(createTranscriber).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });
});
