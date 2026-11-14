// Finds and follows a weight plate (a circle) in the picture.
//
// Method: a gradient-voting circle search (a Hough transform for circles). Every strong edge pixel votes
// for the centres that would put it on a circle of radius r, along its own gradient direction. A plate
// rim makes the votes pile up at the plate centre. The result is then refined to sub-pixel accuracy by
// fitting a circle to the rim. Because only the outline is used, a spinning plate or changing lettering
// does not disturb it, which matters for the Olympic lifts.
//
// The pose model does not know what a barbell is, and this search can be fooled by other round objects,
// so the app asks the user to confirm the plate before trusting it.
import { fitCircle } from '../modes/cycles';

/** A grey-level patch of the picture. Pixel (i, j) covers image position (ox + i * step, oy + j * step). */
export interface Gray {
  w: number;
  h: number;
  data: Float32Array;
  ox: number;
  oy: number;
  step: number;
}

export interface CircleHit {
  /** Image pixels. */
  x: number;
  y: number;
  r: number;
  /** Fraction of the circumference with a matching edge (0 to 1). */
  score: number;
}

export interface FindOptions {
  /** Smallest acceptable fraction of the rim that must be visible. */
  minScore?: number;
  /** Only accept circles whose centre is within `maxDist` (image pixels) of this point. */
  near?: { x: number; y: number; maxDist: number };
  /** Prefer the outermost of several concentric circles (plates have inner rings and a hub). */
  preferOuter?: boolean;
}

/** Converts RGBA pixels to grey levels. */
export function toGray(rgba: Uint8ClampedArray, w: number, h: number, ox = 0, oy = 0, step = 1): Gray {
  const data = new Float32Array(w * h);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return { w, h, data, ox, oy, step };
}

const sample = (g: Gray, x: number, y: number): number => {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 >= g.w - 1 || y0 >= g.h - 1) return NaN;
  const fx = x - x0, fy = y - y0, i = y0 * g.w + x0;
  return (g.data[i] * (1 - fx) + g.data[i + 1] * fx) * (1 - fy) + (g.data[i + g.w] * (1 - fx) + g.data[i + g.w + 1] * fx) * fy;
};

interface Edges { n: number; x: Int32Array; y: Int32Array; ux: Float32Array; uy: Float32Array; mag: Float32Array; dirX: Float32Array; dirY: Float32Array; thr: number }

function edgesOf(g: Gray): Edges {
  const { w, h, data } = g, n = w * h;
  const mag = new Float32Array(n), dirX = new Float32Array(n), dirY = new Float32Array(n);
  let peak = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = data[i - w + 1] + 2 * data[i + 1] + data[i + w + 1] - data[i - w - 1] - 2 * data[i - 1] - data[i + w - 1];
      const gy = data[i + w - 1] + 2 * data[i + w] + data[i + w + 1] - data[i - w - 1] - 2 * data[i - w] - data[i - w + 1];
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      if (m > 0) { dirX[i] = gx / m; dirY[i] = gy / m; }
      if (m > peak) peak = m;
    }
  }
  // Edge threshold: a quarter of the strongest edge, but never below a floor that rejects sensor noise.
  const thr = Math.max(40, 0.25 * peak);
  let count = 0;
  for (let i = 0; i < n; i++) if (mag[i] >= thr) count++;
  const ex = new Int32Array(count), ey = new Int32Array(count), ux = new Float32Array(count), uy = new Float32Array(count);
  let k = 0;
  for (let i = 0; i < n; i++) if (mag[i] >= thr) { ex[k] = i % w; ey[k] = (i / w) | 0; ux[k] = dirX[i]; uy[k] = dirY[i]; k++; }
  return { n: count, x: ex, y: ey, ux, uy, mag, dirX, dirY, thr };
}

const ANGLES = 72;
const COS = Float32Array.from({ length: ANGLES }, (_, i) => Math.cos((2 * Math.PI * i) / ANGLES));
const SIN = Float32Array.from({ length: ANGLES }, (_, i) => Math.sin((2 * Math.PI * i) / ANGLES));

/** Fraction of the circumference where an edge with a roughly radial gradient lies on the circle. */
function coverage(g: Gray, e: Edges, cx: number, cy: number, r: number): number {
  let hits = 0, valid = 0;
  for (let a = 0; a < ANGLES; a++) {
    let found = false, inside = false;
    for (const dr of [0, -1, 1]) {
      const x = Math.round(cx + (r + dr) * COS[a]), y = Math.round(cy + (r + dr) * SIN[a]);
      if (x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1) continue;
      inside = true;
      const i = y * g.w + x;
      if (e.mag[i] >= e.thr && Math.abs(e.dirX[i] * COS[a] + e.dirY[i] * SIN[a]) > 0.8) { found = true; break; }
    }
    if (inside) valid++;
    if (found) hits++;
  }
  // A circle that is mostly outside the patch cannot be judged.
  return valid >= ANGLES * 0.6 ? hits / ANGLES : 0;
}

/** Sub-pixel circle through the strongest radial edge near radius r at each angle. */
function refine(g: Gray, cx: number, cy: number, r: number): { cx: number; cy: number; r: number } {
  const xs: number[] = [], ys: number[] = [], rs: number[] = [];
  const span = Math.max(2, Math.round(r * 0.12));
  for (let a = 0; a < ANGLES; a++) {
    let best = 0, bestRho = NaN;
    const prof: number[] = [];
    for (let d = -span - 1; d <= span + 1; d++) prof.push(sample(g, cx + (r + d) * COS[a], cy + (r + d) * SIN[a]));
    for (let k = 1; k < prof.length - 1; k++) {
      const der = Math.abs(prof[k + 1] - prof[k - 1]);
      if (!(der > best)) continue;
      best = der;
      // Parabolic interpolation of the gradient peak.
      const l = k > 1 ? Math.abs(prof[k] - prof[k - 2]) : NaN, rr = k < prof.length - 2 ? Math.abs(prof[k + 2] - prof[k]) : NaN;
      const den = l - 2 * der + rr;
      const off = Number.isFinite(den) && den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - rr)) / den)) : 0;
      bestRho = r + (k - span - 1) + off;
    }
    if (best > 12 && Number.isFinite(bestRho)) { rs.push(bestRho); xs.push(cx + bestRho * COS[a]); ys.push(cy + bestRho * SIN[a]); }
  }
  if (rs.length < ANGLES * 0.3) return { cx, cy, r };
  const med = rs.slice().sort((p, q) => p - q)[rs.length >> 1];
  const keep = rs.map((v) => Math.abs(v - med) <= Math.max(1.5, 0.04 * r));
  const fit = fitCircle(xs.filter((_, i) => keep[i]), ys.filter((_, i) => keep[i]));
  if (!Number.isFinite(fit.r) || Math.hypot(fit.cx - cx, fit.cy - cy) > Math.max(2, 0.15 * r) || Math.abs(fit.r - r) > Math.max(2, 0.15 * r)) return { cx, cy, r };
  return { cx: fit.cx, cy: fit.cy, r: fit.r };
}

/**
 * Searches a grey patch for the best circle with radius between rMin and rMax (image pixels).
 * Returns null when no circle shows enough of its rim.
 */
export function findCircle(g: Gray, rMin: number, rMax: number, o: FindOptions = {}): CircleHit | null {
  const minScore = o.minScore ?? 0.45;
  const { w, h, step } = g;
  if (w < 8 || h < 8) return null;
  const e = edgesOf(g);
  if (e.n < 12) return null;
  const acc = new Float32Array(w * h);
  const lo = Math.max(3, rMin / step), hi = Math.max(lo, rMax / step);
  const near = o.near ? { x: (o.near.x - g.ox) / step, y: (o.near.y - g.oy) / step, d: o.near.maxDist / step } : null;
  const cands: { cx: number; cy: number; r: number; votes: number }[] = [];
  for (let r = lo; r <= hi + 1e-6; r += hi - lo > 24 ? 1.5 : 1) {
    acc.fill(0);
    for (let k = 0; k < e.n; k++) {
      for (const s of [-1, 1]) {
        const cx = Math.round(e.x[k] + s * r * e.ux[k]), cy = Math.round(e.y[k] + s * r * e.uy[k]);
        if (cx > 0 && cy > 0 && cx < w - 1 && cy < h - 1) acc[cy * w + cx] += 1;
      }
    }
    let best = 0, bi = -1;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (near && Math.hypot(x - near.x, y - near.y) > near.d) continue;
        const i = y * w + x;
        const v = acc[i - w - 1] + acc[i - w] + acc[i - w + 1] + acc[i - 1] + acc[i] + acc[i + 1] + acc[i + w - 1] + acc[i + w] + acc[i + w + 1];
        if (v > best) { best = v; bi = i; }
      }
    }
    if (bi >= 0) cands.push({ cx: bi % w, cy: (bi / w) | 0, r, votes: best / r });
  }
  if (!cands.length) return null;
  // Judge the most-voted candidates by how much of their rim is really there.
  const top = cands.slice().sort((a, b) => b.votes - a.votes).slice(0, 8).map((c) => ({ ...c, score: coverage(g, e, c.cx, c.cy, c.r) }));
  top.sort((a, b) => b.score - a.score);
  let pick = top[0];
  if (pick.score < minScore) return null;
  if (o.preferOuter) {
    for (const c of top) if (c.r > pick.r && c.score >= Math.max(minScore, 0.8 * top[0].score) && Math.hypot(c.cx - top[0].cx, c.cy - top[0].cy) < 0.2 * c.r) pick = c;
  }
  const f = refine(g, pick.cx, pick.cy, pick.r);
  return { x: g.ox + f.cx * step, y: g.oy + f.cy * step, r: f.r * step, score: pick.score };
}

/** Supplies a grey patch covering the image rectangle (x0, y0)-(x1, y1), sampled every `step` image pixels. */
export type Grab = (x0: number, y0: number, x1: number, y1: number, step: number) => Gray | null;

/** Gray pixels a plate radius should span: enough for sub-pixel accuracy, small enough to be fast. */
const TARGET_R = 26;

export class PlateTracker {
  lock: { x: number; y: number; r: number } | null = null;
  /** Consecutive frames in which the plate was not found. */
  missed = 0;
  private vx = 0;
  private vy = 0;
  private lastT = NaN;

  release(): void {
    this.lock = null;
    this.missed = 0;
    this.vx = this.vy = 0;
    this.lastT = NaN;
  }

  lockTo(hit: { x: number; y: number; r: number }, t = NaN): void {
    this.lock = { x: hit.x, y: hit.y, r: hit.r };
    this.missed = 0;
    this.vx = this.vy = 0;
    this.lastT = t;
  }

  /** Looks for a plate-sized circle around a region of interest (for example near the hands). */
  static search(grab: Grab, cx: number, cy: number, half: number, rMin: number, rMax: number, o: FindOptions = {}): CircleHit | null {
    const step = Math.max(1, rMax / (TARGET_R * 1.4));
    const g = grab(cx - half - rMax, cy - half - rMax, cx + half + rMax, cy + half + rMax, step);
    return g ? findCircle(g, rMin, rMax, { preferOuter: true, ...o }) : null;
  }

  /** Re-measures a found circle at full resolution: used when its diameter sets the scale of the picture. */
  static measure(grab: Grab, hit: { x: number; y: number; r: number }): CircleHit | null {
    const pad = 1.2 * hit.r + 4;
    const g = grab(hit.x - pad, hit.y - pad, hit.x + pad, hit.y + pad, 1);
    return g ? findCircle(g, 0.9 * hit.r, 1.1 * hit.r, { near: { x: hit.x, y: hit.y, maxDist: 0.15 * hit.r }, minScore: 0.4 }) : null;
  }

  /** Follows the locked plate into a new frame taken at time `t` (seconds). Returns null if it was not found. */
  update(grab: Grab, t: number): CircleHit | null {
    const k = this.lock;
    if (!k) return null;
    let dt = t - this.lastT;
    if (!(dt > 0) || dt > 0.25) { dt = 0; this.vx = this.vy = 0; }
    const px = k.x + this.vx * dt, py = k.y + this.vy * dt;
    const search = Math.min(2 * k.r, 0.35 * k.r + Math.hypot(this.vx, this.vy) * dt + this.missed * 0.15 * k.r);
    const step = Math.max(1, k.r / TARGET_R), pad = 1.12 * k.r + search + 2 * step;
    const g = grab(px - pad, py - pad, px + pad, py + pad, step);
    const hit = g ? findCircle(g, 0.93 * k.r, 1.07 * k.r, { near: { x: px, y: py, maxDist: search }, minScore: 0.4 }) : null;
    if (!hit) {
      this.missed++;
      if (Number.isFinite(t)) this.lastT = t;
      k.x = px; k.y = py;
      // Coast briefly on the last velocity, then stop guessing.
      if (this.missed > 3) this.vx = this.vy = 0;
      return null;
    }
    if (dt > 0) { this.vx = 0.5 * this.vx + 0.5 * ((hit.x - k.x) / dt); this.vy = 0.5 * this.vy + 0.5 * ((hit.y - k.y) / dt); }
    k.x = hit.x; k.y = hit.y; k.r = 0.9 * k.r + 0.1 * hit.r;
    this.missed = 0;
    this.lastT = t;
    return { ...hit, r: k.r };
  }
}
