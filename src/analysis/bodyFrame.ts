// Anatomical reference frame of the body (mediolateral, anteroposterior and longitudinal axes), used to
// draw the cardinal planes and axes of rotation.
//
// The frame comes from the pose model's estimated 3D landmarks. Depth is the model's least reliable
// output, so the heading is low-pass filtered and snapped to square-on views when it is close to one.
// Coordinates: x toward image right, y DOWN, z away from the camera (the model's convention).
import { OneEuro } from '../kinematics/oneEuro';
import { L } from '../pose/landmarks';
import type { Lm } from '../types';

export interface V3 { x: number; y: number; z: number }
export type PlaneId = 'sagittal' | 'frontal' | 'transverse';
export type FrameMode = 'heading' | 'trunk';

export interface BodyFrame {
  /** Unit vector from the subject's right to their left (mediolateral axis). */
  ml: V3;
  /** Unit vector toward the subject's front (anteroposterior axis). */
  ap: V3;
  /** Unit vector toward the head (longitudinal axis). */
  up: V3;
  /** 'model': from estimated 3D landmarks. 'view': square-on fallback when 3D is unavailable. */
  source: 'model' | 'view';
}

export const PLANES: Record<PlaneId, { label: string; color: string; axis: string; axisAlias: string; divides: string; motions: string }> = {
  sagittal: {
    label: 'Sagittal plane', color: '#f87171', axis: 'Mediolateral axis', axisAlias: 'also called the frontal, transverse or bilateral axis',
    divides: 'left and right', motions: 'flexion and extension, dorsiflexion and plantarflexion; a forward somersault',
  },
  frontal: {
    label: 'Frontal (coronal) plane', color: '#60a5fa', axis: 'Anteroposterior axis', axisAlias: 'also called the sagittal axis',
    divides: 'front and back', motions: 'abduction and adduction, lateral flexion, radial and ulnar deviation; a cartwheel',
  },
  transverse: {
    label: 'Transverse (horizontal) plane', color: '#4ade80', axis: 'Longitudinal axis', axisAlias: 'also called the vertical axis',
    divides: 'upper and lower', motions: 'internal and external rotation, horizontal abduction and adduction, trunk rotation; a pirouette',
  },
};
export const PLANE_IDS: PlaneId[] = ['sagittal', 'frontal', 'transverse'];

/** What each joint can do in each plane, described from the anatomical position. */
export const JOINT_MOTIONS: { id: string; label: string; sagittal: string; frontal: string; transverse: string; note?: string }[] = [
  { id: 'body', label: 'Whole body (centre of mass)', sagittal: 'Somersault, forward and backward lean', frontal: 'Cartwheel, sideways lean', transverse: 'Twist, pirouette' },
  { id: 'shoulder', label: 'Shoulder', sagittal: 'Flexion and extension', frontal: 'Abduction and adduction', transverse: 'Internal and external rotation; horizontal abduction and adduction' },
  { id: 'elbow', label: 'Elbow', sagittal: 'Flexion and extension', frontal: 'None (a hinge joint)', transverse: 'None at the elbow itself', note: 'Pronation and supination happen at the radioulnar joints, about the long axis of the forearm.' },
  { id: 'wrist', label: 'Wrist', sagittal: 'Flexion and extension', frontal: 'Radial and ulnar deviation', transverse: 'None at the wrist itself' },
  { id: 'hip', label: 'Hip', sagittal: 'Flexion and extension', frontal: 'Abduction and adduction', transverse: 'Internal and external rotation' },
  { id: 'knee', label: 'Knee', sagittal: 'Flexion and extension', frontal: 'Very little (resisted by the collateral ligaments)', transverse: 'A small amount of tibial rotation, available when the knee is flexed' },
  { id: 'ankle', label: 'Ankle', sagittal: 'Dorsiflexion and plantarflexion', frontal: 'Inversion and eversion', transverse: 'Small amounts of abduction and adduction of the foot', note: 'Inversion and eversion occur mainly at the subtalar joint, below the ankle joint proper.' },
  { id: 'trunk', label: 'Trunk (spine)', sagittal: 'Flexion and extension', frontal: 'Lateral flexion', transverse: 'Rotation' },
];

const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const mul = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a: V3): V3 | null => {
  const n = Math.hypot(a.x, a.y, a.z);
  return n > 1e-9 ? mul(a, 1 / n) : null;
};

/** Builds an orthonormal frame from a left-pointing vector and an up vector. */
function makeFrame(left: V3, upRaw: V3, mirrored: boolean, source: BodyFrame['source']): BodyFrame | null {
  const up = norm(upRaw);
  if (!up) return null;
  const ml = norm(sub(left, mul(up, dot(left, up))));
  if (!ml) return null;
  // With x right, y down, z away, left x up points forward for a true (unmirrored) image.
  const ap = mul(cross(ml, up), mirrored ? -1 : 1);
  return { ml, ap, up, source };
}

/**
 * Body frame from the model's 3D landmarks.
 * 'heading': the longitudinal axis is the true vertical and only the direction the body faces is taken
 * from the pose (stable; right for upright activities). 'trunk': the frame tilts with the trunk
 * (right for lying or inverted positions).
 */
export function bodyFrame(world: Lm[] | null, mirrored: boolean, mode: FrameMode, minVis = 0.3): BodyFrame | null {
  if (!world) return null;
  const [ls, rs, lh, rh] = [world[L.l_shoulder], world[L.r_shoulder], world[L.l_hip], world[L.r_hip]];
  if (Math.min(ls.v, rs.v, lh.v, rh.v) < minVis) return null;
  const left = add(sub(ls, rs), sub(lh, rh));
  const up = mode === 'trunk' ? sub(mul(add(ls, rs), 0.5), mul(add(lh, rh), 0.5)) : { x: 0, y: -1, z: 0 };
  return makeFrame(left, up, mirrored, 'model');
}

/** Square-on fallback from the 2D picture: `lateral` side views face image right (+1) or left (-1). */
export function frameFromView(view: 'anterior' | 'posterior' | 'lateral', facing: 1 | -1, leftIsImageRight: boolean, mirrored: boolean): BodyFrame {
  const up = { x: 0, y: -1, z: 0 };
  const left = view === 'lateral' ? { x: 0, y: 0, z: facing * (mirrored ? -1 : 1) } : { x: leftIsImageRight ? 1 : -1, y: 0, z: 0 };
  return makeFrame(left, up, mirrored, 'view')!;
}

/**
 * In a side view the two shoulders nearly overlap, so the sign of their depth difference (which decides
 * front from back) is unreliable. The feet and face show the facing direction much more clearly in the
 * picture, so when the two disagree the picture wins. `facing`: +1 if the subject faces image right.
 */
export function alignFacing(f: BodyFrame, facing: 1 | -1): BodyFrame {
  if (Math.abs(f.ap.x) < 0.5 || Math.sign(f.ap.x) === facing) return f;
  return { ...f, ml: mul(f.ml, -1), ap: mul(f.ap, -1) };
}

/** Angle (deg) between the body's mediolateral axis and the picture plane: 0 = front or back view, 90 = side view. */
export function headingAngle(f: BodyFrame): number {
  return (Math.atan2(Math.abs(f.ml.z), Math.hypot(f.ml.x, f.ml.y)) * 180) / Math.PI;
}

/** The plane the camera is looking at most squarely, and how far (deg) the view is from square-on to it. */
export function facingPlane(f: BodyFrame): { plane: PlaneId; offDeg: number } {
  const c: [PlaneId, number][] = [['sagittal', Math.abs(f.ml.z)], ['frontal', Math.abs(f.ap.z)], ['transverse', Math.abs(f.up.z)]];
  c.sort((a, b) => b[1] - a[1]);
  return { plane: c[0][0], offDeg: (Math.acos(Math.min(1, c[0][1])) * 180) / Math.PI };
}

/** The normal of a plane (which is also the axis of rotation for motion in that plane) and two vectors spanning it. */
export function planeBasis(f: BodyFrame, plane: PlaneId): { normal: V3; u: V3; v: V3 } {
  if (plane === 'sagittal') return { normal: f.ml, u: f.ap, v: f.up };
  if (plane === 'frontal') return { normal: f.ap, u: f.ml, v: f.up };
  return { normal: f.up, u: f.ml, v: f.ap };
}

const SNAP_IN = 10, SNAP_OUT = 16;

/** Rotates the frame about its longitudinal axis so the body is exactly square-on (front/back or side). */
function snapped(f: BodyFrame, toSide: boolean, mirrored: boolean): BodyFrame {
  // Remove (front view) or isolate (side view) the depth component of the mediolateral axis.
  const horiz = norm(cross(f.up, { x: 0, y: 0, z: 1 })) ?? { x: 1, y: 0, z: 0 };
  const depth = norm(cross(horiz, f.up)) ?? { x: 0, y: 0, z: 1 };
  const target = toSide ? mul(depth, Math.sign(dot(f.ml, depth)) || 1) : mul(horiz, Math.sign(dot(f.ml, horiz)) || 1);
  return makeFrame(target, f.up, mirrored, f.source) ?? f;
}

/** Smooths the body frame over time and holds it square-on while the heading is near a cardinal view. */
export class FrameSmoother {
  private f = Array.from({ length: 6 }, () => new OneEuro({ minCutoff: 0.6, beta: 0.02, dCutoff: 1 }));
  private snap: 'front' | 'side' | null = null;

  reset(): void {
    this.f.forEach((x) => x.reset());
    this.snap = null;
  }

  update(raw: BodyFrame | null, t: number, mirrored: boolean): BodyFrame | null {
    if (!raw) return null;
    const v = [raw.ml.x, raw.ml.y, raw.ml.z, raw.up.x, raw.up.y, raw.up.z].map((c, i) => this.f[i].filter(c, t));
    const sm = makeFrame({ x: v[0], y: v[1], z: v[2] }, { x: v[3], y: v[4], z: v[5] }, mirrored, raw.source);
    if (!sm) return raw;
    const a = headingAngle(sm);
    if (this.snap === 'front' ? a > SNAP_OUT : this.snap === 'side' ? a < 90 - SNAP_OUT : true) this.snap = a < SNAP_IN ? 'front' : a > 90 - SNAP_IN ? 'side' : null;
    return this.snap ? snapped(sm, this.snap === 'side', mirrored) : sm;
  }
}
