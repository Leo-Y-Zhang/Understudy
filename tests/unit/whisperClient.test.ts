// Retry contract for whisperClient.ts: a failed transcription must not leave
// "Try again" (processing.ts) talking to the same, already-failed worker.
//
// A worker that fails to load the model reports it in-band, as a
// { type: 'error' } message from its own try/catch -- not as a worker-level
// ErrorEvent -- and that worker can never succeed again:
//   - asr.ts's createTranscriber() memoizes one pipeline() promise per worker
//     and whisper.worker.ts memoizes one transcriber, so a rejected model load
//     is awaited again, and rejects again, on every later job;
//   - onnxruntime-web's initializeWebAssembly() latches a failed WASM start-up
//     for the life of the JS realm (wasm-factory.ts: `aborted = true`, then
//     "previous call to 'initializeWebAssembly()' failed." on every retry).
// processing.ts keeps the recording in memory precisely so "Try again" can
// re-run transcription after a transient failure (a dropped model download,
// say); reusing the worker made that retry fail identically every time, and
// the only way out was a reload, which throws the recording away.
//
// `Worker` and `document` are stubbed on the global (this repo has no DOM test
// environment -- see processingRetry.test.ts) before whisperClient.ts is
// imported, since it reads `document.baseURI` at module scope. Each fake
// worker plays a scripted role: 'broken' answers every job with an in-band
// error, the way the real worker does after a failed load; 'healthy' answers
// with words.
//
// What this proves: after an in-band error the client terminates that worker
// and the next transcribe() call gets a fresh one, which can succeed; a
// successful job keeps its worker (the model is loaded once and reused).
// What this does NOT prove: it does not run the real whisper.worker.ts, the
// model, or onnxruntime-web.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimedWord } from '../../src/core/types';

type Role = 'broken' | 'healthy';

const WORDS: TimedWord[] = [{ text: 'hello', t0: 0, t1: 0.4 }];

class FakeWorker extends EventTarget {
  static roles: Role[] = [];
  static instances: FakeWorker[] = [];

  readonly role: Role;
  terminated = false;

  constructor() {
    super();
    this.role = FakeWorker.roles.shift() ?? 'healthy';
    FakeWorker.instances.push(this);
  }

  postMessage(): void {
    if (this.terminated) throw new Error('postMessage on a terminated worker');
    const data =
      this.role === 'broken'
        ? { type: 'error', message: 'Could not load model whisper-tiny.en' }
        : { type: 'result', words: WORDS };
    queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data })));
  }

  terminate(): void {
    this.terminated = true;
  }
}

async function loadClient(): Promise<typeof import('../../src/speech/whisperClient')> {
  vi.resetModules();
  return import('../../src/speech/whisperClient');
}

beforeEach(() => {
  FakeWorker.roles = [];
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('document', { baseURI: 'https://example.test/Understudy/' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('whisperClient retry contract', () => {
  it('retries on a fresh worker after an in-band error, so "Try again" can succeed', async () => {
    FakeWorker.roles = ['broken', 'healthy'];
    const { transcribe } = await loadClient();

    await expect(transcribe(new Float32Array(16))).rejects.toThrow('Could not load model whisper-tiny.en');
    await expect(transcribe(new Float32Array(16))).resolves.toEqual(WORDS);

    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
  });

  it('keeps using the same worker after a successful job', async () => {
    FakeWorker.roles = ['healthy', 'healthy'];
    const { transcribe } = await loadClient();

    await expect(transcribe(new Float32Array(16))).resolves.toEqual(WORDS);
    await expect(transcribe(new Float32Array(16))).resolves.toEqual(WORDS);

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0]?.terminated).toBe(false);
  });
});
