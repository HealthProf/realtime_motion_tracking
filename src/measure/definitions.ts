// Angle definitions and conventions.
import { includedAngle, segmentAngle, type Vec2 } from '../kinematics/angles';
import type { PointId } from '../pose/landmarks';

export type Convention = 'anatomical' | 'included';

interface Base {
  id: string;
  label: string;
  side: 'l' | 'r' | 'c';
}
export interface JointAngleDef extends Base {
  kind: 'joint';
  a: PointId;
  /** Vertex. */
  b: PointId;
  c: PointId;
  /** How the anatomical value is derived from the included angle. */
  anatomical: 'flexion' | 'identity' | 'ankle';
  /** Plain-language definition shown to students and written to export metadata. */
  note: string;
}
export interface SegmentAngleDef extends Base {
  kind: 'segment';
  from: PointId;
  to: PointId;
  ref: 'horizontal' | 'vertical';
  note: string;
}
export type AngleDef = JointAngleDef | SegmentAngleDef;

const joint = (side: 'l' | 'r', name: string, a: string, b: string, c: string, anatomical: JointAngleDef['anatomical'], note: string): JointAngleDef => ({
  kind: 'joint', id: `${side}_${name}`, label: `${side === 'l' ? 'Left' : 'Right'} ${name}`, side,
  a: `${side}_${a}` as PointId, b: `${side}_${b}` as PointId, c: `${side}_${c}` as PointId, anatomical, note,
});
const seg = (side: 'l' | 'r', name: string, from: string, to: string): SegmentAngleDef => ({
  kind: 'segment', id: `${side}_${name}_seg`, label: `${side === 'l' ? 'Left' : 'Right'} ${name} (segment)`, side,
  from: `${side}_${from}` as PointId, to: `${side}_${to}` as PointId, ref: 'horizontal',
  note: `Absolute angle of the ${name} (${from} to ${to}) counter-clockwise from the right horizontal.`,
});

const sides = ['l', 'r'] as const;

export const ANGLES: AngleDef[] = [
  ...sides.flatMap((s) => [
    joint(s, 'knee', 'hip', 'knee', 'ankle', 'flexion', 'Hip-knee-ankle. Anatomical: flexion = 180 deg minus the included angle (0 = straight).'),
    joint(s, 'hip', 'shoulder', 'hip', 'knee', 'flexion', 'Shoulder-hip-knee (trunk-thigh angle). Anatomical: flexion = 180 deg minus the included angle. Includes lumbar and pelvic motion.'),
    joint(s, 'ankle', 'knee', 'ankle', 'toe', 'ankle', 'Knee-ankle-toe. Anatomical: included angle minus 90 deg (positive = plantarflexion). The neutral offset is approximate because the toe keypoint is not on the foot\'s long axis.'),
    joint(s, 'elbow', 'shoulder', 'elbow', 'wrist', 'flexion', 'Shoulder-elbow-wrist. Anatomical: flexion = 180 deg minus the included angle (0 = straight).'),
    joint(s, 'shoulder', 'elbow', 'shoulder', 'hip', 'identity', 'Elbow-shoulder-hip (arm-trunk angle). Elevation in the camera plane: flexion in a side view, abduction in a front view.'),
  ]),
  {
    kind: 'segment', id: 'trunk_lean', label: 'Trunk lean', side: 'c', from: 'mid_hip', to: 'mid_shoulder', ref: 'vertical',
    note: 'Mid-hip to mid-shoulder relative to vertical. Positive = leaning toward image right.',
  },
  ...sides.flatMap((s) => [seg(s, 'thigh', 'hip', 'knee'), seg(s, 'shank', 'knee', 'ankle'), seg(s, 'upper arm', 'shoulder', 'elbow'), seg(s, 'forearm', 'elbow', 'wrist')]),
];

export const ANGLE_BY_ID = new Map(ANGLES.map((a) => [a.id, a]));

export function applyConvention(def: AngleDef, included: number, convention: Convention): number {
  if (def.kind !== 'joint' || convention === 'included') return included;
  switch (def.anatomical) {
    case 'flexion': return 180 - included;
    case 'ankle': return included - 90;
    default: return included;
  }
}

/**
 * Evaluates an angle. `p` resolves a point in a y-up frame (analysis coordinates), or null if missing.
 * Joint angles are independent of the frame; segment angles require y-up.
 */
export function evalAngle(def: AngleDef, p: (id: PointId) => (Vec2 & { z?: number }) | null, convention: Convention): number {
  if (def.kind === 'joint') {
    const a = p(def.a), b = p(def.b), c = p(def.c);
    if (!a || !b || !c) return NaN;
    return applyConvention(def, includedAngle(a, b, c), convention);
  }
  const from = p(def.from), to = p(def.to);
  if (!from || !to) return NaN;
  return segmentAngle(from, to, def.ref);
}

/** Symbol for on-screen and CSV units. */
export const DEG = '°';
