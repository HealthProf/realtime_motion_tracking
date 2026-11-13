// Resampling and numerical differentiation of time series. NaN marks missing samples throughout.

/** Median of the finite values (NaN if none). */
export function median(values: ArrayLike<number>): number {
  const v = Array.prototype.filter.call(values, Number.isFinite) as number[];
  if (!v.length) return NaN;
  v.sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Uniform time grid from t[0] to t[last] at `fs` Hz. */
export function uniformGrid(t0: number, t1: number, fs: number): Float64Array {
  const n = Math.max(1, Math.floor((t1 - t0) * fs + 1e-9) + 1);
  const g = new Float64Array(n);
  for (let i = 0; i < n; i++) g[i] = t0 + i / fs;
  return g;
}

/**
 * Linear interpolation of irregular samples (t, v) onto `grid`.
 * Missing (NaN) samples are skipped; spans between valid samples longer than `maxGap` seconds stay NaN.
 */
export function resample(t: ArrayLike<number>, v: ArrayLike<number>, grid: ArrayLike<number>, maxGap: number): Float64Array {
  const out = new Float64Array(grid.length).fill(NaN);
  const ti: number[] = [];
  const vi: number[] = [];
  for (let i = 0; i < t.length; i++) {
    if (Number.isFinite(v[i]) && Number.isFinite(t[i])) {
      ti.push(t[i]);
      vi.push(v[i]);
    }
  }
  if (!ti.length) return out;
  const eps = 1e-9;
  let j = 0;
  for (let g = 0; g < grid.length; g++) {
    const tg = grid[g];
    if (tg < ti[0] - eps || tg > ti[ti.length - 1] + eps) continue;
    while (j < ti.length - 2 && ti[j + 1] < tg) j++;
    if (ti.length === 1) {
      out[g] = vi[0];
      continue;
    }
    const span = ti[j + 1] - ti[j];
    if (span > maxGap) {
      if (Math.abs(tg - ti[j]) < eps) out[g] = vi[j];
      else if (Math.abs(tg - ti[j + 1]) < eps) out[g] = vi[j + 1];
      continue;
    }
    const u = span > 0 ? Math.min(1, Math.max(0, (tg - ti[j]) / span)) : 0;
    out[g] = vi[j] + u * (vi[j + 1] - vi[j]);
  }
  return out;
}

/** First derivative on a uniform grid: central differences, one-sided at run edges. */
export function derivative(v: ArrayLike<number>, dt: number): Float64Array {
  const n = v.length;
  const out = new Float64Array(n).fill(NaN);
  const ok = (i: number) => i >= 0 && i < n && Number.isFinite(v[i]);
  for (let i = 0; i < n; i++) {
    if (!ok(i)) continue;
    if (ok(i - 1) && ok(i + 1)) out[i] = (v[i + 1] - v[i - 1]) / (2 * dt);
    else if (ok(i + 1)) out[i] = (v[i + 1] - v[i]) / dt;
    else if (ok(i - 1)) out[i] = (v[i] - v[i - 1]) / dt;
  }
  return out;
}

/** Second derivative on a uniform grid by the three-point central formula; run edges copy their neighbour. */
export function secondDerivative(v: ArrayLike<number>, dt: number): Float64Array {
  const n = v.length;
  const out = new Float64Array(n).fill(NaN);
  const ok = (i: number) => i >= 0 && i < n && Number.isFinite(v[i]);
  for (let i = 1; i < n - 1; i++) {
    if (ok(i - 1) && ok(i) && ok(i + 1)) out[i] = (v[i + 1] - 2 * v[i] + v[i - 1]) / (dt * dt);
  }
  for (let i = 0; i < n; i++) {
    if (!ok(i) || Number.isFinite(out[i])) continue;
    if (i + 1 < n && Number.isFinite(out[i + 1]) && !(i > 0 && ok(i - 1) && Number.isFinite(out[i - 1]))) out[i] = out[i + 1];
  }
  for (let i = n - 1; i >= 0; i--) {
    if (ok(i) && !Number.isFinite(out[i]) && i > 0 && Number.isFinite(out[i - 1])) out[i] = out[i - 1];
  }
  return out;
}

/** Cumulative path length of a 2D trajectory; NaN samples contribute nothing and report NaN. */
export function pathLength(x: ArrayLike<number>, y: ArrayLike<number>): Float64Array {
  const n = x.length;
  const out = new Float64Array(n).fill(NaN);
  let total = 0;
  let px = NaN, py = NaN;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) continue;
    if (Number.isFinite(px)) total += Math.hypot(x[i] - px, y[i] - py);
    px = x[i];
    py = y[i];
    out[i] = total;
  }
  return out;
}
