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
      // Check debounce: at least blinkMinGapS since last onset
      if (frame.t - lastOnsetTimeS >= cfg.blinkMinGapS) {
        blinkTimes.push(frame.t);
        lastOnsetTimeS = frame.t;
        detectorState = 'closed';
      }
    } else if (signal < cfg.blinkOff) {
      // Falling edge: reset detector to open state
      detectorState = 'open';
    }
  }

  // Step 2: Calculate blinks per minute
  const durationS = frames.length / 30;
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
      const merged = mergeOverlappingBursts(bursts);

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
 * Two windows overlap if they share any indices.
 */
function mergeOverlappingBursts(
  bursts: Array<{ startIdx: number; endIdx: number }>
): Array<{ startIdx: number; endIdx: number }> {
  if (bursts.length === 0) return [];

  // Sort by startIdx
  const sorted = [...bursts].sort((a, b) => a.startIdx - b.startIdx);

  const merged: Array<{ startIdx: number; endIdx: number }> = [];
  let current = sorted[0]!;

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]!;
    // Check if current and next overlap or are adjacent
    if (next.startIdx <= current.endIdx + 1) {
      // Merge: extend current to include next
      current.endIdx = Math.max(current.endIdx, next.endIdx);
    } else {
      // No overlap: save current and start a new one
      merged.push(current);
      current = next;
    }
  }

  // Push the last window
  merged.push(current);

  return merged;
}
