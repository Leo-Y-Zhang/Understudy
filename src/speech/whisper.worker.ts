// Module worker that owns the Whisper transcriber (see asr.ts) so model
// loading and inference happen off the main thread. Message protocol:
//   in:  { type: 'transcribe', audio: Float32Array }
//   out: { type: 'progress', p: number }   (zero or more, while the model
//          is still loading; see asr.ts for why inference itself never
//          emits progress in this library version)
//        { type: 'result', words: TimedWord[] }
//        { type: 'error', message: string }
//
// Model path: `./models/` is a plain relative string (never a URL object --
// see asr.ts's header for why `env.localModelPath` must stay a string).
// Resolving it "against self.location" needs no code here: `getFile()`
// (node_modules/@huggingface/transformers/src/utils/hub.js:60-74) hands the
// joined relative path straight to `env.fetch(urlOrPath)` with no manual URL
// resolution step of its own -- so it's the browser's ordinary relative-URL
// resolution for `fetch()` calls made from inside a worker's own execution
// context that resolves `./models/...` against this worker script's URL
// (i.e. self.location), keeping every request same-origin regardless of
// which page embeds the worker.
//
// This file is a module (has imports/exports), so the local `declare const
// self` below shadows the ambient global `self` only within this file --
// it does not conflict with the app-wide tsconfig lib set (ES2022 + DOM +
// DOM.Iterable + WebWorker), which otherwise leaves `self` typed for the
// DOM/Window case everywhere else in src/.

import { createTranscriber } from './asr';
import type { TimedWord } from '../core/types';

declare const self: DedicatedWorkerGlobalScope;

const MODEL_PATH = './models/';

type InMessage = { type: 'transcribe'; audio: Float32Array };

type OutMessage =
  | { type: 'progress'; p: number }
  | { type: 'result'; words: TimedWord[] }
  | { type: 'error'; message: string };

function post(message: OutMessage): void {
  self.postMessage(message);
}

// Kicked off at worker-eval time (i.e. as soon as whisperClient spawns this
// worker) rather than waiting for the first 'transcribe' message, so the
// ~40MB local model is already warming up by the time a job arrives.
const transcriberPromise = createTranscriber(MODEL_PATH);

self.onmessage = (ev: MessageEvent<InMessage>): void => {
  if (ev.data?.type !== 'transcribe') return;

  void (async () => {
    try {
      const transcribe = await transcriberPromise;
      const words = await transcribe(ev.data.audio, (p) => post({ type: 'progress', p }));
      post({ type: 'result', words });
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  })();
};
