import { describe, it, expect } from 'vitest';
import { segmentSpeech, detectPauses } from '../../src/core/vad';
import { DEFAULT_CONFIG as cfg } from '../../src/core/config';
import { RmsSeries } from '../../src/core/types';

const HOP = 0.05;

/**
 * Build an RmsSeries from a list of [durationSeconds, rmsValue] blocks at the
 * given hop (default 0.05s). Each block contributes round(durS / hopS) frames
 * of the constant value.
 */
function buildRms(spec: Array<[number, number]>, hopS = HOP): RmsSeries {
  const vals: number[] = [];
  for (const [durS, val] of spec) {
    const n = Math.round(durS / hopS);
    for (let i = 0; i < n; i++) vals.push(val);
  }
  return { hopS, values: Float32Array.from(vals) };
}

describe('segmentSpeech', () => {
  it('produces 5 alternating segments with exact boundaries', () => {
    // 2s silence + 5s speech + 2s silence + 5s speech + 3s silence.
    // noiseFloor (10th pct) = 0.001 -> threshold = max(0.003, 0.01) = 0.01.
    // Hangover (0.3s = 6 hops) only fully covers 5 hops before the strict
    // "< vadHangoverS" check flips to silence, so 0.25s of each trailing
    // silence block is absorbed into the preceding speech segment.
    const rms = buildRms([
      [2, 0.001],
      [5, 0.1],
      [2, 0.001],
      [5, 0.1],
      [3, 0.001],
    ]);

    const segs = segmentSpeech(rms, cfg);

    expect(segs).toHaveLength(5);

    const expected = [
      { t0: 0, t1: 2.0, speech: false },
      { t0: 2.0, t1: 7.25, speech: true },
      { t0: 7.25, t1: 9.0, speech: false },
      { t0: 9.0, t1: 14.25, speech: true },
      { t0: 14.25, t1: 17.0, speech: false },
    ];

    segs.forEach((s, i) => {
      const e = expected[i]!;
      expect(s.t0).toBeCloseTo(e.t0, 9);
      expect(s.t1).toBeCloseTo(e.t1, 9);
      expect(s.speech).toBe(e.speech);
    });

    // Covers [0, duration] exactly with no gaps/overlaps.
    expect(segs[0]!.t0).toBeCloseTo(0, 9);
    expect(segs[segs.length - 1]!.t1).toBeCloseTo(rms.values.length * HOP, 9);
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i]!.t0).toBeCloseTo(segs[i - 1]!.t1, 9);
    }
  });

  it('hangover: a 0.2s dip inside speech does not split the segment', () => {
    // Lead/trail silence give the percentile estimator real noise samples;
    // the 0.2s dip (< 0.3s hangover) must not break the speech run.
    const rms = buildRms([
      [2, 0.001],
      [2.4, 0.1],
      [0.2, 0.001],
      [2.4, 0.1],
      [2, 0.001],
    ]);

    const segs = segmentSpeech(rms, cfg);

    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ speech: false });
    expect(segs[1]).toMatchObject({ speech: true });
    expect(segs[2]).toMatchObject({ speech: false });

    expect(segs[1]!.t0).toBeCloseTo(2.0, 9);
    expect(segs[1]!.t1).toBeCloseTo(7.25, 9);
  });

  it('all-silence input produces a single silence segment', () => {
    const rms = buildRms([[3, 0.001]]);

    const segs = segmentSpeech(rms, cfg);

    expect(segs).toHaveLength(1);
    expect(segs[0]!.speech).toBe(false);
    expect(segs[0]!.t0).toBeCloseTo(0, 9);
    expect(segs[0]!.t1).toBeCloseTo(3.0, 9);
  });

  it('adaptive threshold: speech at 0.02 over a 0.001 noise floor is detected', () => {
    // threshold = max(0.001*3, 0.01) = 0.01; 0.02 >= 0.01 -> speech.
    const rms = buildRms([
      [2, 0.001],
      [2, 0.02],
      [2, 0.001],
    ]);

    const segs = segmentSpeech(rms, cfg);

    expect(segs).toHaveLength(3);
    expect(segs[1]!.speech).toBe(true);
    expect(segs[1]!.t0).toBeCloseTo(2.0, 9);
    expect(segs[1]!.t1).toBeCloseTo(4.25, 9);
  });

  it('adaptive threshold: speech at 0.005 stays below vadAbsMin and is not detected', () => {
    // threshold = max(0.001*3, 0.01) = 0.01; 0.005 < 0.01 -> stays silence.
    const rms = buildRms([
      [2, 0.001],
      [2, 0.005],
      [2, 0.001],
    ]);

    const segs = segmentSpeech(rms, cfg);

    expect(segs).toHaveLength(1);
    expect(segs[0]!.speech).toBe(false);
    expect(segs[0]!.t0).toBeCloseTo(0, 9);
    expect(segs[0]!.t1).toBeCloseTo(6.0, 9);
  });

  it('empty input returns []', () => {
    const rms: RmsSeries = { hopS: HOP, values: new Float32Array(0) };
    expect(segmentSpeech(rms, cfg)).toEqual([]);
  });
});

describe('detectPauses', () => {
  it('flags only the silence strictly between first and last speech as a pause', () => {
    const rms = buildRms([
      [2, 0.001],
      [5, 0.1],
      [2, 0.001],
      [5, 0.1],
      [3, 0.001],
    ]);
    const segs = segmentSpeech(rms, cfg);

    const events = detectPauses(segs, cfg);

    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.type).toBe('pause');
    expect(e.t0).toBeCloseTo(7.25, 9);
    expect(e.t1).toBeCloseTo(9.0, 9);
    expect(e.severity).toBe(1);
    expect(e.detail).toBe('pause 1.8s');
  });

  it('a 2.5s mid gap (2.25s after hangover) is severity 2', () => {
    const rms = buildRms([
      [2, 0.001],
      [5, 0.1],
      [2.5, 0.001],
      [5, 0.1],
      [3, 0.001],
    ]);
    const segs = segmentSpeech(rms, cfg);

    const events = detectPauses(segs, cfg);

    expect(events).toHaveLength(1);
    expect(events[0]!.severity).toBe(2);
    expect(events[0]!.detail).toBe('pause 2.3s');
  });

  it('a 3.5s mid gap (3.25s after hangover) is severity 3', () => {
    const rms = buildRms([
      [2, 0.001],
      [5, 0.1],
      [3.5, 0.001],
      [5, 0.1],
      [3, 0.001],
    ]);
    const segs = segmentSpeech(rms, cfg);

    const events = detectPauses(segs, cfg);

    expect(events).toHaveLength(1);
    expect(events[0]!.severity).toBe(3);
    expect(events[0]!.detail).toBe('pause 3.3s');
  });

  it('lead-in and trailing silence are never pauses even when long', () => {
    const rms = buildRms([
      [4, 0.001], // long lead-in, well over pauseMinS
      [2, 0.1],
      [4, 0.001], // long trailing silence
    ]);
    const segs = segmentSpeech(rms, cfg);

    const events = detectPauses(segs, cfg);

    expect(events).toEqual([]);
  });

  it('a single speech island has no in-between silence to flag', () => {
    const rms = buildRms([
      [2, 0.001],
      [2, 0.02],
      [2, 0.001],
    ]);
    const segs = segmentSpeech(rms, cfg);

    expect(detectPauses(segs, cfg)).toEqual([]);
  });

  it('no speech at all produces no pauses', () => {
    const rms = buildRms([[3, 0.001]]);
    const segs = segmentSpeech(rms, cfg);

    expect(detectPauses(segs, cfg)).toEqual([]);
  });

  it('empty segments returns []', () => {
    expect(detectPauses([], cfg)).toEqual([]);
  });
});
