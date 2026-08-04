import { RmsSeries, VadSegment, DeliveryEvent } from './types';
import { UnderstudyConfig } from './config';

export function segmentSpeech(rms: RmsSeries, cfg: UnderstudyConfig): VadSegment[] {
  const { hopS, values } = rms;
  const n = values.length;

  if (n === 0) {
    return [];
  }

  const noiseFloor = quantile(values, cfg.vadNoisePercentile);
  const threshold = Math.max(noiseFloor * cfg.vadFactor, cfg.vadAbsMin);

  // Per-frame state with hangover: silence -> speech flips immediately on a
  // raw-speech frame; speech -> silence only after vadHangoverS seconds
  // (measured from the last raw-speech frame) with no further raw speech.
  const state: boolean[] = new Array(n);
  let lastSpeechIdx = -1;

  for (let i = 0; i < n; i++) {
    const raw = values[i]! >= threshold;
    if (raw) {
      lastSpeechIdx = i;
      state[i] = true;
    } else if (lastSpeechIdx >= 0 && (i - lastSpeechIdx) * hopS < cfg.vadHangoverS) {
      state[i] = true;
    } else {
      state[i] = false;
    }
  }

  // Run-length encode the state array into alternating segments covering
  // [0, n*hopS] exactly.
  const segments: VadSegment[] = [];
  let segStart = 0;
  let segSpeech = state[0]!;

  for (let i = 1; i <= n; i++) {
    if (i === n || state[i] !== segSpeech) {
      segments.push({ t0: segStart * hopS, t1: i * hopS, speech: segSpeech });
      if (i < n) {
        segStart = i;
        segSpeech = state[i]!;
      }
    }
  }

  return segments;
}

export function detectPauses(segments: VadSegment[], cfg: UnderstudyConfig): DeliveryEvent[] {
  const speechIdxs: number[] = [];
  segments.forEach((seg, i) => {
    if (seg.speech) speechIdxs.push(i);
  });

  if (speechIdxs.length === 0) {
    return [];
  }

  const firstSpeechIdx = speechIdxs[0]!;
  const lastSpeechIdx = speechIdxs[speechIdxs.length - 1]!;

  const events: DeliveryEvent[] = [];

  for (let i = firstSpeechIdx + 1; i < lastSpeechIdx; i++) {
    const seg = segments[i]!;
    if (seg.speech) continue;

    const dur = seg.t1 - seg.t0;
    if (dur >= cfg.pauseMinS) {
      const severity = dur >= 3 ? 3 : dur >= 2.25 ? 2 : 1;
      events.push({
        t0: seg.t0,
        t1: seg.t1,
        type: 'pause',
        severity,
        detail: `pause ${dur.toFixed(1)}s`,
      });
    }
  }

  return events;
}

/**
 * Quantile of a copy of `values`, sorted ascending, sampled at
 * index = floor(p * (n - 1)).
 */
function quantile(values: Float32Array, p: number): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[idx]!;
}
