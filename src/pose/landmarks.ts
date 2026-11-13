// Landmark topology of the MediaPipe Pose Landmarker (BlazePose, 33 keypoints).
import type { Lm } from '../types';

export const LANDMARK_NAMES = [
  'nose', 'l_eye_inner', 'l_eye', 'l_eye_outer', 'r_eye_inner', 'r_eye', 'r_eye_outer', 'l_ear', 'r_ear',
  'mouth_l', 'mouth_r', 'l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow', 'l_wrist', 'r_wrist',
  'l_pinky', 'r_pinky', 'l_index', 'r_index', 'l_thumb', 'r_thumb', 'l_hip', 'r_hip', 'l_knee', 'r_knee',
  'l_ankle', 'r_ankle', 'l_heel', 'r_heel', 'l_toe', 'r_toe',
] as const;

export type LandmarkName = (typeof LANDMARK_NAMES)[number];
/** Points that can be measured: model landmarks plus derived points. */
export type PointId = LandmarkName | 'mid_shoulder' | 'mid_hip' | 'mid_ear' | 'com';

export const L: Record<LandmarkName, number> = Object.fromEntries(LANDMARK_NAMES.map((n, i) => [n, i])) as Record<LandmarkName, number>;

export const POINT_LABELS: Record<PointId, string> = {
  nose: 'Nose', l_eye_inner: 'Left eye (inner)', l_eye: 'Left eye', l_eye_outer: 'Left eye (outer)',
  r_eye_inner: 'Right eye (inner)', r_eye: 'Right eye', r_eye_outer: 'Right eye (outer)',
  l_ear: 'Left ear', r_ear: 'Right ear', mouth_l: 'Mouth (left)', mouth_r: 'Mouth (right)',
  l_shoulder: 'Left shoulder', r_shoulder: 'Right shoulder', l_elbow: 'Left elbow', r_elbow: 'Right elbow',
  l_wrist: 'Left wrist', r_wrist: 'Right wrist', l_pinky: 'Left pinky', r_pinky: 'Right pinky',
  l_index: 'Left index', r_index: 'Right index', l_thumb: 'Left thumb', r_thumb: 'Right thumb',
  l_hip: 'Left hip', r_hip: 'Right hip', l_knee: 'Left knee', r_knee: 'Right knee',
  l_ankle: 'Left ankle', r_ankle: 'Right ankle', l_heel: 'Left heel', r_heel: 'Right heel',
  l_toe: 'Left toe', r_toe: 'Right toe',
  mid_shoulder: 'Mid-shoulder', mid_hip: 'Mid-hip', mid_ear: 'Head (mid-ear)', com: 'Centre of mass (estimate)',
};

/** Points offered for linear kinematics, in menu order. */
export const TRACKABLE_POINTS: PointId[] = [
  'com', 'mid_hip', 'mid_shoulder', 'nose',
  'l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow', 'l_wrist', 'r_wrist',
  'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_ankle', 'r_ankle', 'l_heel', 'r_heel', 'l_toe', 'r_toe',
];

/** Stick-figure bones as landmark-name pairs. */
export const SKELETON: [LandmarkName, LandmarkName][] = [
  ['l_shoulder', 'r_shoulder'], ['l_hip', 'r_hip'], ['l_shoulder', 'l_hip'], ['r_shoulder', 'r_hip'],
  ['l_shoulder', 'l_elbow'], ['l_elbow', 'l_wrist'], ['r_shoulder', 'r_elbow'], ['r_elbow', 'r_wrist'],
  ['l_hip', 'l_knee'], ['l_knee', 'l_ankle'], ['r_hip', 'r_knee'], ['r_knee', 'r_ankle'],
  ['l_ankle', 'l_heel'], ['l_heel', 'l_toe'], ['l_ankle', 'l_toe'],
  ['r_ankle', 'r_heel'], ['r_heel', 'r_toe'], ['r_ankle', 'r_toe'],
  ['l_wrist', 'l_index'], ['r_wrist', 'r_index'], ['l_ear', 'r_ear'],
];

export const sideOf = (name: string): 'l' | 'r' | 'c' => (name.startsWith('l_') ? 'l' : name.startsWith('r_') ? 'r' : 'c');

const mid = (a: Lm, b: Lm): Lm => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2, v: Math.min(a.v, b.v) });

/**
 * Resolves a point from a landmark set. `com` is supplied by the caller (it depends on the body model).
 * Returns null when the point (or a landmark it depends on) is below the visibility threshold.
 */
export function getPoint(lm: Lm[] | null, id: PointId, minVis: number, com?: Lm | null): Lm | null {
  if (!lm) return null;
  let p: Lm | null;
  switch (id) {
    case 'mid_shoulder': p = mid(lm[L.l_shoulder], lm[L.r_shoulder]); break;
    case 'mid_hip': p = mid(lm[L.l_hip], lm[L.r_hip]); break;
    case 'mid_ear': p = mid(lm[L.l_ear], lm[L.r_ear]); break;
    case 'com': p = com ?? null; break;
    default: p = lm[L[id]];
  }
  return p && p.v >= minVis && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
}
