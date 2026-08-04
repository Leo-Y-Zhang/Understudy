// Deterministic stand-in for FaceTracker, used when `?mock=1` is present so
// the app (and its HUD) can be exercised end-to-end without a real camera.
// Same shape as FaceTracker except start() takes no video -- there's nothing
// to read frames from.

import type { Blend, FaceSample } from '../core/types';

const FPS = 30;
const FRAME_INTERVAL_MS = 1000 / FPS;

// One 2s gaze-away block.
const GAZE_AWAY_T0 = 10;
const GAZE_AWAY_T1 = 12;

// A 4-blink cluster: four short on/off pulses starting at t=30, each
// separated by more than the app's blink debounce (0.1s) so they register
// as four distinct blinks within a <2s window (a "burst" per core/blink.ts's
// default config: >=3 blinks within 2.0s).
const BLINK_PULSES: Array<[number, number]> = [
  [30.0, 30.1],
  [30.3, 30.4],
  [30.6, 30.7],
  [30.9, 31.0],
];
const BLINK_VALUE = 0.9;

const ZERO_BLEND: Blend = {
  eyeBlinkLeft: 0,
  eyeBlinkRight: 0,
  browDownLeft: 0,
  browDownRight: 0,
  mouthPressLeft: 0,
  mouthPressRight: 0,
  mouthSmileLeft: 0,
  mouthSmileRight: 0,
};

export class MockTracker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;

  start(onSample: (s: FaceSample) => void, opts?: { fast?: boolean }): Promise<void> {
    if (this.timer !== null) throw new Error('MockTracker already started');

    this.frameIndex = 0;
    console.log('[mockTracker] tracker-initialized');

    // `fast` only compresses real time between ticks; `t` stays
    // index-derived (frameIndex / FPS), so the virtual timeline used by the
    // detectors is unchanged -- a fast run just races through it quicker.
    const intervalMs = opts?.fast ? 1 : FRAME_INTERVAL_MS;

    this.timer = setInterval(() => {
      const t = this.frameIndex / FPS;
      onSample(sampleAt(t));
      this.frameIndex += 1;
    }, intervalMs);

    return Promise.resolve();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

function sampleAt(t: number): FaceSample {
  const gazeAway = t >= GAZE_AWAY_T0 && t < GAZE_AWAY_T1;
  const blinking = BLINK_PULSES.some(([t0, t1]) => t >= t0 && t < t1);

  const blend: Blend = blinking
    ? { ...ZERO_BLEND, eyeBlinkLeft: BLINK_VALUE, eyeBlinkRight: BLINK_VALUE }
    : ZERO_BLEND;

  return {
    t,
    present: true,
    blend,
    yaw: 0,
    pitch: 0,
    roll: 0,
    gazeX: gazeAway ? 0.9 : 0,
    gazeY: 0,
  };
}
