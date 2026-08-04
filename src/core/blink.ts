import { FaceSample, DeliveryEvent } from './types';
import { UnderstudyConfig } from './config';

export interface BlinkResult {
  blinkTimes: number[];
  events: DeliveryEvent[];
  blinksPerMin: number;
}

export function detectBlinks(frames: FaceSample[], cfg: UnderstudyConfig): BlinkResult {
  if (frames.length === 0) {
    return {
      blinkTimes: [],
      events: [],
      blinksPerMin: 0,
    };
  }

  // Step 1: Detect blink onsets using hysteresis on max(eyeBlinkLeft, eyeBlinkRight)
  const blinkTimes: number[] = [];
  let detectorState: 'open' | 'closed' = 'open';
  let lastOnsetTimeS = -Infinity;

  for (const frame of frames) {
    const signal = Math.max(frame.blend.eyeBlinkLeft, frame.blend.eyeBlinkRight);

    // Hysteresis: rising edge detection
    if (signal >= cfg.blinkOn && detectorState === 'open') {
      // Any crossing >= blinkOn from the open state closes the detector,
      // whether or not the onset ends up registering. This prevents a
      // debounce-blocked candidate from resurfacing later as a "new" onset
      // once the clock catches up on the same held-high signal -- a new
      // onset requires the signal to drop below blinkOff and rise again.
      detectorState = 'closed';

      // Check debounce: at least blinkMinGapS since last onset
      if (frame.t - lastOnsetTimeS >= cfg.blinkMinGapS) {
        blinkTimes.push(frame.t);
        lastOnsetTimeS = frame.t;
      }
    } else if (signal < cfg.blinkOff) {
      // Falling edge: reset detector to open state
      detectorState = 'open';
    }
  }

  // Step 2: Calculate blinks per minute, from the real elapsed span between
  // the first and last frame -- NOT frames.length / 30. Real capture runs
  // at whatever rate the camera and per-frame face-tracking inference
  // sustain (commonly 15fps or lower on a laptop webcam, sometimes less on
  // the CPU delegate fallback), not a fixed 30fps, so frames.length/30
  // silently inflates or deflates the reported rate by (30 / actual fps) --
  // e.g. a genuine 17 blinks/min at 15fps used to read as 34/min. See
  // core/head.ts's FRAME_INTERVAL_S and core/gaze.ts's two `+ 1/30`
  // end-of-run nudges for the acceptable uses of a fixed 1/30 elsewhere in
  // this module family -- both are per-event boundary/merge tolerances
  // (negligible either way), never a session-spanning DURATION like this.
  // (frames.length > 0 is guaranteed here by the early return above; a
  // single-frame session has no elapsed span, hence the >= 2 guard.)
  const durationS = frames.length >= 2 ? frames[frames.length - 1]!.t - frames[0]!.t : 0;
  const blinksPerMin = durationS > 0 ? (blinkTimes.length / durationS) * 60 : 0;

  // Step 3: Detect burst clusters (sliding window: >= burstCount onsets within burstWindowS)
  const events: DeliveryEvent[] = [];

  if (blinkTimes.length >= cfg.burstCount) {
    // Find all potential burst windows using sliding window
    const bursts: Array<{ startIdx: number; endIdx: number }> = [];

    for (let i = 0; i < blinkTimes.length; i++) {
      // Find how many onsets fall within burstWindowS starting from blinkTimes[i]
      let j = i;
      const iTime = blinkTimes[i]!;
      while (j < blinkTimes.length && blinkTimes[j]! - iTime <= cfg.burstWindowS) {
        j++;
      }
      const count = j - i;

      if (count >= cfg.burstCount) {
        bursts.push({ startIdx: i, endIdx: j - 1 });
      }
    }

    // Merge overlapping burst windows
    if (bursts.length > 0) {
      const merged = mergeOverlappingBursts(bursts, blinkTimes, cfg.burstWindowS);

      // Create events from merged burst windows
      for (const burst of merged) {
        const blinkCount = burst.endIdx - burst.startIdx + 1;
        const t0 = blinkTimes[burst.startIdx]!;
        const t1 = blinkTimes[burst.endIdx]!;

        // Determine severity: 3 if >= 5 blinks, else 2
        const severity = blinkCount >= 5 ? (3 as const) : (2 as const);
        const detail = `blink burst: ${blinkCount} blinks in ${(t1 - t0).toFixed(1)}s`;

        events.push({
          t0,
          t1,
          type: 'blink-burst',
          severity,
          detail,
        });
      }
    }
  }

  return {
    blinkTimes,
    events,
    blinksPerMin,
  };
}

/**
 * Merge overlapping burst windows.
 * A window is defined by [startIdx, endIdx] in the blinkTimes array.
 * Two windows are merged only if they chain in TIME: the next window's
 * first onset must fall within burstWindowS of the current window's last
 * onset. Array-index adjacency alone is not sufficient -- two unrelated
 * clusters can be adjacent in the (filtered) bursts array while being far
 * apart in time, and must not be fabricated into a single event.
 */
function mergeOverlappingBursts(
  bursts: Array<{ startIdx: number; endIdx: number }>,
  blinkTimes: number[],
  burstWindowS: number
): Array<{ startIdx: number; endIdx: number }> {
  if (bursts.length === 0) return [];

  // Sort by startIdx
  const sorted = [...bursts].sort((a, b) => a.startIdx - b.startIdx);

  const merged: Array<{ startIdx: number; endIdx: number }> = [];
  let current = { startIdx: sorted[0]!.startIdx, endIdx: sorted[0]!.endIdx };

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]!;
    const gapS = blinkTimes[next.startIdx]! - blinkTimes[current.endIdx]!;

    if (gapS <= burstWindowS) {
      // Chained in time: extend current to include next (new object, no mutation of inputs)
      current = { startIdx: current.startIdx, endIdx: Math.max(current.endIdx, next.endIdx) };
    } else {
      // Not chained in time: save current and start a new one
      merged.push(current);
      current = { startIdx: next.startIdx, endIdx: next.endIdx };
    }
  }

  // Push the last window
  merged.push(current);

  return merged;
}
