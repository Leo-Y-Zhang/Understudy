// Regression test for final-review Fix 1 (see the docstring on
// `audioForAttempt` in src/ui/screens/processing.ts).
//
// The bug: whisperClient.transcribe() transfers (does not copy) the
// Float32Array it's given into the worker -- a zero-copy handoff that
// detaches the buffer in the calling context the instant transcribe() is
// invoked. Before this fix, processing.ts's run() passed the SAME
// result.audio16k on every "Try again" retry, so the second attempt's
// postMessage always threw a deterministic DataCloneError against an
// already-detached buffer: the retry path was dead on arrival regardless of
// what caused the first failure. The fix slices a fresh, independent copy
// from the untouched source on every attempt via `audioForAttempt()`.
//
// This test proves that contract directly: it calls `audioForAttempt()`
// twice against the same source array, genuinely detaches the first
// attempt's buffer in between (via structuredClone's `transfer` option --
// the same detachment mechanism Worker.postMessage's transfer list uses),
// and asserts the second attempt's buffer is still usable and byte-identical
// to the source.
//
// `whisperClient.ts` is vi.mock'd before importing processing.ts purely so
// this file can run in vitest's default Node environment: whisperClient.ts
// reads `document.baseURI` at module scope, which throws immediately
// outside a browser/DOM environment (this repo has no jsdom/happy-dom
// installed) -- the mock stands in so importing processing.ts for its named
// export doesn't crash on an unrelated module's top-level code.
//
// What this test proves: the exact buffer-copy contract processing.ts's
// run() calls on every attempt survives a prior attempt's buffer being
// detached, byte-for-byte.
// What this test does NOT prove: it does not mount processingScreen() or
// click the real "Try again" button, does not exercise whisperClient.ts or
// the real Worker/whisper.worker.ts, and does not assert that a real
// DataCloneError is ever thrown or caught. Full DOM-level coverage of the
// retry click flow would need a browser test environment this repo doesn't
// currently have; the E2E suite also can't cover this because it never
// forces a real (non-mock) transcription failure.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/speech/whisperClient', () => ({ transcribe: vi.fn() }));

const { audioForAttempt } = await import('../../src/ui/screens/processing');

describe('processing.ts retry buffer contract (final-review Fix 1)', () => {
  it('gives every attempt a fresh, independent copy that survives a prior attempt being detached', () => {
    const source = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);

    // Attempt 1: an independent copy, not a view over the same buffer.
    const attempt1 = audioForAttempt(source);
    expect(attempt1).not.toBe(source);
    expect(attempt1.buffer).not.toBe(source.buffer);
    expect(Array.from(attempt1)).toEqual(Array.from(source));

    // Simulate whisperClient.transcribe()'s postMessage(msg, [audio.buffer])
    // transferring attempt 1's buffer into the worker, exactly as a real
    // (subsequently failed) first attempt would.
    structuredClone(attempt1.buffer, { transfer: [attempt1.buffer] });
    expect(attempt1.buffer.byteLength).toBe(0); // genuinely detached, not a stub

    // Attempt 2 (the retry) must be sliced from the untouched source, not
    // from attempt 1's now-dead buffer -- this is exactly what would have
    // failed under the pre-fix code (`transcribe(requireAudio(result.audio16k), ...)`
    // reused the same array object on every call).
    const attempt2 = audioForAttempt(source);
    expect(attempt2.buffer.byteLength).toBeGreaterThan(0);
    expect(Array.from(attempt2)).toEqual(Array.from(source));

    // The source itself was never touched, so a third, fourth, ... attempt
    // would work identically -- retries aren't limited to exactly one.
    expect(source.buffer.byteLength).toBe(source.length * Float32Array.BYTES_PER_ELEMENT);
    expect(Array.from(audioForAttempt(source))).toEqual(Array.from(source));
  });
});
