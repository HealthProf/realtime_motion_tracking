// Summary export: the computed results of one trial as a small, versioned JSON document.
// Unlike the session file it holds no landmarks. Rules (see schema/summary.v1.schema.json):
//   - missing or withheld values are null, never NaN;
//   - times are seconds from the start of the trial, not row indices;
//   - units are in field names or in a `unit` field beside the value;
//   - exactly one of report / reps / lift / jump is filled, following the preset's analysis list.
import type { JumpResult } from '../analysis/jump';
import type { Rep } from '../analysis/reps';
import type { LiftAnalysis, LiftRep } from '../lift/metrics';
import type { ModeInputs } from '../modes/bike';
import type { MetricRow, ModeReport, Reference, Status } from '../modes/report';
import { PRESET_BY_ID } from '../presets/presets';
import { jumpsFor, liftFor, modeReportFor, rangeSymmetryFor, repsFor, trialView, type JumpAnalysis, type RepsResult } from './analysis';
import type { Processed, ProcessOptions } from './process';
import type { Trial } from './trial';

export const SUMMARY_FORMAT = 'realtime-motion-tracking-summary';
export const SUMMARY_VERSION = 1;

/** Opaque text from the link that opened the app. Copied through and never interpreted. */
export interface SummaryContext {
  ref?: string;
  subject?: string;
  note?: string;
}

export interface SummaryReference {
  id: string;
  unit: string;
  low: number | null;
  high: number | null;
  basis: string;
  citation: string;
  doi: string;
}

export interface SummaryRow {
  id: string;
  label: string;
  unit: string;
  mean: number | null;
  sd: number | null;
  n: number;
  band: number | null;
  status: Status;
  ref: SummaryReference | null;
  note: string | null;
}

export interface SummaryReport {
  mode: 'bike' | 'run';
  view: 'side' | 'front-back';
  cycles: number;
  rows: SummaryRow[];
  caveats: string[];
}

export interface SummaryRep {
  n: number;
  start_s: number | null;
  peak_s: number | null;
  end_s: number | null;
  start_value: number | null;
  peak_value: number | null;
  rom: number | null;
  duration_s: number | null;
  peak_velocity: number | null;
}

export interface SummaryReps {
  joint: string | null;
  side: 'left' | 'right' | null;
  unit: 'deg';
  velocity_unit: 'deg/s';
  items: SummaryRep[];
  symmetry_index_pct: number | null;
}

export interface SummaryLiftRep {
  n: number;
  start_s: number | null;
  end_s: number | null;
  rom_m: number | null;
  duration_s: number | null;
  mean_velocity_ms: number | null;
  peak_velocity_ms: number | null;
  mean_propulsive_velocity_ms: number | null;
  time_to_peak_velocity_s: number | null;
  peak_acceleration_ms2: number | null;
  mean_force_n: number | null;
  peak_force_n: number | null;
  work_j: number | null;
  mean_power_w: number | null;
  peak_power_w: number | null;
  path_deviation_m: number | null;
  lowering_time_s: number | null;
  system_work_j: number | null;
  system_mean_power_w: number | null;
  system_peak_power_w: number | null;
  bar_source: 'plate' | 'hands' | null;
}

export interface SummaryLift {
  lift: string;
  load_kg: number | null;
  body_mass_kg: number | null;
  reps: SummaryLiftRep[];
  warnings: string[];
}

export interface SummaryJumpItem {
  n: number;
  takeoff_s: number | null;
  landing_s: number | null;
  flight_time_s: number | null;
  height_flight_m: number | null;
  height_resolution_m: number | null;
  height_com_m: number | null;
}

export interface SummaryJump {
  jumps: SummaryJumpItem[];
}

export interface SummaryCapture {
  source: 'camera' | 'synthetic' | 'video';
  model: string;
  nominal_fps: number | null;
  sample_rate_hz: number | null;
  view: 'side' | 'front' | 'oblique' | 'unknown';
  side: 'left' | 'right' | 'both' | null;
  mirrored: boolean;
  calibration: { method: string; unit: 'm' | 'px'; scale: number | null };
  cutoff_hz: number | null;
  min_visibility: number | null;
  angle_convention: string;
  warnings: string[];
}

export interface SummaryInputs {
  inseam_cm: number | null;
  saddle_cm: number | null;
  speed_kmh: number | null;
}

export interface Summary {
  format: typeof SUMMARY_FORMAT;
  version: typeof SUMMARY_VERSION;
  app_version: string;
  trial_id: string;
  recorded_at: string | null;
  duration_s: number | null;
  preset: string;
  context: SummaryContext | null;
  capture: SummaryCapture;
  inputs: SummaryInputs;
  report: SummaryReport | null;
  reps: SummaryReps | null;
  lift: SummaryLift | null;
  jump: SummaryJump | null;
}

/** The analyses behind a summary. Build it with `summaryResultsFor`, or assemble it from existing results. */
export interface SummaryResults {
  processed: Processed;
  opts: ProcessOptions;
  inputs: ModeInputs;
  report: ModeReport | null;
  reps: (RepsResult & { symmetryPct: number }) | null;
  lift: LiftAnalysis | null;
  jump: JumpAnalysis | null;
  /** Reasons an expected analysis is missing, added to `capture.warnings`. */
  problems: string[];
  context: SummaryContext | null;
}

type AnalysisKind = 'bike' | 'run' | 'lift' | 'jump' | 'reps';
const KIND_ORDER: AnalysisKind[] = ['bike', 'run', 'lift', 'jump', 'reps'];

/** Missing, NaN and infinite values become null; the rest keep 7 significant digits. */
export function num(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Number(v.toPrecision(7)) : null;
}

/** Seconds from the start of the trial for a row of the processed series. */
export function seconds(p: Processed, row: number): number | null {
  return num(p.t[row]);
}

const positive = (v: number | undefined): number | null => (typeof v === 'number' && v > 0 ? num(v) : null);

function refOf(r: Reference | undefined): SummaryReference | null {
  return r ? { id: r.id, unit: r.unit, low: num(r.low), high: num(r.high), basis: r.basis, citation: r.citation, doi: r.doi } : null;
}

function rowOf(m: MetricRow): SummaryRow {
  return { id: m.id, label: m.label, unit: m.unit, mean: num(m.mean), sd: num(m.sd), n: m.n, band: num(m.band), status: m.status, ref: refOf(m.ref), note: m.note ?? null };
}

function reportOf(r: ModeReport): SummaryReport {
  return { mode: r.mode, view: r.view, cycles: r.cycles, rows: r.rows.map(rowOf), caveats: [...r.caveats] };
}

function repOf(p: Processed, r: Rep, i: number): SummaryRep {
  return {
    n: i + 1, start_s: seconds(p, r.start), peak_s: seconds(p, r.peak), end_s: seconds(p, r.end), start_value: num(r.startValue), peak_value: num(r.peakValue),
    rom: num(r.rom), duration_s: num(r.duration), peak_velocity: num(r.peakVelocity),
  };
}

function repsOf(p: Processed, r: RepsResult, symmetryPct: number, withSymmetry: boolean): SummaryReps {
  const sided = /^([lr])_(.+)$/.exec(r.angleId);
  return {
    joint: sided ? sided[2] : r.angleId, side: sided ? (sided[1] === 'l' ? 'left' : 'right') : null, unit: 'deg', velocity_unit: 'deg/s',
    items: r.reps.map((x, i) => repOf(p, x, i)), symmetry_index_pct: withSymmetry ? num(symmetryPct) : null,
  };
}

/** The bar position source for a rep: the majority of the bar observations during it (a tie counts as hands). */
export function barSource(trial: Trial, p: Processed, rep: LiftRep): 'plate' | 'hands' | null {
  const t0 = p.t[rep.start], t1 = p.t[rep.end];
  let plate = 0, hands = 0;
  for (const f of trial.frames) {
    if (!f.bar || f.t < t0 || f.t > t1) continue;
    if (f.bar.src === 'plate') plate++; else hands++;
  }
  return plate + hands === 0 ? null : plate > hands ? 'plate' : 'hands';
}

function liftRepOf(trial: Trial, p: Processed, r: LiftRep, i: number): SummaryLiftRep {
  return {
    n: i + 1, start_s: seconds(p, r.start), end_s: seconds(p, r.end), rom_m: num(r.rom), duration_s: num(r.duration),
    mean_velocity_ms: num(r.meanVelocity), peak_velocity_ms: num(r.peakVelocity), mean_propulsive_velocity_ms: num(r.meanPropulsiveVelocity),
    time_to_peak_velocity_s: num(r.timeToPeakVelocity), peak_acceleration_ms2: num(r.peakAcceleration),
    mean_force_n: num(r.meanForce), peak_force_n: num(r.peakForce), work_j: num(r.work), mean_power_w: num(r.meanPower), peak_power_w: num(r.peakPower),
    path_deviation_m: num(r.pathDeviation), lowering_time_s: num(r.loweringTime),
    system_work_j: num(r.systemWork), system_mean_power_w: num(r.systemMeanPower), system_peak_power_w: num(r.systemPeakPower),
    bar_source: barSource(trial, p, r),
  };
}

function liftOf(trial: Trial, p: Processed, a: LiftAnalysis): SummaryLift {
  const m = trial.meta.lift;
  return {
    lift: m?.lift ?? 'other', load_kg: positive(m?.loadKg), body_mass_kg: positive(m?.bodyMassKg),
    reps: a.reps.map((r, i) => liftRepOf(trial, p, r, i)), warnings: [...a.warnings],
  };
}

function jumpOf(j: JumpResult, i: number): SummaryJumpItem {
  return {
    n: i + 1, takeoff_s: num(j.takeoff), landing_s: num(j.landing), flight_time_s: num(j.flightTime),
    height_flight_m: num(j.heightFlight), height_resolution_m: num(j.heightResolution), height_com_m: num(j.heightCom),
  };
}

function viewOf(trial: Trial): SummaryCapture['view'] {
  const v = trialView(trial);
  return v === 'sagittal' ? 'side' : v === 'frontal' ? 'front' : v;
}

function captureOf(trial: Trial, r: SummaryResults, side: SummaryCapture['side']): SummaryCapture {
  const m = trial.meta, c = m.calibration, p = r.processed;
  return {
    source: m.source, model: m.model, nominal_fps: num(m.nominalFps), sample_rate_hz: num(p.fs), view: viewOf(trial), side, mirrored: m.mirrored,
    calibration: { method: c.method, unit: c.unit, scale: num(c.scale) }, cutoff_hz: num(p.cutoff), min_visibility: num(r.opts.minVisibility),
    angle_convention: r.opts.convention, warnings: [...p.warnings, ...r.problems],
  };
}

function recordedAt(trial: Trial): string | null {
  const d = new Date(trial.meta.startedAt);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function inputsOf(i: ModeInputs): SummaryInputs {
  return { inseam_cm: positive(i.inseamCm), saddle_cm: positive(i.saddleCm), speed_kmh: positive(i.speedKmh) };
}

/** Builds the summary document. Pure: it only reads `trial` and `results`. */
export function buildSummary(trial: Trial, results: SummaryResults): Summary {
  const p = results.processed, kind = analysisKind(trial.meta.preset);
  const withSymmetry = !!PRESET_BY_ID.get(trial.meta.preset)?.analysis.includes('symmetry');
  const reps = kind === 'reps' && results.reps ? repsOf(p, results.reps, results.reps.symmetryPct, withSymmetry) : null;
  const report = kind === 'bike' || kind === 'run' ? results.report : null;
  const side = report ? report.side as SummaryCapture['side'] : reps?.side ?? null;
  return {
    format: SUMMARY_FORMAT,
    version: SUMMARY_VERSION,
    app_version: __APP_VERSION__,
    trial_id: trial.id,
    recorded_at: recordedAt(trial),
    duration_s: num(p.timing.duration),
    preset: trial.meta.preset,
    context: results.context ? { ...results.context } : null,
    capture: captureOf(trial, results, side),
    inputs: inputsOf(results.inputs),
    report: report ? reportOf(report) : null,
    reps,
    lift: kind === 'lift' && results.lift ? liftOf(trial, p, results.lift) : null,
    jump: kind === 'jump' && results.jump ? { jumps: results.jump.jumps.map(jumpOf) } : null,
  };
}

export function summaryJson(trial: Trial, results: SummaryResults): string {
  return JSON.stringify(buildSummary(trial, results), null, 2) + '\n';
}

/** Which of the four result blocks a preset fills, or null for presets with no analysis (free analysis). */
export function analysisKind(presetId: string): AnalysisKind | null {
  const list = PRESET_BY_ID.get(presetId)?.analysis ?? [];
  return KIND_ORDER.find((k) => list.includes(k)) ?? null;
}

/** Runs the analysis the trial's preset asks for. `inputs` are the typed measurements; `context` is copied through. */
export function summaryResultsFor(trial: Trial, processed: Processed, opts: ProcessOptions, inputs: ModeInputs, context: SummaryContext | null): SummaryResults {
  const kind = analysisKind(trial.meta.preset);
  const out: SummaryResults = { processed, opts, inputs, report: null, reps: null, lift: null, jump: null, problems: [], context };
  const note = (problem: string | null) => { if (problem) out.problems.push(problem); };
  if (kind === 'bike' || kind === 'run') {
    const r = modeReportFor(trial, inputs);
    out.report = r.value;
    note(r.problem);
  } else if (kind === 'lift') {
    const r = liftFor(trial, processed);
    out.lift = r.value;
    note(r.problem);
  } else if (kind === 'jump') out.jump = jumpsFor(trial, opts);
  else if (kind === 'reps') {
    const found = repsFor(processed, opts, trial.meta.preset);
    out.reps = found && { ...found, symmetryPct: rangeSymmetryFor(processed, trial, found.angleId) };
  }
  return out;
}
