// A trial is the raw record of one capture: unfiltered landmarks with measured timestamps, plus
// everything needed to reproduce the analysis later.
import type { Calibration } from '../kinematics/calibration';
import type { Lm, ModelTier, PoseFrame, TimestampSource } from '../types';
import type { BodyModel } from '../analysis/com';

export interface TrialMeta {
  appVersion: string;
  startedAt: string;
  source: 'camera' | 'synthetic' | 'video';
  cameraLabel: string;
  nominalFps: number;
  timestampSource: TimestampSource;
  model: ModelTier | 'synthetic';
  delegate: string;
  mirrored: boolean;
  width: number;
  height: number;
  calibration: Calibration;
  bodyModel: BodyModel;
  preset: string;
  notes: string;
  /** Video files only: how many times slower than real life the footage plays (1 = normal speed). Times are already corrected. */
  slowMotion?: number;
  /** Weight lifting mode: what was typed in for this trial. */
  lift?: LiftMeta;
}

export interface LiftMeta {
  lift: string;
  /** Total load on the bar including the bar, kg. */
  loadKg: number;
  /** Lifter body mass in kg, if given (enables the system centre-of-mass estimates). */
  bodyMassKg?: number;
}

export interface Mark {
  /** Seconds from trial start. */
  t: number;
  label: string;
}

export interface Trial {
  meta: TrialMeta;
  /** Frame times are seconds from trial start. */
  frames: PoseFrame[];
  marks: Mark[];
}

const q = (v: number, step: number) => Math.round(v / step) * step;
const qlm = (p: Lm, step: number): Lm => ({ x: q(p.x, step), y: q(p.y, step), z: q(p.z, step), v: q(p.v, 1e-3) });

/**
 * Quantises a frame for storage (1e-3 px, 1e-5 m, 1 microsecond). This is orders of magnitude below
 * keypoint noise and makes session files round-trip exactly.
 */
export function storeFrame(f: PoseFrame, t0: number): PoseFrame {
  return {
    t: q(f.t - t0, 1e-6),
    w: f.w,
    h: f.h,
    lm: f.lm ? f.lm.map((p) => qlm(p, 1e-3)) : null,
    world: f.world ? f.world.map((p) => qlm(p, 1e-5)) : null,
    ...(f.bar ? { bar: { x: q(f.bar.x, 1e-3), y: q(f.bar.y, 1e-3), r: q(f.bar.r, 1e-3), src: f.bar.src } } : {}),
  };
}

export class TrialRecorder {
  private t0 = NaN;
  trial: Trial | null = null;
  recording = false;

  start(meta: TrialMeta): void {
    this.trial = { meta, frames: [], marks: [] };
    this.t0 = NaN;
    this.recording = true;
  }

  add(f: PoseFrame): void {
    if (!this.recording || !this.trial) return;
    if (Number.isNaN(this.t0)) this.t0 = f.t;
    this.trial.frames.push(storeFrame(f, this.t0));
  }

  /** Seconds since the first recorded frame. */
  get elapsed(): number {
    const fr = this.trial?.frames;
    return fr && fr.length ? fr[fr.length - 1].t : 0;
  }

  mark(label: string): Mark | null {
    if (!this.recording || !this.trial) return null;
    const m = { t: this.elapsed, label };
    this.trial.marks.push(m);
    return m;
  }

  stop(): Trial | null {
    this.recording = false;
    return this.trial;
  }
}
