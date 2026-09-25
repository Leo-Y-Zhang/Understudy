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

  // Eye contact needs the iris centred on both axes AND the head facing the
  // camera on both axes; every other test here only moves gazeX.
  const axes: Array<[axis: 'gazeX' | 'gazeY' | 'yaw' | 'pitch', limit: number]> = [
    ['gazeX', cfg.gazeXOn],
    ['gazeY', cfg.gazeYOn],
    ['yaw', cfg.yawOn],
    ['pitch', cfg.pitchOn],
  ];
  for (const [axis, limit] of axes) {
    it(`${axis} past its threshold (either sign) breaks eye contact; just inside it does not`, () => {
      const withTwoSeconds = (value: number) => {
        const frames = mkFrames([[10, true]]);
        for (let i = 120; i < 180; i++) frames[i] = { ...frames[i]!, [axis]: value };
        return detectGaze(frames, cfg);
      };

      const outside = withTwoSeconds(-(limit + 0.05));
      expect(outside.events).toHaveLength(1);
      expect(outside.eyeContactPct).toBeCloseTo(80, 0);

      const inside = withTwoSeconds(limit - 0.05);
      expect(inside.events).toHaveLength(0);
      expect(inside.eyeContactPct).toBeCloseTo(100, 0);
    });
  }

  it('reports an off-camera run only once it lasts gazeBreakMinS, mid-answer or at the very end', () => {
    const offFor = (frameCount: number, atEnd: boolean) => {
      const off: [number, boolean] = [frameCount / 30, false];
      return detectGaze(mkFrames(atEnd ? [[5, true], off] : [[5, true], off, [5, true]]), cfg).events;
    };

    expect(offFor(6, false)).toHaveLength(0); // a 0.2s glance
    expect(offFor(6, true)).toHaveLength(0);

    const brief = offFor(12, false); // 0.4s
    expect(brief).toHaveLength(1);
    expect(brief[0]!.severity).toBe(1);
    expect(offFor(12, true)).toHaveLength(1);
  });
});
