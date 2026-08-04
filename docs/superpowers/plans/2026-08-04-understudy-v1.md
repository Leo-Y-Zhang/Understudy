# Understudy v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Understudy v1 — a browser-only interview rehearsal studio with on-device delivery analysis, annotated replay, scorecard, and local progress — live on GitHub Pages.

**Architecture:** Vite + TypeScript SPA, no UI framework. A pure `core/` measurement layer (typed time-series in, events + scores out; zero DOM deps) fed by a `capture/` layer (camera, MediaPipe FaceLandmarker on the main thread with GPU delegate, AudioWorklet RMS, MediaRecorder) and a `speech/` layer (Whisper tiny.en, WASM/q8, in a Web Worker, run post-answer). All model assets are vendored in-repo so the shipped CSP is `connect-src 'self'` — zero external requests at runtime.

**Tech Stack:** Vite 7, TypeScript 5 (strict), `@mediapipe/tasks-vision` (vendored WASM + `face_landmarker.task`), `@huggingface/transformers` (vendored `whisper-tiny.en` ONNX q8), Vitest, Playwright, GitHub Actions + Pages.

## Global Constraints

- **Privacy:** no runtime network request may leave the origin. CSP meta: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; worker-src 'self'; style-src 'self' 'unsafe-inline'`. The Web Speech API is **forbidden** (Chrome ships audio to Google servers).
- **Honesty:** no emotion/deception/personality claims anywhere in code, copy, or docs. Events are named neutrally ("expression event", never "leaked emotion"). The README honest-limits section is permanent policy.
- **Consent:** no `getUserMedia` call before the consent screen is accepted in this browser (persisted flag `understudy.consent.v1` in localStorage).
- **No real faces in the repo:** no sample footage, screenshots of real people, or face image fixtures. Fixtures are synthetic time-series JSON or SAPI-generated audio only.
- **Pinned everything:** all dependencies exact-version (no `^`/`~`) in package.json; GitHub Actions pinned to major versions.
- **Commits:** targeted paths only (never `git add -A`), plain-ASCII messages, push after every task. Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **TS:** `strict: true`, `noUncheckedIndexedAccess: true`. Lint clean before every commit.
- **All `core/` code is pure** — no DOM, no `Date.now()`, no I/O; time comes from the samples.
- Node commands run from repo root `C:\dev\Understudy` (`git -C` / absolute paths from the orchestrator).

## File Structure (final)

```
index.html                     app shell + CSP meta
public/mediapipe/              vendored wasm/ + face_landmarker.task
public/models/whisper-tiny.en/ vendored ONNX q8 + tokenizer/config
src/main.ts                    boot: consent gate -> app
src/ui/app.ts                  screen manager (show/hide, focus mgmt)
src/ui/screens/consent.ts      consent screen
src/ui/screens/home.ts         pack picker + past-session summary
src/ui/screens/question.ts     question + thinking timer
src/ui/screens/session.ts      recording UI (REC dot, elapsed, stop)
src/ui/screens/processing.ts   post-answer progress (transcribe/analyse)
src/ui/screens/replay.ts       video + annotated timeline + scorecard
src/ui/screens/dashboard.ts    trends, history, wipe/export
src/ui/format.ts               mm:ss, score colour helpers
src/core/types.ts              FaceSample, TimedWord, RmsSeries, DeliveryEvent, ...
src/core/config.ts             every tunable constant, documented
src/core/gaze.ts               eye-contact + gaze-break detector
src/core/blink.ts              blink + burst detector
src/core/expression.ts         transient expression-event detector
src/core/head.ts               head-steadiness / fidget detector
src/core/vad.ts                RMS -> speech/silence segments + pauses
src/core/fluency.ts            WPM, pace variability, fillers
src/core/scoring.ts            sub-scores + Composure composite
src/core/analyze.ts            analyzeSession(): merge everything
src/capture/camera.ts          getUserMedia + stream mgmt
src/capture/faceTracker.ts     FaceLandmarker wrapper -> FaceSample stream
src/capture/facemath.ts        pose Euler from matrix, gaze from iris (pure)
src/capture/audio.ts           AudioContext + worklet RMS series
src/capture/rms-worklet.ts     AudioWorkletProcessor (RMS per hop)
src/capture/recorder.ts        MediaRecorder + audio decode/resample to 16k
src/speech/whisperClient.ts    main-thread client for the worker
src/speech/whisper.worker.ts   transformers.js pipeline (local models)
src/data/db.ts                 IndexedDB sessions/replays + wipe/export
src/mock/mockTracker.ts        deterministic FaceSample/word source (?mock=1)
src/packs/general-admissions.json
tests/unit/*.test.ts           Vitest (core + facemath)
tests/integration/whisper.test.ts  local-only real-model test
tests/e2e/*.spec.ts            Playwright (mock mode) + a11y
scripts/fetch-assets.mjs       one-time vendoring script (pinned URLs)
scripts/make-sapi-fixture.ps1  synthesize test speech WAV (local only)
.github/workflows/ci.yml       typecheck+lint+unit+e2e+build
.github/workflows/deploy.yml   Pages deploy on main
```

## Core interfaces (single source of truth — every task conforms to these)

```ts
// src/core/types.ts
export interface FaceSample {
  t: number;            // seconds since answer start
  present: boolean;     // face detected this frame
  blend: Blend;         // blendshape scores 0..1
  yaw: number; pitch: number; roll: number;   // radians
  gazeX: number; gazeY: number;               // iris offset, -1..1, 0 = centred
}
export interface Blend {
  eyeBlinkLeft: number; eyeBlinkRight: number;
  browDownLeft: number; browDownRight: number;
  mouthPressLeft: number; mouthPressRight: number;
  mouthSmileLeft: number; mouthSmileRight: number;
}
export interface TimedWord { text: string; t0: number; t1: number }
export interface RmsSeries { hopS: number; values: Float32Array }
export interface VadSegment { t0: number; t1: number; speech: boolean }

export type EventType = 'gaze-break' | 'blink-burst' | 'expression' | 'fidget' | 'filler' | 'pause';
export interface DeliveryEvent {
  t0: number; t1: number; type: EventType;
  severity: 1 | 2 | 3;
  detail: string;       // human-readable, e.g. "gaze away 2.1s", "'um'"
}

export interface SubScores {
  eyeContact: number; blinkSteadiness: number; expressionControl: number;
  headSteadiness: number; pace: number; fluency: number;   // each 0..100
}
export interface SessionStats {
  durationS: number; eyeContactPct: number; blinksPerMin: number;
  wpm: number; paceCv: number; fillerCount: number; pauseCount: number;
  fidgetIndex: number; wordCount: number;
}
export interface SessionAnalysis {
  events: DeliveryEvent[];   // sorted by t0
  sub: SubScores; composure: number; stats: SessionStats;
}
export interface SessionInput {
  frames: FaceSample[]; words: TimedWord[]; rms: RmsSeries; durationS: number;
}
// src/core/analyze.ts
export function analyzeSession(input: SessionInput, cfg?: Partial<UnderstudyConfig>): SessionAnalysis;
```

Milestones: M1 = T1–T4 (skeleton + assets + face math), M2 = T5–T8 (face detectors), M3 = T9–T11 + T13 (speech), M4 = T12, T14–T15 (capture + session + replay), M5 = T16–T17 (dashboard, packs, E2E, deploy).

---

### Task 1: Scaffold, toolchain, CI

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`, `index.html`, `src/main.ts`, `src/styles.css`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `npm run dev|build|preview|typecheck|lint|test:unit` scripts every later task uses.

- [ ] **Step 1: package.json** — exact pinned versions (resolve latest stable with `npm view <pkg> version` first, then pin what it prints; the versions below are floors known-good at plan time):

```json
{
  "name": "understudy",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview --port 4173 --strictPort",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src tests",
    "test:unit": "vitest run --dir tests/unit",
    "test:integration": "vitest run --dir tests/integration",
    "test:e2e": "playwright test"
  }
}
```

devDependencies (pin exact): `typescript` (5.x), `vite` (7.x), `vitest` (3.x), `eslint` (9.x flat config), `typescript-eslint` (8.x), `@playwright/test` (1.5x), `@axe-core/playwright` (4.x). dependencies: `@mediapipe/tasks-vision` (0.10.x), `@huggingface/transformers` (3.x).

- [ ] **Step 2: tsconfig.json** — `"strict": true, "noUncheckedIndexedAccess": true, "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler", "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"]`, include `src`, `tests`, `scripts`.
- [ ] **Step 3: vite.config.ts** — `base: './'` (works locally and on Pages), `build: { target: 'es2022' }`.
- [ ] **Step 4: index.html** — CSP meta exactly as in Global Constraints; `<title>Understudy — rehearse the interview</title>`; `<div id="app"></div>`; module script `/src/main.ts`. `src/main.ts` renders `<h1>Understudy</h1>` placeholder. `src/styles.css`: minimal reset + `:root` custom properties (colors defined properly in T14 with the frontend-design skill).
- [ ] **Step 5: ci.yml** — on push/PR: `actions/checkout@v4`, `actions/setup-node@v4` (node 22, cache npm), `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build`. (E2E job added in T17.)
- [ ] **Step 6: Verify locally** — `npm install` (writes lockfile), `npm run typecheck && npm run lint && npm run build` all pass; `npm run dev` serves the placeholder.
- [ ] **Step 7: Commit+push** targeted paths; then `gh run watch` until CI green. Expected: green.

### Task 2: Core types + config

**Files:**
- Create: `src/core/types.ts` (exactly the interfaces above), `src/core/config.ts`
- Test: `tests/unit/config.test.ts`

**Interfaces:**
- Produces: `DEFAULT_CONFIG: UnderstudyConfig`, `resolveConfig(partial?): UnderstudyConfig`.

- [ ] **Step 1: Write `src/core/config.ts`** — every constant used by T5–T11, each with a one-line comment stating it is a heuristic band:

```ts
import type {} from './types';

export interface UnderstudyConfig {
  // gaze
  gazeXOn: number; gazeYOn: number;        // |offset| below which iris counts as centred (0.35 / 0.35)
  yawOn: number; pitchOn: number;          // |radians| below which head counts as facing camera (0.35 / 0.30)
  gazeHysteresisFrames: number;            // consecutive frames to switch state (3)
  gazeBreakMinS: number;                   // min off-camera run to report (0.3)
  // blink
  blinkOn: number; blinkOff: number;       // rising/falling thresholds on max(eyeBlinkL, eyeBlinkR) (0.5 / 0.35)
  blinkMinGapS: number;                    // debounce between blinks (0.1)
  burstCount: number; burstWindowS: number; // >=3 blinks within 2.0s = burst
  blinkIdealLo: number; blinkIdealHi: number; // 8..26 blinks/min scores 100
  blinkZeroLo: number; blinkZeroHi: number;   // 0 and 60 blinks/min score 0
  // expression
  exprBaselineS: number;                   // rolling median window (3.0)
  exprK: number;                           // MAD multiplier for onset (4)
  exprMadFloor: number;                    // MAD floor so flat baselines still gate (0.04)
  exprMinFrames: number;                   // sustained frames to count (2)
  exprTransientMaxS: number;               // events longer than this are not transient; dropped (0.5)
  // head
  headWindowS: number;                     // fidget RMS window (2.0)
  fidgetGood: number; fidgetBad: number;   // rad/s: <=0.05 -> 100, >=0.35 -> 0
  // vad
  vadNoisePercentile: number;              // noise floor percentile (0.10)
  vadFactor: number;                       // speech threshold = max(floor*factor, vadAbsMin) (3)
  vadAbsMin: number;                       // absolute RMS minimum (0.01)
  vadHangoverS: number;                    // keep speech state after drop (0.3)
  pauseMinS: number;                       // mid-answer silence to report (1.5)
  // fluency & pace
  fillerSingles: string[];                 // ['um','uh','er','erm','like','basically']
  fillerPhrases: string[][];               // [['you','know'],['sort','of'],['kind','of'],['i','mean']]
  paceIdealLo: number; paceIdealHi: number; // 110..160 wpm scores 100
  paceZeroLo: number; paceZeroHi: number;   // 60 and 220 wpm score 0
  rollingWpmWindowS: number;               // 10
  paceCvPenaltyAbove: number;              // CV above this costs points (0.4)
  // scoring weights (sum = 1.0)
  wEyeContact: number; wFluency: number; wPace: number;
  wExpression: number; wBlink: number; wHead: number; // .22 .22 .16 .14 .13 .13
}
export const DEFAULT_CONFIG: UnderstudyConfig = { /* the values in comments above */ };
export function resolveConfig(p?: Partial<UnderstudyConfig>): UnderstudyConfig {
  return { ...DEFAULT_CONFIG, ...p };
}
```

- [ ] **Step 2: Failing test** `tests/unit/config.test.ts`: weights sum to 1.0 within 1e-9; `resolveConfig({exprK: 5}).exprK === 5` and does not mutate `DEFAULT_CONFIG`. Run: `npm run test:unit` → FAIL (module missing).
- [ ] **Step 3: Implement** the file with all values. **Step 4:** tests pass. **Step 5:** Commit+push `src/core/types.ts src/core/config.ts tests/unit/config.test.ts`.

### Task 3: Vendor model assets (offline-pure runtime)

**Files:**
- Create: `scripts/fetch-assets.mjs`, `public/mediapipe/**`, `public/models/whisper-tiny.en/**`, `THIRD_PARTY.md`

**Interfaces:**
- Produces: asset paths used by `capture/faceTracker.ts` (`./mediapipe/wasm`, `./mediapipe/face_landmarker.task`) and `speech/whisper.worker.ts` (`env.localModelPath = './models/'`, model id `whisper-tiny.en`).

- [ ] **Step 1: Write `scripts/fetch-assets.mjs`** (plain node, no deps): downloads to `public/` —
  - MediaPipe WASM: the `wasm/` directory contents of the installed `@mediapipe/tasks-vision` npm package (copy from `node_modules/@mediapipe/tasks-vision/wasm/*` — no network needed).
  - `face_landmarker.task` from `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`.
  - Whisper: from `https://huggingface.co/onnx-community/whisper-tiny.en/resolve/main/` — `config.json`, `generation_config.json`, `tokenizer.json`, `tokenizer_config.json`, `preprocessor_config.json`, and `onnx/encoder_model_quantized.onnx`, `onnx/decoder_model_merged_quantized.onnx` into `public/models/whisper-tiny.en/{,onnx/}`. Print SHA-256 of each file.
- [ ] **Step 2: Run it**; verify every file exists and no file exceeds 95 MB (GitHub hard limit is 100 MB). Record printed hashes in `THIRD_PARTY.md` along with licences (MediaPipe model: Apache-2.0; Whisper weights: MIT; transformers.js: Apache-2.0) and the exact source URLs.
- [ ] **Step 3: Commit+push** (`public/mediapipe public/models scripts/fetch-assets.mjs THIRD_PARTY.md`). This is a large commit; that is expected and one-time.

### Task 4: Face math (pose Euler + iris gaze), pure

**Files:**
- Create: `src/capture/facemath.ts`
- Test: `tests/unit/facemath.test.ts`

**Interfaces:**
- Produces: `eulerFromMatrix(data: ArrayLike<number>): { yaw: number; pitch: number; roll: number }` (column-major 4x4, radians, YXZ order); `gazeFromLandmarks(lm: ArrayLike<{x:number;y:number}>): { gazeX: number; gazeY: number }`; `toFaceSample(t, result): FaceSample` assembling the core type from a MediaPipe `FaceLandmarkerResult`-shaped object (typed structurally so core never imports MediaPipe types).
- Landmark indices (MediaPipe FaceMesh + iris): left iris centre **468**, right iris centre **473**; left eye corners **33** (outer) / **133** (inner); right eye corners **362** (inner) / **263** (outer); left eyelids **159** (upper) / **145** (lower); right eyelids **386** (upper) / **374** (lower). Per-eye `gazeX = (iris.x - mid(corners).x) / (halfWidth)`, `gazeY = (iris.y - mid(lids).y) / (halfHeight)`; final = mean of both eyes, clamped to [-1, 1].

- [ ] **Step 1: Failing tests** — build a column-major matrix from known yaw/pitch/roll with a local helper that applies the SAME YXZ convention, assert `eulerFromMatrix` round-trips (|err| < 1e-6) for a grid of angles in ±60°; identity matrix → all zeros; synthetic landmark set with iris exactly at eye centre → gazeX≈0, gazeY≈0; iris at inner corner → gazeX ≈ ±1 with the documented sign (left eye inner corner is +x for the left eye… assert against the helper-constructed geometry, not intuition).
- [ ] **Step 2:** run → FAIL. **Step 3:** implement (rotation part r_ij = m[j*4+i]; `pitch = asin(clamp(-r12? …))` — derive from the same convention the test helper uses; the round-trip test is the arbiter). **Step 4:** pass. **Step 5:** Commit+push. *(A manual sign calibration against the real camera happens in T12's HUD step; if signs flip, fix here, tests updated to match — document the final convention in the file header.)*

### Task 5: Gaze / eye-contact detector

**Files:**
- Create: `src/core/gaze.ts`
- Test: `tests/unit/gaze.test.ts`

**Interfaces:**
- Consumes: `FaceSample[]`, `UnderstudyConfig`.
- Produces: `export function detectGaze(frames: FaceSample[], cfg: UnderstudyConfig): { events: DeliveryEvent[]; eyeContactPct: number }`.

- [ ] **Step 1: Failing tests** (use a `mkFrames(spec: Array<[durS, on: boolean]>)` fixture helper at 30 fps producing centred/averted samples — helper lives in `tests/unit/helpers.ts`, shared by later tasks; averted = gazeX 0.9, on = all zeros):

```ts
import { detectGaze } from '../../src/core/gaze';
import { DEFAULT_CONFIG as cfg } from '../../src/core/config';
import { mkFrames } from './helpers';

test('all on-camera: 100pct, no events', () => {
  const r = detectGaze(mkFrames([[10, true]]), cfg);
  expect(r.eyeContactPct).toBeCloseTo(100, 0);
  expect(r.events).toHaveLength(0);
});
test('2s break mid-answer -> one gaze-break event, severity 3', () => {
  const r = detectGaze(mkFrames([[4, true], [2, false], [4, true]]), cfg);
  expect(r.events).toHaveLength(1);
  const e = r.events[0]!;
  expect(e.type).toBe('gaze-break');
  expect(e.t1 - e.t0).toBeCloseTo(2, 0);
  expect(e.severity).toBe(3);
  expect(r.eyeContactPct).toBeCloseTo(80, 0);
});
test('single-frame flicker is absorbed by hysteresis', () => {
  const frames = mkFrames([[5, true]]);
  frames[75] = { ...frames[75]!, gazeX: 0.9 };   // one averted frame
  expect(detectGaze(frames, cfg).events).toHaveLength(0);
});
test('face absent counts as off-camera', () => {
  const frames = mkFrames([[2, true], [1, true], [2, true]]);
  for (let i = 60; i < 90; i++) frames[i] = { ...frames[i]!, present: false };
  const r = detectGaze(frames, cfg);
  expect(r.events).toHaveLength(1);
});
test('empty input -> 0pct, no events', () => {
  const r = detectGaze([], cfg);
  expect(r.eyeContactPct).toBe(0);
  expect(r.events).toHaveLength(0);
});
```

- [ ] **Step 2:** run → FAIL (module missing). 
- [ ] **Step 3: Implement** — per-frame raw classification `on = present && |gazeX|<gazeXOn && |gazeY|<gazeYOn && |yaw|<yawOn && |pitch|<pitchOn`; a state machine flips only after `gazeHysteresisFrames` consecutive opposite frames; contiguous off runs ≥ `gazeBreakMinS` become events (severity: ≥2s → 3, ≥1s → 2, else 1, detail `gaze away ${dur.toFixed(1)}s`); `eyeContactPct = 100 * onFrames / frames.length` (0 for empty).
- [ ] **Step 4:** pass. **Step 5:** Commit+push.

### Task 6: Blink + burst detector

**Files:**
- Create: `src/core/blink.ts`; Test: `tests/unit/blink.test.ts`

**Interfaces:**
- Produces: `export function detectBlinks(frames: FaceSample[], cfg: UnderstudyConfig): { blinkTimes: number[]; events: DeliveryEvent[]; blinksPerMin: number }` (events are `blink-burst` only — individual blinks are stats, not timeline noise).

- [ ] **Step 1: Failing tests** — helper `withBlinks(frames, atSeconds: number[])` sets `eyeBlinkLeft/Right` to 0.9 for 3 frames at each time: 3 blinks spread over 60s → `blinkTimes.length === 3`, `blinksPerMin ≈ 3`, no events; 4 blinks inside 1.8s → one `blink-burst` event spanning first-to-last, severity 2 (5+ blinks → 3); signal that rises to 0.45 only (below `blinkOn`) → no blink; two threshold crossings 50 ms apart (< `blinkMinGapS`) → one blink; empty input → zeros.
- [ ] **Step 2:** FAIL. **Step 3: Implement** — rising-edge on `max(eyeBlinkLeft, eyeBlinkRight)` crossing `blinkOn` while previous state below `blinkOff`, debounced by `blinkMinGapS`; bursts via sliding window (`burstCount` onsets within `burstWindowS`), overlapping windows merged into one event. **Step 4:** pass. **Step 5:** Commit+push.

### Task 7: Expression-event detector

**Files:**
- Create: `src/core/expression.ts`; Test: `tests/unit/expression.test.ts`

**Interfaces:**
- Produces: `export function detectExpressionEvents(frames: FaceSample[], cfg: UnderstudyConfig): DeliveryEvent[]`. Channels: `browFurrow = mean(browDownL, browDownR)`, `lipPress = mean(mouthPressL, mouthPressR)`, `smileAsym = |mouthSmileL - mouthSmileR|`. Detail strings: `brow furrow`, `lip press`, `asymmetric smile`.

- [ ] **Step 1: Failing tests** — flat baseline 0.05 with one 0.3s excursion to 0.6 on browDown channels → exactly one event, type `expression`, detail `brow furrow`, duration ≈0.3s; the same excursion lasting 1.2s → **zero** events (not transient; deliberate expressions are not flagged); constant high browDown from t=0 (a furrowed resting face) → zero events (baseline adapts); tiny excursion to baseline+0.02 → zero events (below `exprK * exprMadFloor`); two channels spiking simultaneously → two events with distinct details.
- [ ] **Step 2:** FAIL. **Step 3: Implement** — per channel: rolling median + MAD over trailing `exprBaselineS`; onset when value > median + `exprK * max(MAD, exprMadFloor)` for ≥ `exprMinFrames`; offset when value < median + `exprK/2 * max(MAD, exprMadFloor)`; keep only events with duration ≤ `exprTransientMaxS`; severity 1 (2 if amplitude > 2× threshold). O(n·w) rolling window is fine at 30 fps. **Step 4:** pass. **Step 5:** Commit+push.

### Task 8: Head-steadiness detector

**Files:**
- Create: `src/core/head.ts`; Test: `tests/unit/head.test.ts`

**Interfaces:**
- Produces: `export function headSteadiness(frames: FaceSample[], cfg: UnderstudyConfig): { fidgetIndex: number; events: DeliveryEvent[] }`. `fidgetIndex` = session RMS of per-frame angular speed `sqrt(dyaw^2 + dpitch^2 + droll^2) / dt` (rad/s). Events (`fidget`): 2s windows whose RMS exceeds `max(2 * sessionMedian, fidgetGood * 2)`, merged when adjacent, severity 2.

- [ ] **Step 1: Failing tests** — perfectly still frames → `fidgetIndex ≈ 0`, no events; constant slow drift (0.02 rad/s) → small index, no events; still baseline with a 2s violent shake (0.5 rad/s) → one event covering the shake; empty/single frame → zeros. 
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** pass. **Step 5:** Commit+push.

### Task 9: VAD + pause detector

**Files:**
- Create: `src/core/vad.ts`; Test: `tests/unit/vad.test.ts`

**Interfaces:**
- Produces: `export function segmentSpeech(rms: RmsSeries, cfg: UnderstudyConfig): VadSegment[]` (alternating, covering [0, duration]); `export function detectPauses(segments: VadSegment[], cfg: UnderstudyConfig): DeliveryEvent[]` — silences ≥ `pauseMinS` strictly between the first and last speech segments (lead-in thinking time and trailing silence are NOT pauses). Severity: ≥3s → 3, ≥2.25s → 2, else 1. Detail: `pause ${dur.toFixed(1)}s`.

- [ ] **Step 1: Failing tests** — synthetic RMS (hop 0.05): 2s silence (0.001) + 5s speech (0.1) + 2s silence + 5s speech + 3s silence → segments correctly typed; exactly one pause event (the middle 2s), the lead-in and tail excluded; hangover: a 0.2s dip inside speech does not split the segment; all-silence input → one silence segment, no pauses; threshold adapts (speech at 0.02 over noise floor 0.001 still detected).
- [ ] **Step 2:** FAIL. **Step 3:** Implement — noise floor = `vadNoisePercentile` percentile of values; threshold = `max(floor * vadFactor, vadAbsMin)`; hysteresis with `vadHangoverS`. **Step 4:** pass. **Step 5:** Commit+push.

### Task 10: Fluency (WPM, pace, fillers)

**Files:**
- Create: `src/core/fluency.ts`; Test: `tests/unit/fluency.test.ts`

**Interfaces:**
- Consumes: `TimedWord[]`, `VadSegment[]` (for speaking time), cfg.
- Produces: `export function fluency(words: TimedWord[], segments: VadSegment[], cfg: UnderstudyConfig): { wpm: number; paceCv: number; fillerEvents: DeliveryEvent[]; wordCount: number }`. Normalization: lowercase, strip leading/trailing non-letters. `wpm = wordCount / speakingTimeS * 60` (speakingTime = sum of speech segments; falls back to `last.t1 - first.t0` if no segments). Rolling WPM over `rollingWpmWindowS` windows stepped 1s → `paceCv = std/mean` (0 when <2 windows). Filler events: singles from `fillerSingles`; phrase bigrams from `fillerPhrases` (event spans both words, detail `'you know'`); severity always 1.

- [ ] **Step 1: Failing tests** — 150 words spread over exactly 60s of speech → `wpm ≈ 150`; transcript `"So, um, I think, you know, the answer is..."` (constructed as TimedWords) → filler events for `'um'` and `'you know'` only (the `so` and `I think` are not in the lexicon; `i mean` phrase is); `"I like maths"` → `like` IS flagged (documented heuristic: all instances count) — assert 1 filler and assert the detail string so the limitation is pinned by a test; punctuation stripped (`"Um,"` matches `um`); empty input → zeros, no NaN.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** pass. **Step 5:** Commit+push.

### Task 11: Scoring + analyzeSession

**Files:**
- Create: `src/core/scoring.ts`, `src/core/analyze.ts`; Test: `tests/unit/scoring.test.ts`, `tests/unit/analyze.test.ts`

**Interfaces:**
- Produces: `export function scoreSession(parts, cfg): { sub: SubScores; composure: number }` where `parts = { eyeContactPct, blinksPerMin, burstCount, expressionEvents, fidgetIndex, wpm, paceCv, fillerEvents, pauseEvents, durationS }`; and `analyzeSession(input: SessionInput, cfg?): SessionAnalysis` wiring T5–T10 together, merging all events sorted by `t0`.
- Score maps (all clamp 0..100, all in scoring.ts, all pure): eyeContact `= 100 * clamp01((pct - 40) / 50)`; blink: 100 inside `[blinkIdealLo, blinkIdealHi]`, linear to 0 at `blinkZeroLo`/`blinkZeroHi`, minus 5 per burst; expression `= 100 - Σ(sev1:8, sev2:12, sev3:18)`; head: 100 at ≤`fidgetGood`, linear to 0 at ≥`fidgetBad`; pace: 100 inside ideal band, linear to 0 at zero bounds, minus `20 * max(0, paceCv - paceCvPenaltyAbove)`; fluency `= 100 - 12 * max(0, fillersPerMin - 1) - Σ pause(sev1:4, sev2:8, sev3:14)`. Composure = weighted sum with the six config weights.

- [ ] **Step 1: Failing tests** — a "perfect delivery" parts object (95% eye contact, 15 blinks/min, no events, fidget 0.03, 135 wpm, CV 0.2) → every sub-score ≥ 95 and composure ≥ 95; a "rough delivery" (50% eye contact, 45 blinks/min + 2 bursts, 6 expression events, fidget 0.4, 80 wpm CV 0.6, 8 fillers/min, 3 sev-3 pauses) → composure < 40 and every sub-score strictly less than the perfect case's; monotonicity spot-checks (more fillers never raises fluency; eyeContact(70) between eyeContact(50) and eyeContact(90)); all outputs finite and clamped for zero-duration input. `analyze.test.ts`: build a full 60s synthetic `SessionInput` (frames with one gaze break + one blink burst; words with 2 fillers; rms with 1 pause) → events of all expected types present, sorted; stats populated; composure in (0, 100).
- [ ] **Step 2:** FAIL. **Step 3:** Implement both files. **Step 4:** pass. **Step 5:** Commit+push. *(M2+M3 core complete: the measurement layer is now fully specified by executable tests.)*

### Task 12: Capture layer + live HUD (first real screen)

**Files:**
- Create: `src/capture/camera.ts`, `src/capture/faceTracker.ts`, `src/capture/audio.ts`, `src/capture/rms-worklet.ts`, `src/capture/recorder.ts`, `src/mock/mockTracker.ts`
- Modify: `src/main.ts` (boot a bare setup screen with HUD for manual verification)

**Interfaces:**
- Produces: `Camera` (`start(): Promise<MediaStream>`, `stop()`); `FaceTracker` (`start(video, onSample: (s: FaceSample) => void)`, `stop()`; constructed with asset base path; uses `FilesetResolver.forVisionTasks('./mediapipe/wasm')` + `FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: './mediapipe/face_landmarker.task', delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true })`, driven by `video.requestVideoFrameCallback`, converting via `toFaceSample` from T4; GPU delegate failure falls back to CPU delegate); `AudioMeter` (`start(stream) -> void`, `stopAndGetSeries(): RmsSeries`, AudioWorklet at hop 0.05s); `Recorder` (`start(stream)`, `stop(): Promise<{ blob: Blob; audio16k: Float32Array }>` — decode via `AudioContext.decodeAudioData`, resample to 16 kHz mono with `OfflineAudioContext`); `MockTracker` implementing the same `FaceTracker` interface emitting deterministic samples (used when `location.search` contains `mock=1`).
- HUD (temporary dev screen, becomes the T14 setup screen): live video, landmark dots on an overlay canvas, live meters for gaze/yaw/blink values.

- [ ] **Step 1:** Implement capture modules (no unit tests — this is the I/O shell; its logic lives in already-tested facemath/core. TS strict + lint are the gate here, plus the manual step below).
- [ ] **Step 2: MANUAL CALIBRATION (orchestrator, real webcam, self-consent):** run `npm run dev`, verify: face detected; turning head left/right moves yaw with the documented sign (fix `facemath.ts` + its tests if flipped); looking at screen edges moves gazeX/gazeY as documented; blink meter spikes on blinks. Record the verified sign conventions in `facemath.ts`'s header comment.
- [ ] **Step 3:** `npm run build && npm run preview` — verify the deployed-shape app loads models from `./mediapipe/` with zero external requests (devtools network tab). 
- [ ] **Step 4:** Commit+push.

### Task 13: Whisper worker + integration test

**Files:**
- Create: `src/speech/whisper.worker.ts`, `src/speech/whisperClient.ts`, `scripts/make-sapi-fixture.ps1`, `tests/integration/whisper.test.ts`
- Test fixture: `tests/integration/fixtures/spoken.wav` (SAPI-synthesized — no real person)

**Interfaces:**
- Produces: `transcribe(audio16k: Float32Array, onProgress?: (p: number) => void): Promise<TimedWord[]>` (whisperClient, wraps the worker). Worker: `import { pipeline, env } from '@huggingface/transformers'`; `env.allowRemoteModels = false; env.allowLocalModels = true; env.localModelPath = new URL('../../models/', import.meta.url)... (resolve to './models/' at runtime)`; `pipeline('automatic-speech-recognition', 'whisper-tiny.en', { device: 'wasm', dtype: 'q8' })`; call with `{ return_timestamps: 'word', chunk_length_s: 30 }`; map `output.chunks` (`{ text, timestamp: [t0, t1] }`) → `TimedWord[]` (null end-timestamp on the final chunk → clamp to audio duration).
- `make-sapi-fixture.ps1`: `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile(...16kHz mono...); $s.Speak('Hello um I think the answer is that plants um convert light into energy')` — a synthetic voice, committed once.
- Integration test (local-only, excluded from CI by directory): load the wav, decode to Float32Array via a small WAV parser in the test, run `transcribe` **in Node via vitest with the same pipeline options but `env.localModelPath = 'public/models/'`**, assert ≥8 words, at least one `um` present, timestamps monotonically non-decreasing.

- [ ] **Step 1:** Write worker + client + protocol (`{type:'transcribe'|'progress'|'result'|'error'}`). **Step 2:** Generate + commit the SAPI fixture. **Step 3:** Failing integration test → run `npm run test:integration` → FAIL (not implemented), then pass after implementation. Expected runtime: tens of seconds (model load + WASM transcription) — set test timeout 300s. **Step 4:** Browser smoke: dev server, `?mock=1` path replaced by a dev-only button that transcribes the fixture wav fetched same-origin; verify words render and network tab stays same-origin. **Step 5:** Commit+push.

### Task 14: Session flow UI (consent → home → question → session → processing)

**Files:**
- Create: `src/ui/app.ts`, `src/ui/screens/{consent,home,question,session,processing}.ts`, `src/ui/format.ts`, `src/packs/general-admissions.json`
- Modify: `src/main.ts`, `src/styles.css`

**Interfaces:**
- Consumes: Camera/FaceTracker/AudioMeter/Recorder (T12), `transcribe` (T13), `analyzeSession` (T11).
- Produces: `App` screen manager (`show(name, props)`; moves focus to the new screen's `h1`; all screens are `<section role="region" aria-labelledby=...>`); a completed session yields `{ question, packId, startedAt, durationS, analysis, replayBlob }` handed to the T15 replay screen. Question pack JSON schema: `{ id, title, questions: [{ id, text, thinkingS, suggestedAnswerS }] }`.
- Behaviour contract: consent screen fully explains what is measured + on-device guarantee + how to verify (network tab) + data controls; **Accept** persists `understudy.consent.v1` and only then may any screen call `getUserMedia`. Home: pick pack → random unasked question. Question screen: shows question + thinking countdown (`thinkingS`, default 30s, skippable button "I'm ready"); then session screen auto-starts capture+recording. Session: subtle REC dot + elapsed + big Stop button (Space/Enter accessible); collects FaceSamples + RMS. Processing screen: determinate progress (transcribing p%) then "analysing"; calls analyzeSession; on completion routes to replay. Mock mode (`?mock=1`): MockTracker + canned `TimedWord[]` + synthetic RMS, no getUserMedia, no Whisper — the E2E path.
- **Use the frontend-design skill before writing the visual layer** — this is the product's face; it must NOT look templated. Design tokens in `:root`; dark + light via `prefers-color-scheme`; WCAG AA contrast; visible focus rings; all interactive elements keyboard-reachable; `prefers-reduced-motion` respected.
- Question pack content (write all 30 in the JSON, these five verbatim plus 25 more in the same spirit — general UK admissions, no subject lock-in): "Why do you want to study your chosen subject?", "Tell me about something you have read or watched recently that changed how you think.", "Describe a time you got something badly wrong. What did you do next?", "What would you want to explore beyond your current syllabus, and why?", "Explain something you find genuinely fascinating to someone who has never met the idea."

- [ ] **Step 1:** Invoke frontend-design skill; define tokens + type scale. **Step 2:** Implement screens + pack JSON. **Step 3:** Manual E2E in dev (real camera, self-consent) AND `?mock=1` run end-to-end to processing. **Step 4:** `npm run build`, lint, typecheck. **Step 5:** Commit+push.

### Task 15: Replay screen (annotated timeline + scorecard)

**Files:**
- Create: `src/ui/screens/replay.ts`
- Test: `tests/unit/timeline.test.ts` (pure timeline-layout helper)

**Interfaces:**
- Consumes: session result object from T14.
- Produces: replay screen with (a) `<video>` playing the replay blob (`URL.createObjectURL`, revoked on leave); (b) a timeline (single `<canvas>` + DOM overlay for a11y): one lane per event type, events as rounded marks at their time span, colour by severity — **consult the dataviz skill for colours/encodings**; click/Enter on an event seeks the video to `max(0, t0 - 0.5)`; playhead tracks `timeupdate`; (c) scorecard: Composure number + six sub-score bars + stats row (duration, eye-contact %, WPM, fillers, pauses, blinks/min); (d) an accessible event list (`<ol>`) mirroring the canvas (each item a button: `[0:23] filler — 'um'`), the canvas is `aria-hidden` (the list IS the accessible timeline); (e) "Save replay locally" opt-in toggle + "Practise again" / "Dashboard" actions.
- Pure helper for testability: `export function layoutTimeline(events: DeliveryEvent[], durationS: number, widthPx: number): Array<{ event: DeliveryEvent; x: number; w: number; lane: number }>` — lanes stable by type order [gaze-break, blink-burst, expression, fidget, pause, filler]; `x = t0/duration*width`; `w = max(6, (t1-t0)/duration*width)`.

- [ ] **Step 1: Failing test** for `layoutTimeline`: events map to correct lanes/x/w; zero-duration event gets min-width 6; empty events → empty layout; events beyond duration clamp to width. **Step 2:** FAIL → implement → pass. **Step 3:** Implement the screen; manual verify with `?mock=1` (deterministic events) and a real self-consented session. **Step 4:** Commit+push.

### Task 16: Persistence + dashboard

**Files:**
- Create: `src/data/db.ts`, `src/ui/screens/dashboard.ts`
- Test: `tests/unit/db.test.ts` (against `fake-indexeddb`, add as pinned devDependency)

**Interfaces:**
- Produces: `openDb(): Promise<UnderstudyDb>` with `saveSession(rec: SessionRecord): Promise<string>`, `listSessions(): Promise<SessionRecord[]>` (newest first), `saveReplay(id, blob)`, `getReplay(id): Promise<Blob | null>`, `deleteSession(id)` (cascades replay), `wipeAll(): Promise<void>`, `exportJson(): Promise<string>` (metrics only, never blobs). `SessionRecord = { id, startedAt: number, packId, questionId, questionText, durationS, stats, sub, composure, events, hasReplay }`. DB `understudy` v1, stores `sessions` (keyPath `id`) + `replays` (keyPath `id`).
- Dashboard: composure trend across sessions (line/spark — dataviz skill), per-sub-score latest vs best, session history list (open replay if saved, else scorecard-only view), Export JSON button (downloads via blob URL), **Wipe everything** button with an explicit typed-out confirm (`type DELETE`) that calls `wipeAll` and shows the empty state.

- [ ] **Step 1: Failing db tests:** save→list round-trips and sorts newest-first; `exportJson` contains stats but no blob fields; `wipeAll` empties both stores; `deleteSession` removes its replay. **Step 2:** FAIL → implement → pass. **Step 3:** Implement dashboard screen; wire "session complete" to `saveSession` (+ `saveReplay` when opted in). **Step 4:** Manual verify with mock sessions; build+lint+typecheck. **Step 5:** Commit+push.

### Task 17: E2E, a11y, CI-complete, Pages deploy, release

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/journey.spec.ts`, `tests/e2e/privacy.spec.ts`, `tests/e2e/a11y.spec.ts`, `.github/workflows/deploy.yml`
- Modify: `.github/workflows/ci.yml` (e2e job), `README.md` (final)

**Interfaces:**
- Playwright config: `webServer: { command: 'npm run preview', port: 4173 }`; chromium project with `launchOptions.args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']`.
- `journey.spec.ts` (mock mode `/?mock=1`): consent screen blocks → accept → home → pick question → skip thinking timer → session runs (mock samples) → stop → processing → replay shows ≥1 event in the list and a composure number → save session → dashboard lists it → wipe (type DELETE) → empty state.
- `privacy.spec.ts`: run the full mock journey while collecting every request via `page.on('request')`; assert every URL starts with `http://localhost:4173/` — **the zero-external-requests guarantee, enforced in CI**. Also assert consent screen appears before any `getUserMedia` (mock mode never calls it; assert real mode blocks: load without `?mock=1`, assert camera not requested until accept via `context.grantPermissions` + a `navigator.mediaDevices.getUserMedia` wrap injected with `page.addInitScript` that records call time vs accept-click time).
- `a11y.spec.ts`: `@axe-core/playwright` scan on consent, home, replay (mock session), dashboard — zero serious/critical violations.
- `deploy.yml`: on push to main — build, `actions/upload-pages-artifact@v3` (dist), `actions/deploy-pages@v4` (permissions `pages: write, id-token: write`, environment `github-pages`).
- README final: what it is, live URL, screenshots **of mock-mode sessions only** (no real faces), how-it-works (architecture diagram in mermaid), privacy guarantee + how to verify, honest limits (§9 of spec, verbatim spirit), local dev, licence + third-party notices link.

- [ ] **Step 1:** Failing E2E (config + specs) → run `npm run test:e2e` → journeys fail against current app → fix wiring until green locally. **Step 2:** Add e2e job to ci.yml (`npx playwright install --with-deps chromium` then `npm run test:e2e`). **Step 3:** Enable Pages: `gh api -X POST repos/Leo-Y-Zhang/Understudy/pages -f build_type=workflow` (idempotent: POST 409 → already enabled, fine). Add deploy.yml. **Step 4:** Commit+push; `gh run watch` both workflows green; fetch the live URL (`https://leo-y-zhang.github.io/Understudy/`), verify with WebFetch/curl that it serves and (manually) that a mock session runs on the live site. **Step 5:** Dispatch security-reviewer agent (ten-point floor; expected findings profile: no backend so most items N/A — verify CSP, no secrets, deps audit) and tester agent (adversarial pass on the live build + mock mode). Fix anything found; commit+push. **Step 6:** Final release-manager pass: CI green on HEAD (`gh run list`), `git ls-remote origin` matches local HEAD, README truthful, honest-limits present.

---

## Self-review notes (performed at write time)

- **Spec coverage:** §4 architecture → T1/T3/T12/T13; §5 metrics → T5–T11 (each metric has a dedicated task + tests); §6 UX steps 1–6 → T14 (1–4), T15 (5), T16 (6); §7 privacy → CSP (T1), vendoring (T3), consent gate (T14), opt-in replay + wipe (T15/T16), enforced-in-CI network assertion (T17); §8 testing → unit T2/T4–T11/T15/T16, integration T13, E2E T17; §9 honest limits → README (T17) + Global Constraints; §10 milestones → task grouping above. Spec's "all heavy inference in workers" line amended by decision: FaceLandmarker runs main-thread GPU-delegated (official pattern, ~ms per frame); Whisper (the genuinely heavy load) is in a worker and post-hoc — spec updated to match.
- **Placeholder scan:** clean — every core algorithm has explicit thresholds/formulas; UI tasks carry behaviour contracts + interface signatures rather than pixel-level code by design (frontend-design skill governs the visual layer at execution).
- **Type consistency:** all detector signatures consume `FaceSample[]`/`RmsSeries`/`TimedWord[]` and cfg from T2; `analyzeSession` (T11) is the only aggregation point; UI consumes only `SessionAnalysis`/`SessionRecord`.
