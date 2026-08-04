// Main-thread client for the Whisper transcription worker (whisper.worker.ts).
// Spawns the worker lazily on the first transcribe() call and reuses it for
// every call after that, since the vendored model only needs to load once
// per worker lifetime. Only one job runs at a time: the worker's message
// protocol has no per-job id to disambiguate concurrent replies, so a
// second call while one is in flight is rejected rather than silently
// queued or left to race the first call's listeners.
//
// `new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })`
// is Vite's documented worker-import pattern. Confirmed present (this repo
// pins vite@8.2.0) via the exact detection regex in
// node_modules/vite/dist/node/chunks/node.js:28618
// (`workerImportMetaUrlRE`), which matches this `new Worker(new URL(...,
// import.meta.url))` shape and rewrites it at build time to a same-origin
// built worker asset URL -- see workerImportMetaUrlPlugin at line 28619.
//
// The caller's `audio16k` buffer is transferred (not copied) into the
// worker for a zero-copy handoff, per the worker's transferable-friendly
// message protocol -- `audio16k` is therefore detached (unusable) in the
// calling context immediately after transcribe() is invoked.
//
// Model path (MEDIUM-2 fix): the worker cannot correctly resolve a plain
// relative string like './models/' against its own script URL, because a
// Vite-built module worker is emitted under /assets/ (see
// workerImportMetaUrlPlugin, cited above) -- resolving './models/' from
// there lands on '/assets/models/', which doesn't exist; the real vendored
// models live at the site root's '/models/' (see scripts/fetch-assets.mjs's
// WHISPER_DEST_DIR, which is `public/models/...`, and Vite serves `public/`
// at the site root). This bit the live site: every real (non-mock)
// transcription 404'd. The fix is to resolve the model base on *this*
// thread, where `document.baseURI` is the actual page URL Vite's `base:
// './'` build serves from (works for both a project-page path like
// '.../Understudy/' and local preview's 'http://localhost:4173/'), and pass
// it to the worker over postMessage -- the worker has no equivalent of
// `document` to compute this itself.
//
// Root-relative *path*, not a full `https://...` URL (a second, subtler bug
// found while building the real-mode E2E gate, tests/e2e/real-session.spec.ts):
// passing the full absolute URL (`.href`) as `env.localModelPath` made
// @huggingface/transformers silently stop finding the processor config.
// `get_file_metadata()`
// (node_modules/@huggingface/transformers/src/utils/model_registry/get_file_metadata.js:94-98)
// only treats a resolved path as "local" (safe to existence-check via
// `getFile()`, which works against any origin-relative or absolute URL) when
// `isValidUrl(localPath, ['http:','https:'])` is *false* -- a full URL with
// a scheme makes that `true`, which routes it into the "check remote"
// branch instead (:117), gated behind `env.allowRemoteModels` -- which
// asr.ts deliberately sets `false`. Net effect: `preprocessor_config.json`
// was reported as not existing, `AutoProcessor.from_pretrained()` was never
// called (pipelines.js:171-195's `hasProcessor` check), and
// `this.processor` stayed `null` -- crashing later with "Cannot read
// properties of null (reading 'feature_extractor')" deep inside
// `_call_whisper`. `isValidUrl()`
// (node_modules/@huggingface/transformers/src/utils/hub/utils.js:31-42) is
// `new URL(string)` with **no base** wrapped in a try/catch -- a
// root-relative path like '/Understudy/models/' has no scheme, so that
// throws and `isValidUrl` returns `false`, keeping this on the "local"
// code path (which works correctly -- `getFile()`'s own fetch call still
// resolves a root-relative path against the current origin exactly like an
// absolute URL would, per ordinary URL-resolution rules, regardless of the
// worker script's own path depth under /assets/). Hence `.pathname` below,
// not `.href`.
//
// `siteBasePath` (a third bug, same real-mode E2E gate): with the two bugs
// above fixed, a real session actually reached inference -- and
// onnxruntime-web tried to fetch its own WASM binary from
// `cdn.jsdelivr.net`. `@huggingface/transformers` defaults
// `env.backends.onnx.wasm.wasmPaths` to a jsdelivr CDN URL whenever nothing
// else has set it (backends/onnx.js:337-357), which is exactly this app's
// "no third-party network request, ever" guarantee broken in the one place
// module workers can't be protected by the page's CSP (see MEDIUM-1 in
// README.md's privacy section). whisper.worker.ts now points
// `wasmPaths` at the copies scripts/fetch-assets.mjs vendors under
// `public/onnxruntime-web/`, using this same root-relative-path technique
// (same reasoning as `modelBasePath` above).

import type { TimedWord } from '../core/types';

type OutMessage =
  | { type: 'progress'; p: number }
  | { type: 'result'; words: TimedWord[] }
  | { type: 'error'; message: string };

const SITE_BASE_PATH = new URL('.', document.baseURI).pathname;
const MODEL_BASE_PATH = new URL('models/', document.baseURI).pathname;

let worker: Worker | null = null;
let jobInFlight = false;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

export async function transcribe(
  audio16k: Float32Array,
  onProgress?: (p: number) => void
): Promise<TimedWord[]> {
  if (jobInFlight) {
    throw new Error('whisperClient.transcribe: a transcription is already in flight');
  }
  jobInFlight = true;

  try {
    const w = getWorker();
    return await new Promise<TimedWord[]>((resolve, reject) => {
      const cleanup = (): void => {
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onWorkerError);
      };
      const onMessage = (ev: MessageEvent<OutMessage>): void => {
        const msg = ev.data;
        if (msg.type === 'progress') {
          onProgress?.(msg.p);
        } else if (msg.type === 'result') {
          cleanup();
          resolve(msg.words);
        } else if (msg.type === 'error') {
          cleanup();
          reject(new Error(msg.message));
        }
      };
      const onWorkerError = (ev: ErrorEvent): void => {
        cleanup();
        // Final-review Fix 1: a worker-level error (as opposed to an
        // in-band { type: 'error' } message the worker's own try/catch
        // reported) means something went wrong outside the worker's
        // control-flow -- its state afterwards is not trustworthy. Kill it
        // and drop the cached singleton so the *next* transcribe() call
        // (e.g. a "Try again" retry) spawns a fresh worker instead of
        // reusing one that may be half-initialized or wedged.
        w.terminate();
        if (worker === w) worker = null;
        reject(new Error(ev.message || 'whisper worker error'));
      };

      w.addEventListener('message', onMessage);
      w.addEventListener('error', onWorkerError);
      w.postMessage(
        { type: 'transcribe', audio: audio16k, modelBasePath: MODEL_BASE_PATH, siteBasePath: SITE_BASE_PATH },
        [audio16k.buffer]
      );
    });
  } finally {
    jobInFlight = false;
  }
}
