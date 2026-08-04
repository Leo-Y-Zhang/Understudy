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
 *
 * Plain Node, zero dependencies (uses global `fetch`, `fs`, `crypto`).
 * Re-run any time to reproduce `public/mediapipe/**` and
 * `public/models/whisper-tiny.en/**` from scratch.
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
const WHISPER_BASE_URL = `https://huggingface.co/onnx-community/${WHISPER_MODEL_ID}/resolve/main/`;
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

/** @type {{ file: string, bytes: number, sha256: string, source: string }[]} */
const manifest = [];

function sha256File(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function recordFile(destPath, source) {
  const buf = await (await import('node:fs/promises')).readFile(destPath);
  const bytes = buf.length;
  if (bytes > MAX_FILE_BYTES) {
    throw new Error(
      `${path.relative(REPO_ROOT, destPath)} is ${bytes} bytes, which exceeds the ${MAX_FILE_BYTES} byte cap`,
    );
  }
  const sha256 = sha256File(buf);
  manifest.push({ file: path.relative(REPO_ROOT, destPath).split(path.sep).join('/'), bytes, sha256, source });
  console.log(`  ${path.relative(REPO_ROOT, destPath).padEnd(60)} ${String(bytes).padStart(10)} bytes  sha256:${sha256}`);
}

async function copyMediapipeWasm() {
  console.log(`\n[1/3] Copying MediaPipe WASM runtime from node_modules ...`);
  if (!existsSync(MEDIAPIPE_WASM_SRC)) {
    throw new Error(
      `MediaPipe wasm source not found at ${MEDIAPIPE_WASM_SRC}. Run "npm ci" first (need @mediapipe/tasks-vision installed).`,
    );
  }
  await mkdir(MEDIAPIPE_WASM_DEST, { recursive: true });
  const entries = await readdir(MEDIAPIPE_WASM_SRC, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const src = path.join(MEDIAPIPE_WASM_SRC, entry.name);
    const dest = path.join(MEDIAPIPE_WASM_DEST, entry.name);
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
  await recordFile(destPath, source ?? url);
}

async function fetchFaceLandmarker() {
  console.log(`\n[2/3] Downloading MediaPipe face_landmarker.task model ...`);
  await downloadFile(FACE_LANDMARKER_URL, FACE_LANDMARKER_DEST, FACE_LANDMARKER_URL);
}

async function fetchWhisperAssets() {
  console.log(`\n[3/3] Downloading Whisper-tiny.en model + tokenizer assets ...`);
  for (const relFile of WHISPER_FILES) {
    const url = WHISPER_BASE_URL + relFile;
    const dest = path.join(WHISPER_DEST_DIR, relFile);
    await downloadFile(url, dest, url);
  }
}

async function main() {
  await copyMediapipeWasm();
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
