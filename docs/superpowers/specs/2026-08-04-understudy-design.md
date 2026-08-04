# Understudy — Design Specification

**Date:** 2026-08-04
**Status:** Approved design, pre-implementation

## 1. Overview

Understudy is a browser-based interview training simulator. A candidate
answers real interview questions on camera and receives immediate, objective
feedback on their **delivery**: eye contact, blink behaviour, transient
expression events, head steadiness, speaking pace, filler words, and pauses.

Everything runs **entirely on the user's device**. No video, audio,
transcript, or metric ever leaves the browser. There is no backend, no
account, no API key, and no analytics.

The first target audience is **university admissions candidates** (UK-style
admissions interviews), with a general admissions question pack in v1.

## 2. Goals

- Give candidates a private, repeatable way to rehearse interview delivery
  and see measurable improvement across sessions.
- Produce feedback that is **specific and timestamped** ("gaze broke for
  2.1 s at 0:41", "'um' ×7, clustered in the first 30 s"), not vague advice.
- Be verifiably private: a user can open devtools and confirm nothing is
  transmitted.
- Be honest: report only what camera and microphone signals can actually
  support.

## 3. Non-goals (v1)

- **Content coaching** — no judgement of what the answer says, only how it
  is delivered. (A later, clearly-separated opt-in layer may add this.)
- Emotion recognition, deception detection, or personality inference —
  **permanently out of scope**, not just deferred (see §9).
- Accounts, sharing, cloud sync, mobile-native apps.
- Subject-specific question packs (post-v1; the pack format supports them).

## 4. Architecture

Single-page application. Vite + TypeScript, no UI framework. Static deploy
(GitHub Pages). All heavy inference runs in workers.

```
src/
  core/      Pure TypeScript measurement layer. Zero DOM/browser deps.
             Types, event detection, scoring. Fully unit-testable.
  capture/   Camera/mic acquisition, MediaPipe FaceLandmarker worker,
             WebAudio worklet (VAD/RMS), MediaRecorder (in-memory replay).
  speech/    Whisper (tiny.en) worker via transformers.js — on-device
             speech-to-text with word-level timestamps. Runs after the
             recording completes (on the captured audio), not in realtime,
             keeping session-time CPU low and results deterministic.
  ui/        Screens: consent → setup → question → session → replay →
             dashboard. Vanilla DOM, one module per screen.
  data/      IndexedDB persistence (session metrics; replay blobs optional),
             full-wipe and JSON export.
  packs/     Question packs (static JSON): id, prompt, thinking-time,
             suggested answer length.
```

### Signal flow

```
camera ──► FaceLandmarker (worker, ~30 fps)
             └─► FaceFrame {t, blendshapes[52], landmarks, poseMatrix} ─┐
mic ────► AudioWorklet (RMS/VAD)                                        ├─► core/
      └─► MediaRecorder ─► replay blob (in-memory)                      │
      └─► Whisper worker ─► words [{text, t0, t1}] ────────────────────┘
                                          core/ ─► events[] + scores ─► ui/
```

The **core** consumes plain time-series (face frames, VAD segments, timed
words) and emits a unified event stream plus scores. It never touches the
camera, DOM, or workers — that boundary is what makes the measurement layer
deterministic and testable.

### Why on-device Whisper (and not the Web Speech API)

Chrome's Web Speech API sends audio to Google servers, which would silently
break the privacy guarantee. Whisper tiny.en running locally via
transformers.js (WebGPU with WASM fallback) is the only honest keyless
transcription path. Cost: a one-time ~40 MB model download, cached by the
browser.

### Model assets

- MediaPipe FaceLandmarker task + WASM: vendored in-repo (~5 MB), served
  same-origin.
- Whisper tiny.en ONNX: fetched at runtime from the Hugging Face CDN,
  **pinned to an exact revision**, cached via the browser cache/Cache API.
  CSP `connect-src` allows only that host; no user data ever flows out —
  model downloads are inbound only. (Roadmap: self-host to reach
  `connect-src 'self'`.)

## 5. Measurement layer (core)

All detectors operate on rolling baselines rather than absolute thresholds
where feasible, so scores are self-relative. Every constant below lives in
one documented `config.ts` and is tunable.

### Face channel (per-frame, ~30 fps)

| Metric | Method |
|---|---|
| **Eye contact** | Gaze proxy from iris centre relative to eye corners + head pose from the pose matrix. Per-frame on/off-camera classification with hysteresis. Outputs: eye-contact %, gaze-break events (>300 ms off-camera). |
| **Blink behaviour** | `eyeBlinkLeft/Right` blendshapes, thresholded with debounce → blink events → rate (blinks/min) and **burst** events (≥3 blinks within 2 s). |
| **Expression events** | Transient spikes in selected blendshape channels — brow lower (furrow), lip press, asymmetric smile — detected as onset→offset excursions <500 ms with amplitude above rolling baseline + k·MAD. Reported neutrally as timestamped "expression events". |
| **Head steadiness** | Sliding-window variance of translation + rotation from the pose matrix → fidget index. |

### Speech channel

| Metric | Method |
|---|---|
| **Pace** | Words/minute overall + 10 s rolling; pace variability as CV of rolling WPM. |
| **Fillers** | Lexicon match on timed words: um, uh, er, you know, sort of, kind of, basically, I mean, like. ("like" counting is heuristic and documented as such.) |
| **Pauses** | VAD (WebAudio RMS + hangover) → silence segments; mid-answer silences >1.5 s become pause events. Whisper timestamps cross-check segment boundaries. |

### Events and scores

- Unified event stream: `{t0, t1, type, severity, detail}` — drives the
  replay timeline directly.
- Six sub-scores (0–100) via documented monotone mappings: eye contact,
  blink steadiness, expression control, head steadiness, pace, verbal
  fluency (fillers + pauses). Composite **Composure** score as a documented
  weighted mean. Mappings are explicitly heuristics, not population norms.

## 6. Session loop (UX)

1. **Consent screen** — before any camera access: what is measured, the
   nothing-leaves-your-device guarantee and how to verify it, data controls.
   Blocks until accepted.
2. **Setup** — camera/mic check with live landmark HUD (immediate "it sees
   me" moment); pick a question pack.
3. **Question** — prompt shown with a realistic thinking timer, then
   recording starts on the candidate's action.
4. **Session** — minimal UI while answering (subtle REC + elapsed time; no
   distracting live meters). Stop when done.
5. **Replay** — recorded video with a scrubbable annotated timeline: every
   event plotted at its timestamp; click an event → video seeks there.
   Scorecard alongside (six sub-scores + composure + per-metric detail).
6. **Dashboard** — score trends across sessions (IndexedDB), best/worst
   moments, streaks. One-click **wipe everything**.

## 7. Data & privacy

- No network transmission of user data, ever. CSP pins `connect-src` to
  same-origin + the pinned model host; no analytics, no fonts, no CDNs
  beyond the model host.
- Replay blobs are in-memory by default; saving a replay to IndexedDB is
  explicit opt-in per session. Metrics-only history is stored locally.
- Full wipe and JSON export (metrics only) in the dashboard.
- No sample footage of real people is ever committed to the repo or shown
  in docs; demo material uses the author's own consented recordings only if
  ever needed, and never in the repository.

## 8. Testing

- **Unit (Vitest):** `core/` tested against fixture traces — synthetic
  blendshape/word time-series checked in as JSON (no images, no audio).
  Each detector gets: clean case, boundary case, and a
  known-failure-first regression case.
- **E2E (Playwright):** Chromium with
  `--use-fake-device-for-media-stream` +
  `--use-file-for-fake-video-capture` (prepared y4m) and a fixture WAV:
  full session flow completes, events render, wipe works, and a network
  assertion proves zero outbound requests carrying user data.
- **CI (GitHub Actions):** typecheck, lint, unit, E2E on every push (free
  for public repos).

## 9. Honest-limits statement (ships in the README)

Understudy measures observable delivery signals only. It does **not**
detect emotions, truthfulness, confidence, or ability, and its scores are
heuristics for self-comparison across your own sessions — not comparisons
against other people. Landmark models can behave differently across faces,
lighting, and cameras; trends on the same setup are meaningful, absolute
numbers are not. These limits are permanent product policy, not a v1 gap.

## 10. Milestones

1. **M1 Walking skeleton** — capture pipeline + live landmark HUD deployed.
2. **M2 Face metrics** — core face-channel detectors + unit suite.
3. **M3 Speech metrics** — Whisper worker, VAD, fillers/pace/pauses.
4. **M4 Replay** — annotated timeline + scorecard.
5. **M5 v1** — dashboard, question pack, consent flow, a11y pass, E2E,
   Pages deploy.
