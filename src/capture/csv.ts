// CSV and session-file serialisation.
import { ANGLE_BY_ID } from '../measure/definitions';
import { LANDMARK_NAMES } from '../pose/landmarks';
import type { Processed, ProcessOptions } from './process';
import type { Trial } from './trial';

const num = (v: number, digits = 5) => (Number.isFinite(v) ? String(Number(v.toFixed(digits))) : '');
const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function metadataLines(trial: Trial, p: Processed, o: ProcessOptions): string[] {
  const m = trial.meta, c = m.calibration;
  const lines = [
    `Real-Time Motion Tracking v${m.appVersion} - processed kinematics`,
    `recorded: ${m.startedAt}`,
    `source: ${m.source}; camera: ${m.cameraLabel}; frame size: ${m.width}x${m.height}; mirrored: ${m.mirrored}`,
    `pose model: ${m.model} (${m.delegate}); timestamp source: ${m.timestampSource}`,
    `frames: ${p.timing.frames}; duration_s: ${num(p.timing.duration, 3)}; median frame interval_ms: ${num(p.timing.medianInterval * 1000, 2)} (min ${num(p.timing.minInterval * 1000, 2)}, max ${num(p.timing.maxInterval * 1000, 2)}); long intervals: ${p.timing.longIntervals}`,
    `resampled to a uniform ${num(p.fs, 3)} Hz grid by linear interpolation (gaps longer than ${o.maxGap} s left empty)`,
    `filter: zero-phase 4th-order low-pass Butterworth (2nd order, forward and reverse, Winter cutoff correction); cutoff_Hz: ${num(p.cutoff, 2)}`,
    `derivatives: central differences on filtered data; *_raw columns are resampled but unfiltered`,
    `calibration: ${c.method}; scale: ${c.scale} ${c.unit}/px; origin_px: (${num(c.origin.x, 1)}, ${num(c.origin.y, 1)}); axes: x right, y up`,
    `angle convention: ${o.convention}; minimum landmark visibility: ${o.minVisibility}; body model (COM): ${o.bodyModel}; preset: ${m.preset}`,
    ...o.angles.map((id) => ANGLE_BY_ID.get(id)).filter((d) => !!d).map((d) => `angle ${d!.id}: ${d!.note}`),
    ...p.warnings.map((w) => `WARNING: ${w}`),
    'Planar (2D) measurements assume the motion lies in a plane perpendicular to the camera axis. Keypoints are model estimates, not palpated joint centres.',
  ];
  if (m.notes) lines.push(`notes: ${m.notes}`);
  return lines;
}

export function processedCsv(trial: Trial, p: Processed, o: ProcessOptions, withMetadata = true, extraLines: string[] = []): string {
  const marks = new Map<number, string>();
  for (const m of p.markRows) marks.set(m.row, marks.has(m.row) ? `${marks.get(m.row)}; ${m.label}` : m.label);
  const rows: string[] = [];
  if (withMetadata) for (const l of [...metadataLines(trial, p, o), ...extraLines]) rows.push(`# ${l}`);
  rows.push(['time_s', 'mark', ...p.columns.map((c) => c.name)].join(','));
  for (let i = 0; i < p.t.length; i++) {
    rows.push([num(p.t[i], 4), esc(marks.get(i) ?? ''), ...p.columns.map((c) => num(c.data[i]))].join(','));
  }
  return rows.join('\n') + '\n';
}

/** Raw, unfiltered landmarks exactly as recorded (irregular timestamps). */
export function landmarksCsv(trial: Trial): string {
  const head = ['time_s'];
  for (const n of LANDMARK_NAMES) head.push(`${n}_x_px`, `${n}_y_px`, `${n}_visibility`);
  for (const n of LANDMARK_NAMES) head.push(`${n}_wx_m`, `${n}_wy_m`, `${n}_wz_m`);
  const rows = [
    `# Real-Time Motion Tracking v${trial.meta.appVersion} - raw landmarks (unfiltered, measured timestamps)`,
    '# image coordinates: pixels, x right, y DOWN, origin top-left. w* columns: model-estimated 3D position in metres relative to the hip midpoint (experimental).',
    head.join(','),
  ];
  for (const f of trial.frames) {
    const r = [num(f.t, 6)];
    for (let i = 0; i < LANDMARK_NAMES.length; i++) r.push(f.lm ? num(f.lm[i].x, 3) : '', f.lm ? num(f.lm[i].y, 3) : '', f.lm ? num(f.lm[i].v, 3) : '');
    for (let i = 0; i < LANDMARK_NAMES.length; i++) r.push(f.world ? num(f.world[i].x) : '', f.world ? num(f.world[i].y) : '', f.world ? num(f.world[i].z) : '');
    rows.push(r.join(','));
  }
  return rows.join('\n') + '\n';
}

const SESSION_FORMAT = 'realtime-motion-tracking-session';
export const SESSION_VERSION = 1;

export function sessionJson(trial: Trial): string {
  const pack = (l: Trial['frames'][number]['lm']) => (l ? l.map((p) => [p.x, p.y, p.z, p.v]) : null);
  return JSON.stringify({
    format: SESSION_FORMAT,
    version: SESSION_VERSION,
    meta: trial.meta,
    marks: trial.marks,
    frames: trial.frames.map((f) => ({ t: f.t, w: f.w, h: f.h, lm: pack(f.lm), world: pack(f.world) })),
  });
}

export function parseSession(text: string): Trial {
  let d: any;
  try { d = JSON.parse(text); } catch { throw new Error('This file is not valid JSON.'); }
  if (d?.format !== SESSION_FORMAT) throw new Error('This is not a Real-Time Motion Tracking session file.');
  if (d.version > SESSION_VERSION) throw new Error(`This session was saved by a newer version of the app (file version ${d.version}).`);
  if (!Array.isArray(d.frames) || !d.meta?.calibration) throw new Error('The session file is incomplete.');
  const unpack = (l: number[][] | null) => (l ? l.map(([x, y, z, v]) => ({ x, y, z, v })) : null);
  return {
    meta: d.meta,
    marks: Array.isArray(d.marks) ? d.marks : [],
    frames: d.frames.map((f: any) => ({ t: f.t, w: f.w, h: f.h, lm: unpack(f.lm), world: unpack(f.world) })),
  };
}
