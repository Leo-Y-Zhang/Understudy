// Pure presentation helpers shared across screens. No DOM, no state -- easy
// to unit-test without jsdom.

/**
 * Seconds -> "m:ss" (e.g. 0 -> "0:00", 65 -> "1:05", 754 -> "12:34").
 * Negative input clamps to 0. Fractional seconds are floored, not rounded,
 * so a countdown reads as "time remaining, not yet elapsed" and an elapsed
 * timer never appears to jump ahead of the clock.
 */
export function formatElapsed(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Seconds remaining -> "m:ss", rounded up so a countdown never briefly shows
 * "0:00" while there is still a fraction of a second left.
 */
export function formatCountdown(secondsRemaining: number): string {
  const safe = Number.isFinite(secondsRemaining) ? Math.max(0, secondsRemaining) : 0;
  return formatElapsed(Math.ceil(safe));
}

/** 0..1 fraction -> "62%", rounded to the nearest whole percent. */
export function formatPercent(fraction: number): string {
  const safe = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  return `${Math.round(safe * 100)}%`;
}

/** A 0..100 score -> its nearest whole-number string, e.g. 77.6 -> "78". */
export function formatScore(score: number): string {
  const safe = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
  return String(Math.round(safe));
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}
