export interface FaceSample {
  t: number;            // seconds since answer start
  present: boolean;     // face detected this frame
  blend: Blend;         // blendshape scores 0..1
  yaw: number; pitch: number; roll: number;   // radians
  gazeX: number; gazeY: number;               // iris offset, -1..1, 0 = centred
}

export interface Blend {
  eyeBlinkLeft: number; eyeBlinkRight: number;
  browDownLeft: number; browDownRight: number;
  mouthPressLeft: number; mouthPressRight: number;
  mouthSmileLeft: number; mouthSmileRight: number;
}

export interface TimedWord {
  text: string; t0: number; t1: number;
}

export interface RmsSeries {
  hopS: number; values: Float32Array;
}

export interface VadSegment {
  t0: number; t1: number; speech: boolean;
}

export type EventType = 'gaze-break' | 'blink-burst' | 'expression' | 'fidget' | 'filler' | 'pause';

export interface DeliveryEvent {
  t0: number; t1: number; type: EventType;
  severity: 1 | 2 | 3;
  detail: string;       // human-readable, e.g. "gaze away 2.1s", "'um'"
}

export interface SubScores {
  eyeContact: number; blinkSteadiness: number; expressionControl: number;
  headSteadiness: number; pace: number; fluency: number;   // each 0..100
}

export interface SessionStats {
  durationS: number; eyeContactPct: number; blinksPerMin: number;
  wpm: number; paceCv: number; fillerCount: number; pauseCount: number;
  fidgetIndex: number; wordCount: number;
}

export interface SessionAnalysis {
  events: DeliveryEvent[];   // sorted by t0
  sub: SubScores; composure: number; stats: SessionStats;
}

export interface SessionInput {
  frames: FaceSample[]; words: TimedWord[]; rms: RmsSeries; durationS: number;
}
