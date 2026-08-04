import { FaceSample, DeliveryEvent } from './types';
import { UnderstudyConfig } from './config';

// One frame interval at the nominal 30fps sample rate, used as the adjacency
// tolerance when merging fidgety regions (see step 3 below).
const FRAME_INTERVAL_S = 1 / 30;

export function headSteadiness(
  frames: FaceSample[],
  cfg: UnderstudyConfig
): { fidgetIndex: number; events: DeliveryEvent[] } {
  // Calculate per-frame angular speeds, carrying the timestamp of the LATER frame in
  // each pair alongside the speed value. Carrying timestamps (rather than relying on
  // speeds[]<->frames[] index arithmetic downstream) keeps windowing and event-boundary
  // math correct even when present=false frames are skipped, which compacts this array
  // relative to the frames array.
  const speeds: Array<{ t: number; v: number }> = [];

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
    speeds.push({ t: curr.t, v: angularSpeed });
  }

  // Calculate fidgetIndex (RMS of all angular speeds)
  let fidgetIndex = 0;
  if (speeds.length >= 1) {
    const sumOfSquares = speeds.reduce((sum, s) => sum + s.v * s.v, 0);
    fidgetIndex = Math.sqrt(sumOfSquares / speeds.length);
  }

  // Find fidgety windows
  const events: DeliveryEvent[] = [];

  if (speeds.length < 1) {
    return { fidgetIndex, events };
  }

  // Calculate session median speed. For an even-length array there is no single middle
  // element, so use the average of the two middle values (standard median definition) -
  // taking just the upper-middle element biases the threshold on even-length sessions.
  const sortedSpeeds = speeds.map(s => s.v).sort((a, b) => a - b);
  const mid = Math.floor(sortedSpeeds.length / 2);
  const medianSpeed =
    sortedSpeeds.length % 2 === 0
      ? (sortedSpeeds[mid - 1]! + sortedSpeeds[mid]!) / 2
      : sortedSpeeds[mid]!;

  // Fidgety threshold: max(2 * sessionMedian, fidgetGood * 2)
  const fidgetyThreshold = Math.max(2 * medianSpeed, cfg.fidgetGood * 2);

  // Slide a headWindowS-second window over the speed samples, keyed by TIMESTAMP (not
  // array index or frame index), so that present=false gaps elsewhere in the session
  // never desync this scan from the true timeline. This pass only finds fidgety
  // REGIONS (merged windows); it does not decide final event boundaries - see the
  // trimming pass below, which fixes the "event balloons by a window-width" bug.
  //
  // Two-pointer sweep: as the window start (i) advances, the window's timestamp only
  // increases, so the window end pointer only ever moves forward too.
  const fidgetyWindows: Array<{ t0: number; t1: number }> = [];
  let windowEndIdx = 0;

  for (let i = 0; i < speeds.length; i++) {
    const windowStartT = speeds[i]!.t;
    const windowEndT = windowStartT + cfg.headWindowS;

    if (windowEndIdx < i) {
      windowEndIdx = i;
    }
    while (windowEndIdx + 1 < speeds.length && speeds[windowEndIdx + 1]!.t <= windowEndT) {
      windowEndIdx++;
    }

    let sumOfSquares = 0;
    for (let k = i; k <= windowEndIdx; k++) {
      sumOfSquares += speeds[k]!.v * speeds[k]!.v;
    }
    const windowRms = Math.sqrt(sumOfSquares / (windowEndIdx - i + 1));

    if (windowRms > fidgetyThreshold) {
      fidgetyWindows.push({ t0: speeds[i]!.t, t1: speeds[windowEndIdx]!.t });
    }
  }

  // Trim each RAW fidgety window down to the FIRST and LAST individual speed sample
  // inside it whose speed exceeds the same fidgetyThreshold, dropping windows with no
  // qualifying sample (in practice unreachable, since RMS > threshold implies some
  // sample > threshold, but guarded defensively). This is what stops an event from
  // ballooning by roughly a window-width on each side: the window scan above finds
  // where shaking-adjacent windows are, but the final reported span should cover only
  // the samples that actually shook.
  //
  // Trimming MUST happen before the adjacency merge below, not after: the raw windows
  // are still padded by up to ~headWindowS on each side, so merging on raw regions can
  // bridge a calm gap between two genuinely separate fidget episodes into one inflated
  // event (e.g. a 4.0s calm gap being swallowed into a single "restless 8.0s" event).
  // Trimming first means the merge only ever sees the true shake boundaries.
  //
  // Windows and speeds are both time-ordered, so a single running pointer suffices -
  // no need to rescan from the start of speeds for each window.
  const trimmedRegions: Array<{ t0: number; t1: number }> = [];
  let scanIdx = 0;
  for (const region of fidgetyWindows) {
    while (scanIdx < speeds.length && speeds[scanIdx]!.t < region.t0) {
      scanIdx++;
    }

    let trimmedT0: number | undefined;
    let trimmedT1: number | undefined;
    let k = scanIdx;
    while (k < speeds.length && speeds[k]!.t <= region.t1) {
      const sample = speeds[k]!;
      if (sample.v > fidgetyThreshold) {
        if (trimmedT0 === undefined) {
          trimmedT0 = sample.t;
        }
        trimmedT1 = sample.t;
      }
      k++;
    }

    if (trimmedT0 === undefined || trimmedT1 === undefined) {
      continue;
    }

    trimmedRegions.push({ t0: trimmedT0, t1: trimmedT1 });
  }

  // Merge adjacent OR overlapping TRIMMED regions. "Adjacent" means the next region
  // starts within one frame interval of where the current one ends. Running this on
  // trimmed spans (instead of the raw, window-padded regions) is what keeps two
  // genuinely separate fidget episodes from fusing across the calm gap between them.
  const mergedRegions: Array<{ t0: number; t1: number }> = [];
  for (const region of trimmedRegions) {
    if (mergedRegions.length === 0) {
      mergedRegions.push({ ...region });
    } else {
      const last = mergedRegions[mergedRegions.length - 1]!;
      if (region.t0 <= last.t1 + FRAME_INTERVAL_S) {
        last.t1 = Math.max(last.t1, region.t1);
      } else {
        mergedRegions.push({ ...region });
      }
    }
  }

  for (const region of mergedRegions) {
    const duration = region.t1 - region.t0;

    events.push({
      t0: region.t0,
      t1: region.t1,
      type: 'fidget',
      severity: 2,
      detail: `restless ${duration.toFixed(1)}s`,
    });
  }

  return { fidgetIndex, events };
}
