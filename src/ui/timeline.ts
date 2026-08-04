// Pure, DOM-free layout helper for the replay screen's annotated timeline.
// Kept separate from screens/replay.ts so it is trivially unit-testable
// (no jsdom, no canvas) and so the drawing code in replay.ts stays a thin
// consumer of already-laid-out pixel coordinates.

import type { DeliveryEvent, EventType } from '../core/types';

/**
 * Fixed lane order: a given event type always draws in the same row,
 * regardless of the order events happen to appear in the input array (which
 * is time-sorted, not type-grouped).
 */
export const TIMELINE_LANE_ORDER: EventType[] = [
  'gaze-break',
  'blink-burst',
  'expression',
  'fidget',
  'pause',
  'filler',
];

const MIN_MARK_WIDTH_PX = 6;

export interface TimelineMark {
  event: DeliveryEvent;
  x: number;
  w: number;
  lane: number;
}

/**
 * Lays out delivery events into pixel x/width/lane coordinates for a
 * `widthPx`-wide strip spanning `durationS` seconds.
 *
 * - `lane` comes from `TIMELINE_LANE_ORDER`, not array position.
 * - `x = t0/durationS * widthPx`.
 * - `w = max(MIN_MARK_WIDTH_PX, (t1-t0)/durationS * widthPx)` -- an
 *   instantaneous (or sub-pixel) event still renders as a visible mark.
 * - An event that runs past `durationS` gets its right edge (`x + w`)
 *   clamped to `widthPx` by pulling `x` left (never by shrinking `w`), so a
 *   mark's width still reflects the event's true duration; it just hugs the
 *   end of the strip instead of running off it. An event that starts
 *   entirely beyond `durationS` clamps the same way, landing flush against
 *   the right edge.
 * - Degenerate input (`durationS` or `widthPx` <= 0) has no timeline to lay
 *   out against, so it returns `[]` rather than dividing by zero or
 *   producing NaN/Infinity coordinates.
 */
export function layoutTimeline(
  events: DeliveryEvent[],
  durationS: number,
  widthPx: number
): TimelineMark[] {
  if (!(durationS > 0) || !(widthPx > 0)) return [];

  return events.map((event) => {
    const lane = TIMELINE_LANE_ORDER.indexOf(event.type);
    const rawX = (event.t0 / durationS) * widthPx;
    const w = Math.max(MIN_MARK_WIDTH_PX, ((event.t1 - event.t0) / durationS) * widthPx);
    const x = Math.max(0, Math.min(rawX, widthPx - w));
    return { event, x, w, lane };
  });
}
