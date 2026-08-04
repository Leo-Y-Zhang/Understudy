// Module worker that owns the Whisper transcriber (see asr.ts) so model
// loading and inference happen off the main thread. Message protocol:
//   in:  { type: 'transcribe', audio: Float32Array, modelBasePath: string, siteBasePath: string }
//   out: { type: 'progress', p: number }   (zero or more, while the model
//          is still loading; see asr.ts for why inference itself never
//          emits progress in this library version)
//        { type: 'result', words: TimedWord[] }
//        { type: 'error', message: string }
//
// Model path (MEDIUM-2 fix, see whisperClient.ts's header for the full
// story, including two further bugs found along the way): this used to be
// the plain relative string './models/', resolved "against self.location"
// inside `getFile()`
// (node_modules/@huggingface/transformers/src/utils/hub.js:60-74, which
// hands the joined relative path straight to `env.fetch(urlOrPath)` with no
// manual URL resolution step of its own -- so it was the browser's ordinary
// relative-URL resolution for `fetch()` calls made from a worker's own
// execution context doing the resolving). That reasoning was wrong in
// practice: `self.location` for a *built* module worker is the worker
// script's own asset URL -- Vite's workerImportMetaUrlPlugin emits it under
// `/assets/`, not the site root -- so './models/' resolved to
// '/assets/models/', which 404's; the real vendored models live at
// '/models/' (site root). The caller (whisperClient.ts, which has a
// `document` to resolve against and this worker does not) now computes the
// correct **root-relative path** (not a full `https://...` URL -- see
// whisperClient.ts's header for why a full URL silently breaks processor
// config detection) and sends it as `modelBasePath` on every 'transcribe'
// message; this worker just passes it straight to `createTranscriber()` as
// `env.localModelPath` (still a plain string, never a URL object -- see
// asr.ts's header for why that matters). The transcriber is memoized on
// first use rather than kicked off eagerly at worker-eval time (the
// previous design), since the model base is no longer known until the
// first message arrives.
//
// `siteBasePath` fixes a third bug found the same way: onnxruntime-web's
// WASM runtime defaults to fetching itself from `cdn.jsdelivr.net` unless
// this app points it somewhere else first (see whisperClient.ts's header
// and scripts/fetch-assets.mjs, which vendors the two WASM variants this
// app needs under `public/onnxruntime-web/`). That has to happen here, not
// in asr.ts: asr.ts is shared with the Node integration test
// (tests/integration/whisper.test.ts), which uses onnxruntime-node (a
// native binding, no WASM/`env.backends.onnx.wasm` involved at all), so
// setting `wasmPaths` there would be a browser-only concern leaking into
// shared code for no reason. This worker is always a browser (or
// browser-like Worker) execution context, so it's the natural place for
// it, done once before the first `createTranscriber()` call.

import { createTranscriber, Transcriber } from './asr';
import { env } from '@huggingface/transformers';
import type { TimedWord } from '../core/types';

declare const self: DedicatedWorkerGlobalScope;

type InMessage = {
  type: 'transcribe';
  audio: Float32Array;
  modelBasePath: string;
  siteBasePath: string;
};

type OutMessage =
  | { type: 'progress'; p: number }
  | { type: 'result'; words: TimedWord[] }
  | { type: 'error'; message: string };

function post(message: OutMessage): void {
  self.postMessage(message);
}

// Mirrors @huggingface/transformers's own (unexported) `isSafari()` check
// (node_modules/@huggingface/transformers/src/env.js:72-92) -- it isn't
// part of the package's public API surface, so this is a deliberate,
// documented duplicate, not a drifted copy. Safari lacks the
// thread-atomics ("asyncify") build every other evergreen browser uses;
// picking the wrong variant fails to load rather than silently degrading.
function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent;
  const vendor = navigator.vendor || '';
  const isAppleVendor = vendor.includes('Apple');
  const notOtherBrowser =
    !/CriOS|FxiOS|EdgiOS|OPiOS|mercury|brave/i.test(userAgent) &&
    !userAgent.includes('Chrome') &&
    !userAgent.includes('Android');
  return isAppleVendor && notOtherBrowser;
}

let onnxWasmConfigured = false;

function configureOnnxWasmPaths(siteBasePath: string): void {
  if (onnxWasmConfigured) return;
  onnxWasmConfigured = true;

  // `env.backends.onnx.wasm` is populated as a side effect of importing
  // @huggingface/transformers (onnx.js's module-eval-time init code, see
  // this file's header) -- by the time this runs, it's always already an
  // object. The guard below is defensive only; `.wasm` itself is `readonly`
  // in onnxruntime-common's types (can't be *replaced*), but `.wasmPaths`
  // inside it is a plain mutable property.
  const onnxWasm = env.backends.onnx.wasm;
  if (!onnxWasm) return;

  const dir = `${siteBasePath}onnxruntime-web/`;
  onnxWasm.wasmPaths = isSafari()
    ? { mjs: `${dir}ort-wasm-simd-threaded.mjs`, wasm: `${dir}ort-wasm-simd-threaded.wasm` }
    : { mjs: `${dir}ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${dir}ort-wasm-simd-threaded.asyncify.wasm` };
}

// Memoized on the first 'transcribe' message's modelBasePath and reused for
// every job after that (every caller in this app sends the same value, so
// there is no cache-invalidation concern here).
let transcriberPromise: Promise<Transcriber> | null = null;

self.onmessage = (ev: MessageEvent<InMessage>): void => {
  if (ev.data?.type !== 'transcribe') return;

  void (async () => {
    try {
      if (!transcriberPromise) {
        configureOnnxWasmPaths(ev.data.siteBasePath);
        transcriberPromise = createTranscriber(ev.data.modelBasePath);
      }
      const transcribe = await transcriberPromise;
      const words = await transcribe(ev.data.audio, (p) => post({ type: 'progress', p }));
      post({ type: 'result', words });
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  })();
};
