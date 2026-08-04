import { TimedWord, VadSegment, DeliveryEvent } from './types';
import { UnderstudyConfig } from './config';

/**
 * Computes speaking pace (wpm, pace variability) and filler-word events from
 * a transcript's timed words and the session's VAD segments.
 *
 * Pace-band scoring (mapping wpm/paceCv to a 0..100 sub-score) is out of
 * scope here -- it is consumed by scoring (task 11), not computed here.
 */
export function fluency(
  words: TimedWord[],
  segments: VadSegment[],
  cfg: UnderstudyConfig
): { wpm: number; paceCv: number; fillerEvents: DeliveryEvent[]; wordCount: number } {
  const wordCount = words.length;

  if (wordCount === 0) {
    return { wpm: 0, paceCv: 0, fillerEvents: [], wordCount: 0 };
  }

  const speakingTimeS = computeSpeakingTimeS(words, segments);
  const wpm = speakingTimeS > 0 ? (wordCount / speakingTimeS) * 60 : 0;

  const rollingWpms = computeRollingWpm(words, cfg);
  const paceCv = computePaceCv(rollingWpms);

  const fillerEvents = detectFillers(words, cfg);

  return { wpm, paceCv, fillerEvents, wordCount };
}

/**
 * Total speaking time: sum of durations of speech==true VAD segments. Falls
 * back to the word span (last word's t1 - first word's t0) when the segments
 * contain no speech at all (including an empty segments array).
 */
function computeSpeakingTimeS(words: TimedWord[], segments: VadSegment[]): number {
  const hasSpeech = segments.some((s) => s.speech);
  if (hasSpeech) {
    return segments
      .filter((s) => s.speech)
      .reduce((sum, s) => sum + (s.t1 - s.t0), 0);
  }
  const first = words[0]!;
  const last = words[words.length - 1]!;
  return last.t1 - first.t0;
}

/**
 * Rolling WPM: windows of cfg.rollingWpmWindowS seconds, stepped 1s, across
 * [first word's t0, last word's t1]. A window's wpm is the count of words
 * whose midpoint ((t0+t1)/2) falls within it, scaled to words/minute. Only
 * full-length windows count -- a shorter trailing window is skipped.
 */
function computeRollingWpm(words: TimedWord[], cfg: UnderstudyConfig): number[] {
  const first = words[0]!.t0;
  const last = words[words.length - 1]!.t1;
  const windowS = cfg.rollingWpmWindowS;
  const totalSpan = last - first;

  if (totalSpan < windowS) return [];

  // Step by integer k (not repeated float addition) so window starts stay
  // exact multiples of 1s away from `first`.
  const numWindows = Math.floor(totalSpan - windowS + 1e-9) + 1;
  const mids = words.map((w) => (w.t0 + w.t1) / 2);

  const wpms: number[] = [];
  for (let k = 0; k < numWindows; k++) {
    const start = first + k;
    const end = start + windowS;
    const count = mids.filter((m) => m >= start && m < end).length;
    wpms.push((count / windowS) * 60);
  }
  return wpms;
}

/** Coefficient of variation (population std / mean) of the rolling-wpm series. */
function computePaceCv(wpms: number[]): number {
  if (wpms.length < 2) return 0;
  const mean = wpms.reduce((a, b) => a + b, 0) / wpms.length;
  if (mean === 0) return 0;
  const variance = wpms.reduce((a, b) => a + (b - mean) ** 2, 0) / wpms.length;
  return Math.sqrt(variance) / mean;
}

/**
 * Lowercases and strips leading/trailing non-letter characters, keeping any
 * internal characters (notably apostrophes, e.g. "don't") untouched. A word
 * with no letters at all normalizes to ''.
 */
function normalizeWord(text: string): string {
  const lower = text.toLowerCase();
  let start = 0;
  while (start < lower.length && !/[a-z]/.test(lower[start]!)) start++;
  let end = lower.length;
  while (end > start && !/[a-z]/.test(lower[end - 1]!)) end--;
  return lower.slice(start, end);
}

/**
 * Scans normalized words left-to-right. At each position, a fillerPhrases
 * bigram match is tried first (consuming both words so neither can also
 * match as a single); otherwise a fillerSingles match consumes one word.
 * Events come out sorted by t0 for free, since the scan is left-to-right.
 */
function detectFillers(words: TimedWord[], cfg: UnderstudyConfig): DeliveryEvent[] {
  const normalized = words.map((w) => normalizeWord(w.text));
  const singles = new Set(cfg.fillerSingles);
  const events: DeliveryEvent[] = [];

  let i = 0;
  while (i < words.length) {
    if (i + 1 < words.length) {
      const phrase = cfg.fillerPhrases.find(
        (p) => p[0] === normalized[i] && p[1] === normalized[i + 1]
      );
      if (phrase) {
        events.push({
          t0: words[i]!.t0,
          t1: words[i + 1]!.t1,
          type: 'filler',
          severity: 1,
          detail: `'${phrase[0]} ${phrase[1]}'`,
        });
        i += 2;
        continue;
      }
    }

    const word = normalized[i]!;
    if (word !== '' && singles.has(word)) {
      events.push({
        t0: words[i]!.t0,
        t1: words[i]!.t1,
        type: 'filler',
        severity: 1,
        detail: `'${word}'`,
      });
    }
    i += 1;
  }

  return events;
}
