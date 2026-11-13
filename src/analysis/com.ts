// Whole-body centre of mass by the segmental method.
// Parameters: de Leva (1996), J. Biomech. 29(9):1223-1230, Table 4 (mass % of body mass,
// longitudinal CM position % of segment length from the proximal endpoint).
//
// Approximations forced by the pose landmarks (documented for students in docs/methods.md):
//  - Head+neck CM is placed at the mid-ear point (de Leva: 59.76 % / 58.94 % from vertex to mid-gonion).
//  - Trunk uses de Leva's mid-shoulder -> mid-hip definition, with the shoulder/hip keypoints as joint centres.
//  - Hand uses wrist -> index knuckle; foot uses heel -> toe keypoints.
//  - A limb segment that is not visible is replaced by its contralateral segment (reasonable only for
//    symmetric postures or sagittal views); the result is flagged `mirrored`.
import type { Lm } from '../types';
import { L, type LandmarkName } from '../pose/landmarks';

export type BodyModel = 'male' | 'female' | 'average';

interface Seg {
  name: string;
  prox: LandmarkName | 'mid_shoulder';
  dist: LandmarkName | 'mid_hip';
  mass: { male: number; female: number };
  cm: { male: number; female: number };
}

const limb = (side: 'l' | 'r'): Seg[] => [
  { name: `${side}_upper_arm`, prox: `${side}_shoulder`, dist: `${side}_elbow`, mass: { male: 2.71, female: 2.55 }, cm: { male: 57.72, female: 57.54 } },
  { name: `${side}_forearm`, prox: `${side}_elbow`, dist: `${side}_wrist`, mass: { male: 1.62, female: 1.38 }, cm: { male: 45.74, female: 45.59 } },
  { name: `${side}_hand`, prox: `${side}_wrist`, dist: `${side}_index`, mass: { male: 0.61, female: 0.56 }, cm: { male: 79.0, female: 74.74 } },
  { name: `${side}_thigh`, prox: `${side}_hip`, dist: `${side}_knee`, mass: { male: 14.16, female: 14.78 }, cm: { male: 40.95, female: 36.12 } },
  { name: `${side}_shank`, prox: `${side}_knee`, dist: `${side}_ankle`, mass: { male: 4.33, female: 4.81 }, cm: { male: 43.95, female: 43.52 } },
  { name: `${side}_foot`, prox: `${side}_heel`, dist: `${side}_toe`, mass: { male: 1.37, female: 1.29 }, cm: { male: 44.15, female: 40.14 } },
];

export const HEAD_MASS = { male: 6.94, female: 6.68 };
export const TRUNK: Seg = { name: 'trunk', prox: 'mid_shoulder', dist: 'mid_hip', mass: { male: 43.46, female: 42.57 }, cm: { male: 43.1, female: 37.82 } };
export const LIMB_SEGMENTS = { l: limb('l'), r: limb('r') };

const pick = (v: { male: number; female: number }, m: BodyModel) => (m === 'average' ? (v.male + v.female) / 2 : v[m]);

export interface ComResult {
  com: Lm;
  /** True when at least one hidden limb segment was replaced by the opposite side. */
  mirrored: boolean;
}

/** Centre of mass in the same coordinates as the landmarks. Returns null if the head or trunk is not visible. */
export function centreOfMass(lm: Lm[] | null, model: BodyModel, minVis: number): ComResult | null {
  if (!lm) return null;
  const ok = (n: LandmarkName) => lm[L[n]].v >= minVis;
  const get = (n: LandmarkName | 'mid_shoulder' | 'mid_hip') => {
    if (n === 'mid_shoulder' || n === 'mid_hip') {
      const a = lm[n === 'mid_shoulder' ? L.l_shoulder : L.l_hip];
      const b = lm[n === 'mid_shoulder' ? L.r_shoulder : L.r_hip];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    }
    return lm[L[n]];
  };
  if (!ok('l_shoulder') || !ok('r_shoulder') || !ok('l_hip') || !ok('r_hip')) return null;
  const earL = ok('l_ear'), earR = ok('r_ear');
  if (!earL && !earR) return null;

  let sx = 0, sy = 0, sz = 0, sm = 0, vmin = 1;
  const addPoint = (p: { x: number; y: number; z: number }, m: number) => { sx += p.x * m; sy += p.y * m; sz += p.z * m; sm += m; };
  const addSeg = (s: Seg, from: Seg = s) => {
    const a = get(from.prox), b = get(from.dist), f = pick(s.cm, model) / 100;
    addPoint({ x: a.x + f * (b.x - a.x), y: a.y + f * (b.y - a.y), z: a.z + f * (b.z - a.z) }, pick(s.mass, model));
  };

  const head = earL && earR ? { x: (lm[L.l_ear].x + lm[L.r_ear].x) / 2, y: (lm[L.l_ear].y + lm[L.r_ear].y) / 2, z: (lm[L.l_ear].z + lm[L.r_ear].z) / 2 } : lm[earL ? L.l_ear : L.r_ear];
  addPoint(head, pick(HEAD_MASS, model));
  addSeg(TRUNK);

  let mirrored = false;
  for (let i = 0; i < LIMB_SEGMENTS.l.length; i++) {
    const pair = { l: LIMB_SEGMENTS.l[i], r: LIMB_SEGMENTS.r[i] };
    const vis = { l: ok(pair.l.prox as LandmarkName) && ok(pair.l.dist as LandmarkName), r: ok(pair.r.prox as LandmarkName) && ok(pair.r.dist as LandmarkName) };
    if (!vis.l && !vis.r) return null;
    for (const side of ['l', 'r'] as const) {
      const other = side === 'l' ? 'r' : 'l';
      if (vis[side]) addSeg(pair[side]);
      else { addSeg(pair[side], pair[other]); mirrored = true; }
    }
  }
  for (const n of ['l_shoulder', 'r_shoulder', 'l_hip', 'r_hip'] as const) vmin = Math.min(vmin, lm[L[n]].v);
  return { com: { x: sx / sm, y: sy / sm, z: sz / sm, v: vmin }, mirrored };
}
