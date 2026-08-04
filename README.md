# Understudy

**Rehearse the interview. See your delivery.**

Understudy is a privacy-first interview rehearsal studio that runs entirely in
your browser. Answer real admissions-interview questions on camera and get
immediate, timestamped feedback on your delivery — eye contact, blink
behaviour, expression events, head steadiness, pace, filler words, and pauses
— with an annotated replay and a score trend across sessions.

**Nothing you record ever leaves your device.** No backend, no account, no API
key, no analytics. Face landmarking (MediaPipe) and speech recognition
(Whisper) run on-device, in the browser. You can verify this yourself in the
network tab.

## Status

In active development. Design spec:
[`docs/superpowers/specs/2026-08-04-understudy-design.md`](docs/superpowers/specs/2026-08-04-understudy-design.md)

## Honest limits

Understudy measures observable delivery signals only. It does **not** detect
emotions, truthfulness, confidence, or ability. Scores are heuristics for
comparing your own sessions on the same setup — not for comparing people.
These limits are permanent product policy, not a v1 gap.

## Licence

[MIT](LICENSE)
