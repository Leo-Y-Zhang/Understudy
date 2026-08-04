#!/usr/bin/env node
/**
 * fetch-assets.mjs
 *
 * Vendors all third-party model/runtime assets that Understudy needs to run
 * fully offline / same-origin (no third-party `connect-src` at runtime):
 *
 *   1. MediaPipe Tasks Vision WASM runtime — copied from the already-installed
 *      `@mediapipe/tasks-vision` npm package (no network call).
 *   2. MediaPipe `face_landmarker.task` model — downloaded from Google's
 *      public model bucket (version-independent URL).
 *   3. Whisper-tiny.en ONNX model + tokenizer/config sidecars — downloaded
 *      from the `onnx-community/whisper-tiny.en` Hugging Face repo, using the
 *      exact file set that `@huggingface/transformers@4.2.0` requests at
 *      runtime for `dtype: 'q8'` on the wasm backend (see THIRD_PARTY.md for
 *      the evidence trail).
 *   4. onnxruntime-web's WASM inference runtime — copied from the
 *      already-installed `onnxruntime-web` npm package (no network call).
 *      `@huggingface/transformers` defaults `env.backends.onnx.wasm.wasmPaths`
 *      to a `cdn.jsdelivr.net` URL whenever the host application hasn't set
 *      it itself (see node_modules/@huggingface/transformers/src/backends/onnx.js:337-357)
 *      -- a real bug found building tests/e2e/real-session.spec.ts: real
 *      transcription was silently fetching its inference engine from a
 *      public CDN, which is exactly the kind of third-party network request
 *      this app's whole privacy guarantee promises never happens. asr.ts
 *      (browser path only, via whisper.worker.ts) points `wasmPaths` at
 *      these vendored copies instead, for both the SIMD+threaded variant
 *      most browsers use and the plain SIMD+threaded variant Safari uses
 *      (no thread-atomics "asyncify" build) -- see whisper.worker.ts.
 *
 * Plain Node, zero dependencies (uses global `fetch`, `fs`, `crypto`).
 * Re-run any time to reproduce `public/mediapipe/**`,
 * `public/models/whisper-tiny.en/**`, and `public/onnxruntime-web/**` from
 * scratch.
 *
 * Usage:
 *   node scripts/fetch-assets.mjs
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, copyFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

const MAX_FILE_BYTES = 95 * 1024 * 1024; // GitHub hard limit is 100 MB; stay under 95 MB.

const MEDIAPIPE_WASM_SRC = path.join(
  REPO_ROOT,
  'node_modules',
  '@mediapipe',
  'tasks-vision',
  'wasm',
);
const MEDIAPIPE_WASM_DEST = path.join(PUBLIC_DIR, 'mediapipe', 'wasm');

const ONNXRUNTIME_WASM_SRC = path.join(REPO_ROOT, 'node_modules', 'onnxruntime-web', 'dist');
const ONNXRUNTIME_WASM_DEST = path.join(PUBLIC_DIR, 'onnxruntime-web');
// Only the two variants asr.ts actually selects between (see its header):
// the default (Chrome/Firefox/Edge) SIMD+threaded+asyncify build, and
// Safari's SIMD+threaded build without thread-atomics "asyncify" support.
// onnxruntime-web@1.26.0 ships several other variants (jsep, jspi, non-simd,
// non-threaded, ...) this app never requests -- not vendored.
const ONNXRUNTIME_WASM_FILES = [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
];

const FACE_LANDMARKER_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const FACE_LANDMARKER_DEST = path.join(PUBLIC_DIR, 'mediapipe', 'face_landmarker.task');

// Exact file set requested at runtime by @huggingface/transformers@4.2.0 for
// model id "whisper-tiny.en" (a Seq2Seq model) loaded via
// `env.localModelPath` with `dtype: 'q8'` on the wasm device:
//   - config.json                                    (always fetched)
//   - generation_config.json                          (Seq2Seq optional_configs)
//   - tokenizer.json + tokenizer_config.json          (loadTokenizer -> get_tokenizer_files)
//   - preprocessor_config.json                        (feature_extraction_utils -> FEATURE_EXTRACTOR_NAME)
//   - onnx/encoder_model_quantized.onnx               (session "model", q8 -> "_quantized" suffix)
//   - onnx/decoder_model_merged_quantized.onnx        (session "decoder_model_merged", q8 -> "_quantized" suffix)
// See THIRD_PARTY.md for the exact node_modules source lines backing this list.
const WHISPER_MODEL_ID = 'whisper-tiny.en';
const WHISPER_COMMIT_HASH = '2575352d61be1bf7225cf8f8b268a4678025fc58';
const WHISPER_BASE_URL = `https://huggingface.co/onnx-community/${WHISPER_MODEL_ID}/resolve/${WHISPER_COMMIT_HASH}/`;
const WHISPER_FILES = [
  'config.json',
  'generation_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'preprocessor_config.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];
const WHISPER_DEST_DIR = path.join(PUBLIC_DIR, 'models', WHISPER_MODEL_ID);

// Pinned SHA-256 of every file this script downloads over the network
// (never the MediaPipe WASM files -- those are a local copy from
// node_modules, not a network fetch, so there's no upstream to have
// changed under us). Values are exactly THIRD_PARTY.md's table -- the last
// known-good hash for each vendored file, reviewed and documented there.
// Checked in downloadFile() after every download: a mismatch means the
// upstream file changed (a re-release, a takedown-and-replace, or a
// compromised host/MITM) since this repo last reviewed it, and the run
// fails loudly instead of silently vendoring different bytes than what
// THIRD_PARTY.md claims ships. Bumping a pin here is a deliberate, reviewed
// action (re-run fetch-assets.mjs, diff the new hash against this map,
// update both together), not something that should ever happen silently.
const EXPECTED_SHA256 = {
  'public/mediapipe/face_landmarker.task':
    '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
  'public/models/whisper-tiny.en/config.json':
    '251ea843b5901a99efa58c0b99b8052c6019aa3e7d2baf46693a1128ff606233',
  'public/models/whisper-tiny.en/generation_config.json':
    '7b2e8451ed5f118e75fdd991409d72119d21d2fef1eba9723f68fb9c57fe5dc9',
  'public/models/whisper-tiny.en/tokenizer.json':
    '5eb60cec1e77aeeb6869a2bb5a8e01a84c3fe5d072d75369343021fe6f5310d0',
  'public/models/whisper-tiny.en/tokenizer_config.json':
    '93879c3dccdd4b976f709acd85b44778873f30c275e67026f30ca1e4c975230c',
  'public/models/whisper-tiny.en/preprocessor_config.json':
    'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d',
  'public/models/whisper-tiny.en/onnx/encoder_model_quantized.onnx':
    'e93ec822f16a8fd264e7de972ad17d615ea7334b75a52d54c50c2e18dd503a25',
  'public/models/whisper-tiny.en/onnx/decoder_model_merged_quantized.onnx':
    'c0592d0749413c960569e1c7fb806b060d5d18f3ebad4a95cbf9a77dc6e9be52',
};

/** @type {{ file: string, bytes: number, sha256: string, source: string }[]} */
const manifest = [];

function sha256File(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function recordFile(destPath, source, expectedSha256) {
  const buf = await (await import('node:fs/promises')).readFile(destPath);
  const bytes = buf.length;
  if (bytes > MAX_FILE_BYTES) {
    throw new Error(
      `${path.relative(REPO_ROOT, destPath)} is ${bytes} bytes, which exceeds the ${MAX_FILE_BYTES} byte cap`,
    );
  }
  const sha256 = sha256File(buf);
  if (expectedSha256 && sha256 !== expectedSha256) {
    throw new Error(
      `${path.relative(REPO_ROOT, destPath)}: SHA-256 mismatch -- expected ${expectedSha256}, got ${sha256}. ` +
        `The upstream file no longer matches THIRD_PARTY.md's pinned hash; refusing to vendor it unreviewed. ` +
        `If this is an intentional upstream update, review the new file, then update EXPECTED_SHA256 in this ` +
        `script and THIRD_PARTY.md together.`,
    );
  }
  manifest.push({ file: path.relative(REPO_ROOT, destPath).split(path.sep).join('/'), bytes, sha256, source });
  console.log(`  ${path.relative(REPO_ROOT, destPath).padEnd(60)} ${String(bytes).padStart(10)} bytes  sha256:${sha256}`);
}

async function copyMediapipeWasm() {
  console.log(`\n[1/4] Copying MediaPipe WASM runtime from node_modules ...`);
  if (!existsSync(MEDIAPIPE_WASM_SRC)) {
    throw new Error(
      `MediaPipe wasm source not found at ${MEDIAPIPE_WASM_SRC}. Run "npm ci" first (need @mediapipe/tasks-vision installed).`,
    );
  }
  // Allowlist of expected MediaPipe WASM files
  const expectedFiles = new Set([
    'vision_wasm_internal.js',
    'vision_wasm_internal.wasm',
    'vision_wasm_module_internal.js',
    'vision_wasm_module_internal.wasm',
    'vision_wasm_nosimd_internal.js',
    'vision_wasm_nosimd_internal.wasm',
  ]);
  await mkdir(MEDIAPIPE_WASM_DEST, { recursive: true });
  const entries = await readdir(MEDIAPIPE_WASM_SRC, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!expectedFiles.has(entry.name)) {
      throw new Error(
        `Unexpected file in MediaPipe WASM directory: ${entry.name}. Expected only: ${[...expectedFiles].join(', ')}`,
      );
    }
    const src = path.join(MEDIAPIPE_WASM_SRC, entry.name);
    const dest = path.join(MEDIAPIPE_WASM_DEST, entry.name);
    await copyFile(src, dest);
    await recordFile(dest, path.relative(REPO_ROOT, src).split(path.sep).join('/') + ' (node_modules, local copy)');
  }
}

async function copyOnnxRuntimeWasm() {
  console.log(`\n[2/4] Copying onnxruntime-web WASM runtime from node_modules ...`);
  if (!existsSync(ONNXRUNTIME_WASM_SRC)) {
    throw new Error(
      `onnxruntime-web dist not found at ${ONNXRUNTIME_WASM_SRC}. Run "npm ci" first (need onnxruntime-web installed -- it's a transitive dependency of @huggingface/transformers).`,
    );
  }
  await mkdir(ONNXRUNTIME_WASM_DEST, { recursive: true });
  for (const filename of ONNXRUNTIME_WASM_FILES) {
    const src = path.join(ONNXRUNTIME_WASM_SRC, filename);
    if (!existsSync(src)) {
      throw new Error(`Expected onnxruntime-web file not found: ${src}`);
    }
    const dest = path.join(ONNXRUNTIME_WASM_DEST, filename);
    await copyFile(src, dest);
    await recordFile(dest, path.relative(REPO_ROOT, src).split(path.sep).join('/') + ' (node_modules, local copy)');
  }
}

async function downloadFile(url, destPath, source) {
  await mkdir(path.dirname(destPath), { recursive: true });
  console.log(`  fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status} ${res.statusText}`);
  }
  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  await writeFile(destPath, buf);
  const relPath = path.relative(REPO_ROOT, destPath).split(path.sep).join('/');
  await recordFile(destPath, source ?? url, EXPECTED_SHA256[relPath]);
}

async function fetchFaceLandmarker() {
  console.log(`\n[3/4] Downloading MediaPipe face_landmarker.task model ...`);
  await downloadFile(FACE_LANDMARKER_URL, FACE_LANDMARKER_DEST, FACE_LANDMARKER_URL);
}

async function fetchWhisperAssets() {
  console.log(`\n[4/4] Downloading Whisper-tiny.en model + tokenizer assets ...`);
  for (const relFile of WHISPER_FILES) {
    const url = WHISPER_BASE_URL + relFile;
    const dest = path.join(WHISPER_DEST_DIR, relFile);
    await downloadFile(url, dest, url);
  }
}

async function main() {
  await copyMediapipeWasm();
  await copyOnnxRuntimeWasm();
  await fetchFaceLandmarker();
  await fetchWhisperAssets();

  const totalBytes = manifest.reduce((sum, m) => sum + m.bytes, 0);
  console.log(`\n=== Summary ===`);
  console.log(`Files vendored: ${manifest.length}`);
  console.log(`Total size: ${totalBytes} bytes (${(totalBytes / (1024 * 1024)).toFixed(2)} MiB)`);
  const largest = manifest.reduce((a, b) => (a.bytes > b.bytes ? a : b));
  console.log(`Largest file: ${largest.file} (${largest.bytes} bytes)`);
  if (largest.bytes > MAX_FILE_BYTES) {
    throw new Error(`Largest file exceeds the ${MAX_FILE_BYTES} byte cap`);
  }

  console.log(`\n=== Manifest (for THIRD_PARTY.md) ===`);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((err) => {
  console.error('\nfetch-assets failed:', err);
  process.exitCode = 1;
});
