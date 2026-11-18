// Two clips locked together. The lock stores a time in each clip that shows the same moment; after
// that, clip 2 time = clip 1 time + offset. All overlay times are on clip 1's timeline.
import type { TimedShape } from './types';

export interface SyncPair { a: number; b: number }

export const offsetOf = (s: SyncPair) => s.b - s.a;

/** Time in clip 2 that matches time tA in clip 1. */
export const partnerTime = (s: SyncPair, tA: number) => tA + offsetOf(s);

/** Stretch of clip 1's timeline during which both clips have pictures. */
export function syncRange(s: SyncPair, durA: number, durB: number): { start: number; end: number } {
  const o = offsetOf(s);
  return { start: Math.max(0, -o), end: Math.max(Math.max(0, -o), Math.min(durA, durB - o)) };
}

/** True if clip 2 has drifted more than one frame from where it should be. */
export const drifted = (s: SyncPair, tA: number, tB: number, fps: number) => Math.abs(tB - partnerTime(s, tA)) > 1 / Math.max(1, fps);

/** Overlays on screen at time t (start and end included). */
export const activeAt = (items: TimedShape[], t: number) => items.filter((it) => t >= it.start - 1e-6 && t <= it.end + 1e-6);

/** Default length of time a new overlay stays on screen, seconds. */
export const DEFAULT_OVERLAY_SECONDS = 3;
