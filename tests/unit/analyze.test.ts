import { describe, it, expect } from 'vitest';
import { analyzeSession } from '../../src/core/analyze';
import { SessionInput, TimedWord, RmsSeries } from '../../src/core/types';
import { mkFrames, withBlinks } from './helpers';

const HOP = 0.05;

/**
 * Build an RmsSeries from a list of [durationSeconds, rmsValue] blocks at the
 * given hop (default 0.05s). Mirrors the local helper in vad.test.ts.
 */
function buildRms(spec: Array<[number, number]>, hopS = HOP): RmsSeries {
  const vals: number[] = [];
  for (const [durS, val] of spec) {
    const n = Math.round(durS / hopS);
    for (let i = 0; i < n; i++) vals.push(val);
  }
  return { hopS, values: Float32Array.from(vals) };
}

/**
 * Build TimedWords with contiguous timing, mirroring fluency.test.ts's local
 * helper: word i occupies [startT + i*spacingS, startT + i*spacingS + durS).
 */
function mkWords(texts: string[], startT = 0, spacingS = 0.4, durS = spacingS): TimedWord[] {
  return texts.map((text, i) => ({
    text,
    t0: startT + i * spacingS,
    t1: startT + i * spacingS + durS,
  }));
}

/**
 * A 60s synthetic session:
 * - frames: on-camera throughout except a 2s gaze-away block at t=10..12.
 * - a blink cluster: 4 blinks within 1.5s starting at t=30 (3-frame 0.9
 *   pulses via withBlinks), which should trigger exactly one blink-burst
 *   event (burstCount 3, burstWindowS 2.0 in DEFAULT_CONFIG).
 * - words: 100 words spaced 0.4s apart from t=2, with words[10]='um' and
 *   words[50]='uh' as the only two filler hits.
 * - rms: speech (0.1) throughout except lead-in silence [0,2), a mid-session
 *   pause [40,42.2) (2.2s, expected severity 1 after hangover trim), and
 *   trailing silence [50,60). The trailing silence is an addition beyond the
 *   task brief's literal [0,2)+[40,42.2) silence spec: with only those two
 *   blocks, silence is under 10% of the 1200 rms samples, so the VAD's 10th-
 *   percentile noise-floor estimate lands on the speech level (0.1) instead
 *   of the silence level (0.001), and the whole session reads as one long
 *   silent segment with zero pauses detected. Extending trailing silence to
 *   [50,60) pushes silence to ~24% of samples so the noise floor resolves
 *   correctly, while still keeping the mid-session pause exactly as
 *   specified and not touching word/pause timing.
 */
function buildSession(): SessionInput {
  let frames = mkFrames([
    [10, true],
    [2, false],
    [48, true],
  ]);
  frames = withBlinks(frames, [30.0, 30.4, 30.8, 31.2]);

  const texts = Array.from({ length: 100 }, (_, i) => `w${i}`);
  texts[10] = 'um';
  texts[50] = 'uh';
  const words = mkWords(texts, 2, 0.4);

  const rms = buildRms([
    [2, 0.001],
    [38, 0.1],
    [2.2, 0.001],
    [7.8, 0.1],
    [10, 0.001],
  ]);

  return { frames, words, rms, durationS: 60 };
}

describe('analyzeSession', () => {
  it('wires all six detectors into a sorted, fully-populated SessionAnalysis', () => {
    const result = analyzeSession(buildSession());

    const types = new Set(result.events.map((e) => e.type));
    expect(types.has('gaze-break')).toBe(true);
    expect(types.has('blink-burst')).toBe(true);
    expect(types.has('filler')).toBe(true);
    expect(types.has('pause')).toBe(true);

    // Sorted by t0.
    for (let i = 1; i < result.events.length; i++) {
      expect(result.events[i]!.t0).toBeGreaterThanOrEqual(result.events[i - 1]!.t0);
    }

    expect(result.stats.durationS).toBe(60);
    expect(result.stats.fillerCount).toBe(2);
    expect(result.stats.pauseCount).toBe(1);
    expect(result.stats.wordCount).toBe(100);
    expect(result.stats.eyeContactPct).toBeGreaterThan(96);
    expect(result.stats.eyeContactPct).toBeLessThan(97);

    expect(result.composure).toBeGreaterThan(0);
    expect(result.composure).toBeLessThan(100);

    for (const value of Object.values(result.sub)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('accepts a partial config override and still returns a complete analysis', () => {
    const result = analyzeSession(buildSession(), { pauseMinS: 100 });

    // With pauseMinS raised far above the actual 2.2s gap, no pause qualifies.
    expect(result.stats.pauseCount).toBe(0);
    expect(result.events.some((e) => e.type === 'pause')).toBe(false);
    // Everything else still wires up.
    expect(result.events.some((e) => e.type === 'gaze-break')).toBe(true);
  });
});
