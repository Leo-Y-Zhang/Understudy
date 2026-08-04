import { FaceSample, DeliveryEvent } from './types';
import { UnderstudyConfig } from './config';

interface Channel {
  detail: string;
  value: (f: FaceSample) => number;
}

const CHANNELS: Channel[] = [
  {
    detail: 'brow furrow',
    value: (f) => (f.blend.browDownLeft + f.blend.browDownRight) / 2,
  },
  {
    detail: 'lip press',
    value: (f) => (f.blend.mouthPressLeft + f.blend.mouthPressRight) / 2,
  },
  {
    detail: 'asymmetric smile',
    value: (f) => Math.abs(f.blend.mouthSmileLeft - f.blend.mouthSmileRight),
  },
];

export function detectExpressionEvents(
  frames: FaceSample[],
  cfg: UnderstudyConfig
): DeliveryEvent[] {
  if (frames.length === 0) return [];

  const events: DeliveryEvent[] = [];
  for (const channel of CHANNELS) {
    events.push(...detectChannelEvents(frames, cfg, channel));
  }

  // Channels are detected independently and may interleave in time; present
  // the merged stream in chronological order.
  events.sort((a, b) => a.t0 - b.t0);
  return events;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function mad(values: number[], med: number): number {
  return median(values.map((v) => Math.abs(v - med)));
}

interface HistoryEntry {
  t: number;
  v: number;
}

interface PendingEntry extends HistoryEntry {
  median: number;
  gate: number;
}

/**
 * Detects transient excursions on a single channel using a rolling
 * median/MAD baseline.
 *
 * Interpretation notes (per task-7 brief, chosen to satisfy the spec'd
 * behaviour and documented here since the brief leaves some edges implicit):
 *
 * - "Warm-up": no detection is attempted until at least exprBaselineS
 *   seconds have elapsed since the first frame in the stream. Before that,
 *   frames are simply folded into the baseline history untested. This is
 *   what stops a channel that is already elevated at t=0 from firing on
 *   frame 2 purely because its 1-frame history has ~zero MAD.
 *
 * - Onset frames are held in a `pending` buffer (not yet added to
 *   `history`) until the run either reaches exprMinFrames (becomes a
 *   confirmed event -- those frames are then permanently excluded from the
 *   baseline) or breaks early (the frames are ordinary noise and are
 *   committed to `history` retroactively). This is how "baseline excludes
 *   frames during the event" is honoured even though we don't know a frame
 *   is "during the event" until exprMinFrames later.
 *
 * - The median/MAD/gate are frozen at the values computed for the *first*
 *   frame of the onset run (not the frame where the run is confirmed),
 *   since that is the last un-excited state of the baseline.
 *
 * - Offset is a single-frame test (no minimum run length): the first frame
 *   whose value drops back below median+gate/2 closes the event, and that
 *   frame itself is treated as a normal (in-baseline) frame from then on.
 *   Event duration is measured onset-frame-time to offset-frame-time, i.e.
 *   duration == elapsed time spent above the low (gate/2) threshold.
 *
 * - An event still open when the stream ends never reaches an offset frame
 *   and is therefore simply never pushed (dropped), matching the brief.
 */
function detectChannelEvents(
  frames: FaceSample[],
  cfg: UnderstudyConfig,
  channel: Channel
): DeliveryEvent[] {
  const events: DeliveryEvent[] = [];
  const streamStartT = frames[0]!.t;

  // Trailing baseline history (chronological order), pruned to the trailing
  // exprBaselineS window relative to the frame currently being processed.
  const history: HistoryEntry[] = [];

  // Frames above the (unfrozen) onset threshold whose run hasn't yet reached
  // exprMinFrames -- neither confirmed-event nor confirmed-baseline yet.
  let pending: PendingEntry[] = [];

  // Open-event state, frozen at onset.
  let open = false;
  let onsetT = 0;
  let frozenMedian = 0;
  let frozenGate = 0;
  let peak = 0;

  for (const frame of frames) {
    const t = frame.t;
    const v = channel.value(frame);

    // Drop history entries that have aged out of the trailing window.
    while (history.length > 0 && history[0]!.t < t - cfg.exprBaselineS) {
      history.shift();
    }

    if (open) {
      peak = Math.max(peak, v);
      if (v < frozenMedian + frozenGate / 2) {
        // Offset: the excursion has ended.
        const duration = t - onsetT;
        if (duration <= cfg.exprTransientMaxS) {
          const severity: 1 | 2 = peak - frozenMedian > 2 * frozenGate ? 2 : 1;
          events.push({
            t0: onsetT,
            t1: t,
            type: 'expression',
            severity,
            detail: channel.detail,
          });
        }
        open = false;
        // Fall through: this frame is back at baseline and is processed
        // below like any other normal frame (it will be added to history).
      } else {
        // Still excursing: excluded from the baseline entirely.
        continue;
      }
    }

    const warmedUp = t - streamStartT >= cfg.exprBaselineS;
    if (!warmedUp || history.length === 0) {
      history.push({ t, v });
      continue;
    }

    const values = history.map((h) => h.v);
    const med = median(values);
    const gate = cfg.exprK * Math.max(mad(values, med), cfg.exprMadFloor);
    const threshold = med + gate;

    if (v > threshold) {
      pending.push({ t, v, median: med, gate });
      if (pending.length >= cfg.exprMinFrames) {
        const onset = pending[0]!;
        open = true;
        onsetT = onset.t;
        frozenMedian = onset.median;
        frozenGate = onset.gate;
        peak = Math.max(...pending.map((p) => p.v));
        pending = [];
      }
    } else {
      // The run (if any) never reached exprMinFrames -- it was ordinary
      // baseline fluctuation, not an excluded event; commit it now.
      for (const p of pending) history.push({ t: p.t, v: p.v });
      pending = [];
      history.push({ t, v });
    }
  }

  return events;
}
