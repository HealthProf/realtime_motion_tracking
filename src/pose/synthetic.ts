// Deterministic synthetic poses with known kinematics. Used for demo mode (no camera needed)
// and as ground truth in automated tests.
import type { Lm, PoseFrame } from '../types';
import { L, LANDMARK_NAMES, type LandmarkName } from './landmarks';

export type SyntheticActivity = 'squat' | 'jump' | 'raise' | 'cycle' | 'run' | 'lift';

export const SYNTH = {
  width: 1280,
  height: 720,
  /** Pixels per metre: lets tests check calibration against a known scale. */
  pxPerMetre: 300,
  groundY: 660,
  squatPeriod: 3,
  jumpPeriod: 3,
  /** Flight time of the synthetic jump (s). Jump height = g t^2 / 8 = 0.3066 m. */
  jumpFlight: 0.5,
  raisePeriod: 4,
  raiseMaxLeft: 150,
  raiseMaxRight: 170,
  /** Pedalling cadence (rev/min) and the hip position that sets saddle height. */
  cycleCadence: 90,
  cycleHip: { x: -0.2, y: 1.0 },
  /** Running: stride time (s), ground contact time (s), foot-strike angle (deg, + = heel first). */
  runStride: 0.7,
  runContact: 0.25,
  runStrikeAngle: 12,
  /** Barbell squat: period (s), plate radius (m: a standard 450 mm plate) and the bar's offset from the shoulder (m). */
  liftPeriod: 3,
  plateRadius: 0.225,
  barOffset: { x: -0.05, y: 0.03 },
} as const;

const rad = (d: number) => (d * Math.PI) / 180;
type P = { x: number; y: number };
const add = (p: P, len: number, angFromUp: number): P => ({ x: p.x + len * Math.sin(rad(angFromUp)), y: p.y + len * Math.cos(rad(angFromUp)) });

const SEG = { shank: 0.43, thigh: 0.43, trunk: 0.5, upperArm: 0.3, forearm: 0.27, hand: 0.08 };

/** Synthetic joint angles (degrees) for the squat: included knee angle at time t. Exposed for tests. */
export function squatKneeIncluded(t: number): number {
  const s = 0.5 * (1 - Math.cos((2 * Math.PI * t) / SYNTH.squatPeriod));
  const shank = 5 + 25 * s;
  const thigh = 5 + 75 * s;
  return 180 - (shank + thigh);
}

function sagittal(shankA: number, thighA: number, trunkA: number, armA: number, lift: number, plantar: number): Partial<Record<LandmarkName, P>> {
  const footDrop = 0.07;
  // Heel rises about the toe during plantarflexion.
  const toe: P = { x: 0.19, y: lift };
  const ankle: P = { x: toe.x - 0.19 * Math.cos(rad(plantar)) + footDrop * Math.sin(rad(plantar)), y: lift + 0.19 * Math.sin(rad(plantar)) + footDrop * Math.cos(rad(plantar)) };
  const heel: P = { x: ankle.x - 0.06 * Math.cos(rad(plantar)) - footDrop * Math.sin(rad(plantar)), y: ankle.y + 0.06 * Math.sin(rad(plantar)) - footDrop * Math.cos(rad(plantar)) };
  const knee = add(ankle, SEG.shank, shankA);
  const hip = add(knee, SEG.thigh, -thighA);
  const shoulder = add(hip, SEG.trunk, trunkA);
  const elbow = add(shoulder, SEG.upperArm, 180 - armA);
  const wrist = add(elbow, SEG.forearm, 180 - armA - 10);
  const hand = add(wrist, SEG.hand, 180 - armA - 10);
  const head = add(shoulder, 0.2, trunkA);
  const out: Partial<Record<LandmarkName, P>> = {};
  for (const [side, dx] of [['l', 0.0], ['r', 0.02]] as const) {
    const o = (p: P): P => ({ x: p.x + dx, y: p.y });
    out[`${side}_ankle`] = o(ankle); out[`${side}_heel`] = o(heel); out[`${side}_toe`] = o(toe);
    out[`${side}_knee`] = o(knee); out[`${side}_hip`] = o(hip); out[`${side}_shoulder`] = o(shoulder);
    out[`${side}_elbow`] = o(elbow); out[`${side}_wrist`] = o(wrist);
    out[`${side}_index`] = o(hand); out[`${side}_pinky`] = o(hand); out[`${side}_thumb`] = o(hand);
    out[`${side}_ear`] = o({ x: head.x - 0.02, y: head.y });
    out[`${side}_eye`] = o({ x: head.x + 0.07, y: head.y + 0.03 });
    out[`${side}_eye_inner`] = o({ x: head.x + 0.08, y: head.y + 0.03 });
    out[`${side}_eye_outer`] = o({ x: head.x + 0.06, y: head.y + 0.03 });
  }
  out.nose = { x: head.x + 0.1, y: head.y };
  out.mouth_l = { x: head.x + 0.08, y: head.y - 0.05 };
  out.mouth_r = { x: head.x + 0.08, y: head.y - 0.05 };
  return out;
}

function frontal(abdL: number, abdR: number): Partial<Record<LandmarkName, P>> {
  const out: Partial<Record<LandmarkName, P>> = {};
  // Subject faces the camera: their left side appears on image right.
  for (const [side, sx, abd] of [['l', 1, abdL], ['r', -1, abdR]] as const) {
    const hip: P = { x: sx * 0.12, y: 0.93 };
    const shoulder: P = { x: sx * 0.19, y: 1.43 };
    const elbow = add(shoulder, SEG.upperArm, sx * (180 - abd));
    const wrist = add(elbow, SEG.forearm, sx * (180 - abd));
    const hand = add(wrist, SEG.hand, sx * (180 - abd));
    out[`${side}_hip`] = hip; out[`${side}_knee`] = { x: sx * 0.12, y: 0.5 }; out[`${side}_ankle`] = { x: sx * 0.12, y: 0.07 };
    out[`${side}_heel`] = { x: sx * 0.11, y: 0.0 }; out[`${side}_toe`] = { x: sx * 0.16, y: 0.0 };
    out[`${side}_shoulder`] = shoulder; out[`${side}_elbow`] = elbow; out[`${side}_wrist`] = wrist;
    out[`${side}_index`] = hand; out[`${side}_pinky`] = hand; out[`${side}_thumb`] = hand;
    out[`${side}_ear`] = { x: sx * 0.08, y: 1.62 }; out[`${side}_eye`] = { x: sx * 0.035, y: 1.65 };
    out[`${side}_eye_inner`] = { x: sx * 0.02, y: 1.65 }; out[`${side}_eye_outer`] = { x: sx * 0.05, y: 1.65 };
  }
  out.nose = { x: 0, y: 1.6 };
  out.mouth_l = { x: 0.03, y: 1.55 };
  out.mouth_r = { x: -0.03, y: 1.55 };
  return out;
}

/** Two-link inverse kinematics: joint position between `a` and `b`, bending toward +x (knee) or -x. */
function ik(a: P, b: P, l1: number, l2: number, bend: 1 | -1): P {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.min(Math.hypot(dx, dy), l1 + l2 - 1e-6);
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const ux = dx / Math.hypot(dx, dy), uy = dy / Math.hypot(dx, dy);
  // Perpendicular chosen so the joint lies on the +x side for bend = 1.
  let px = -uy, py = ux;
  if (px * bend < 0) { px = -px; py = -py; }
  return { x: a.x + ux * along + px * h, y: a.y + uy * along + py * h };
}
const rot = (v: P, deg: number): P => ({ x: v.x * Math.cos(rad(deg)) - v.y * Math.sin(rad(deg)), y: v.x * Math.sin(rad(deg)) + v.y * Math.cos(rad(deg)) });
const plus = (a: P, b: P): P => ({ x: a.x + b.x, y: a.y + b.y });

type Leg = { hip: P; knee: P; ankle: P; heel: P; toe: P };
type Arm = { shoulder: P; elbow: P; wrist: P };

function assemble(legs: { l: Leg; r: Leg }, arms: { l: Arm; r: Arm }, head: P): Partial<Record<LandmarkName, P>> {
  const out: Partial<Record<LandmarkName, P>> = {};
  for (const side of ['l', 'r'] as const) {
    const g = legs[side], a = arms[side];
    out[`${side}_hip`] = g.hip; out[`${side}_knee`] = g.knee; out[`${side}_ankle`] = g.ankle; out[`${side}_heel`] = g.heel; out[`${side}_toe`] = g.toe;
    out[`${side}_shoulder`] = a.shoulder; out[`${side}_elbow`] = a.elbow; out[`${side}_wrist`] = a.wrist;
    const hand = plus(a.wrist, { x: 0.07 * Math.sign(a.wrist.x - a.elbow.x || 1), y: -0.02 });
    out[`${side}_index`] = hand; out[`${side}_pinky`] = hand; out[`${side}_thumb`] = hand;
    out[`${side}_ear`] = { x: head.x - 0.02, y: head.y };
    out[`${side}_eye`] = { x: head.x + 0.07, y: head.y + 0.03 };
    out[`${side}_eye_inner`] = { x: head.x + 0.08, y: head.y + 0.03 };
    out[`${side}_eye_outer`] = { x: head.x + 0.06, y: head.y + 0.03 };
  }
  out.nose = { x: head.x + 0.1, y: head.y };
  out.mouth_l = { x: head.x + 0.08, y: head.y - 0.05 };
  out.mouth_r = { x: head.x + 0.08, y: head.y - 0.05 };
  return out;
}

const BB: P = { x: 0, y: 0.28 }, CRANK = 0.17;

/** One leg of the synthetic cyclist at crank angle `deg` (0 = top, 90 = forward). */
export function cycleLeg(deg: number): Leg {
  const pedal: P = { x: BB.x + CRANK * Math.sin(rad(deg)), y: BB.y + CRANK * Math.cos(rad(deg)) };
  const pitch = -8 + 8 * Math.sin(rad(deg)); // mild ankling
  const ankle = plus(pedal, rot({ x: -0.12, y: 0.09 }, pitch));
  const hip: P = { ...SYNTH.cycleHip };
  return { hip, knee: ik(hip, ankle, SEG.thigh, SEG.shank, 1), ankle, heel: plus(pedal, rot({ x: -0.19, y: 0.02 }, pitch)), toe: plus(pedal, rot({ x: 0.05, y: -0.01 }, pitch)) };
}
const flexion = (g: Leg) => {
  const a = Math.atan2(g.hip.y - g.knee.y, g.hip.x - g.knee.x), b = Math.atan2(g.ankle.y - g.knee.y, g.ankle.x - g.knee.x);
  let d = Math.abs(a - b) * (180 / Math.PI);
  if (d > 180) d = 360 - d;
  return 180 - d;
};
/** Ground-truth knee flexion (deg) of the near (left) leg of the synthetic cyclist at crank angle `deg`. */
export const cycleKneeFlexion = (deg: number) => flexion(cycleLeg(deg));

function cyclist(t: number): Partial<Record<LandmarkName, P>> {
  const deg = (t * SYNTH.cycleCadence * 6) % 360;
  const hip: P = { ...SYNTH.cycleHip };
  const shoulder = add(hip, SEG.trunk, 45);
  const elbow = add(shoulder, SEG.upperArm, 145);
  const arm: Arm = { shoulder, elbow, wrist: add(elbow, SEG.forearm, 125) };
  return assemble({ l: cycleLeg(deg), r: cycleLeg(deg + 180) }, { l: arm, r: arm }, add(shoulder, 0.2, 30));
}

/** One leg of the synthetic runner. `tau` is time within the stride (0 = initial contact). */
export function runLeg(tau: number, hip: P): Leg {
  const T = SYNTH.runStride, tc = SYNTH.runContact;
  const tt = ((tau % T) + T) % T;
  const foot = (heel: P, pitch: number): Leg => {
    const ankle = plus(heel, rot({ x: 0.06, y: 0.07 }, pitch));
    return { hip, knee: ik(hip, ankle, SEG.thigh, SEG.shank, 1), ankle, heel, toe: plus(heel, rot({ x: 0.25, y: 0 }, pitch)) };
  };
  const stance = (u: number): { heel: P; pitch: number } => {
    const flatHeelX = 0.12 - 0.4 * u; // the belt carries the foot backward
    if (u < 0.2) return { heel: { x: flatHeelX, y: 0 }, pitch: SYNTH.runStrikeAngle * (1 - u / 0.2) };
    if (u < 0.6) return { heel: { x: flatHeelX, y: 0 }, pitch: 0 };
    const pitch = (-45 * (u - 0.6)) / 0.4; // heel rise, pivoting on the toe
    const toe: P = { x: flatHeelX + 0.25, y: 0 };
    return { heel: plus(toe, rot({ x: -0.25, y: 0 }, pitch)), pitch };
  };
  if (tt < tc) { const s = stance(tt / tc); return foot(s.heel, s.pitch); }
  const w = (tt - tc) / (T - tc), sm = w * w * (3 - 2 * w);
  const a = stance(1), b = stance(0);
  return foot({ x: a.heel.x + (b.heel.x - a.heel.x) * sm, y: a.heel.y * (1 - sm) + 0.22 * Math.sin(Math.PI * w) }, a.pitch + (b.pitch - a.pitch) * sm);
}
/** Hip position of the synthetic runner at time t (lowest at mid-stance of each step). */
export function runHip(t: number): P {
  const half = SYNTH.runStride / 2;
  return { x: 0, y: 0.89 - 0.03 * Math.cos((2 * Math.PI * (t - SYNTH.runContact / 2)) / half) };
}

function runner(t: number): Partial<Record<LandmarkName, P>> {
  const hip = runHip(t);
  const shoulder = add(hip, SEG.trunk, 8);
  const swing = 25 * Math.sin((2 * Math.PI * t) / SYNTH.runStride);
  const arm = (sgn: number): Arm => {
    const elbow = add(shoulder, SEG.upperArm, 180 - sgn * swing);
    return { shoulder, elbow, wrist: add(elbow, SEG.forearm, 90 - sgn * swing) };
  };
  return assemble({ l: runLeg(t, hip), r: runLeg(t + SYNTH.runStride / 2, hip) }, { l: arm(1), r: arm(-1) }, add(shoulder, 0.2, 8));
}

function lifter(t: number): Partial<Record<LandmarkName, P>> {
  const s = 0.5 * (1 - Math.cos((2 * Math.PI * t) / SYNTH.liftPeriod));
  const b = sagittal(5 + 25 * s, 5 + 75 * s, 5 + 35 * s, 0, 0, 0);
  // Back squat: the hands hold the bar beside the shoulders.
  for (const side of ['l', 'r'] as const) {
    const sh = b[`${side}_shoulder`]!;
    b[`${side}_elbow`] = { x: sh.x - 0.1, y: sh.y - 0.24 };
    for (const n of ['wrist', 'index', 'pinky', 'thumb'] as const) b[`${side}_${n}`] = { x: sh.x + SYNTH.barOffset.x + 0.04, y: sh.y + SYNTH.barOffset.y - 0.03 };
  }
  return b;
}

/** Centre of the synthetic barbell (metres, x right, y up) at time t. Ground truth for the lifting tests. */
export function syntheticBar(t: number): P {
  const sh = lifter(t).l_shoulder!;
  return { x: sh.x + SYNTH.barOffset.x, y: sh.y + SYNTH.barOffset.y };
}

/** Body configuration in metres (x right, y up, origin at the ground under the subject). */
export function syntheticBody(t: number, activity: SyntheticActivity): Partial<Record<LandmarkName, P>> {
  if (activity === 'lift') return lifter(t);
  if (activity === 'raise') {
    const s = 0.5 * (1 - Math.cos((2 * Math.PI * t) / SYNTH.raisePeriod));
    return frontal(10 + (SYNTH.raiseMaxLeft - 10) * s, 10 + (SYNTH.raiseMaxRight - 10) * s);
  }
  if (activity === 'cycle') return cyclist(t);
  if (activity === 'run') return runner(t);
  if (activity === 'squat') {
    const s = 0.5 * (1 - Math.cos((2 * Math.PI * t) / SYNTH.squatPeriod));
    return sagittal(5 + 25 * s, 5 + 75 * s, 5 + 35 * s, 80 * s, 0, 0);
  }
  // Jump: countermovement (0-0.8 s), flight (0.8-1.3 s), landing (1.3-1.8 s), stand.
  const tt = ((t % SYNTH.jumpPeriod) + SYNTH.jumpPeriod) % SYNTH.jumpPeriod;
  const tf = SYNTH.jumpFlight;
  let s = 0, lift = 0, plantar = 0;
  if (tt < 0.8) s = 0.6 * Math.sin((Math.PI * tt) / 0.8) ** 2;
  else if (tt < 0.8 + tf) {
    const u = tt - 0.8;
    lift = 0.5 * 9.81 * u * (tf - u);
    plantar = 35;
  } else if (tt < 1.8) s = 0.4 * Math.sin((Math.PI * (tt - 0.8 - tf)) / 0.5) ** 2;
  return sagittal(5 + 25 * s, 5 + 75 * s, 5 + 35 * s, 0, lift, plantar);
}

export function syntheticFrame(t: number, activity: SyntheticActivity): PoseFrame {
  const body = syntheticBody(t, activity);
  const cx = SYNTH.width / 2;
  const lm: Lm[] = [];
  const world: Lm[] = [];
  const farSide = activity === 'raise' ? null : 'r';
  for (const name of LANDMARK_NAMES) {
    const p = body[name] ?? { x: 0, y: 0 };
    const v = farSide && name.startsWith(`${farSide}_`) ? 0.7 : 0.98;
    lm[L[name]] = { x: cx + p.x * SYNTH.pxPerMetre, y: SYNTH.groundY - p.y * SYNTH.pxPerMetre, z: 0, v };
    const side = name.startsWith('l_') ? 1 : name.startsWith('r_') ? -1 : 0;
    // Sagittal demo: the subject's left-right axis lies along the camera's depth axis.
    world[L[name]] = { x: p.x, y: -p.y, z: activity === 'raise' ? 0 : side * 0.15, v };
  }
  return { t, w: SYNTH.width, h: SYNTH.height, lm, world };
}
