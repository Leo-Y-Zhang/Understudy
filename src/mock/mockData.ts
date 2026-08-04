// Canned, fully deterministic stand-ins for a transcript and an audio RMS
// series, used together with MockTracker (src/mock/mockTracker.ts) so
// `?mock=1` can exercise the whole session -> processing -> analyzeSession
// pipeline without a microphone, a camera, or the Whisper worker.
//
// Nothing here is derived from wall-clock time or Math.random() -- both
// exports are the same on every load, which is what makes the mock path
// usable as a repeatable end-to-end smoke test.

import type { RmsSeries, TimedWord } from '../core/types';

const WORD_SPACING_S = 0.4;
const WORD_SPAN_S = 0.3; // each word "lasts" 0.3s, leaving a 0.1s gap to the next
const FIRST_WORD_T0_S = 2;

// A short, plausible admissions-interview answer, split into words. Two
// entries are literal filler words ('um', at index 8 and 63) so
// core/fluency.ts's filler detector has something real to find; the rest are
// ordinary words so pace/wpm math has a realistic transcript to chew on.
const MOCK_TRANSCRIPT_WORDS: string[] = (() => {
  const words = (
    'I think what draws me to this subject is the way it keeps asking better ' +
    'questions instead of settling for tidy answers I found that out during a ' +
    'summer project where I spent weeks reading primary sources instead of ' +
    'textbooks and realised how much of what we accept as fact depends on who ' +
    'was doing the writing and that changed how I read everything afterwards ' +
    'including the news I still go back to that project whenever I feel stuck ' +
    'because it reminds me curiosity is really just refusing to stop at the ' +
    'first explanation and I want three more years of that'
  ).split(/\s+/);
  words.splice(8, 0, 'um');
  words.splice(63, 0, 'um');
  return words;
})();

/** ~100 deterministic TimedWords, 0.4s apart starting at t=2, two 'um' fillers. */
export const mockWords: TimedWord[] = MOCK_TRANSCRIPT_WORDS.map((text, i) => {
  const t0 = FIRST_WORD_T0_S + i * WORD_SPACING_S;
  return { text, t0, t1: t0 + WORD_SPAN_S };
});

const MOCK_RMS_HOP_S = 0.05;
const MOCK_RMS_SPEECH = 0.1;
const MOCK_RMS_SILENCE = 0.004;

// Segment plan for the synthetic RmsSeries: quiet lead-in, a long speech run,
// a 2.2s mid-answer silence at t=40 (long enough to trip vad.ts's
// pauseMinS=1.5s default), a shorter closing speech run, then a quiet tail.
// The silence portions total ~20% of the series so the VAD's 10th-percentile
// noise-floor estimate actually lands in the silence, not the speech, band.
const MOCK_RMS_SEGMENTS: Array<[durationS: number, value: number]> = [
  [5, MOCK_RMS_SILENCE],
  [35, MOCK_RMS_SPEECH],
  [2.2, MOCK_RMS_SILENCE],
  [4.8, MOCK_RMS_SPEECH],
  [3, MOCK_RMS_SILENCE],
];

/** Synthetic RmsSeries: speech at 0.1 with a 2.2s silence at t=40. */
export const mockRms: RmsSeries = (() => {
  const values: number[] = [];
  for (const [durationS, value] of MOCK_RMS_SEGMENTS) {
    const hops = Math.round(durationS / MOCK_RMS_HOP_S);
    for (let i = 0; i < hops; i++) values.push(value);
  }
  return { hopS: MOCK_RMS_HOP_S, values: Float32Array.from(values) };
})();
