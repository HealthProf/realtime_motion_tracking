// Delayed view: the picture and measurements from a fixed number of seconds ago, so a person can
// perform a movement and then turn to the screen and watch it. Pure helpers; the frames themselves
// live in the replay buffer.

export const DELAY_MIN = 5;
export const DELAY_MAX = 60;
export const DELAY_DEFAULT = 10;

export function clampDelay(seconds: number): number {
  return Number.isFinite(seconds) ? Math.min(DELAY_MAX, Math.max(DELAY_MIN, Math.round(seconds))) : DELAY_DEFAULT;
}

/**
 * Width (pixels) at which frames are stored for a buffer of the given length. Stored bytes grow with
 * the pixel count times the number of frames, so holding width squared times seconds constant keeps
 * memory roughly level: `floorWidth` at the longest delay, sharper for shorter ones, up to `maxWidth`.
 */
export function delayWidth(bufferSeconds: number, floorWidth: number, maxWidth: number): number {
  const w = floorWidth * Math.sqrt(DELAY_MAX / Math.max(1, bufferSeconds));
  return Math.round(Math.min(maxWidth, Math.max(floorWidth, w)));
}

/** Either the buffered frame to show, or how long (s) until there is one. */
export type DelayedPick = { index: number; wait: 0 } | { index: -1; wait: number };

/**
 * Finds the frame captured `delay` seconds before `now`: the last one at or before that moment.
 * If the buffer does not reach back that far yet, or nothing was captured around that moment
 * (tracking was paused for longer than `maxGap`), reports the wait instead of showing a frame
 * from the wrong time.
 */
export function pickDelayed(timeAt: (i: number) => number, count: number, now: number, delay: number, maxGap = 1.5): DelayedPick {
  const target = now - delay;
  if (count === 0) return { index: -1, wait: delay };
  if (timeAt(0) > target) return { index: -1, wait: timeAt(0) - target };
  let lo = 0, hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (timeAt(mid) <= target) lo = mid; else hi = mid - 1;
  }
  if (target - timeAt(lo) > maxGap && lo + 1 < count) return { index: -1, wait: timeAt(lo + 1) - target };
  return { index: lo, wait: 0 };
}
