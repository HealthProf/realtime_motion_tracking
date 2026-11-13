// Repetition detection and bilateral symmetry.

export interface Rep {
  /** Row indices into the processed series. */
  start: number;
  peak: number;
  end: number;
  startValue: number;
  peakValue: number;
  /** Range of motion: |peak - mean(start, end)|. */
  rom: number;
  duration: number;
  peakVelocity: number;
}

/**
 * Finds repetitions as excursions away from a baseline and back, using hysteresis so noise cannot
 * trigger a rep. `minProminence` is the smallest excursion (signal units) counted; by default 30 % of
 * the overall range. Works for excursions in either direction (picks the dominant one).
 */
export function detectReps(v: ArrayLike<number>, velocity: ArrayLike<number>, fs: number, minProminence?: number): Rep[] {
  const idx: number[] = [];
  for (let i = 0; i < v.length; i++) if (Number.isFinite(v[i])) idx.push(i);
  if (idx.length < 5) return [];
  let lo = Infinity, hi = -Infinity;
  for (const i of idx) { lo = Math.min(lo, v[i]); hi = Math.max(hi, v[i]); }
  const range = hi - lo;
  const prom = minProminence ?? 0.3 * range;
  if (!(range > 0) || range < prom) return [];
  // Baseline is the resting level: whichever extreme the signal spends more time near.
  let nearLo = 0;
  for (const i of idx) if (v[i] < lo + range / 2) nearLo++;
  const sign = nearLo >= idx.length / 2 ? 1 : -1;
  const base = sign === 1 ? lo : hi;
  const val = (i: number) => sign * (v[i] - base);
  const enter = Math.max(0.5 * prom, 0.25 * range), exit = 0.5 * enter;

  const reps: Rep[] = [];
  let state: 'rest' | 'moving' = 'rest';
  let start = idx[0], peak = idx[0], lastRest = idx[0];
  for (const i of idx) {
    if (state === 'rest') {
      if (val(i) < exit) lastRest = i;
      if (val(i) > enter) { state = 'moving'; start = lastRest; peak = i; }
    } else {
      if (val(i) > val(peak)) peak = i;
      if (val(i) < exit) {
        // Walk outward from the threshold crossings to the turning points, so the rep spans the full excursion.
        let a = start, b = i;
        while (a > 0 && Number.isFinite(v[a - 1]) && val(a - 1) < val(a)) a--;
        while (b < v.length - 1 && Number.isFinite(v[b + 1]) && val(b + 1) < val(b)) b++;
        const startValue = v[a], peakValue = v[peak];
        const rom = Math.abs(peakValue - (v[a] + v[b]) / 2);
        if (rom >= prom) {
          let pv = 0;
          for (let k = a; k <= b; k++) if (Number.isFinite(velocity[k])) pv = Math.max(pv, Math.abs(velocity[k]));
          reps.push({ start: a, peak, end: b, startValue, peakValue, rom, duration: (b - a) / fs, peakVelocity: pv });
        }
        state = 'rest';
        lastRest = i;
      }
    }
  }
  return reps;
}

/**
 * Symmetry index (Robinson et al., 1987): 100 * (L - R) / (0.5 * (L + R)).
 * 0 = symmetric; positive = left larger. NaN if either value is missing or both are zero.
 */
export function symmetryIndex(left: number, right: number): number {
  const mean = 0.5 * (left + right);
  if (!Number.isFinite(mean) || mean === 0) return NaN;
  return (100 * (left - right)) / mean;
}

export function rangeOf(v: ArrayLike<number>): { min: number; max: number; rom: number } {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < v.length; i++) if (Number.isFinite(v[i])) { min = Math.min(min, v[i]); max = Math.max(max, v[i]); }
  return Number.isFinite(min) ? { min, max, rom: max - min } : { min: NaN, max: NaN, rom: NaN };
}

export function peakAbs(v: ArrayLike<number>): number {
  let m = NaN;
  for (let i = 0; i < v.length; i++) if (Number.isFinite(v[i]) && !(Math.abs(v[i]) <= m)) m = Math.abs(v[i]);
  return m;
}
