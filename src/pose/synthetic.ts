// Deterministic synthetic poses with known kinematics. Used for demo mode (no camera needed)
// and as ground truth in automated tests.
import type { Lm, PoseFrame } from '../types';
import { L, LANDMARK_NAMES, type LandmarkName } from './landmarks';

export type SyntheticActivity = 'squat' | 'jump' | 'raise';

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

/** Body configuration in metres (x right, y up, origin at the ground under the subject). */
export function syntheticBody(t: number, activity: SyntheticActivity): Partial<Record<LandmarkName, P>> {
  if (activity === 'raise') {
    const s = 0.5 * (1 - Math.cos((2 * Math.PI * t) / SYNTH.raisePeriod));
    return frontal(10 + (SYNTH.raiseMaxLeft - 10) * s, 10 + (SYNTH.raiseMaxRight - 10) * s);
  }
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
