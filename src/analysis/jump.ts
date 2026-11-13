// Vertical jump analysis: flight-time method, with a comparison against centre-of-mass displacement.

export const G = 9.81;

export interface JumpResult {
  takeoff: number;
  landing: number;
  flightTime: number;
  /** h = g t^2 / 8. Assumes take-off and landing postures (and COM heights) are the same. */
  heightFlight: number;
  /** Height uncertainty from timing resolution: +- one frame interval on the flight time. */
  heightResolution: number;
  /** COM rise from the take-off instant to the apex (calibrated trials only; NaN otherwise). */
  heightCom: number;
}

/**
 * Detects flight phases from the height of the lowest foot point.
 * `footY`: height (y up, any length unit) of the lowest foot keypoint per sample (unfiltered is best:
 * filtering rounds off the take-off and landing corners). `threshold`: rise above the standing
 * baseline that counts as airborne (same unit). Crossing times are linearly interpolated.
 */
export function detectJumps(t: ArrayLike<number>, footY: ArrayLike<number>, threshold: number, comY?: ArrayLike<number>, metres = false): JumpResult[] {
  const vals = Array.prototype.filter.call(footY, Number.isFinite) as number[];
  if (vals.length < 5) return [];
  // Standing baseline: a low percentile is robust to the flight samples and to single outliers.
  const sorted = vals.slice().sort((a, b) => a - b);
  const base = sorted[Math.floor(0.2 * sorted.length)];
  const level = base + threshold;
  const dt = t[1] - t[0];
  const cross = (i: number) => t[i - 1] + ((level - footY[i - 1]) / (footY[i] - footY[i - 1])) * (t[i] - t[i - 1]);
  const jumps: JumpResult[] = [];
  let up = NaN, upIdx = -1;
  for (let i = 1; i < t.length; i++) {
    if (!Number.isFinite(footY[i]) || !Number.isFinite(footY[i - 1])) { up = NaN; continue; }
    if (footY[i - 1] <= level && footY[i] > level) { up = cross(i); upIdx = i; }
    else if (footY[i - 1] > level && footY[i] <= level && Number.isFinite(up)) {
      const down = cross(i);
      const flight = down - up;
      // Ignore blips shorter than 100 ms (keypoint jitter) and implausible flights over 1.2 s.
      if (flight >= 0.1 && flight <= 1.2) {
        let heightCom = NaN;
        if (comY && metres) {
          let apex = -Infinity;
          for (let k = upIdx; k <= i; k++) if (Number.isFinite(comY[k])) apex = Math.max(apex, comY[k]);
          const atTakeoff = comY[upIdx - 1] + ((up - t[upIdx - 1]) / (t[upIdx] - t[upIdx - 1])) * (comY[upIdx] - comY[upIdx - 1]);
          heightCom = apex - atTakeoff;
        }
        jumps.push({ takeoff: up, landing: down, flightTime: flight, heightFlight: (G * flight * flight) / 8, heightResolution: (G * flight * dt) / 4, heightCom });
      }
      up = NaN;
    }
  }
  return jumps;
}
