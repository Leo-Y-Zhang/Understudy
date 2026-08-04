import { FaceSample, DeliveryEvent } from './types';
import { UnderstudyConfig } from './config';

export interface GazeResult {
  events: DeliveryEvent[];
  eyeContactPct: number;
}

export function detectGaze(frames: FaceSample[], cfg: UnderstudyConfig): GazeResult {
  if (frames.length === 0) {
    return {
      events: [],
      eyeContactPct: 0,
    };
  }

  // Step 1: Compute raw classification for each frame
  // on = present && |gazeX|<gazeXOn && |gazeY|<gazeYOn && |yaw|<yawOn && |pitch|<pitchOn
  const rawOn = frames.map((frame) => {
    return (
      frame.present &&
      Math.abs(frame.gazeX) < cfg.gazeXOn &&
      Math.abs(frame.gazeY) < cfg.gazeYOn &&
      Math.abs(frame.yaw) < cfg.yawOn &&
      Math.abs(frame.pitch) < cfg.pitchOn
    );
  });

  // Step 2: Compute eyeContactPct from raw classification (before hysteresis)
  const rawOnFrames = rawOn.filter((v) => v).length;
  const eyeContactPct = (100 * rawOnFrames) / frames.length;

  // Step 3: Apply hysteresis state machine
  // State flips only after gazeHysteresisFrames consecutive opposite raw frames
  const hysteresisState = applyHysteresis(rawOn, cfg.gazeHysteresisFrames);

  // Step 4: Find contiguous off runs and create events
  const events = findGazeBreakEvents(frames, hysteresisState, cfg.gazeBreakMinS);

  return {
    events,
    eyeContactPct,
  };
}

function applyHysteresis(rawOn: boolean[], hysteresisFrames: number): boolean[] {
  const state: boolean[] = [];
  let currentState = true; // start as on
  let oppositeCount = 0;

  for (const raw of rawOn) {
    if (raw === currentState) {
      // Same as current state, reset opposite count
      oppositeCount = 0;
    } else {
      // Opposite to current state, increment counter
      oppositeCount++;
      if (oppositeCount >= hysteresisFrames) {
        // Flip state
        currentState = !currentState;
        oppositeCount = 0;
      }
    }
    state.push(currentState);
  }

  return state;
}

function findGazeBreakEvents(
  frames: FaceSample[],
  hysteresisState: boolean[],
  gazeBreakMinS: number
): DeliveryEvent[] {
  const events: DeliveryEvent[] = [];

  let offStart: number | null = null;
  let offStartFrameIdx: number | null = null;

  for (let i = 0; i < hysteresisState.length; i++) {
    const isOn = hysteresisState[i];

    if (!isOn && offStart === null) {
      // Start of off run
      offStart = frames[i]!.t;
      offStartFrameIdx = i;
    } else if (isOn && offStart !== null) {
      // End of off run
      const offEndFrameIdx = i - 1;
      const offEnd = frames[offEndFrameIdx]!.t + 1 / 30; // end time is last frame + frame duration
      const duration = offEnd - offStart;

      if (duration >= gazeBreakMinS) {
        // Create event
        const severity = duration >= 2 ? 3 : duration >= 1 ? 2 : 1;
        events.push({
          t0: offStart,
          t1: offEnd,
          type: 'gaze-break',
          severity,
          detail: `gaze away ${duration.toFixed(1)}s`,
        });
      }

      offStart = null;
      offStartFrameIdx = null;
    }
  }

  // Handle case where session ends in off state
  if (offStart !== null && offStartFrameIdx !== null) {
    const offEnd = frames[frames.length - 1]!.t + 1 / 30;
    const duration = offEnd - offStart;

    if (duration >= gazeBreakMinS) {
      const severity = duration >= 2 ? 3 : duration >= 1 ? 2 : 1;
      events.push({
        t0: offStart,
        t1: offEnd,
        type: 'gaze-break',
        severity,
        detail: `gaze away ${duration.toFixed(1)}s`,
      });
    }
  }

  return events;
}
