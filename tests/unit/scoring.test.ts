import { describe, it, expect } from 'vitest';
import { scoreSession, ScoreParts } from '../../src/core/scoring';
import { DEFAULT_CONFIG as cfg } from '../../src/core/config';
import { DeliveryEvent } from '../../src/core/types';

function mkEvent(type: DeliveryEvent['type'], severity: 1 | 2 | 3): DeliveryEvent {
  return { t0: 0, t1: 1, type, severity, detail: 'test' };
}

const PERFECT: ScoreParts = {
  eyeContactPct: 95,
  blinksPerMin: 15,
  burstCount: 0,
  expressionEvents: [],
  fidgetIndex: 0.03,
  wpm: 135,
  paceCv: 0.2,
  fillerEvents: [],
  pauseEvents: [],
  durationS: 120,
};

const ROUGH: ScoreParts = {
  eyeContactPct: 50,
  blinksPerMin: 45,
  burstCount: 2,
  expressionEvents: Array.from({ length: 6 }, () => mkEvent('expression', 2)),
  fidgetIndex: 0.4,
  wpm: 80,
  paceCv: 0.6,
  fillerEvents: Array.from({ length: 16 }, () => mkEvent('filler', 1)),
  pauseEvents: Array.from({ length: 3 }, () => mkEvent('pause', 3)),
  durationS: 120,
};

describe('scoreSession', () => {
  it('scores a perfect delivery at or above 95 on every sub-score and composure', () => {
    const { sub, composure } = scoreSession(PERFECT, cfg);

    expect(sub.eyeContact).toBeGreaterThanOrEqual(95);
    expect(sub.blinkSteadiness).toBeGreaterThanOrEqual(95);
    expect(sub.expressionControl).toBeGreaterThanOrEqual(95);
    expect(sub.headSteadiness).toBeGreaterThanOrEqual(95);
    expect(sub.pace).toBeGreaterThanOrEqual(95);
    expect(sub.fluency).toBeGreaterThanOrEqual(95);
    expect(composure).toBeGreaterThanOrEqual(95);
  });

  it('scores a rough delivery below 40 composure, with every sub-score strictly below the perfect case', () => {
    const perfect = scoreSession(PERFECT, cfg);
    const rough = scoreSession(ROUGH, cfg);

    expect(rough.composure).toBeLessThan(40);
    expect(rough.sub.eyeContact).toBeLessThan(perfect.sub.eyeContact);
    expect(rough.sub.blinkSteadiness).toBeLessThan(perfect.sub.blinkSteadiness);
    expect(rough.sub.expressionControl).toBeLessThan(perfect.sub.expressionControl);
    expect(rough.sub.headSteadiness).toBeLessThan(perfect.sub.headSteadiness);
    expect(rough.sub.pace).toBeLessThan(perfect.sub.pace);
    expect(rough.sub.fluency).toBeLessThan(perfect.sub.fluency);
  });

  it('more fillers per minute never raises fluency, at the same duration', () => {
    const base: ScoreParts = { ...PERFECT, durationS: 60, pauseEvents: [] };
    const few = scoreSession(
      { ...base, fillerEvents: Array.from({ length: 4 }, () => mkEvent('filler', 1)) },
      cfg
    );
    const many = scoreSession(
      { ...base, fillerEvents: Array.from({ length: 10 }, () => mkEvent('filler', 1)) },
      cfg
    );

    expect(few.sub.fluency).toBeGreaterThan(many.sub.fluency);
  });

  it('eyeContact(70) sits strictly between eyeContact(50) and eyeContact(90)', () => {
    const at = (pct: number) => scoreSession({ ...PERFECT, eyeContactPct: pct }, cfg).sub.eyeContact;

    const lo = at(50);
    const mid = at(70);
    const hi = at(90);

    expect(mid).toBeGreaterThan(lo);
    expect(mid).toBeLessThan(hi);
  });

  it('produces finite, clamped output for zero-duration, all-zero input', () => {
    const zero: ScoreParts = {
      eyeContactPct: 0,
      blinksPerMin: 0,
      burstCount: 0,
      expressionEvents: [],
      fidgetIndex: 0,
      wpm: 0,
      paceCv: 0,
      fillerEvents: [],
      pauseEvents: [],
      durationS: 0,
    };

    const { sub, composure } = scoreSession(zero, cfg);

    const values = [
      sub.eyeContact,
      sub.blinkSteadiness,
      sub.expressionControl,
      sub.headSteadiness,
      sub.pace,
      sub.fluency,
      composure,
    ];
    for (const value of values) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('exact-value spot checks: eyeContact score map', () => {
    const at = (pct: number) => scoreSession({ ...PERFECT, eyeContactPct: pct }, cfg).sub.eyeContact;

    expect(at(90)).toBe(100);
    expect(at(40)).toBe(0);
    expect(at(65)).toBe(50);
  });

  it('exact-value spot checks: headSteadiness score map', () => {
    const at = (fidgetIndex: number) => scoreSession({ ...PERFECT, fidgetIndex }, cfg).sub.headSteadiness;

    expect(at(0.05)).toBe(100);
    expect(at(0.35)).toBe(0);
    expect(at(0.2)).toBeCloseTo(50, 9);
  });

  it('exact-value spot checks: pace score map', () => {
    const at = (wpm: number, paceCv = 0) => scoreSession({ ...PERFECT, wpm, paceCv }, cfg).sub.pace;

    expect(at(135, 0)).toBe(100);
    expect(at(60)).toBe(0);
    expect(at(220)).toBe(0);
  });

  it('exact-value spot checks: pace score between the bands, and the variability penalty', () => {
    const at = (wpm: number, paceCv = 0) => scoreSession({ ...PERFECT, wpm, paceCv }, cfg).sub.pace;

    expect(at(85)).toBeCloseTo(50, 9); // halfway from 60 up to the 110 ideal
    expect(at(190)).toBeCloseTo(50, 9); // halfway from the 160 ideal to 220
    expect(at(135, 0.4)).toBe(100); // variability at the threshold costs nothing
    expect(at(135, 0.9)).toBeCloseTo(90, 9); // 20 points per unit of CV above 0.4
  });

  it('exact-value spot checks: blinkSteadiness score map and burst penalty', () => {
    const at = (blinksPerMin: number, burstCount = 0) =>
      scoreSession({ ...PERFECT, blinksPerMin, burstCount }, cfg).sub.blinkSteadiness;

    expect(at(8)).toBe(100);
    expect(at(26)).toBe(100);
    expect(at(4)).toBeCloseTo(50, 9); // halfway from 0 up to the ideal band
    expect(at(43)).toBeCloseTo(50, 9); // halfway from the ideal band to 60
    expect(at(0)).toBe(0);
    expect(at(60)).toBe(0);
    expect(at(15, 2)).toBe(90); // 5 points per blink burst
  });

  it('exact-value spot checks: fluency allows one filler a minute, then charges per filler and per pause', () => {
    const at = (fillers: number, pauses: Array<1 | 2 | 3> = []) =>
      scoreSession(
        {
          ...PERFECT,
          durationS: 60,
          fillerEvents: Array.from({ length: fillers }, () => mkEvent('filler', 1)),
          pauseEvents: pauses.map((severity) => mkEvent('pause', severity)),
        },
        cfg
      ).sub.fluency;

    expect(at(1)).toBe(100);
    expect(at(3)).toBe(76); // 12 points per filler per minute above the first
    expect(at(0, [1])).toBe(96);
    expect(at(0, [2])).toBe(92);
    expect(at(0, [3])).toBe(86);
  });

  it('exact-value spot checks: expressionControl charges by event severity', () => {
    const at = (severity: 1 | 2 | 3) =>
      scoreSession({ ...PERFECT, expressionEvents: [mkEvent('expression', severity)] }, cfg).sub.expressionControl;

    expect(at(1)).toBe(92);
    expect(at(2)).toBe(88);
    expect(at(3)).toBe(82);
  });

  it('composure weights each sub-score as configured (.22 .22 .16 .14 .13 .13)', () => {
    // PERFECT scores 100 on every sub-score, so zeroing exactly one of them
    // costs composure exactly that sub-score's weight x 100.
    const composure = (parts: Partial<ScoreParts>) => scoreSession({ ...PERFECT, ...parts }, cfg).composure;
    const many = (type: DeliveryEvent['type'], severity: 1 | 2 | 3) =>
      Array.from({ length: 30 }, () => mkEvent(type, severity));

    expect(composure({})).toBeCloseTo(100, 9);
    expect(composure({ eyeContactPct: 40 })).toBeCloseTo(78, 9);
    expect(composure({ durationS: 60, fillerEvents: many('filler', 1) })).toBeCloseTo(78, 9);
    expect(composure({ wpm: 60 })).toBeCloseTo(84, 9);
    expect(composure({ expressionEvents: many('expression', 3) })).toBeCloseTo(86, 9);
    expect(composure({ blinksPerMin: 60 })).toBeCloseTo(87, 9);
    expect(composure({ fidgetIndex: 0.35 })).toBeCloseTo(87, 9);
  });
});
