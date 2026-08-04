import type { UnderstudyConfig } from './types';

export const DEFAULT_CONFIG: UnderstudyConfig = {
  // gaze
  gazeXOn: 0.35,
  gazeYOn: 0.35,
  yawOn: 0.35,
  pitchOn: 0.30,
  gazeHysteresisFrames: 3,
  gazeBreakMinS: 0.3,
  // blink
  blinkOn: 0.5,
  blinkOff: 0.35,
  blinkMinGapS: 0.1,
  burstCount: 3,
  burstWindowS: 2.0,
  blinkIdealLo: 8,
  blinkIdealHi: 26,
  blinkZeroLo: 0,
  blinkZeroHi: 60,
  // expression
  exprBaselineS: 3.0,
  exprK: 4,
  exprMadFloor: 0.04,
  exprMinFrames: 2,
  exprTransientMaxS: 0.5,
  // head
  headWindowS: 2.0,
  fidgetGood: 0.05,
  fidgetBad: 0.35,
  // vad
  vadNoisePercentile: 0.10,
  vadFactor: 3,
  vadAbsMin: 0.01,
  vadHangoverS: 0.3,
  pauseMinS: 1.5,
  // fluency & pace
  fillerSingles: ['um', 'uh', 'er', 'erm', 'like', 'basically'],
  fillerPhrases: [
    ['you', 'know'],
    ['sort', 'of'],
    ['kind', 'of'],
    ['i', 'mean'],
  ],
  paceIdealLo: 110,
  paceIdealHi: 160,
  paceZeroLo: 60,
  paceZeroHi: 220,
  rollingWpmWindowS: 10,
  paceCvPenaltyAbove: 0.4,
  // scoring weights (sum = 1.0)
  wEyeContact: 0.22,
  wFluency: 0.22,
  wPace: 0.16,
  wExpression: 0.14,
  wBlink: 0.13,
  wHead: 0.13,
};

export function resolveConfig(
  p?: Partial<UnderstudyConfig>
): UnderstudyConfig {
  return { ...DEFAULT_CONFIG, ...p };
}
