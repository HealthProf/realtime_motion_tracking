// Post-trial processing: resample to a uniform time base, zero-phase low-pass filter, differentiate.
// This is what makes exported numbers defensible; live readouts use a causal filter and lag slightly.
import { centreOfMass, type BodyModel } from '../analysis/com';
import { includedAngle, unwrapDegrees } from '../kinematics/angles';
import { filtfiltGaps } from '../kinematics/butterworth';
import { toAnalysis } from '../kinematics/calibration';
import { derivative, median, pathLength, resample, secondDerivative, uniformGrid } from '../kinematics/series';
import { ANGLE_BY_ID, applyConvention, evalAngle, type AngleDef, type Convention } from '../measure/definitions';
import { getPoint, L, LANDMARK_NAMES, type PointId } from '../pose/landmarks';
import type { Trial } from './trial';

export interface ProcessOptions {
  /** Final low-pass cutoff (Hz) of the zero-phase Butterworth filter. */
  cutoff: number;
  angles: string[];
  points: PointId[];
  convention: Convention;
  minVisibility: number;
  bodyModel: BodyModel;
  /** Longest gap (s) bridged by linear interpolation. */
  maxGap: number;
  /** Also output joint angles from the model's estimated 3D landmarks (experimental). */
  include3d: boolean;
  /** Override the sample rate (used by the teaching tools to simulate lower frame rates). */
  fs?: number;
}

export interface Column {
  name: string;
  unit: string;
  data: Float64Array;
}

export interface Processed {
  fs: number;
  /** Cutoff actually used (clamped below Nyquist when necessary). */
  cutoff: number;
  t: Float64Array;
  columns: Column[];
  col: Map<string, Float64Array>;
  /** Row index of each key-moment mark. */
  markRows: { row: number; label: string }[];
  timing: { frames: number; duration: number; medianInterval: number; minInterval: number; maxInterval: number; longIntervals: number; detectedFraction: number };
  warnings: string[];
  lengthUnit: string;
}

const RAD = Math.PI / 180;

export function processTrial(trial: Trial, o: ProcessOptions): Processed {
  const frames = trial.frames;
  const warnings: string[] = [];
  if (frames.length < 5) throw new Error('The trial is too short to analyse (fewer than 5 frames).');
  const cal = trial.meta.calibration;
  const u = cal.unit;
  const ft = frames.map((f) => f.t);
  const dts = ft.slice(1).map((t, i) => t - ft[i]);
  const medDt = median(dts);
  const fs = o.fs ?? 1 / medDt;
  const dt = 1 / fs;
  const t = uniformGrid(0, ft[ft.length - 1], fs);
  let cutoff = o.cutoff;
  if (cutoff > 0.4 * fs) {
    cutoff = 0.4 * fs;
    warnings.push(`Cutoff reduced to ${cutoff.toFixed(1)} Hz (must stay well below the Nyquist frequency of ${(fs / 2).toFixed(1)} Hz).`);
  }
  const longIntervals = dts.filter((d) => d > 1.5 * medDt).length;
  if (longIntervals > 0.05 * dts.length) warnings.push(`${longIntervals} of ${dts.length} frame intervals were more than 1.5x the median: the camera frame rate was unstable.`);
  if (fs < 24) warnings.push(`Low frame rate (${fs.toFixed(1)} Hz). Velocity and acceleration will be poorly resolved; improve the lighting.`);
  if (u === 'px') warnings.push('Not calibrated: lengths, velocities and accelerations are in pixels, not metres.');
  const detected = frames.filter((f) => f.lm).length;
  if (detected < 0.9 * frames.length) warnings.push(`A person was detected in only ${Math.round((100 * detected) / frames.length)} % of frames.`);

  const columns: Column[] = [];
  const col = new Map<string, Float64Array>();
  const push = (name: string, unit: string, data: Float64Array) => { columns.push({ name, unit, data }); col.set(name, data); };

  // Point trajectories in analysis coordinates: raw (resampled) and filtered.
  const cache = new Map<PointId, { rx: Float64Array; ry: Float64Array; fx: Float64Array; fy: Float64Array }>();
  let comMirrored = false;
  const point = (id: PointId) => {
    let p = cache.get(id);
    if (p) return p;
    const xs = new Float64Array(frames.length).fill(NaN), ys = new Float64Array(frames.length).fill(NaN);
    frames.forEach((f, i) => {
      let com = null;
      if (id === 'com') {
        const r = centreOfMass(f.lm, o.bodyModel, o.minVisibility);
        if (r) { com = r.com; comMirrored ||= r.mirrored; }
      }
      const q = getPoint(f.lm, id, o.minVisibility, com);
      if (q) { const a = toAnalysis(cal, q.x, q.y); xs[i] = a.x; ys[i] = a.y; }
    });
    const rx = resample(ft, xs, t, o.maxGap), ry = resample(ft, ys, t, o.maxGap);
    p = { rx, ry, fx: filtfiltGaps(rx, cutoff, fs), fy: filtfiltGaps(ry, cutoff, fs) };
    cache.set(id, p);
    return p;
  };

  const angleSeries = (def: AngleDef, which: 'r' | 'f') => {
    const out = new Float64Array(t.length);
    const ids = def.kind === 'joint' ? [def.a, def.b, def.c] : [def.from, def.to];
    const pts = new Map(ids.map((id) => [id, point(id)]));
    for (let i = 0; i < t.length; i++) {
      out[i] = evalAngle(def, (id) => {
        const p = pts.get(id)!;
        const x = which === 'r' ? p.rx[i] : p.fx[i], y = which === 'r' ? p.ry[i] : p.fy[i];
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
      }, o.convention);
    }
    return def.kind === 'segment' ? unwrapDegrees(out) : out;
  };

  for (const id of o.angles) {
    const def = ANGLE_BY_ID.get(id);
    if (!def) continue;
    const filt = angleSeries(def, 'f');
    const omega = derivative(filt, dt);
    push(`${id}_deg_raw`, 'deg', angleSeries(def, 'r'));
    push(`${id}_deg`, 'deg', filt);
    push(`${id}_vel_deg_s`, 'deg/s', omega);
    push(`${id}_acc_deg_s2`, 'deg/s^2', secondDerivative(filt, dt));
    if (def.kind === 'segment') {
      // Kinovea-style rotational quantities for the distal end about the proximal end.
      const a = point(def.from), b = point(def.to);
      const vt = new Float64Array(t.length), ac = new Float64Array(t.length);
      for (let i = 0; i < t.length; i++) {
        const r = Math.hypot(b.fx[i] - a.fx[i], b.fy[i] - a.fy[i]);
        const w = omega[i] * RAD;
        vt[i] = w * r;
        ac[i] = w * w * r;
      }
      push(`${id}_tangential_vel_${u}_s`, `${u}/s`, vt);
      push(`${id}_centripetal_acc_${u}_s2`, `${u}/s^2`, ac);
    }
  }

  for (const id of o.points) {
    const p = point(id);
    const vx = derivative(p.fx, dt), vy = derivative(p.fy, dt);
    const ax = secondDerivative(p.fx, dt), ay = secondDerivative(p.fy, dt);
    push(`${id}_x_${u}_raw`, u, p.rx);
    push(`${id}_y_${u}_raw`, u, p.ry);
    push(`${id}_x_${u}`, u, p.fx);
    push(`${id}_y_${u}`, u, p.fy);
    push(`${id}_vx_${u}_s`, `${u}/s`, vx);
    push(`${id}_vy_${u}_s`, `${u}/s`, vy);
    push(`${id}_speed_${u}_s`, `${u}/s`, vx.map((v, i) => Math.hypot(v, vy[i])));
    push(`${id}_ax_${u}_s2`, `${u}/s^2`, ax);
    push(`${id}_ay_${u}_s2`, `${u}/s^2`, ay);
    push(`${id}_acc_${u}_s2`, `${u}/s^2`, ax.map((v, i) => Math.hypot(v, ay[i])));
    push(`${id}_path_${u}`, u, pathLength(p.fx, p.fy));
  }
  if (comMirrored) warnings.push('Centre of mass: one or more hidden limb segments were replaced by the opposite side.');

  if (o.include3d) {
    const world = (name: PointId) => {
      const idx = L[name as (typeof LANDMARK_NAMES)[number]];
      return (['x', 'y', 'z'] as const).map((k) => {
        const raw = Float64Array.from(frames, (f) => (f.world && f.world[idx].v >= o.minVisibility ? f.world[idx][k] : NaN));
        return filtfiltGaps(resample(ft, raw, t, o.maxGap), cutoff, fs);
      });
    };
    const wc = new Map<PointId, Float64Array[]>();
    const w = (id: PointId) => wc.get(id) ?? (wc.set(id, world(id)), wc.get(id)!);
    for (const id of o.angles) {
      const def = ANGLE_BY_ID.get(id);
      if (!def || def.kind !== 'joint' || !(def.a in L) || !(def.b in L) || !(def.c in L)) continue;
      const [a, b, c] = [w(def.a), w(def.b), w(def.c)];
      const out = new Float64Array(t.length);
      for (let i = 0; i < t.length; i++) {
        out[i] = applyConvention(def, includedAngle({ x: a[0][i], y: a[1][i], z: a[2][i] }, { x: b[0][i], y: b[1][i], z: b[2][i] }, { x: c[0][i], y: c[1][i], z: c[2][i] }), o.convention);
      }
      push(`${id}_deg_3d_experimental`, 'deg', out);
    }
  }

  const markRows = trial.marks.map((m) => ({ row: Math.min(t.length - 1, Math.max(0, Math.round(m.t * fs))), label: m.label }));
  return {
    fs, cutoff, t, columns, col, markRows, warnings, lengthUnit: u,
    timing: {
      frames: frames.length, duration: ft[ft.length - 1], medianInterval: medDt,
      minInterval: Math.min(...dts), maxInterval: Math.max(...dts), longIntervals, detectedFraction: detected / frames.length,
    },
  };
}
