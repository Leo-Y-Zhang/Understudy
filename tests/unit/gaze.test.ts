import { describe, it, expect } from 'vitest';
import { detectGaze } from '../../src/core/gaze';
import { DEFAULT_CONFIG as cfg } from '../../src/core/config';
import { mkFrames } from './helpers';

describe('gaze detector', () => {
  it('all on-camera: 100pct, no events', () => {
    const r = detectGaze(mkFrames([[10, true]]), cfg);
    expect(r.eyeContactPct).toBeCloseTo(100, 0);
    expect(r.events).toHaveLength(0);
  });

  it('2s break mid-answer -> one gaze-break event, severity 3', () => {
    const r = detectGaze(mkFrames([[4, true], [2, false], [4, true]]), cfg);
    expect(r.events).toHaveLength(1);
    const e = r.events[0]!;
    expect(e.type).toBe('gaze-break');
    expect(e.t1 - e.t0).toBeCloseTo(2, 0);
    expect(e.severity).toBe(3);
    expect(r.eyeContactPct).toBeCloseTo(80, 0);
  });

  it('single-frame flicker is absorbed by hysteresis', () => {
    const frames = mkFrames([[5, true]]);
    frames[75] = { ...frames[75]!, gazeX: 0.9 };   // one averted frame
    expect(detectGaze(frames, cfg).events).toHaveLength(0);
  });

  it('face absent counts as off-camera', () => {
    const frames = mkFrames([[2, true], [1, true], [2, true]]);
    for (let i = 60; i < 90; i++) frames[i] = { ...frames[i]!, present: false };
    const r = detectGaze(frames, cfg);
    expect(r.events).toHaveLength(1);
  });

  it('empty input -> 0pct, no events', () => {
    const r = detectGaze([], cfg);
    expect(r.eyeContactPct).toBe(0);
    expect(r.events).toHaveLength(0);
  });
});
