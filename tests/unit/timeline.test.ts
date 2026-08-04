import { describe, it, expect } from 'vitest';
import { layoutTimeline } from '../../src/ui/timeline';
import type { DeliveryEvent, EventType } from '../../src/core/types';

function mkEvent(type: EventType, t0: number, t1: number, detail = 'detail'): DeliveryEvent {
  return { type, t0, t1, severity: 1, detail };
}

describe('layoutTimeline', () => {
  it('returns an empty layout for an empty events array', () => {
    expect(layoutTimeline([], 10, 200)).toEqual([]);
  });

  it('returns an empty layout for zero or negative durationS', () => {
    const events = [mkEvent('pause', 1, 2)];
    expect(layoutTimeline(events, 0, 200)).toEqual([]);
    expect(layoutTimeline(events, -5, 200)).toEqual([]);
  });

  it('returns an empty layout for zero or negative widthPx', () => {
    const events = [mkEvent('pause', 1, 2)];
    expect(layoutTimeline(events, 10, 0)).toEqual([]);
    expect(layoutTimeline(events, 10, -50)).toEqual([]);
  });

  it('maps a mixed set of event types to stable lanes (by type order, not appearance order) with correct x/w', () => {
    // Deliberately out of both time order and lane order, to prove lane
    // assignment is keyed off the type -> lane table, not array position.
    const events: DeliveryEvent[] = [
      mkEvent('filler', 1, 1.5, "'um'"), // lane 5
      mkEvent('gaze-break', 2, 4, 'gaze away 2.0s'), // lane 0
      mkEvent('pause', 5, 7, 'pause 2.0s'), // lane 4
      mkEvent('blink-burst', 3, 3.5, 'blink burst'), // lane 1
      mkEvent('expression', 6, 6.2, 'brow furrow'), // lane 2
      mkEvent('fidget', 8, 9, 'restless 1.0s'), // lane 3
    ];
    const durationS = 10;
    const widthPx = 200;
    const result = layoutTimeline(events, durationS, widthPx);

    expect(result).toHaveLength(6);
    const byType = new Map(result.map((m) => [m.event.type, m]));

    expect(byType.get('gaze-break')!.lane).toBe(0);
    expect(byType.get('blink-burst')!.lane).toBe(1);
    expect(byType.get('expression')!.lane).toBe(2);
    expect(byType.get('fidget')!.lane).toBe(3);
    expect(byType.get('pause')!.lane).toBe(4);
    expect(byType.get('filler')!.lane).toBe(5);

    // filler: t0=1, t1=1.5 -> x = 1/10*200 = 20, w = 0.5/10*200 = 10
    expect(byType.get('filler')!.x).toBeCloseTo(20);
    expect(byType.get('filler')!.w).toBeCloseTo(10);

    // gaze-break: t0=2, t1=4 -> x = 40, w = 40
    expect(byType.get('gaze-break')!.x).toBeCloseTo(40);
    expect(byType.get('gaze-break')!.w).toBeCloseTo(40);

    // pause: t0=5, t1=7 -> x = 100, w = 40
    expect(byType.get('pause')!.x).toBeCloseTo(100);
    expect(byType.get('pause')!.w).toBeCloseTo(40);
  });

  it('gives a zero-duration event the minimum width of 6px without shifting a mid-timeline mark', () => {
    const events = [mkEvent('pause', 5, 5, 'instant')];
    const result = layoutTimeline(events, 10, 200);
    expect(result).toHaveLength(1);
    expect(result[0]!.w).toBe(6);
    // x = 5/10*200 = 100; 100 + 6 = 106 <= 200, so no clamping kicks in.
    expect(result[0]!.x).toBeCloseTo(100);
  });

  it('clamps a mark that runs past durationS so x+w never exceeds widthPx', () => {
    const events = [mkEvent('filler', 9, 12, 'trailing')]; // spans 3s, only 1s inside duration
    const result = layoutTimeline(events, 10, 200);
    expect(result).toHaveLength(1);
    const mark = result[0]!;
    // raw w = (12-9)/10*200 = 60; raw x = 9/10*200 = 180; clamp x = min(180, 200-60) = 140
    expect(mark.w).toBeCloseTo(60);
    expect(mark.x).toBeCloseTo(140);
    expect(mark.x + mark.w).toBeCloseTo(200);
  });

  it('clamps a mark that starts entirely beyond durationS to hug the right edge', () => {
    const events = [mkEvent('pause', 15, 16, 'late')];
    const result = layoutTimeline(events, 10, 200);
    const mark = result[0]!;
    // raw w = (1/10)*200 = 20; raw x = 15/10*200 = 300; clamp x = min(300, 200-20) = 180
    expect(mark.w).toBeCloseTo(20);
    expect(mark.x).toBeCloseTo(180);
    expect(mark.x + mark.w).toBeCloseTo(200);
  });
});
