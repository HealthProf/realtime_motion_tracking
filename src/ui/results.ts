// Trial results: processing, summary tables, plots, repetition / symmetry / jump analysis,
// the filtering teaching tool, and exports.
import { detectJumps } from '../analysis/jump';
import { detectReps, peakAbs, rangeOf, symmetryIndex, type Rep } from '../analysis/reps';
import { residualAnalysis } from '../analysis/residual';
import { landmarksCsv, processedCsv, sessionJson } from '../capture/csv';
import { download, stamp, textBlob } from '../capture/media';
import { processTrial, type Processed, type ProcessOptions } from '../capture/process';
import type { Trial } from '../capture/trial';
import { bodyYaw, classifyView } from '../coach/coach';
import { filtfiltGaps } from '../kinematics/butterworth';
import { derivative, median, secondDerivative } from '../kinematics/series';
import { ANGLE_BY_ID } from '../measure/definitions';
import { L, POINT_LABELS, type PointId } from '../pose/landmarks';
import { bikeFrontReport, bikeSideReport, type ModeInputs } from '../modes/bike';
import { reportCsv, STATUS_TEXT, type ModeReport } from '../modes/report';
import { runBackReport, runSideReport } from '../modes/run';
import { PRESET_BY_ID } from '../presets/presets';
import { drawChart, legendHtml, PALETTE, type Series } from '../render/chart';
import { $, esc, f, say, settings } from '../state';

interface Current {
  trial: Trial;
  video: Blob | null;
  videoExt: string;
  processed: Processed;
  opts: ProcessOptions;
  reps: Rep[];
  name: string;
}
let cur: Current | null = null;
let modeReport: ModeReport | null = null;
/** Last report per mode and view, for the adjust-and-re-measure comparison. */
const previousReports = new Map<string, { report: ModeReport; trialName: string }>();

const options = (): ProcessOptions => ({
  cutoff: settings.cutoff, angles: settings.angles.slice(), points: settings.points.slice(), convention: settings.convention,
  minVisibility: settings.minVisibility, bodyModel: settings.bodyModel, maxGap: settings.maxGap, include3d: settings.include3d,
});

export const hasTrial = () => !!cur;

export function showTrial(trial: Trial, video: Blob | null, videoExt: string): void {
  try {
    const opts = options();
    cur = { trial, video, videoExt, processed: processTrial(trial, opts), opts, reps: [], name: `trial-${stamp(new Date(trial.meta.startedAt))}` };
  } catch (err) {
    say((err as Error).message);
    return;
  }
  $<HTMLTextAreaElement>('notes').value = trial.meta.notes;
  $('results').hidden = false;
  $('teach').hidden = false;
  $<HTMLButtonElement>('btn-video-dl').hidden = !video;
  renderAll();
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  say(`Trial processed: ${cur.processed.t.length} samples at ${f(cur.processed.fs)} Hz.`);
}

/** Re-runs processing with the current settings (measurement selection, cutoff, convention). */
export function reprocess(): void {
  if (!cur) return;
  try {
    cur.opts = options();
    cur.processed = processTrial(cur.trial, cur.opts);
    renderAll();
  } catch (err) {
    say((err as Error).message);
  }
}

const angleLabel = (id: string) => ANGLE_BY_ID.get(id)?.label ?? id;

function seriesOptions(p: Processed, o: ProcessOptions): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  if (o.angles.length) out.push({ value: 'angle', label: 'Angles' }, { value: 'angvel', label: 'Angular velocity' }, { value: 'angacc', label: 'Angular acceleration' });
  if (o.points.length) out.push({ value: 'py', label: 'Point height (y)' }, { value: 'px', label: 'Point horizontal position (x)' }, { value: 'pspeed', label: 'Point speed' }, { value: 'pvy', label: 'Point vertical velocity' }, { value: 'pacc', label: 'Point acceleration (magnitude)' });
  if (o.angles.length >= 2) out.push({ value: 'angle-angle', label: `Angle-angle: ${angleLabel(o.angles[0])} vs ${angleLabel(o.angles[1])}` });
  if (o.include3d && p.columns.some((c) => c.name.endsWith('_3d_experimental'))) out.push({ value: 'angle3d', label: '2D vs estimated 3D angles (experimental)' });
  return out;
}

function renderChart(): void {
  if (!cur) return;
  const { processed: p, opts: o } = cur;
  const mode = $<HTMLSelectElement>('res-series').value;
  const u = p.lengthUnit;
  const series: Series[] = [];
  let yLabel = '', xLabel = 'time (s)';
  const add = (label: string, col: string, dashed = false) => {
    const y = p.col.get(col);
    if (y) series.push({ label, x: p.t, y, color: PALETTE[(dashed ? series.length - 1 : series.length) % PALETTE.length], dashed });
  };
  switch (mode) {
    case 'angle': o.angles.forEach((id) => add(angleLabel(id), `${id}_deg`)); yLabel = 'angle (deg)'; break;
    case 'angvel': o.angles.forEach((id) => add(angleLabel(id), `${id}_vel_deg_s`)); yLabel = 'deg/s'; break;
    case 'angacc': o.angles.forEach((id) => add(angleLabel(id), `${id}_acc_deg_s2`)); yLabel = 'deg/s²'; break;
    case 'py': o.points.forEach((id) => add(POINT_LABELS[id], `${id}_y_${u}`)); yLabel = `y (${u})`; break;
    case 'px': o.points.forEach((id) => add(POINT_LABELS[id], `${id}_x_${u}`)); yLabel = `x (${u})`; break;
    case 'pspeed': o.points.forEach((id) => add(POINT_LABELS[id], `${id}_speed_${u}_s`)); yLabel = `${u}/s`; break;
    case 'pvy': o.points.forEach((id) => add(POINT_LABELS[id], `${id}_vy_${u}_s`)); yLabel = `${u}/s`; break;
    case 'pacc': o.points.forEach((id) => add(POINT_LABELS[id], `${id}_acc_${u}_s2`)); yLabel = `${u}/s²`; break;
    case 'angle3d':
      o.angles.forEach((id) => {
        if (!p.col.has(`${id}_deg_3d_experimental`)) return;
        add(`${angleLabel(id)} (2D)`, `${id}_deg`);
        add(`${angleLabel(id)} (3D estimate)`, `${id}_deg_3d_experimental`, true);
      });
      yLabel = 'angle (deg)';
      break;
    case 'angle-angle': {
      const x = p.col.get(`${o.angles[0]}_deg`)!, y = p.col.get(`${o.angles[1]}_deg`)!;
      series.push({ label: `${angleLabel(o.angles[1])} against ${angleLabel(o.angles[0])}`, x, y, color: PALETTE[0] });
      xLabel = `${angleLabel(o.angles[0])} (deg)`;
      yLabel = `${angleLabel(o.angles[1])} (deg)`;
      break;
    }
  }
  const timePlot = mode !== 'angle-angle';
  const markers = timePlot ? [
    ...p.markRows.map((m) => ({ x: p.t[m.row], label: m.label, color: '#facc15' })),
    ...cur.reps.map((r, i) => ({ x: p.t[r.start], label: `rep ${i + 1}`, color: 'rgba(148,163,184,0.8)' })),
  ] : [];
  drawChart($<HTMLCanvasElement>('res-chart'), series, { xLabel, yLabel, markers });
  $('res-legend').innerHTML = legendHtml(series);
}

function trialView(trial: Trial): ReturnType<typeof classifyView> {
  return classifyView(median(trial.frames.map((fr) => bodyYaw(fr.world))));
}

function renderAll(): void {
  if (!cur) return;
  const { trial, processed: p, opts: o } = cur;
  const u = p.lengthUnit;
  const c = trial.meta.calibration;
  $('res-summary').textContent = `${f(p.timing.duration, 2)} s, ${p.timing.frames} frames, ${f(p.fs)} Hz, cutoff ${f(p.cutoff)} Hz, ${c.unit === 'm' ? `calibrated (${c.method.replace('-', ' ')})` : 'uncalibrated (pixels)'}`;
  $('res-warnings').innerHTML = p.warnings.map((w) => `<li>${esc(w)}</li>`).join('');
  $<HTMLInputElement>('cutoff').value = String(settings.cutoff);

  const sel = $<HTMLSelectElement>('res-series');
  const prev = sel.value;
  const opts = seriesOptions(p, o);
  sel.innerHTML = opts.map((x) => `<option value="${x.value}">${esc(x.label)}</option>`).join('');
  if (opts.some((x) => x.value === prev)) sel.value = prev;

  // Summary table.
  const rows: string[] = [];
  for (const id of o.angles) {
    const r = rangeOf(p.col.get(`${id}_deg`) ?? []);
    rows.push(`<tr><td>${esc(angleLabel(id))} (deg)</td><td>${f(r.min)}</td><td>${f(r.max)}</td><td>${f(r.rom)}</td><td>${f(peakAbs(p.col.get(`${id}_vel_deg_s`) ?? []), 0)} deg/s</td><td>${f(peakAbs(p.col.get(`${id}_acc_deg_s2`) ?? []), 0)} deg/s²</td></tr>`);
  }
  const d = u === 'm' ? 3 : 0;
  for (const id of o.points) {
    const ry = rangeOf(p.col.get(`${id}_y_${u}`) ?? []), rx = rangeOf(p.col.get(`${id}_x_${u}`) ?? []);
    rows.push(`<tr><td>${esc(POINT_LABELS[id])} y (${u})</td><td>${f(ry.min, d)}</td><td>${f(ry.max, d)}</td><td>${f(ry.rom, d)}</td><td>${f(peakAbs(p.col.get(`${id}_speed_${u}_s`) ?? []), d ? 2 : 0)} ${u}/s</td><td>${f(peakAbs(p.col.get(`${id}_acc_${u}_s2`) ?? []), d ? 1 : 0)} ${u}/s²</td></tr>`);
    rows.push(`<tr><td>${esc(POINT_LABELS[id])} x (${u})</td><td>${f(rx.min, d)}</td><td>${f(rx.max, d)}</td><td>${f(rx.rom, d)}</td><td></td><td></td></tr>`);
  }
  $('res-table').querySelector('thead')!.innerHTML = '<tr><th scope="col">Measurement</th><th scope="col">Min</th><th scope="col">Max</th><th scope="col">Range</th><th scope="col">Peak rate</th><th scope="col">Peak acceleration</th></tr>';
  $('res-table').querySelector('tbody')!.innerHTML = rows.join('') || '<tr><td colspan="6">Select at least one angle or point under "Activity and measurements".</td></tr>';

  renderMode();
  renderReps();
  renderSymmetry();
  renderJump();
  renderChart();
  populateTeaching();
  renderTeaching();
}

function renderMode(): void {
  modeReport = null;
  if (!cur) return;
  const { trial } = cur;
  const preset = PRESET_BY_ID.get(trial.meta.preset);
  const mode = preset?.analysis.includes('bike') ? 'bike' : preset?.analysis.includes('run') ? 'run' : null;
  const el = $('res-mode');
  if (!mode) { el.innerHTML = ''; return; }
  const view = trialView(trial);
  if (view !== 'sagittal' && view !== 'frontal') {
    el.innerHTML = `<p class="warnings">The ${mode === 'bike' ? 'bike fit' : 'running'} report was not produced: the camera view was ${view === 'oblique' ? 'oblique' : 'not recognisable'}. Record square-on from the side, or directly from the ${mode === 'bike' ? 'front' : 'back'}.</p>`;
    return;
  }
  const inp: ModeInputs = {
    cutoff: settings.cutoff, minVisibility: settings.minVisibility, bodyModel: settings.bodyModel,
    inseamCm: Number.isFinite(settings.inseamCm) ? settings.inseamCm : undefined, saddleCm: Number.isFinite(settings.saddleCm) ? settings.saddleCm : undefined,
    speedKmh: Number.isFinite(settings.speedKmh) ? settings.speedKmh : undefined,
  };
  let r: ModeReport;
  try {
    r = mode === 'bike' ? (view === 'sagittal' ? bikeSideReport(trial, inp) : bikeFrontReport(trial, inp)) : view === 'sagittal' ? runSideReport(trial, inp) : runBackReport(trial, inp);
  } catch (err) {
    el.innerHTML = `<p class="warnings">${esc((err as Error).message)}</p>`;
    return;
  }
  modeReport = r;
  const key = `${r.mode}:${r.view}`;
  const prev = previousReports.get(key);
  const before = prev && prev.trialName !== cur.name ? prev.report : null;
  const cls = (st: string) => (st === 'in' ? 'status-in' : st.startsWith('borderline') ? 'status-borderline' : st === 'low' || st === 'high' ? 'status-out' : '');
  const refText = (m: ModeReport['rows'][number]) => (m.ref ? `${m.ref.low ?? ''}${m.ref.low !== null && m.ref.high !== null ? ' to ' : m.ref.low !== null ? ' or more' : 'up to '}${m.ref.high ?? ''} ${esc(m.ref.unit)}${m.band ? ` (tool uncertainty about \u00b1${m.band})` : ''}<br><small><a href="https://doi.org/${m.ref.doi}" target="_blank" rel="noopener">${esc(m.ref.citation)}</a>. ${esc(m.ref.basis)}</small>` : '');
  const rowsHtml = r.rows.map((m) => {
    const b = before?.rows.find((x) => x.id === m.id);
    const change = b && Number.isFinite(b.mean) && Number.isFinite(m.mean) ? `${f(b.mean, m.digits)} (${m.mean - b.mean >= 0 ? '+' : ''}${f(m.mean - b.mean, m.digits)})` : '';
    return `<tr><td class="wrap">${esc(m.label)}${m.note ? `<br><small class="muted">${esc(m.note)}</small>` : ''}</td><td>${m.status === 'withheld' ? '\u2013' : `${f(m.mean, m.digits)} ${esc(m.unit)}`}</td><td>${Number.isFinite(m.sd) ? f(m.sd, m.digits) : ''}</td><td>${m.n || ''}</td>${before ? `<td>${change}</td>` : ''}<td class="wrap">${refText(m)}</td><td class="${cls(m.status)}">${m.status === 'none' ? '' : STATUS_TEXT[m.status]}</td></tr>`;
  }).join('');
  el.innerHTML = `<h3>${esc(r.title)}</h3>
    <p class="muted">${r.cycles} ${r.mode === 'bike' ? 'pedal revolutions' : r.view === 'side' ? 'strides' : 'steps per side'} analysed at ${f(r.fs)} Hz${r.side !== 'both' ? `, ${r.side} side (nearest the camera)` : ''}.${before ? ' Compared with the previous trial in this view.' : ''}</p>
    <div class="table-wrap"><table><caption class="sr">${esc(r.title)} measurements</caption><thead><tr><th scope="col">Measurement</th><th scope="col">Mean</th><th scope="col">SD</th><th scope="col">n</th>${before ? '<th scope="col">Previous (change)</th>' : ''}<th scope="col" class="wrap">Reference range</th><th scope="col">Status</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
    <h3>Options to try, then re-measure</h3>
    <ul class="options">${r.options.map((o) => `<li>${esc(o.text)}<small>Why: ${esc(o.because)}${o.citation ? ` <a href="https://doi.org/${o.citation.doi}" target="_blank" rel="noopener">${esc(o.citation.citation)}</a>` : ''}</small></li>`).join('')}</ul>
    <h3>Read before acting on this</h3>
    <ul class="caveats">${r.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
    <div class="row"><button id="btn-mode-csv">Download this report (CSV)</button></div>`;
  $('btn-mode-csv').addEventListener('click', () => cur && modeReport && download(textBlob(reportCsv(modeReport), 'text/csv'), `${cur.name}-${modeReport.mode}-${modeReport.view}-report.csv`));
  if (r.cycles > 0) previousReports.set(key, { report: r, trialName: cur.name });
}

const modeLines = (): string[] => (modeReport ? reportCsv(modeReport).trim().split('\n').map((l) => l.replace(/^# /, '')).map((l) => `report: ${l}`) : []);

function renderReps(): void {
  if (!cur) return;
  const { processed: p, opts: o } = cur;
  const preset = PRESET_BY_ID.get(cur.trial.meta.preset);
  const jointAngles = o.angles.filter((id) => ANGLE_BY_ID.get(id)?.kind === 'joint');
  const id = (preset?.repJoint && jointAngles.find((a) => a.endsWith(`_${preset.repJoint}`))) || jointAngles[0];
  cur.reps = [];
  if (!id) { $('res-reps').innerHTML = ''; return; }
  const reps = detectReps(p.col.get(`${id}_deg`)!, p.col.get(`${id}_vel_deg_s`)!, p.fs, 15);
  cur.reps = reps;
  if (!reps.length) { $('res-reps').innerHTML = `<p class="muted">No repetitions detected on ${esc(angleLabel(id))} (needs an excursion of at least 15° that returns to the start).</p>`; return; }
  const mean = (k: (r: Rep) => number) => reps.reduce((s, r) => s + k(r), 0) / reps.length;
  const sd = (k: (r: Rep) => number) => (reps.length > 1 ? Math.sqrt(reps.reduce((s, r) => s + (k(r) - mean(k)) ** 2, 0) / (reps.length - 1)) : NaN);
  $('res-reps').innerHTML = `<div class="table-wrap"><table><caption>Repetitions detected on ${esc(angleLabel(id))}</caption>
    <thead><tr><th scope="col">Rep</th><th scope="col">Start (s)</th><th scope="col">Duration (s)</th><th scope="col">Range of motion (deg)</th><th scope="col">Peak angle (deg)</th><th scope="col">Peak velocity (deg/s)</th></tr></thead><tbody>
    ${reps.map((r, i) => `<tr><td>${i + 1}</td><td>${f(p.t[r.start], 2)}</td><td>${f(r.duration, 2)}</td><td>${f(r.rom)}</td><td>${f(r.peakValue)}</td><td>${f(r.peakVelocity, 0)}</td></tr>`).join('')}
    <tr><td>Mean (SD)</td><td></td><td>${f(mean((r) => r.duration), 2)} (${f(sd((r) => r.duration), 2)})</td><td>${f(mean((r) => r.rom))} (${f(sd((r) => r.rom))})</td><td>${f(mean((r) => r.peakValue))} (${f(sd((r) => r.peakValue))})</td><td>${f(mean((r) => r.peakVelocity), 0)} (${f(sd((r) => r.peakVelocity), 0)})</td></tr>
    </tbody></table></div>`;
}

function renderSymmetry(): void {
  if (!cur) return;
  const { processed: p, opts: o, trial } = cur;
  const pairs = o.angles.filter((id) => id.startsWith('l_') && o.angles.includes(`r_${id.slice(2)}`));
  if (!pairs.length) { $('res-symmetry').innerHTML = ''; return; }
  const view = trialView(trial);
  if (view !== 'frontal') {
    $('res-symmetry').innerHTML = `<p class="muted">Left/right symmetry is not reported for this trial: it was recorded in a ${view === 'unknown' ? 'view that could not be classified' : `${view} view`}, where the far limb is partly hidden and at a different distance from the camera. Record a frontal view to compare sides.</p>`;
    return;
  }
  const rows = pairs.map((id) => {
    const l = rangeOf(p.col.get(`${id}_deg`)!), r = rangeOf(p.col.get(`r_${id.slice(2)}_deg`)!);
    return `<tr><td>${esc(angleLabel(id).replace(/^Left /, ''))}</td><td>${f(l.rom)}</td><td>${f(r.rom)}</td><td>${f(symmetryIndex(l.rom, r.rom))}</td><td>${f(l.max)}</td><td>${f(r.max)}</td><td>${f(symmetryIndex(l.max, r.max))}</td></tr>`;
  });
  $('res-symmetry').innerHTML = `<div class="table-wrap"><table><caption>Left/right symmetry (frontal view). Symmetry index = 100 x (L - R) / mean(L, R); 0 is symmetric, positive means left is larger.</caption>
    <thead><tr><th scope="col">Joint</th><th scope="col">Left range</th><th scope="col">Right range</th><th scope="col">SI range (%)</th><th scope="col">Left peak</th><th scope="col">Right peak</th><th scope="col">SI peak (%)</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function renderJump(): void {
  if (!cur) return;
  const { trial, opts: o } = cur;
  const preset = PRESET_BY_ID.get(trial.meta.preset);
  if (!preset?.analysis.includes('jump')) { $('res-jump').innerHTML = ''; return; }
  const jp = processTrial(trial, { ...o, angles: [], points: ['l_toe', 'r_toe', 'com'], include3d: false });
  const u = jp.lengthUnit;
  const lt = jp.col.get(`l_toe_y_${u}_raw`)!, rt = jp.col.get(`r_toe_y_${u}_raw`)!;
  const foot = lt.map((v, i) => (Number.isFinite(v) && Number.isFinite(rt[i]) ? Math.min(v, rt[i]) : Number.isFinite(v) ? v : rt[i]));
  const shank = median(trial.frames.map((fr) => (fr.lm ? Math.hypot(fr.lm[L.l_knee].x - fr.lm[L.l_ankle].x, fr.lm[L.l_knee].y - fr.lm[L.l_ankle].y) : NaN)));
  const threshold = u === 'm' ? 0.02 : 0.05 * shank;
  const jumps = detectJumps(jp.t, foot, threshold, jp.col.get(`com_y_${u}`), u === 'm');
  if (!jumps.length) { $('res-jump').innerHTML = '<p class="muted">No flight phase detected. Both feet must clearly leave the ground and stay in view.</p>'; return; }
  $('res-jump').innerHTML = `<div class="table-wrap"><table><caption>Vertical jump. Flight-time height = g t² / 8 (needs no calibration; assumes the same body position at take-off and landing).</caption>
    <thead><tr><th scope="col">Jump</th><th scope="col">Take-off (s)</th><th scope="col">Flight time (ms)</th><th scope="col">Height, flight time (cm)</th><th scope="col">Timing resolution (cm)</th><th scope="col">Height, centre of mass rise (cm)</th></tr></thead><tbody>
    ${jumps.map((j, i) => `<tr><td>${i + 1}</td><td>${f(j.takeoff, 2)}</td><td>${f(j.flightTime * 1000, 0)}</td><td>${f(j.heightFlight * 100)}</td><td>±${f(j.heightResolution * 100)}</td><td>${Number.isFinite(j.heightCom) ? f(j.heightCom * 100) : 'needs calibration'}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted">The two methods differ for real reasons: flight time is limited by the frame interval (${f(1000 / jp.fs, 0)} ms here) and is inflated by landing with bent knees; the centre-of-mass method depends on calibration, filtering and the body-segment model.</p>`;
}

// ---- Teaching tool -------------------------------------------------------------------------

function populateTeaching(): void {
  if (!cur) return;
  const { opts: o, processed: p } = cur;
  const sel = $<HTMLSelectElement>('teach-signal');
  const prev = sel.value;
  const items = [
    ...o.angles.map((id) => ({ value: `${id}_deg_raw`, label: `${angleLabel(id)} (deg)` })),
    ...o.points.map((id) => ({ value: `${id}_y_${p.lengthUnit}_raw`, label: `${POINT_LABELS[id as PointId]} height (${p.lengthUnit})` })),
  ];
  sel.innerHTML = items.map((x) => `<option value="${x.value}">${esc(x.label)}</option>`).join('');
  if (items.some((x) => x.value === prev)) sel.value = prev;
}

const rmsOf = (v: ArrayLike<number>) => {
  let s = 0, n = 0;
  for (let i = 0; i < v.length; i++) if (Number.isFinite(v[i])) { s += v[i] * v[i]; n++; }
  return n ? Math.sqrt(s / n) : NaN;
};

export function renderTeaching(): void {
  if (!cur) return;
  const sig = $<HTMLSelectElement>('teach-signal').value;
  const k = Number($<HTMLSelectElement>('teach-decimate').value);
  let fc = Number($<HTMLInputElement>('teach-cutoff').value);
  if (!sig) { $('teach-text').textContent = 'Select a measurement to explore.'; return; }
  let p: Processed;
  try {
    const trial = k > 1 ? { ...cur.trial, frames: cur.trial.frames.filter((_, i) => i % k === 0) } : cur.trial;
    p = processTrial(trial, cur.opts);
  } catch (err) {
    $('teach-text').textContent = (err as Error).message;
    return;
  }
  const raw = p.col.get(sig);
  if (!raw) return;
  fc = Math.min(fc, 0.4 * p.fs);
  $('teach-cutoff-out').textContent = `${f(fc)} Hz`;
  const dt = 1 / p.fs;
  const filt = filtfiltGaps(raw, fc, p.fs);
  const GREY = '#94a3b8', COL = '#f59e0b';
  const pair = (a: ArrayLike<number>, b: ArrayLike<number>): Series[] => [
    { label: 'from raw data', x: p.t, y: a, color: GREY, dashed: true, width: 1.2 },
    { label: 'from filtered data', x: p.t, y: b, color: COL, width: 2 },
  ];
  const vRaw = derivative(raw, dt), vF = derivative(filt, dt), aRaw = secondDerivative(raw, dt), aF = secondDerivative(filt, dt);
  drawChart($<HTMLCanvasElement>('teach-pos'), pair(raw, filt), { xLabel: 'time (s)' });
  drawChart($<HTMLCanvasElement>('teach-vel'), pair(vRaw, vF), { xLabel: 'time (s)' });
  drawChart($<HTMLCanvasElement>('teach-acc'), pair(aRaw, aF), { xLabel: 'time (s)' });
  const ra = residualAnalysis(raw, p.fs);
  drawChart($<HTMLCanvasElement>('teach-res'), [{ label: 'residual', x: ra.cutoffs, y: ra.residuals, color: COL }], {
    xLabel: 'cutoff (Hz)',
    hLines: Number.isFinite(ra.line.intercept) ? [{ y: ra.line.intercept, label: 'noise estimate', color: GREY }] : [],
    markers: [{ x: fc, label: 'current', color: '#f8fafc' }, ...(Number.isFinite(ra.suggested) ? [{ x: ra.suggested, label: 'suggested', color: '#4ade80' }] : [])],
  });
  const ratio = rmsOf(aRaw) / rmsOf(aF);
  $('teach-text').textContent = `At ${f(p.fs)} Hz with a ${f(fc)} Hz cutoff, acceleration computed from the raw data has ${f(ratio)} times the RMS of the filtered estimate; the excess is amplified measurement noise. ${Number.isFinite(ra.suggested) ? `Residual analysis suggests a cutoff near ${f(ra.suggested)} Hz for this signal.` : 'Residual analysis could not suggest a cutoff for this signal.'} Too low a cutoff removes real movement; too high leaves noise.`;
}

export function initResults(): void {
  $('res-series').addEventListener('change', renderChart);
  $('btn-reprocess').addEventListener('click', () => {
    const v = Number($<HTMLInputElement>('cutoff').value);
    if (!(v > 0)) { say('Enter a cutoff frequency above 0 Hz.'); return; }
    settings.cutoff = v;
    reprocess();
    if (cur) say(`Re-filtered at ${f(cur.processed.cutoff)} Hz.`);
  });
  $('btn-suggest').addEventListener('click', () => {
    if (!cur) return;
    const id = cur.opts.angles[0];
    const raw = id ? cur.processed.col.get(`${id}_deg_raw`) : cur.opts.points[0] ? cur.processed.col.get(`${cur.opts.points[0]}_y_${cur.processed.lengthUnit}_raw`) : undefined;
    if (!raw) { say('Select a measurement first.'); return; }
    const s = residualAnalysis(raw, cur.processed.fs).suggested;
    if (!Number.isFinite(s)) { say('Residual analysis could not determine a cutoff for this signal. Keep the default or choose from the literature for this movement.'); return; }
    $<HTMLInputElement>('cutoff').value = (Math.round(s * 2) / 2).toFixed(1);
    say(`Residual analysis suggests about ${f(s)} Hz. The value is entered but not applied: press Re-filter if you agree.`);
  });
  for (const id of ['teach-signal', 'teach-decimate']) $(id).addEventListener('change', renderTeaching);
  $('teach-cutoff').addEventListener('input', renderTeaching);
  $('notes').addEventListener('input', () => { if (cur) cur.trial.meta.notes = $<HTMLTextAreaElement>('notes').value; });
  $('btn-csv').addEventListener('click', () => cur && download(textBlob(processedCsv(cur.trial, cur.processed, cur.opts, $<HTMLInputElement>('chk-csv-meta').checked, modeLines()), 'text/csv'), `${cur.name}-kinematics.csv`));
  $('btn-raw').addEventListener('click', () => cur && download(textBlob(landmarksCsv(cur.trial), 'text/csv'), `${cur.name}-landmarks.csv`));
  $('btn-session').addEventListener('click', () => cur && download(textBlob(sessionJson(cur.trial), 'application/json'), `${cur.name}-session.json`));
  $('btn-video-dl').addEventListener('click', () => cur?.video && download(cur.video, `${cur.name}.${cur.videoExt}`));
  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = window.setTimeout(() => { renderChart(); renderTeaching(); }, 150); });
}
