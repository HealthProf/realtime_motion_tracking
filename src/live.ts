// Live (causal) processing for on-screen feedback. Values here lag slightly and are labelled
// "live estimate"; exported data are re-filtered zero-phase after the trial.
import { centreOfMass, type BodyModel } from './analysis/com';
import { includedAngle } from './kinematics/angles';
import { toAnalysis, type Calibration } from './kinematics/calibration';
import { OneEuro } from './kinematics/oneEuro';
import { ANGLE_BY_ID, applyConvention, evalAngle, type Convention } from './measure/definitions';
import { getPoint, L, type LandmarkName, type PointId } from './pose/landmarks';
import type { Lm, PoseFrame } from './types';

export interface LiveSettings {
  angles: string[];
  points: PointId[];
  convention: Convention;
  minVisibility: number;
  bodyModel: BodyModel;
  calibration: Calibration;
  include3d: boolean;
}

export interface LiveAngle {
  value: number;
  /** deg/s, causal estimate. */
  velocity: number;
  /** From estimated 3D landmarks (experimental); NaN when unavailable. */
  value3d: number;
}
export interface LivePoint {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  /** Magnitude, causal estimate: noisy and lagged. */
  acc: number;
  /** Image pixels, for drawing. */
  px: number;
  py: number;
}

export interface LiveSample {
  t: number;
  w: number;
  h: number;
  /** Smoothed image landmarks (pixels) or null. */
  lm: Lm[] | null;
  world: Lm[] | null;
  com: Lm | null;
  angles: Map<string, LiveAngle>;
  points: Map<PointId, LivePoint>;
}

const POS = { minCutoff: 1.7, beta: 0.01, dCutoff: 1 };
const ANG = { minCutoff: 3, beta: 0.02, dCutoff: 2 };
const VEL = { minCutoff: 2, beta: 0.0, dCutoff: 1.5 };

export class LiveEngine {
  private lmF: OneEuro[] = [];
  private wF: OneEuro[] = [];
  private angF = new Map<string, OneEuro>();
  private ptF = new Map<PointId, { x: OneEuro; y: OneEuro; vx: OneEuro; vy: OneEuro }>();

  reset(): void {
    this.lmF = [];
    this.wF = [];
    this.angF.clear();
    this.ptF.clear();
  }

  process(f: PoseFrame, s: LiveSettings): LiveSample {
    const out: LiveSample = { t: f.t, w: f.w, h: f.h, lm: null, world: null, com: null, angles: new Map(), points: new Map() };
    if (!f.lm) return out;
    if (!this.lmF.length) for (let i = 0; i < 33 * 2; i++) this.lmF.push(new OneEuro(POS));
    out.lm = f.lm.map((p, i) => ({ x: this.lmF[2 * i].filter(p.x, f.t), y: this.lmF[2 * i + 1].filter(p.y, f.t), z: p.z, v: p.v }));
    if (f.world) {
      if (!this.wF.length) for (let i = 0; i < 33 * 3; i++) this.wF.push(new OneEuro(POS));
      out.world = f.world.map((p, i) => ({ x: this.wF[3 * i].filter(p.x, f.t), y: this.wF[3 * i + 1].filter(p.y, f.t), z: this.wF[3 * i + 2].filter(p.z, f.t), v: p.v }));
    }
    out.com = centreOfMass(out.lm, s.bodyModel, s.minVisibility)?.com ?? null;

    const resolve = (id: PointId) => {
      const p = getPoint(out.lm, id, s.minVisibility, out.com);
      return p ? { ...toAnalysis(s.calibration, p.x, p.y), px: p.x, py: p.y } : null;
    };

    for (const id of s.angles) {
      const def = ANGLE_BY_ID.get(id);
      if (!def) continue;
      const raw = evalAngle(def, resolve, s.convention);
      let flt = this.angF.get(id);
      if (!flt) this.angF.set(id, (flt = new OneEuro(ANG)));
      let value = NaN, velocity = NaN, value3d = NaN;
      if (Number.isFinite(raw)) {
        value = flt.filter(raw, f.t);
        velocity = flt.derivative;
      } else flt.reset();
      if (s.include3d && out.world && def.kind === 'joint' && def.a in L && def.b in L && def.c in L) {
        const g = (n: PointId) => out.world![L[n as LandmarkName]];
        const [a, b, c] = [g(def.a), g(def.b), g(def.c)];
        if (Math.min(a.v, b.v, c.v) >= s.minVisibility) value3d = applyConvention(def, includedAngle(a, b, c), s.convention);
      }
      out.angles.set(id, { value, velocity, value3d });
    }

    for (const id of s.points) {
      const p = resolve(id);
      let flt = this.ptF.get(id);
      if (!flt) this.ptF.set(id, (flt = { x: new OneEuro(ANG), y: new OneEuro(ANG), vx: new OneEuro(VEL), vy: new OneEuro(VEL) }));
      if (!p) {
        flt.x.reset(); flt.y.reset(); flt.vx.reset(); flt.vy.reset();
        continue;
      }
      const x = flt.x.filter(p.x, f.t), y = flt.y.filter(p.y, f.t);
      const vx = flt.vx.filter(flt.x.derivative, f.t), vy = flt.vy.filter(flt.y.derivative, f.t);
      out.points.set(id, { x, y, vx, vy, speed: Math.hypot(vx, vy), acc: Math.hypot(flt.vx.derivative, flt.vy.derivative), px: p.px, py: p.py });
    }
    return out;
  }
}

/** Measured frame-rate statistics over a sliding window of recent frame timestamps. */
export class FpsMeter {
  private times: number[] = [];
  constructor(private window = 45) {}
  reset(): void { this.times = []; }
  add(t: number): void {
    this.times.push(t);
    if (this.times.length > this.window) this.times.shift();
  }
  get fps(): number {
    const n = this.times.length;
    return n > 1 ? (n - 1) / (this.times[n - 1] - this.times[0]) : NaN;
  }
}
