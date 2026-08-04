import { FaceSample, DeliveryEvent } from './types';
import { UnderstudyConfig } from './config';

export function headSteadiness(
  frames: FaceSample[],
  cfg: UnderstudyConfig
): { fidgetIndex: number; events: DeliveryEvent[] } {
  // Calculate per-frame angular speeds
  const speeds: number[] = [];

  for (let i = 1; i < frames.length; i++) {
    const curr = frames[i]!;
    const prev = frames[i - 1]!;

    // Skip if either frame is not present
    if (!curr.present || !prev.present) {
      continue;
    }

    const dt = curr.t - prev.t;
    if (dt <= 0) {
      continue;
    }

    const dyaw = curr.yaw - prev.yaw;
    const dpitch = curr.pitch - prev.pitch;
    const droll = curr.roll - prev.roll;

    const angularSpeed = Math.sqrt(dyaw * dyaw + dpitch * dpitch + droll * droll) / dt;
    speeds.push(angularSpeed);
  }

  // Calculate fidgetIndex (RMS of all angular speeds)
  let fidgetIndex = 0;
  if (speeds.length >= 1) {
    const sumOfSquares = speeds.reduce((sum, s) => sum + s * s, 0);
    fidgetIndex = Math.sqrt(sumOfSquares / speeds.length);
  }

  // Find fidgety windows
  const events: DeliveryEvent[] = [];

  if (speeds.length < 1) {
    return { fidgetIndex, events };
  }

  // Calculate session median speed
  const sortedSpeeds = [...speeds].sort((a, b) => a - b);
  const medianSpeed = sortedSpeeds[Math.floor(sortedSpeeds.length / 2)]!;

  // Fidgety threshold: max(2 * sessionMedian, fidgetGood * 2)
  const fidgetyThreshold = Math.max(2 * medianSpeed, cfg.fidgetGood * 2);

  // Slide window over the frame array
  // A window of headWindowS seconds = headWindowS * 30 speeds (at 30fps)
  // Which spans headWindowS * 30 + 1 frames
  const windowSpeedsCount = Math.round(cfg.headWindowS * 30);
  const windowFrameCount = windowSpeedsCount + 1;

  const fidgetyWindows: Array<{ startIdx: number; endIdx: number }> = [];

  for (let i = 0; i <= frames.length - windowFrameCount; i++) {
    const windowStart = i;
    const windowEnd = i + windowFrameCount - 1;

    // Calculate RMS of speeds in this window
    // Speeds array has length frames.length - 1, where speeds[i] is the speed from frames[i] to frames[i+1]
    // A window from frame i to frame i+W-1 (W frames) corresponds to speeds i to i+W-2 (W-1 speeds)
    const speedsInWindow: number[] = [];
    for (let j = windowStart; j < windowEnd; j++) {
      if (j < speeds.length) {
        speedsInWindow.push(speeds[j]!);
      }
    }

    if (speedsInWindow.length > 0) {
      const sumOfSquares = speedsInWindow.reduce((sum, s) => sum + s * s, 0);
      const windowRms = Math.sqrt(sumOfSquares / speedsInWindow.length);

      if (windowRms > fidgetyThreshold) {
        fidgetyWindows.push({ startIdx: windowStart, endIdx: windowEnd });
      }
    }
  }

  // Merge adjacent/overlapping fidgety windows
  if (fidgetyWindows.length > 0) {
    const merged: Array<{ startIdx: number; endIdx: number }> = [];

    for (const window of fidgetyWindows) {
      if (merged.length === 0) {
        merged.push(window);
      } else {
        const last = merged[merged.length - 1]!;
        // Merge if overlapping (window starts before or at last window end)
        if (window.startIdx <= last.endIdx) {
          last.endIdx = Math.max(last.endIdx, window.endIdx);
        } else {
          merged.push(window);
        }
      }
    }

    // Convert merged windows to events
    for (const window of merged) {
      const t0 = frames[window.startIdx]!.t;
      const t1 = frames[window.endIdx]!.t;
      const duration = t1 - t0;

      events.push({
        t0,
        t1,
        type: 'fidget',
        severity: 2,
        detail: `restless ${duration.toFixed(1)}s`,
      });
    }
  }

  return { fidgetIndex, events };
}
