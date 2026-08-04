import { DeliveryEvent, SubScores } from './types';
import { UnderstudyConfig } from './config';

export interface ScoreParts {
  eyeContactPct: number;
  blinksPerMin: number;
  burstCount: number;
  expressionEvents: DeliveryEvent[];
  fidgetIndex: number;
  wpm: number;
  paceCv: number;
  fillerEvents: DeliveryEvent[];
  pauseEvents: DeliveryEvent[];
  durationS: number;
}

const EXPRESSION_SEVERITY_COST: Record<1 | 2 | 3, number> = { 1: 8, 2: 12, 3: 18 };
const PAUSE_SEVERITY_COST: Record<1 | 2 | 3, number> = { 1: 4, 2: 8, 3: 14 };

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Clamp to [0,100], coercing any non-finite result (e.g. 0/0 from a
 * degenerate config) to 0 so every sub-score stays a usable number. */
function clampScore(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, x));
}

function eyeContactScore(pct: number): number {
  return clampScore(100 * clamp01((pct - 40) / 50));
}

function blinkSteadinessScore(bpm: number, burstCount: number, cfg: UnderstudyConfig): number {
  let base: number;
  if (bpm >= cfg.blinkIdealLo && bpm <= cfg.blinkIdealHi) {
    base = 100;
  } else if (bpm < cfg.blinkIdealLo) {
    base = (100 * (bpm - cfg.blinkZeroLo)) / (cfg.blinkIdealLo - cfg.blinkZeroLo);
  } else {
    base = (100 * (cfg.blinkZeroHi - bpm)) / (cfg.blinkZeroHi - cfg.blinkIdealHi);
  }
  return clampScore(base - 5 * burstCount);
}

function expressionControlScore(events: DeliveryEvent[]): number {
  const total = events.reduce((sum, e) => sum + EXPRESSION_SEVERITY_COST[e.severity], 0);
  return clampScore(100 - total);
}

function headSteadinessScore(fidgetIndex: number, cfg: UnderstudyConfig): number {
  if (fidgetIndex <= cfg.fidgetGood) return 100;
  if (fidgetIndex >= cfg.fidgetBad) return 0;
  const score = (100 * (cfg.fidgetBad - fidgetIndex)) / (cfg.fidgetBad - cfg.fidgetGood);
  return clampScore(score);
}

function paceScore(wpm: number, paceCv: number, cfg: UnderstudyConfig): number {
  let base: number;
  if (wpm >= cfg.paceIdealLo && wpm <= cfg.paceIdealHi) {
    base = 100;
  } else if (wpm < cfg.paceIdealLo) {
    base = (100 * (wpm - cfg.paceZeroLo)) / (cfg.paceIdealLo - cfg.paceZeroLo);
  } else {
    base = (100 * (cfg.paceZeroHi - wpm)) / (cfg.paceZeroHi - cfg.paceIdealHi);
  }
  const penalty = 20 * Math.max(0, paceCv - cfg.paceCvPenaltyAbove);
  return clampScore(base - penalty);
}

function fluencyScore(fillerEvents: DeliveryEvent[], pauseEvents: DeliveryEvent[], durationS: number): number {
  const fillersPerMin = durationS > 0 ? fillerEvents.length / (durationS / 60) : 0;
  const pauseCost = pauseEvents.reduce((sum, e) => sum + PAUSE_SEVERITY_COST[e.severity], 0);
  const score = 100 - 12 * Math.max(0, fillersPerMin - 1) - pauseCost;
  return clampScore(score);
}

export function scoreSession(
  parts: ScoreParts,
  cfg: UnderstudyConfig
): { sub: SubScores; composure: number } {
  const sub: SubScores = {
    eyeContact: eyeContactScore(parts.eyeContactPct),
    blinkSteadiness: blinkSteadinessScore(parts.blinksPerMin, parts.burstCount, cfg),
    expressionControl: expressionControlScore(parts.expressionEvents),
    headSteadiness: headSteadinessScore(parts.fidgetIndex, cfg),
    pace: paceScore(parts.wpm, parts.paceCv, cfg),
    fluency: fluencyScore(parts.fillerEvents, parts.pauseEvents, parts.durationS),
  };

  const composure = clampScore(
    cfg.wEyeContact * sub.eyeContact +
      cfg.wFluency * sub.fluency +
      cfg.wPace * sub.pace +
      cfg.wExpression * sub.expressionControl +
      cfg.wBlink * sub.blinkSteadiness +
      cfg.wHead * sub.headSteadiness
  );

  return { sub, composure };
}
