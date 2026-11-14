// Quasi-static external (gravitational) moment about a joint.
//
// The body above (or beyond) the joint is treated as one mass acting at its own centre of mass. The
// moment of its weight about the joint is weight x horizontal distance (the moment arm). This is the
// moment the muscles and other tissues must balance to HOLD the position: it ignores acceleration, so
// it is not valid for fast movements, and it assumes the picture plane contains the movement.
import { segmentCentres, type BodyModel, type SegGroup } from './com';
import { L } from '../pose/landmarks';
import type { Lm } from '../types';

export const G = 9.80665;

export type StaticJoint = 'elbow' | 'shoulder' | 'hips' | 'knees' | 'ankles';

export const STATIC_JOINTS: { id: StaticJoint; label: string; supports: string }[] = [
  { id: 'elbow', label: 'Elbow', supports: 'the forearm and hand' },
  { id: 'shoulder', label: 'Shoulder', supports: 'the whole arm' },
  { id: 'hips', label: 'Hips (both together)', supports: 'the head, arms and trunk' },
  { id: 'knees', label: 'Knees (both together)', supports: 'the head, arms, trunk and thighs' },
  { id: 'ankles', label: 'Ankles (both together)', supports: 'everything above the feet' },
];

const HAT: SegGroup[] = ['head', 'trunk', 'upper_arm', 'forearm', 'hand'];
const SETS: Record<StaticJoint, { groups: SegGroup[]; oneSide: boolean; pivot: 'elbow' | 'shoulder' | 'hip' | 'knee' | 'ankle' }> = {
  elbow: { groups: ['forearm', 'hand'], oneSide: true, pivot: 'elbow' },
  shoulder: { groups: ['upper_arm', 'forearm', 'hand'], oneSide: true, pivot: 'shoulder' },
  hips: { groups: HAT, oneSide: false, pivot: 'hip' },
  knees: { groups: [...HAT, 'thigh'], oneSide: false, pivot: 'knee' },
  ankles: { groups: [...HAT, 'thigh', 'shank'], oneSide: false, pivot: 'ankle' },
};
/** How many segments each set must contain to be complete. */
const EXPECTED = (groups: SegGroup[], oneSide: boolean) => groups.reduce((n, g) => n + (g === 'head' || g === 'trunk' || oneSide ? 1 : 2), 0);

export interface StaticInput {
  lm: Lm[] | null;
  joint: StaticJoint;
  /** Side whose joint is used as the pivot (and, for the arm joints, whose segments are included). */
  side: 'l' | 'r';
  bodyModel: BodyModel;
  minVisibility: number;
  /** Body mass in kg. */
  bodyMassKg: number;
  /** Metres per pixel, or NaN when the picture is not calibrated. */
  scale: number;
  /** External load carried by the hands (kg) and where it acts (image pixels). */
  load?: { kg: number; x: number; y: number } | null;
}

export interface StaticMoment {
  pivot: { x: number; y: number };
  /** Centre of mass of everything supported, including the external load (image pixels). */
  com: { x: number; y: number };
  /** Percent of body mass supported. */
  massPct: number;
  /** Supported mass including the external load share, kg. */
  massKg: number;
  weightN: number;
  /** Horizontal moment arm in pixels: positive when the weight acts to image right of the joint. */
  armPx: number;
  /** Moment arm in metres (NaN if uncalibrated). */
  armM: number;
  /** Moment in N·m: positive turns clockwise as seen in the picture. NaN if uncalibrated. */
  momentNm: number;
  /** True when a hidden limb segment was placed using the opposite side. */
  mirrored: boolean;
}

export function staticMoment(i: StaticInput): StaticMoment | null {
  const { lm } = i;
  if (!lm || !(i.bodyMassKg > 0)) return null;
  const set = SETS[i.joint];
  const pv = lm[L[`${i.side}_${set.pivot}`]];
  if (pv.v < i.minVisibility) return null;
  const segs = segmentCentres(lm, i.bodyModel, i.minVisibility).filter((s) => set.groups.includes(s.group) && (!set.oneSide || s.side === i.side));
  if (segs.length !== EXPECTED(set.groups, set.oneSide)) return null;
  if (set.oneSide && segs.some((s) => s.mirrored)) return null;
  let massPct = 0, sx = 0, sy = 0;
  for (const s of segs) { massPct += s.mass; sx += s.mass * s.x; sy += s.mass * s.y; }
  let kg = (massPct / 100) * i.bodyMassKg;
  let cx = sx / massPct, cy = sy / massPct;
  if (i.load && i.load.kg > 0) {
    // A two-handed load is shared between the arms; every other set carries all of it.
    const lk = set.oneSide ? i.load.kg / 2 : i.load.kg;
    cx = (cx * kg + i.load.x * lk) / (kg + lk);
    cy = (cy * kg + i.load.y * lk) / (kg + lk);
    kg += lk;
  }
  const weightN = kg * G, armPx = cx - pv.x, armM = armPx * i.scale;
  return { pivot: { x: pv.x, y: pv.y }, com: { x: cx, y: cy }, massPct, massKg: kg, weightN, armPx, armM, momentNm: weightN * armM, mirrored: segs.some((s) => s.mirrored) };
}

/**
 * Which muscle group must act to hold the position, for the lower-limb joints in a side view.
 * `facing`: +1 if the subject faces image right. Returns null where the answer depends on more than the picture shows.
 */
export function resistingGroup(joint: StaticJoint, armPx: number, facing: 1 | -1): { tendency: string; muscles: string } | null {
  const anterior = armPx * facing > 0;
  switch (joint) {
    case 'hips': return anterior ? { tendency: 'flex the hips (tip the trunk forward)', muscles: 'hip extensors (gluteus maximus, hamstrings) and the back extensors' } : { tendency: 'extend the hips (tip the trunk backward)', muscles: 'hip flexors and abdominals' };
    case 'knees': return anterior ? { tendency: 'extend the knees', muscles: 'knee flexors and the passive structures at the back of the knee' } : { tendency: 'flex the knees', muscles: 'knee extensors (quadriceps)' };
    case 'ankles': return anterior ? { tendency: 'dorsiflex the ankles (tip the body forward over the feet)', muscles: 'plantarflexors (gastrocnemius and soleus)' } : { tendency: 'plantarflex the ankles (tip the body backward)', muscles: 'dorsiflexors (tibialis anterior)' };
    default: return null;
  }
}

/** Horizontal base of support from the feet that are on the ground, and where the line of gravity falls. */
export interface Support {
  /** Left and right ends of the base of support and its height in the picture (pixels). */
  x0: number;
  x1: number;
  y: number;
  /** Signed distance (pixels) from the line of gravity to the nearest edge: positive = inside the base. */
  margin: number;
}

export function baseOfSupport(lm: Lm[] | null, comX: number, minVis: number): Support | null {
  if (!lm) return null;
  const feet = (['l', 'r'] as const).map((s) => [lm[L[`${s}_heel`]], lm[L[`${s}_toe`]]]).filter((f) => f.every((p) => p.v >= minVis));
  if (!feet.length) return null;
  const lowest = Math.max(...feet.flat().map((p) => p.y));
  const height = Math.abs(lm[L.l_shoulder].y + lm[L.r_shoulder].y - lm[L.l_hip].y - lm[L.r_hip].y) / 2 || 1;
  // A foot counts as on the ground when its lowest point is within 8 % of trunk length of the lowest foot point.
  const grounded = feet.filter((f) => lowest - Math.max(f[0].y, f[1].y) < 0.08 * height);
  const xs = grounded.flat().map((p) => p.x);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  return { x0, x1, y: lowest, margin: Math.min(comX - x0, x1 - comX) };
}
