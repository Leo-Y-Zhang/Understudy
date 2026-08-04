# Third-Party Assets

Understudy runs entirely client-side and same-origin: no runtime asset is
fetched from a third-party domain. This means all model weights and the
MediaPipe WASM runtime are vendored into this repository (under `public/`)
rather than loaded from a CDN. This file records exactly where each vendored
file came from, its licence, and the SHA-256 checksum printed by
`scripts/fetch-assets.mjs` when it produced these files.

Re-run `node scripts/fetch-assets.mjs` at any time to reproduce every file
below from scratch (the MediaPipe WASM files are copied from the local
`node_modules/@mediapipe/tasks-vision` install; everything else is
downloaded fresh and re-hashed).

## Why these exact filenames (version note)

The implementation plan this project started from assumed
`@mediapipe/tasks-vision@0.10.x` and `@huggingface/transformers@3.x`, but the
versions actually pinned in `package.json` are newer:
`@mediapipe/tasks-vision@1.0.1` and `@huggingface/transformers@4.2.0`. Both
file sets below were verified against the installed package source rather
than assumed from the plan:

- **MediaPipe WASM**: copied verbatim from whatever exists in
  `node_modules/@mediapipe/tasks-vision/wasm/` at install time (see script).
  For 1.0.1 that is the three `vision_wasm*_internal.{js,wasm}` pairs listed
  below (SIMD, non-SIMD, and a "module" variant) — there is no
  `wasm/` layout change relevant to this task, just different file names than
  the plan's placeholder.
- **Whisper ONNX file names**: `@huggingface/transformers@4.2.0` resolves the
  quantized (`dtype: 'q8'`) file names via
  `node_modules/@huggingface/transformers/src/utils/dtypes.js`
  (`DEFAULT_DTYPE_SUFFIX_MAPPING[q8] === '_quantized'`) combined with the
  per-architecture base session names in
  `node_modules/@huggingface/transformers/src/models/session_config.js`.
  Whisper (`WhisperForConditionalGeneration`) resolves to `MODEL_TYPES.Seq2Seq`
  (see `MODEL_FOR_SPEECH_SEQ_2_SEQ_MAPPING_NAMES` in
  `node_modules/@huggingface/transformers/src/models/registry.js:185-187`,
  mapped to `MODEL_TYPES.Seq2Seq` at `registry.js:560`), whose session config
  in `session_config.js:30-34` is:
  ```js
  sessions: () => ({ model: 'encoder_model', decoder_model_merged: 'decoder_model_merged' }),
  optional_configs: { generation_config: 'generation_config.json' },
  ```
  `get_model_files.js:80-96` (`add_model_file`) appends the q8 suffix and
  `onnx/` subfolder to each session base name, giving
  `onnx/encoder_model_quantized.onnx` and
  `onnx/decoder_model_merged_quantized.onnx` — i.e. the **same** file names
  the v3-era plan assumed, confirmed against v4.2.0 source rather than
  guessed. This is not just an introspection helper: `models/session.js:349-351`
  (`constructSessions`, the real model-loading path) uses the identical
  `DEFAULT_DTYPE_SUFFIX_MAPPING` from `dtypes.js`.
- **Tokenizer/config sidecars**: `tokenization_utils.js:28-33`
  (`loadTokenizer`, the real runtime tokenizer loader) calls
  `get_tokenizer_files.js`, which requests only `tokenizer.json` plus
  `tokenizer_config.json` (v4's Rust/WASM tokenizer backend
  `@huggingface/tokenizers` consumes the unified `tokenizer.json` format
  directly — no separate `vocab.json`/`merges.txt`/`normalizer.json` needed,
  unlike some older repos that still publish those files). Likewise
  `feature_extraction_utils.js:35` fetches `FEATURE_EXTRACTOR_NAME`
  (`preprocessor_config.json`, from `utils/constants.js:4`) directly. `config.json`
  is always fetched (`get_model_files.js:65-68`), and `generation_config.json`
  is fetched because Seq2Seq declares it as an `optional_config`
  (`session_config.js:33`).
- Cross-checked against the live HF API file listing for
  `onnx-community/whisper-tiny.en` (`GET
  https://huggingface.co/api/models/onnx-community/whisper-tiny.en`): the repo
  also publishes `vocab.json`, `merges.txt`, `normalizer.json`,
  `added_tokens.json`, `special_tokens_map.json`, and many other dtype
  variants of the ONNX files (`fp16`, `int8`, `uint8`, `q4`, `bnb4`, etc.) —
  none of those are requested by the v4.2.0 loading code above, so none are
  vendored.

## MediaPipe Tasks Vision (WASM runtime)

- **Source package**: `@mediapipe/tasks-vision@1.0.1` (npm), copied locally
  from `node_modules/@mediapipe/tasks-vision/wasm/*` — no network fetch.
- **Licence**: Apache-2.0 (per the package's `package.json`).
- **Destination**: `public/mediapipe/wasm/`

| File | Bytes | SHA-256 |
|---|---|---|
| `public/mediapipe/wasm/vision_wasm_internal.js` | 323377 | `e170ee67dd4e16c1a6fcd8840a206687e5a59b22c20e4a902bc445b095454d73` |
| `public/mediapipe/wasm/vision_wasm_internal.wasm` | 11756954 | `8da277a733926eacd0474b8704b36742d6ec3231c57a860c5b889dff8f1df886` |
| `public/mediapipe/wasm/vision_wasm_module_internal.js` | 323415 | `da8934057f147b622e82cfb4c0dbd85461c598e268588b5a8ba9ca963a8ff82d` |
| `public/mediapipe/wasm/vision_wasm_module_internal.wasm` | 11756972 | `2dabd8e23c60984628beb7bb338764c81a08e6837145273f59578684b5d53c1b` |
| `public/mediapipe/wasm/vision_wasm_nosimd_internal.js` | 323180 | `e81d715a3d42cc3373602eb2f7aff795d164934db680e32496b65dab537f9658` |
| `public/mediapipe/wasm/vision_wasm_nosimd_internal.wasm` | 10960242 | `a28483cd42e74e855bf5ebdb6b40d9b66a5b49e35e95020bc97669e6822a3192` |

## MediaPipe Face Landmarker model

- **Source URL**: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`
- **Licence**: Apache-2.0 (MediaPipe Model Maker / MediaPipe Solutions models
  are distributed under Apache-2.0; see
  https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE and the
  model card at
  https://storage.googleapis.com/mediapipe-tasks/face_landmarker/face_landmarker.md).
- **Destination**: `public/mediapipe/face_landmarker.task`

| File | Bytes | SHA-256 |
|---|---|---|
| `public/mediapipe/face_landmarker.task` | 3758596 | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |

## Whisper-tiny.en (ONNX, quantized) + transformers.js

- **Source repo**: `https://huggingface.co/onnx-community/whisper-tiny.en`
  (`resolve/main/...`), an ONNX export of OpenAI Whisper `tiny.en` republished
  by the `onnx-community` org for use with `@huggingface/transformers`.
- **Weights licence**: MIT (per the `onnx-community/whisper-tiny.en` model
  card; OpenAI's original Whisper weights are also MIT-licensed).
- **`@huggingface/transformers@4.2.0` (the loading library)**: Apache-2.0.
- **Destination**: `public/models/whisper-tiny.en/` — matches
  `env.localModelPath = './models/'` + model id `whisper-tiny.en` expected by
  `speech/whisper.worker.ts` (not yet implemented at the time this task
  ran — see `.superpowers/sdd/task-3-report.md` for confirmation that
  `src/capture/faceTracker.ts` and `src/speech/whisper.worker.ts` do not exist
  yet in this repo; the destination paths were derived from the task brief's
  documented interface instead).

| File | Bytes | SHA-256 | Source URL |
|---|---|---|---|
| `public/models/whisper-tiny.en/config.json` | 2197 | `251ea843b5901a99efa58c0b99b8052c6019aa3e7d2baf46693a1128ff606233` | `https://huggingface.co/onnx-community/whisper-tiny.en/resolve/main/config.json` |
| `public/models/whisper-tiny.en/generation_config.json` | 1646 | `7b2e8451ed5f118e75fdd991409d72119d21d2fef1eba9723f68fb9c57fe5dc9` | `https://huggingface.co/onnx-community/whisper-tiny.en/resolve/main/generation_config.json` |
| `public/models/whisper-tiny.en/tokenizer.json` | 2405679 | `5eb60cec1e77aeeb6869a2bb5a8e01a84c3fe5d072d75369343021fe6f5310d0` | `https://huggingface.co/onnx-community/whisper-tiny.en/resolve/main/tokenizer.json` |
| `public/models/whisper-tiny.en/tokenizer_config.json` | 282662 | `93879c3dccdd4b976f709acd85b44778873f30c275e67026f30ca1e4c975230c` | `https://huggingface.co/onnx-community/whisper-tiny.en/resolve/main/tokenizer_config.json` |
| `public/models/whisper-tiny.en/preprocessor_config.json` | 339 | `a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d` | `https://huggingface.co/onnx-community/whisper-tiny.en/resolve/main/preprocessor_config.json` |
| `public/models/whisper-tiny.en/onnx/encoder_model_quantized.onnx` | 10124993 | `e93ec822f16a8fd264e7de972ad17d615ea7334b75a52d54c50c2e18dd503a25` | `https://huggingface.co/onnx-community/whisper-tiny.en/resolve/main/onnx/encoder_model_quantized.onnx` |
| `public/models/whisper-tiny.en/onnx/decoder_model_merged_quantized.onnx` | 30718858 | `c0592d0749413c960569e1c7fb806b060d5d18f3ebad4a95cbf9a77dc6e9be52` | `https://huggingface.co/onnx-community/whisper-tiny.en/resolve/main/onnx/decoder_model_merged_quantized.onnx` |

## Totals

- **Files vendored**: 14
- **Total size**: 82,739,110 bytes (78.91 MiB)
- **Largest single file**: `public/models/whisper-tiny.en/onnx/decoder_model_merged_quantized.onnx` at 30,718,858 bytes (~29.3 MiB) — well under GitHub's 100 MB hard limit and the 95 MB cap `scripts/fetch-assets.mjs` enforces.

## Reproducing

```sh
node scripts/fetch-assets.mjs
```

The script copies the MediaPipe WASM runtime from the installed
`@mediapipe/tasks-vision` package, downloads the two remaining URL-sourced
assets, and prints the SHA-256 of every file it writes (the table above was
generated from that output on 2026-08-04, transformers.js commit
`2575352d61be1bf7225cf8f8b268a4678025fc58` of `onnx-community/whisper-tiny.en`
per the `X-Repo-Commit` response header at fetch time).
