import { describe, it, expect } from 'vitest';
import { detectExpressionEvents } from '../../src/core/expression';
import { DEFAULT_CONFIG as cfg } from '../../src/core/config';
import { FaceSample } from '../../src/core/types';
import { mkFrames } from './helpers';

/**
 * A step profile: `baseline` everywhere, except within each [t0, t1) window
 * (half-open: t0 inclusive, t1 exclusive) where it takes `value`.
 */
function stepProfile(
  t: number,
  baseline: number,
  spikes: Array<[t0: number, t1: number, value: number]>
): number {
  for (const [t0, t1, value] of spikes) {
    if (t >= t0 && t < t1) return value;
  }
  return baseline;
}

describe('detectExpressionEvents', () => {
  // Test 1: flat 0.05 browDown baseline, one excursion to 0.6 lasting 0.3s at t=4.
  it('detects one brow-furrow event for a 0.3s excursion above the gate', () => {
    const frames: FaceSample[] = mkFrames([[8, true]]).map((f) => {
      const v = stepProfile(f.t, 0.05, [[4, 4.3, 0.6]]);
      return { ...f, blend: { ...f.blend, browDownLeft: v, browDownRight: v } };
    });

    const events = detectExpressionEvents(frames, cfg);

    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.type).toBe('expression');
    expect(e.detail).toBe('brow furrow');
    expect(e.t0).toBeCloseTo(4, 1);
    expect(e.t1 - e.t0).toBeCloseTo(0.3, 1); // duration approx 0.3s, +/-0.05
    expect(e.severity).toBe(2); // excess 0.55 > 2*gate (0.32)
  });

  // Test 2: same excursion but lasting 1.2s -> deliberate expression, not transient.
  it('does not flag a 1.2s excursion (longer than exprTransientMaxS)', () => {
    const frames: FaceSample[] = mkFrames([[8, true]]).map((f) => {
      const v = stepProfile(f.t, 0.05, [[4, 5.2, 0.6]]);
      return { ...f, blend: { ...f.blend, browDownLeft: v, browDownRight: v } };
    });

    const events = detectExpressionEvents(frames, cfg);

    expect(events).toHaveLength(0);
  });

  // Test 3: browDown held constant and high (0.6) from t=0 for 6s -> baseline adapts.
  it('does not flag a constant elevated baseline (furrowed resting face)', () => {
    const frames: FaceSample[] = mkFrames([[6, true]]).map((f) => ({
      ...f,
      blend: { ...f.blend, browDownLeft: 0.6, browDownRight: 0.6 },
    }));

    const events = detectExpressionEvents(frames, cfg);

    expect(events).toHaveLength(0);
  });

  // Test 4: tiny excursion to baseline+0.02, below exprK*exprMadFloor gate (0.16).
  it('ignores an excursion smaller than the MAD-floor gate', () => {
    const frames: FaceSample[] = mkFrames([[8, true]]).map((f) => {
      const v = stepProfile(f.t, 0.05, [[4, 4.3, 0.07]]);
      return { ...f, blend: { ...f.blend, browDownLeft: v, browDownRight: v } };
    });

    const events = detectExpressionEvents(frames, cfg);

    expect(events).toHaveLength(0);
  });

  // Test 5: browDown and mouthPress spike simultaneously -> two independent events.
  it('detects two independent events when two channels spike simultaneously', () => {
    const frames: FaceSample[] = mkFrames([[8, true]]).map((f) => {
      const v = stepProfile(f.t, 0.05, [[4, 4.3, 0.6]]);
      return {
        ...f,
        blend: {
          ...f.blend,
          browDownLeft: v,
          browDownRight: v,
          mouthPressLeft: v,
          mouthPressRight: v,
        },
      };
    });

    const events = detectExpressionEvents(frames, cfg);

    expect(events).toHaveLength(2);
    expect(events.every((e) => e.type === 'expression')).toBe(true);
    const details = events.map((e) => e.detail).sort();
    expect(details).toEqual(['brow furrow', 'lip press']);
  });

  // Test 6: empty input.
  it('returns no events for empty input', () => {
    expect(detectExpressionEvents([], cfg)).toEqual([]);
  });

  // Bonus: exercises the third channel (smileAsym), not otherwise covered above.
  it('detects an asymmetric-smile event from a one-sided smile spike', () => {
    const frames: FaceSample[] = mkFrames([[8, true]]).map((f) => {
      const v = stepProfile(f.t, 0.05, [[4, 4.3, 0.6]]);
      return {
        ...f,
        blend: { ...f.blend, mouthSmileLeft: v, mouthSmileRight: 0.05 },
      };
    });

    const events = detectExpressionEvents(frames, cfg);

    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e.detail).toBe('asymmetric smile');
    expect(e.t0).toBeCloseTo(4, 1);
    expect(e.t1 - e.t0).toBeCloseTo(0.3, 1);
  });
});
