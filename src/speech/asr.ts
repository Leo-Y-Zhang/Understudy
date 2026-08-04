// Shared Whisper transcription pipeline logic, used by both the browser
// worker (whisper.worker.ts) and the Node integration test
// (tests/integration/whisper.test.ts) so there is exactly one code path for
// "load the local model and turn 16kHz audio into timed words" -- the two
// callers differ only in which `localModelPath` string they pass in (a
// same-origin relative URL in the worker; a filesystem path relative to the
// repo root in Node, since vitest's cwd is the repo root).
//
// API surface verified against the installed @huggingface/transformers@4.2.0
// source (this repo pins 4.2.0, a major ahead of the v3-era assumptions the
// original task brief was written against -- see THIRD_PARTY.md for the
// vendored-file-naming evidence trail). Citations below are against
// node_modules/@huggingface/transformers/src/**, which is what
// dist/transformers.{node,web}.js are built from:
//
// - env.allowRemoteModels / env.allowLocalModels / env.localModelPath:
//   env.js:258-263. `localModelPath` MUST stay a plain string, never a URL
//   object: utils/hub.js:130 joins it via `pathJoin()`, which calls
//   `.replace()` on every path segment (utils/hub/utils.js:10-22) --
//   `URL` instances don't have `.replace`, so passing one throws at the
//   first `getModelFile()` call, not at assignment time.
// - `device` is intentionally omitted from the pipeline() options (left
//   `undefined`), not hardcoded to 'wasm' as the pre-4.x brief pseudocode
//   suggested. In Node, 'wasm' is not a supported device at all --
//   backends/onnx.js:120-136 only pushes 'dml'/'webgpu'/'cpu' (Windows) onto
//   `supportedDevices` for IS_NODE_ENV, and deviceToExecutionProviders()
//   (onnx.js:161-178) throws `Unsupported device: "wasm"` for anything not
//   in that list. Leaving `device` undefined instead lets
//   models/session.js:36-42 (`selectDevice(options.device ?? ..., ...)`)
//   fall through to utils/devices.js's `DEFAULT_DEVICE` constant, which is
//   defined as `apis.IS_NODE_ENV ? 'cpu' : 'wasm'` (devices.js:23) -- i.e.
//   the *same* pipeline() call already picks the right device for whichever
//   runtime it executes in, browser or Node, with no environment branching
//   needed in this file.
// - `dtype: 'q8'` resolves to the `*_quantized.onnx` files vendored under
//   public/models/whisper-tiny.en/onnx/ (see THIRD_PARTY.md's dtypes.js /
//   session_config.js / get_model_files.js citation trail).
//
// *** Why this uses `return_timestamps: true`, NOT `'word'` (deviation from
// the task brief's literal pseudocode -- documented, not silently done): ***
//
// `return_timestamps: 'word'` sets `generation_config.return_token_timestamps
// = true` (pipelines/automatic-speech-recognition.js:204-207), which in turn
// requires the model's `generate()` output to include `cross_attentions`
// (models/whisper/modeling_whisper.js:137-151 sets `output_attentions =
// true` and routes through `_extract_token_timestamps`, which at
// modeling_whisper.js:388-392 throws exactly:
//   "Model outputs must contain cross attentions to extract timestamps.
//    This is most likely because the model was not exported with
//    `output_attentions=True`."
// ...if `generate_outputs.cross_attentions` is falsy. That's not a config
// problem on our end: the vendored
// public/models/whisper-tiny.en/onnx/decoder_model_merged_quantized.onnx
// graph was inspected directly with onnxruntime-node
// (`InferenceSession.create(...).then(s => s.outputNames)`) and its outputs
// are exactly `['logits', 'present.0.decoder.key', 'present.0.decoder.value',
// 'present.0.encoder.key', 'present.0.encoder.value', ...present.1..3...]` --
// no `cross_attentions.*` output at all. The onnx-community/whisper-tiny.en
// quantized "merged" decoder export this repo vendors (see THIRD_PARTY.md)
// simply does not expose per-layer cross-attention tensors, so
// `return_timestamps: 'word'` cannot work against this exact file
// regardless of any option this module passes -- confirmed by first
// reproducing the "must contain cross attentions" error end to end via the
// real integration test (tests/integration/whisper.test.ts), then isolating
// it to the ONNX graph itself.
//
// Per the task brief: don't vendor different files, don't hit the network.
// `return_timestamps: true` (segment-level, boolean, not `'word'`) is a
// working alternative available from the *same* vendored files: it drives
// `WhisperTimeStampLogitsProcessor` (models/whisper/modeling_whisper.js:125-128),
// which only needs the model's ordinary `logits` output (present in our
// decoder) to insert timestamp tokens during generation -- no attention
// outputs required. Manually verified against the real fixture: it returns
// real, model-produced segment boundaries roughly at sentence granularity
// (e.g. `[0,3]`, `[3,10]`, `[10,14]` for the ~14s SAPI fixture), with an
// accurate transcript.
//
// `toTimedWords()` below turns those segment-level chunks into the
// per-`TimedWord` shape the rest of the app expects by splitting each
// segment's text into words and distributing the segment's *real* [t0, t1]
// span across them proportionally by character length. This means: segment
// boundaries are exact (real model output); a given word's position
// *within* its segment is an estimate, not a forced-alignment timestamp.
// For this app's downstream consumers (pace/filler/pause heuristics working
// over multi-second windows) that's an acceptable trade-off, but it is a
// real precision loss worth flagging if per-word-exact timing ever becomes
// a hard requirement -- see task-13-report.md's Concerns section for the
// path to recover true word alignment (re-export the decoder with
// `output_attentions=True`, which requires vendoring a different ONNX file,
// out of scope for this task per the "don't vendor different files"
// instruction).
//
// - Call options `{ return_timestamps: true, chunk_length_s: 30 }` and the
//   `{ text, chunks: [{ text, timestamp: [t0, t1] }] }` output shape:
//   pipelines/automatic-speech-recognition.js:196-311 (`_call_whisper`, the
//   code path actually taken for a `model_type: 'whisper'` config, per the
//   `switch` at line 142-145).
// - The package's exported `Chunk` type (types/pipelines/automatic-speech-recognition.d.ts)
//   claims `timestamp: [number, number]` (both ends non-null), but that's an
//   auto-generated-from-JSDoc simplification that doesn't match the real
//   runtime behaviour: models/whisper/tokenization_whisper.js:27 documents
//   `timestamp: Array<number|null>`, and a chunk's end timestamp is only
//   ever conditionally assigned (tokenization_whisper.js:176-187, 284-307)
//   -- it comes back `null` whenever the model runs out of audio/tokens
//   before emitting a closing timestamp token (this applies to segment-level
//   timestamps too, not just word-level -- `force_full_sequences` defaults
//   to `false` in the pipeline, so this is the normal "leftover" flush path,
//   not an error case). `toTimedWords()` defines its own local type for
//   this reason and treats a null/undefined end as "runs to the end of the
//   audio", per the task brief.
// - progress_callback: pipeline() always wraps whatever function you pass in
//   a `DefaultProgressCallback` (pipelines.js:154-157) that additionally
//   emits one synthetic `{ status: 'progress_total', progress: <0..100> }`
//   event (aggregated across every file being loaded) alongside the raw
//   per-file events (utils/core.js:104-140) -- that's the only status we
//   forward, normalized to 0..1, since it's the one meaningful "how far
//   through loading the ~40MB model are we" signal for a caller-supplied
//   onProgress.

import { pipeline, env } from '@huggingface/transformers';
import type { TimedWord } from '../core/types';

const SAMPLE_RATE_HZ = 16000;

export type Transcriber = (
  audio16k: Float32Array,
  onProgress?: (p: number) => void
) => Promise<TimedWord[]>;

/**
 * Sets up the local-only model environment and starts loading
 * whisper-tiny.en (q8) from `localModelPath`, returning a ready-to-call
 * transcribe function.
 *
 * The model load is kicked off immediately (not deferred to the first call)
 * so that a caller which constructs its transcriber up front -- e.g. the
 * worker, at module-eval time -- starts warming the model up right away
 * instead of waiting for the first transcribe() call to begin loading. The
 * returned function awaits that same in-flight load on every call; after
 * the first call it has already resolved, so subsequent calls skip straight
 * to inference.
 */
export async function createTranscriber(localModelPath: string): Promise<Transcriber> {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = localModelPath;

  // Mutable so each transcribe() call's onProgress is the one forwarded to
  // while the (one-time) model load is still in flight; a call made after
  // loading has already finished simply never sees a progress event, since
  // there's nothing left to report.
  let currentOnProgress: ((p: number) => void) | undefined;

  const pipelinePromise = pipeline('automatic-speech-recognition', 'whisper-tiny.en', {
    dtype: 'q8',
    // `graphOptimizationLevel: 'disabled'` works around a real bug found
    // while building the real-mode E2E gate (tests/e2e/real-session.spec.ts):
    // onnxruntime-web's WASM backend fails to build a session from the
    // vendored decoder_model_merged_quantized.onnx at its default
    // optimization level ('all'), throwing
    //   "Can't create a session. ERROR_CODE: 1, ERROR_MESSAGE:
    //    qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits Missing
    //    required scale: model.decoder.embed_tokens.weight_merged_0_scale
    //    for node: model.decoder.embed_tokens.weight_transposed_DequantizeLinear"
    // -- a QDQ/MatMulNBits graph-transform pass choking on this exact
    // graph. Reproduced against both the dev snapshot originally resolved
    // by @huggingface/transformers@4.2.0's dependency range
    // (onnxruntime-web@1.26.0-dev.20260416-b7804b056c) and the stable
    // 1.26.0 release pinned via this repo's package.json `overrides` (so
    // it isn't a dev-build-only regression) -- the bug is in whichever
    // level-2/3 optimization pass performs this particular QDQ fusion, not
    // the specific build. `onnxruntime-node` (the Node.js native binding
    // tests/integration/whisper.test.ts runs against) does not hit this:
    // its default optimization pipeline apparently doesn't apply the same
    // problematic transform to this graph, which is exactly why this bug
    // was invisible to the integration test and only surfaced once a real
    // *browser* session made it far enough to attempt building the decoder
    // session (previously masked entirely by MEDIUM-2's model-path 404,
    // which failed before session creation was ever reached). Disabling
    // graph optimization avoids the buggy pass; the model is small enough
    // (whisper-tiny.en) that the loss of optimization is not a practical
    // performance concern.
    session_options: { graphOptimizationLevel: 'disabled' },
    progress_callback: (info) => {
      if (info.status === 'progress_total') {
        currentOnProgress?.(info.progress / 100);
      }
    },
  });

  return async (audio16k, onProgress) => {
    currentOnProgress = onProgress;
    try {
      const transcribe = await pipelinePromise;
      // NOT 'word' -- see the header comment for why (the vendored decoder
      // ONNX has no cross-attention outputs, which word-level timestamps
      // require).
      const output = await transcribe(audio16k, { return_timestamps: true, chunk_length_s: 30 });
      return toTimedWords(output.chunks, audio16k.length / SAMPLE_RATE_HZ);
    } finally {
      currentOnProgress = undefined;
    }
  };
}

interface AsrSegmentChunk {
  text: string;
  timestamp: [number, number | null];
}

/**
 * Converts segment-level `{ text, timestamp: [t0, t1] }` chunks into
 * per-word `TimedWord`s. Segment boundaries come straight from the model;
 * a word's position within its segment is estimated by distributing the
 * segment's span across its words proportionally to word length (a longer
 * word is assumed to take proportionally longer to say than a short one --
 * a coarse but reasonable stand-in for true forced alignment, which this
 * vendored model cannot produce -- see the header comment).
 */
function toTimedWords(chunks: AsrSegmentChunk[] | undefined, audioDurationS: number): TimedWord[] {
  const words: TimedWord[] = [];
  let lastEnd = 0;

  for (const chunk of chunks ?? []) {
    const segmentText = chunk.text.trim();
    if (!segmentText) continue;

    const tokens = segmentText.split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length === 0) continue;

    const [rawStart, rawEnd] = chunk.timestamp;
    const segStart = Math.max(rawStart, lastEnd);
    const segEndRaw = rawEnd == null ? audioDurationS : rawEnd;
    const segEnd = Math.max(segEndRaw, segStart);
    const segSpan = segEnd - segStart;

    const totalChars = tokens.reduce((sum, t) => sum + t.length, 0);

    let cursor = segStart;
    for (const token of tokens) {
      const share = (token.length || 1) / (totalChars || tokens.length);
      const t0 = cursor;
      const t1 = Math.min(segEnd, Math.max(t0, t0 + segSpan * share));
      words.push({ text: token, t0, t1 });
      cursor = t1;
    }
    lastEnd = Math.max(segEnd, cursor);
  }

  return words;
}
