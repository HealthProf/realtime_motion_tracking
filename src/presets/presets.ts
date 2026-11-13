// Activity presets are plain data: adding one needs no code changes elsewhere.
import type { PointId } from '../pose/landmarks';

export type SideMode = 'auto' | 'left' | 'right' | 'both';

export interface Preset {
  id: string;
  label: string;
  view: 'sagittal' | 'frontal' | null;
  /** Joint names without a side prefix (resolved against the chosen side), or full ids such as trunk_lean. */
  joints: string[];
  /** Points without side prefix are resolved the same way. */
  points: string[];
  /** Joint used for repetition detection (unsided), if any. */
  repJoint: string | null;
  analysis: ('reps' | 'jump' | 'symmetry')[];
  /** Suggested low-pass cutoff (Hz) for typical performances of this activity. */
  cutoff: number;
  guidance: string;
}

export const PRESETS: Preset[] = [
  {
    id: 'free', label: 'Free analysis', view: null, joints: ['knee', 'hip', 'elbow', 'shoulder'], points: ['com'], repJoint: null, analysis: [], cutoff: 6,
    guidance: 'Choose any angles and points below. Keep the movement in one plane, perpendicular to the camera.',
  },
  {
    id: 'squat', label: 'Squat', view: 'sagittal', joints: ['knee', 'hip', 'ankle', 'trunk_lean'], points: ['com', 'hip'], repJoint: 'knee', analysis: ['reps'], cutoff: 6,
    guidance: 'Side view, camera at hip height and level, 3 to 4 m away. Keep the whole body in view at the bottom of the squat. Hold the arms forward so they do not hide the hip.',
  },
  {
    id: 'sit-to-stand', label: 'Sit-to-stand', view: 'sagittal', joints: ['knee', 'hip', 'trunk_lean'], points: ['com', 'shoulder'], repJoint: 'knee', analysis: ['reps'], cutoff: 6,
    guidance: 'Side view with an armless chair. Fold the arms across the chest. The chair will hide part of the pelvis, so expect lower hip confidence while seated.',
  },
  {
    id: 'jump', label: 'Vertical jump', view: 'sagittal', joints: ['knee', 'hip', 'ankle'], points: ['com', 'toe'], repJoint: null, analysis: ['jump'], cutoff: 10,
    guidance: 'Side view. Leave headroom for the top of the jump. Use the brightest light available and 60 fps if the camera offers it: flight time is resolved only to one frame. Land with the legs as straight as at take-off.',
  },
  {
    id: 'gait', label: 'Walking gait', view: 'sagittal', joints: ['hip', 'knee', 'ankle'], points: ['ankle', 'toe'], repJoint: 'knee', analysis: ['reps'], cutoff: 6,
    guidance: 'Side view, camera far enough back to see 2 to 3 strides. Analyse the limb nearest the camera: the far limb is hidden for part of each stride. A treadmill keeps the subject centred.',
  },
  {
    id: 'reach', label: 'Overhead reach (bilateral)', view: 'frontal', joints: ['shoulder', 'elbow'], points: ['wrist'], repJoint: 'shoulder', analysis: ['reps', 'symmetry'], cutoff: 6,
    guidance: 'Front view, facing the camera squarely. Raise both arms out to the side and overhead. Symmetry is reported because both limbs are fully visible in this view.',
  },
];

export const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));

const SIDED_JOINTS = new Set(['knee', 'hip', 'ankle', 'elbow', 'shoulder']);

/** Expands a preset into concrete angle and point ids for the given sides. */
export function resolvePreset(p: Preset, sides: ('l' | 'r')[]): { angles: string[]; points: PointId[] } {
  const angles = p.joints.flatMap((j) => (SIDED_JOINTS.has(j) ? sides.map((s) => `${s}_${j}`) : [j]));
  const points = p.points.flatMap((q) => (q === 'com' || q.startsWith('mid_') || q === 'nose' ? [q] : sides.map((s) => `${s}_${q}`))) as PointId[];
  return { angles, points };
}
