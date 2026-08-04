export interface UnderstudyConfig {
  // gaze
  gazeXOn: number;
  gazeYOn: number; // |offset| below which iris counts as centred (0.35 / 0.35)
  yawOn: number;
  pitchOn: number; // |radians| below which head counts as facing camera (0.35 / 0.30)
  gazeHysteresisFrames: number; // consecutive frames to switch state (3)
  gazeBreakMinS: number; // min off-camera run to report (0.3)
  // blink
  blinkOn: number;
  blinkOff: number; // rising/falling thresholds on max(eyeBlinkL, eyeBlinkR) (0.5 / 0.35)
  blinkMinGapS: number; // debounce between blinks (0.1)
  burstCount: number;
  burstWindowS: number; // >=3 blinks within 2.0s = burst
  blinkIdealLo: number;
  blinkIdealHi: number; // 8..26 blinks/min scores 100
  blinkZeroLo: number;
  blinkZeroHi: number; // 0 and 60 blinks/min score 0
  // expression
  exprBaselineS: number; // rolling median window (3.0)
  exprK: number; // MAD multiplier for onset (4)
  exprMadFloor: number; // MAD floor so flat baselines still gate (0.04)
  exprMinFrames: number; // sustained frames to count (2)
  exprTransientMaxS: number; // events longer than this are not transient; dropped (0.5)
  // head
  headWindowS: number; // fidget RMS window (2.0)
  fidgetGood: number;
  fidgetBad: number; // rad/s: <=0.05 -> 100, >=0.35 -> 0
  // vad
  vadNoisePercentile: number; // noise floor percentile (0.10)
  vadFactor: number; // speech threshold = max(floor*factor, vadAbsMin) (3)
  vadAbsMin: number; // absolute RMS minimum (0.01)
  vadHangoverS: number; // keep speech state after drop (0.3)
  pauseMinS: number; // mid-answer silence to report (1.5)
  // fluency & pace
  fillerSingles: string[]; // ['um','uh','er','erm','like','basically']
  fillerPhrases: string[][]; // [['you','know'],['sort','of'],['kind','of'],['i','mean']]
  paceIdealLo: number;
  paceIdealHi: number; // 110..160 wpm scores 100
  paceZeroLo: number;
  paceZeroHi: number; // 60 and 220 wpm score 0
  rollingWpmWindowS: number; // 10
  paceCvPenaltyAbove: number; // CV above this costs points (0.4)
  // scoring weights (sum = 1.0)
  wEyeContact: number;
  wFluency: number;
  wPace: number;
  wExpression: number;
  wBlink: number;
  wHead: number; // .22 .22 .16 .14 .13 .13
}

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
