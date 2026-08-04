# Session Handoff — Understudy

**State: v1 SHIPPED.** Live at https://leo-y-zhang.github.io/Understudy/ —
CI and Pages deploy green on `main`, zero open security alerts, full test
pyramid (unit / integration / E2E incl. a real recording + on-device
transcription run with a zero-successful-off-origin-requests assertion).

**Plan executed in full:**
`docs/superpowers/plans/2026-08-04-understudy-v1.md` — all 17 tasks, each
with a TDD cycle and an independent review; followed by a security review,
an adversarial test pass, and a final whole-branch review whose must-fix
list has been applied and verified.

## Task board

- [x] T1 Scaffold, toolchain, CI
- [x] T2 Core types + config
- [x] T3 Vendor model assets
- [x] T4 Face math (pose Euler + iris gaze)
- [x] T5 Gaze / eye-contact detector
- [x] T6 Blink + burst detector
- [x] T7 Expression-event detector
- [x] T8 Head-steadiness detector
- [x] T9 VAD + pause detector
- [x] T10 Fluency (WPM, pace, fillers)
- [x] T11 Scoring + analyzeSession
- [x] T12 Capture layer + live HUD
- [x] T13 Whisper worker + integration test
- [x] T14 Session flow UI (consent -> processing)
- [x] T15 Replay screen (timeline + scorecard)
- [x] T16 Persistence + dashboard
- [x] T17 E2E, a11y, CI-complete, Pages deploy

## Post-v1 queue (deliberate, none blocking)

- **Manual webcam pass (~5 min, needs a human):** verify the face-math sign
  conventions against a real face (documented as tentative in
  `src/capture/facemath.ts`), and confirm event-click seeking works on a
  real MediaRecorder webm replay.
- **Product decision:** discard sub-~3s takes or add per-session delete
  (`db.ts` already ships `deleteSession`); currently a mis-tap take stays in
  the trend until a full wipe.
- Gate the Pages deploy on CI success (today they run in parallel).
- Cross-browser verification beyond Chromium (Safari/Firefox: recording
  container, ORT wasm path).
- Spec §6 drift, accepted for v1: no separate camera-check/setup screen;
  recording auto-starts when the thinking timer expires; dashboard omits
  "best/worst moments" and "streaks".
- Spec §5 drift: Whisper-timestamp cross-check of VAD segment boundaries
  was not built (RMS-only VAD).

## Conventions that must not be "fixed"

- Word-level timings are segment-real but interpolated (the vendored q8
  decoder has no cross-attention outputs) — documented in `src/speech/asr.ts`
  and the README; do not claim per-word precision.
- The consent screen and README describe a MediaPipe telemetry attempt that
  the page CSP blocks — that copy is deliberately honest; do not simplify it
  back to a false absolute.
- The honest-limits section (README + consent) is permanent product policy.
