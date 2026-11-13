// Tools for cyclic movements (pedalling, running): extrema, circle fitting, per-cycle statistics.

export interface Extrema {
  maxima: number[];
  minima: number[];
}

/**
 * Alternating local maxima and minima separated by at least `delta` (signal units).
 * Classic peak detection with hysteresis: robust to noise smaller than `delta`. NaN samples are skipped.
 */
export function findExtrema(v: ArrayLike<number>, delta: number): Extrema {
  const maxima: number[] = [], minima: number[] = [];
  let mx = -Infinity, mn = Infinity, mxi = -1, mni = -1, lookForMax: boolean | null = null;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (!Number.isFinite(x)) continue;
    if (x > mx) { mx = x; mxi = i; }
    if (x < mn) { mn = x; mni = i; }
    if (lookForMax === null) {
      if (x < mx - delta) { lookForMax = false; mn = x; mni = i; }
      else if (x > mn + delta) { lookForMax = true; mx = x; mxi = i; }
    } else if (lookForMax) {
      if (x < mx - delta) { maxima.push(mxi); mn = x; mni = i; lookForMax = false; }
    } else if (x > mn + delta) { minima.push(mni); mx = x; mxi = i; lookForMax = true; }
  }
  return { maxima, minima };
}

export interface Stat {
  mean: number;
  sd: number;
  n: number;
}

export function stat(values: number[]): Stat {
  const v = values.filter(Number.isFinite);
  if (!v.length) return { mean: NaN, sd: NaN, n: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : NaN;
  return { mean, sd, n: v.length };
}

/** Least-squares circle (Kasa method). Returns NaN radius when the points are degenerate. */
export function fitCircle(x: ArrayLike<number>, y: ArrayLike<number>): { cx: number; cy: number; r: number; rms: number } {
  let n = 0, sx = 0, sy = 0;
  for (let i = 0; i < x.length; i++) if (Number.isFinite(x[i]) && Number.isFinite(y[i])) { sx += x[i]; sy += y[i]; n++; }
  if (n < 5) return { cx: NaN, cy: NaN, r: NaN, rms: NaN };
  const mx = sx / n, my = sy / n;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) continue;
    const u = x[i] - mx, v = y[i] - my;
    suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-12) return { cx: NaN, cy: NaN, r: NaN, rms: NaN };
  const uc = (0.5 * (suuu + suvv) * svv - 0.5 * (svvv + svuu) * suv) / det;
  const vc = (0.5 * (svvv + svuu) * suu - 0.5 * (suuu + suvv) * suv) / det;
  const cx = uc + mx, cy = vc + my, r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  let e = 0;
  for (let i = 0; i < x.length; i++) if (Number.isFinite(x[i]) && Number.isFinite(y[i])) e += (Math.hypot(x[i] - cx, y[i] - cy) - r) ** 2;
  return { cx, cy, r, rms: Math.sqrt(e / n) };
}

/** Linear interpolation of series `v` at fractional index `i`. */
export function at(v: ArrayLike<number>, i: number): number {
  const a = Math.floor(i), b = Math.min(v.length - 1, a + 1);
  if (a < 0 || a >= v.length) return NaN;
  return v[a] + (i - a) * (v[b] - v[a]);
}

/** Fraction of finite samples in a series. */
export function coverage(v: ArrayLike<number> | undefined): number {
  if (!v || !v.length) return 0;
  let n = 0;
  for (let i = 0; i < v.length; i++) if (Number.isFinite(v[i])) n++;
  return n / v.length;
}

/** Fractional indices where `v` crosses `level` going upward. */
export function upCrossings(v: ArrayLike<number>, level: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < v.length; i++) {
    if (Number.isFinite(v[i - 1]) && Number.isFinite(v[i]) && v[i - 1] < level && v[i] >= level) out.push(i - 1 + (level - v[i - 1]) / (v[i] - v[i - 1]));
  }
  return out;
}
