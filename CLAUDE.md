# Understudy

A browser-only, no-backend interview-rehearsal studio: it scores on-device
delivery (eye contact, blinks, expression events, head steadiness, pace,
filler words) from webcam/mic via MediaPipe FaceLandmarker and an on-device
Whisper tiny.en transcription pipeline, producing an annotated replay and a
composure-score trend. Nothing recorded ever leaves the device — every model
file (MediaPipe, Whisper, onnxruntime-web) is vendored under `public/`.

## Directory layout

- `src/capture/` — camera/audio capture, face tracking, recorder.
- `src/core/` — pure, deterministic measurement core (blink/gaze/head/vad/
  expression/scoring/fluency) — this is what the unit suite targets.
- `src/speech/` — Whisper worker + ASR client.
- `src/data/`, `src/mock/`, `src/packs/`, `src/ui/` — IndexedDB storage, demo
  data, question packs, UI screens.
- `public/models/`, `public/mediapipe/`, `public/onnxruntime-web/` — vendored
  model/runtime assets (large; inflate a naive LOC count).
- `tests/unit/` (14 files), `tests/integration/` (real, non-mocked Whisper
  transcription, offline), `tests/e2e/` (Playwright: journey, privacy, a11y).
- `scripts/`, `docs/`.

## Install

```
npm ci
```
(CI and this repo's canonical command; the SessionStart hook uses
`npm install` instead so the container's cached `node_modules` layer is reused.)

## Lint / format / typecheck

```
npm run lint        # eslint src tests
npm run typecheck   # tsc --noEmit
```

## Test

```
npm run test:unit          # vitest run --dir tests/unit  (14 files, ~111 tests, ~2s)
npm run test:integration   # vitest run --dir tests/integration (real Whisper, offline, ~9s)
npm run test:e2e           # playwright test — see caveat below
```
Fastest useful subset — one unit file:
```
npx vitest run tests/unit/scoring.test.ts
```

## Verification gate (source of truth)

CI's `build` job (typecheck, lint, `test:unit`, build) plus `test:integration`
is what this repo can prove offline and is the practical gate for a web
session. `test:e2e` (9 Playwright tests: journey, privacy/zero-network, a11y)
is the repo's real end-to-end gate and is what CI's separate `e2e` job runs —
but see the environment caveat below before attempting it here.

## Environment caveats (from audit)

- **Playwright browser version mismatch.** This container's pre-installed
  browsers at `/opt/pw-browsers` are chromium/chromium-headless-shell
  revision **1194**, but the pinned `@playwright/test@1.62.1` in
  `package.json` expects revision **1234** — `browserType.launch` fails with
  "Executable doesn't exist". This is an environment/tooling mismatch, not an
  app defect: CI's `e2e` job installs its own matching browser
  (`npx playwright install --with-deps chromium`) every run. Do **not** run
  `playwright install` in this sandbox to "fix" it — there is no reason to
  expect network egress for a ~100MB browser download to succeed or be fast,
  and the hook does not attempt it. Expect `test:e2e` to fail here; rely on
  `test:unit` + `test:integration` instead.
- The hook exports `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` and
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` so `npm install` never tries (and
  fails/hangs) fetching a matching browser itself.
- `test:integration` needs zero network access by design
  (`env.allowRemoteModels=false`); if it tries to fetch anything, that's a
  regression, not a missing dependency.

## CI / conventions

- `ci.yml`: `build` job (`npm ci`, typecheck, lint, `test:unit`, build) on
  Node 22; separate `e2e` job installs its own Playwright browsers; a
  `gitleaks` job scans full history for secrets.
- `deploy.yml` publishes to GitHub Pages; not test-relevant.
- No coverage floor is enforced.
