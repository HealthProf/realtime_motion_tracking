// Barbell mechanics from the tracked bar position.
//
// Everything here follows from Newton's second law applied to the bar (treated as a point mass):
//   force on the bar (vertical)  F = m (g + a_y)
//   power delivered to the bar   P = F v_y + m a_x v_x
//   work done on the bar         W = integral of P dt  (= m g x rise + change in kinetic energy)
// The values describe the BAR, not the lifter's whole body. "System" values use the combined centre of
// mass of the lifter and the bar from the segmental body model, and carry that model's uncertainty.
//
// Velocity definitions follow the velocity-based-training literature. The propulsive phase is the part
// of the lift in which the bar's acceleration is greater than -g, i.e. the lifter is still pushing
// (Sanchez-Medina, Perez & Gonzalez-Badillo, 2010, Int J Sports Med 31:123-129, doi:10.1055/s-0029-1242815).
import { derivative, secondDerivative } from '../kinematics/series';
import { findExtrema } from '../modes/cycles';

export const G = 9.80665;
export const KG_PER_LB = 0.45359237;

export const LIFTS: { id: string; label: string; fast: boolean; guidance: string }[] = [
  { id: 'squat', label: 'Squat', fast: false, guidance: 'Side view with the plate facing the camera, camera at about hip height.' },
  { id: 'deadlift', label: 'Deadlift', fast: false, guidance: 'Side view with the plate facing the camera, camera at about knee height.' },
  { id: 'bench', label: 'Bench press', fast: false, guidance: 'Side view with the plate facing the camera. Calibrate from the plate or a reference object: the standing-height method does not apply to a lifter who is lying down, and body tracking is weaker in this position.' },
  { id: 'press', label: 'Overhead press', fast: false, guidance: 'Side view with the plate facing the camera. Leave room above the head for the bar at lockout.' },
  { id: 'clean', label: 'Clean', fast: true, guidance: 'Side view with the plate facing the camera. Use 60 fps or faster: the bar moves about 2 m/s.' },
  { id: 'snatch', label: 'Snatch', fast: true, guidance: 'Side view with the plate facing the camera. Use 60 fps or faster, and leave room above the head.' },
  { id: 'other', label: 'Other barbell lift', fast: false, guidance: 'Side view with the plate facing the camera.' },
];

export interface LiftSeries {
  vx: Float64Array;
  vy: Float64Array;
  ax: Float64Array;
  ay: Float64Array;
  /** Vertical force applied to the bar, N. */
  force: Float64Array;
  /** Power delivered to the bar, W. */
  power: Float64Array;
}

export function liftSeries(x: ArrayLike<number>, y: ArrayLike<number>, fs: number, massKg: number): LiftSeries {
  const dt = 1 / fs;
  const vx = derivative(x, dt), vy = derivative(y, dt), ax = secondDerivative(x, dt), ay = secondDerivative(y, dt);
  const force = ay.map((a) => massKg * (G + a));
  const power = force.map((f, i) => f * vy[i] + massKg * ax[i] * vx[i]);
  return { vx, vy, ax, ay, force, power };
}

export interface LiftRep {
  /** Row indices of the start and end of the lifting (concentric) phase. */
  start: number;
  end: number;
  /** Vertical distance the bar rose, m. */
  rom: number;
  /** Duration of the lifting phase, s. */
  duration: number;
  meanVelocity: number;
  peakVelocity: number;
  timeToPeakVelocity: number;
  meanPropulsiveVelocity: number;
  peakAcceleration: number;
  meanForce: number;
  peakForce: number;
  /** Work done on the bar during the lifting phase, J. */
  work: number;
  meanPower: number;
  peakPower: number;
  /** Largest horizontal movement of the bar away from where the lift started, m. */
  pathDeviation: number;
  /** Time spent lowering the bar before this lift, s (NaN if the trial did not include it). */
  loweringTime: number;
  /** System (lifter + bar) values; NaN unless body mass and a body centre of mass were available. */
  systemWork: number;
  systemMeanPower: number;
  systemPeakPower: number;
}

export interface LiftInput {
  fs: number;
  /** Filtered bar position in metres (x right, y up) on a uniform time grid. */
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  /** Total mass on the bar including the bar, kg. */
  massKg: number;
  /** Smallest rise counted as a lift, m. Default: the larger of 0.10 m and 30 % of the bar's range. */
  minRise?: number;
  /** Combined lifter + bar centre-of-mass height (m) and total mass (kg), for the system estimates. */
  system?: { y: ArrayLike<number>; massKg: number } | null;
}

export interface LiftAnalysis {
  series: LiftSeries;
  reps: LiftRep[];
  warnings: string[];
}

const fin = Number.isFinite;

/** Bottom and top of every rise of at least `delta`, including ones that touch the ends of the record. */
function rises(y: ArrayLike<number>, delta: number): [number, number][] {
  const { maxima, minima } = findExtrema(y, delta);
  const pts = [...maxima.map((i) => ({ i, max: true })), ...minima.map((i) => ({ i, max: false }))].sort((a, b) => a.i - b.i);
  const arg = (from: number, to: number, wantMax: boolean) => {
    let best = -1;
    for (let i = from; i <= to; i++) if (fin(y[i]) && (best < 0 || (wantMax ? y[i] > y[best] : y[i] < y[best]))) best = i;
    return best;
  };
  const n = y.length;
  // The hysteresis search does not report an extreme at either end of the record: add them.
  const first = pts[0], last = pts[pts.length - 1];
  if (!first) {
    const lo = arg(0, n - 1, false), hi = lo >= 0 ? arg(lo, n - 1, true) : -1;
    return lo >= 0 && hi > lo && y[hi] - y[lo] >= delta ? [[lo, hi]] : [];
  }
  if (first.max) { const lo = arg(0, first.i, false); if (lo >= 0 && lo < first.i && y[first.i] - y[lo] >= delta) pts.unshift({ i: lo, max: false }); }
  if (!last.max) { const hi = arg(last.i, n - 1, true); if (hi > last.i && y[hi] - y[last.i] >= delta) pts.push({ i: hi, max: true }); }
  const out: [number, number][] = [];
  for (let k = 0; k < pts.length - 1; k++) if (!pts[k].max && pts[k + 1].max) out.push([pts[k].i, pts[k + 1].i]);
  return out;
}

export function analyseLift(inp: LiftInput): LiftAnalysis {
  const { fs, x, y, massKg } = inp;
  const dt = 1 / fs;
  const s = liftSeries(x, y, fs, massKg);
  const warnings: string[] = [];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < y.length; i++) if (fin(y[i])) { lo = Math.min(lo, y[i]); hi = Math.max(hi, y[i]); }
  const reps: LiftRep[] = [];
  if (!(hi > lo)) return { series: s, reps, warnings: ['The bar was not tracked in this trial.'] };
  const delta = inp.minRise ?? Math.max(0.1, 0.3 * (hi - lo));
  const sys = inp.system && inp.system.massKg > 0 ? inp.system : null;
  const sv = sys ? derivative(sys.y, dt) : null, sa = sys ? secondDerivative(sys.y, dt) : null;

  let prevTop = -1;
  for (const [bottom, top] of rises(y, delta)) {
    let pk = bottom;
    for (let i = bottom; i <= top; i++) if (fin(s.vy[i]) && s.vy[i] > (fin(s.vy[pk]) ? s.vy[pk] : -Infinity)) pk = i;
    const vPeak = s.vy[pk];
    if (!(vPeak > 0)) continue;
    // The lift starts and ends where the upward speed crosses a small threshold, so a pause at the
    // bottom or a hold at the top does not dilute the mean velocity.
    const thr = Math.max(0.02, 0.03 * vPeak);
    let a = pk, b = pk;
    while (a > bottom && fin(s.vy[a - 1]) && s.vy[a - 1] > thr) a--;
    while (b < top && fin(s.vy[b + 1]) && s.vy[b + 1] > thr) b++;
    if (a > bottom) a--;
    if (b < top) b++;
    if (b - a < 2) continue;
    const rom = y[b] - y[a], duration = (b - a) * dt;
    let work = 0, forceSum = 0, forceN = 0, sysWork = 0, peakF = -Infinity, peakP = -Infinity, peakA = -Infinity, sysPeakP = -Infinity, dev = 0, propSum = 0, propN = 0, propOpen = true, sysOk = !!sys;
    for (let i = a; i <= b; i++) {
      const wgt = i === a || i === b ? 0.5 : 1;
      if (fin(s.power[i])) work += s.power[i] * dt * wgt;
      if (fin(s.force[i])) { forceSum += s.force[i]; forceN++; }
      if (s.force[i] > peakF) peakF = s.force[i];
      if (s.power[i] > peakP) peakP = s.power[i];
      if (s.ay[i] > peakA) peakA = s.ay[i];
      if (fin(x[i]) && fin(x[a])) dev = Math.max(dev, Math.abs(x[i] - x[a]));
      if (propOpen && i > pk && s.ay[i] < -G) propOpen = false;
      if (propOpen && fin(s.vy[i])) { propSum += s.vy[i]; propN++; }
      if (sys && sv && sa) {
        const p = sys.massKg * (G + sa[i]) * sv[i];
        if (fin(p)) { sysWork += p * dt * wgt; if (p > sysPeakP) sysPeakP = p; } else sysOk = false;
      }
    }
    // Lowering phase: from the previous top (or the start of the record) down to this bottom.
    let from = Math.max(0, prevTop);
    if (prevTop < 0) { for (let i = bottom; i >= 0; i--) if (fin(y[i]) && y[i] >= y[from]) from = i; }
    const lowered = y[from] - y[bottom] >= delta;
    reps.push({
      start: a, end: b, rom, duration, meanVelocity: rom / duration, peakVelocity: vPeak, timeToPeakVelocity: (pk - a) * dt,
      meanPropulsiveVelocity: propN ? propSum / propN : NaN, peakAcceleration: peakA, meanForce: forceN ? forceSum / forceN : NaN, peakForce: peakF,
      work, meanPower: work / duration, peakPower: peakP, pathDeviation: dev, loweringTime: lowered ? (bottom - from) * dt : NaN,
      systemWork: sysOk ? sysWork : NaN, systemMeanPower: sysOk ? sysWork / duration : NaN, systemPeakPower: sysOk ? sysPeakP : NaN,
    });
    prevTop = top;
  }
  if (!reps.length) warnings.push(`No lift detected: the bar must rise at least ${(delta * 100).toFixed(0)} cm.`);
  const fastest = Math.max(0, ...reps.map((r) => r.peakVelocity));
  if (fs < 50 && fastest > 1.2) warnings.push(`Peak bar speed was ${fastest.toFixed(2)} m/s but the frame rate was only ${fs.toFixed(0)} Hz. Peak velocity, acceleration, force and power are underestimated for fast lifts at this rate; use 60 fps or faster.`);
  return { series: s, reps, warnings };
}
