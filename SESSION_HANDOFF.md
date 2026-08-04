# Session Handoff — Understudy

**State:** design spec + v1 implementation plan committed. No application code yet.

**Source of truth for execution:**
`docs/superpowers/plans/2026-08-04-understudy-v1.md` — 17 tasks, executed in
order (T5–T10 may run in parallel once T2 and T4 are done). Each task ends
with a verified test cycle and a pushed commit.

**Next action:** execute Task 5 (gaze detector) once T4 review closes.

## Task board

- [x] T1 Scaffold, toolchain, CI
- [x] T2 Core types + config
- [x] T3 Vendor model assets
- [ ] T4 Face math (pose Euler + iris gaze)
- [ ] T5 Gaze / eye-contact detector
- [ ] T6 Blink + burst detector
- [ ] T7 Expression-event detector
- [ ] T8 Head-steadiness detector
- [ ] T9 VAD + pause detector
- [ ] T10 Fluency (WPM, pace, fillers)
- [ ] T11 Scoring + analyzeSession
- [ ] T12 Capture layer + live HUD
- [ ] T13 Whisper worker + integration test
- [ ] T14 Session flow UI (consent -> processing)
- [ ] T15 Replay screen (timeline + scorecard)
- [ ] T16 Persistence + dashboard
- [ ] T17 E2E, a11y, CI-complete, Pages deploy

## Needs a human (queued, non-blocking)

- **2-minute webcam calibration** after T12: open the dev HUD, confirm
  yaw/gaze sign conventions and blink meter against a real face. The build
  proceeds on documented conventions + round-trip tests meanwhile.
