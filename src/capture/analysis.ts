// Per-trial analyses that need no DOM: repetitions, symmetry, jumps, lifting and the mode reports.
// The results panel and the summary export both call these, so they always agree.
import { detectJumps, type JumpResult } from '../analysis/jump';
import { detectReps, rangeOf, symmetryIndex, type Rep } from '../analysis/reps';
import { bodyYaw, classifyView } from '../coach/coach';
import { median } from '../kinematics/series';
import { analyseLift, type LiftAnalysis } from '../lift/metrics';
import { ANGLE_BY_ID } from '../measure/definitions';
import { bikeFrontReport, bikeSideReport, type ModeInputs } from '../modes/bike';
import type { ModeReport } from '../modes/report';
import { runBackReport, runSideReport } from '../modes/run';
import { L } from '../pose/landmarks';
import { PRESET_BY_ID } from '../presets/presets';
import { processTrial, type Processed, type ProcessOptions } from './process';
import type { Trial } from './trial';

export function trialView(trial: Trial): ReturnType<typeof classifyView> {
  return classifyView(median(trial.frames.map((fr) => bodyYaw(fr.world))));
}

export interface RepsResult {
  /** Id of the angle the repetitions were detected on, e.g. `l_knee`. */
  angleId: string;
  reps: Rep[];
}

/** Repetitions on the preset's rep joint (or the first joint angle). Null when no joint angle is selected. */
export function repsFor(p: Processed, o: ProcessOptions, presetId: string): RepsResult | null {
  const preset = PRESET_BY_ID.get(presetId);
  const jointAngles = o.angles.filter((id) => ANGLE_BY_ID.get(id)?.kind === 'joint');
  const angleId = (preset?.repJoint && jointAngles.find((a) => a.endsWith(`_${preset.repJoint}`))) || jointAngles[0];
  if (!angleId) return null;
  return { angleId, reps: detectReps(p.col.get(`${angleId}_deg`)!, p.col.get(`${angleId}_vel_deg_s`)!, p.fs, 15) };
}

/** Symmetry index (%) of the range of motion of an angle against its opposite side; NaN unless the view is frontal. */
export function rangeSymmetryFor(p: Processed, trial: Trial, angleId: string): number {
  if (!/^[lr]_/.test(angleId) || trialView(trial) !== 'frontal') return NaN;
  const other = `${angleId[0] === 'l' ? 'r' : 'l'}_${angleId.slice(2)}`;
  const a = p.col.get(`${angleId}_deg`), b = p.col.get(`${other}_deg`);
  if (!a || !b) return NaN;
  const left = angleId[0] === 'l' ? a : b, right = angleId[0] === 'l' ? b : a;
  return symmetryIndex(rangeOf(left).rom, rangeOf(right).rom);
}

export interface JumpAnalysis {
  jumps: JumpResult[];
  /** Sample rate of the series the jumps were detected on, Hz. */
  fs: number;
}

export function jumpsFor(trial: Trial, o: ProcessOptions): JumpAnalysis {
  const jp = processTrial(trial, { ...o, angles: [], points: ['l_toe', 'r_toe', 'com'], include3d: false });
  const u = jp.lengthUnit;
  const lt = jp.col.get(`l_toe_y_${u}_raw`)!, rt = jp.col.get(`r_toe_y_${u}_raw`)!;
  const foot = lt.map((v, i) => (Number.isFinite(v) && Number.isFinite(rt[i]) ? Math.min(v, rt[i]) : Number.isFinite(v) ? v : rt[i]));
  const shank = median(trial.frames.map((fr) => (fr.lm ? Math.hypot(fr.lm[L.l_knee].x - fr.lm[L.l_ankle].x, fr.lm[L.l_knee].y - fr.lm[L.l_ankle].y) : NaN)));
  const threshold = u === 'm' ? 0.02 : 0.05 * shank;
  return { jumps: detectJumps(jp.t, foot, threshold, jp.col.get(`com_y_${u}`), u === 'm'), fs: jp.fs };
}

/** An analysis, or the reason there is none (null reason: nothing to say). */
export interface Outcome<T> {
  value: T | null;
  problem: string | null;
}

export function liftFor(trial: Trial, p: Processed): Outcome<LiftAnalysis> {
  const lm = trial.meta.lift, u = p.lengthUnit;
  const by = p.col.get(`bar_y_${u}`), bx = p.col.get(`bar_x_${u}`);
  if (!lm && !by) return { value: null, problem: null };
  if (!by || !bx) return { value: null, problem: 'Weight lifting report not produced: the bar was not located in this trial.' };
  if (u !== 'm') return { value: null, problem: 'Weight lifting report not produced: the trial was not calibrated, so velocity, force, work and power cannot be given in real units.' };
  if (!lm || !(lm.loadKg > 0)) return { value: null, problem: 'Weight lifting report not produced: no load was entered for this trial.' };
  const sysY = p.col.get('system_com_y_m');
  const system = sysY && lm.bodyMassKg ? { y: sysY, massKg: lm.bodyMassKg + lm.loadKg } : null;
  return { value: analyseLift({ fs: p.fs, x: bx, y: by, massKg: lm.loadKg, system }), problem: null };
}

export function modeReportFor(trial: Trial, inp: ModeInputs): Outcome<ModeReport> {
  const preset = PRESET_BY_ID.get(trial.meta.preset);
  const mode = preset?.analysis.includes('bike') ? 'bike' : preset?.analysis.includes('run') ? 'run' : null;
  if (!mode) return { value: null, problem: null };
  const view = trialView(trial);
  if (view !== 'sagittal' && view !== 'frontal') {
    return { value: null, problem: `The ${mode === 'bike' ? 'bike fit' : 'running'} report was not produced: the camera view was ${view === 'oblique' ? 'oblique' : 'not recognisable'}. Record square-on from the side, or directly from the ${mode === 'bike' ? 'front' : 'back'}.` };
  }
  try {
    const r = mode === 'bike' ? (view === 'sagittal' ? bikeSideReport(trial, inp) : bikeFrontReport(trial, inp)) : view === 'sagittal' ? runSideReport(trial, inp) : runBackReport(trial, inp);
    return { value: r, problem: null };
  } catch (err) {
    return { value: null, problem: (err as Error).message };
  }
}
