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

import type { TimedWord } from '../core/types';

type OutMessage =
  | { type: 'progress'; p: number }
  | { type: 'result'; words: TimedWord[] }
  | { type: 'error'; message: string };

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
        reject(new Error(ev.message || 'whisper worker error'));
      };

      w.addEventListener('message', onMessage);
      w.addEventListener('error', onWorkerError);
      w.postMessage({ type: 'transcribe', audio: audio16k }, [audio16k.buffer]);
    });
  } finally {
    jobInFlight = false;
  }
}
