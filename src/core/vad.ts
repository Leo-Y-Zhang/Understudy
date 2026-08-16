import { RmsSeries, VadSegment, DeliveryEvent } from './types';
import { UnderstudyConfig } from './config';

export function segmentSpeech(rms: RmsSeries, cfg: UnderstudyConfig): VadSegment[] {
  const { hopS, values } = rms;
  const n = values.length;

  if (n === 0) {
    return [];
  }

  const noiseFloor = quantile(values, cfg.vadNoisePercentile);
  let threshold = Math.max(noiseFloor * cfg.vadFactor, cfg.vadAbsMin);

  // The percentile noise floor assumes at least vadNoisePercentile of the
  // session is silence. An answer delivered with little dead air breaks that
  // assumption: the 10th percentile lands on the SPEECH level, the scaled
  // threshold ends up above every sample in the series, and the whole take
  // reads as one long silence -- so the pause detector reports nothing, and
  // fluency scores a clean sheet, precisely for the sessions that contain
  // the least silence to estimate from. A single genuine 5s pause in an
  // otherwise continuous 60s answer is under 10% of the series and was
  // dropped this way.
  //
  // When no sample at all clears the estimated threshold, the estimate is
  // the thing that failed, not the audio. Fall back to vadAbsMin, the
  // config's own statement of "this much energy is speech", but only if
  // something in the series actually reaches it -- a genuinely silent or
  // too-quiet session (mic muted, speech below vadAbsMin) has no speech in
  // it and must keep reading as silence rather than being talked into one.
  let peak = 0;
  for (let i = 0; i < n; i++) {
    if (values[i]! > peak) peak = values[i]!;
  }
  if (peak < threshold && peak >= cfg.vadAbsMin) {
    threshold = cfg.vadAbsMin;
  }

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
