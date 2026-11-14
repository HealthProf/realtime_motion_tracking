import { JOINT_MOTIONS, PLANE_IDS, PLANES, type PlaneId } from './analysis/bodyFrame';
import { EYE_HEIGHT_FRACTION, standingHeightSpan } from './analysis/heightCal';
import { resistingGroup, STATIC_JOINTS, type StaticJoint, type StaticMoment } from './analysis/statics';
import { JOINT_GROUPS, MUSCLES, type JointGroup, type ViewInfo } from './anatomy/anatomy';
import { CATALOG_BY_ID, LAYER_LABELS, type CatalogEntry } from './anatomy/catalog';
import { searchCatalog } from './anatomy/search';
import { SYSTEMS, type SystemId } from './anatomy/systems';
import { findExtrema } from './modes/cycles';
import { closeCamera, listCameras, openCamera, startFrameLoop, type OpenCamera } from './camera/camera';
import { parseSession } from './capture/csv';
import { canvasPng, download, stamp, VideoRecorder } from './capture/media';
import { clampDelay, delayWidth, pickDelayed } from './capture/delay';
import { ReplayBuffer, ReplayPlayer, type ReplayEntry } from './capture/replay';
import { storeFrame, TrialRecorder, type Trial, type TrialMeta } from './capture/trial';
import { frameRate, resample, uniformGrid } from './kinematics/series';
import { PlateTracker, type CircleHit } from './lift/circle';
import { drawLiftScene, makeGrab } from './lift/grab';
import { analyseLift, KG_PER_LB, LIFTS, type LiftRep } from './lift/metrics';
import { bodyYaw, classifyView, coachChecks, tiltFromOrientation } from './coach/coach';
import { calibrateFromLength, defaultCalibration } from './kinematics/calibration';
import { FpsMeter, LiveEngine, type LiveSample } from './live';
import { ANGLES, ANGLE_BY_ID, DEG } from './measure/definitions';
import { Landmarker } from './pose/landmarker';
import { L, POINT_LABELS, SKELETON, TRACKABLE_POINTS, type PointId } from './pose/landmarks';
import { syntheticBar, syntheticFrame, SYNTH, type SyntheticActivity } from './pose/synthetic';
import { PRESETS, PRESET_BY_ID, resolvePreset } from './presets/presets';
import { drawChart, legendHtml, PALETTE, type Series } from './render/chart';
import { drawScene, SIDE_COLOR } from './render/overlay';
import { $, cal, esc, f, isMobile, layers, say, settings } from './state';
import type { BarObs, Lm, ModelTier, PoseFrame, TimestampSource } from './types';
import { hasTrial, initResults, reprocess, showTrial } from './ui/results';

const canvas = $<HTMLCanvasElement>('view');
const ctx = canvas.getContext('2d')!;
const video = $<HTMLVideoElement>('cam');

const live = new LiveEngine();
const fpsMeter = new FpsMeter();
const recorder = new TrialRecorder();
const videoRec = new VideoRecorder();
const REPLAY_SECONDS = isMobile ? 10 : 20, REPLAY_WIDTH = isMobile ? 480 : 640;
/** Sharpest stored picture for short delays; the picture is stored smaller as the delay grows. */
const DELAY_MAX_WIDTH = isMobile ? 960 : 1280;
const replay = new ReplayBuffer(REPLAY_SECONDS, REPLAY_WIDTH, (isMobile ? 96 : 192) * 1e6);
const player = new ReplayPlayer();
/** Delayed view: the buffered frame now on screen, and the live picture for the corner inset. */
const delay = { player: new ReplayPlayer(), busy: false, last: null as ReplayEntry | null, shown: null as LiveSample | null, liveBg: null as CanvasImageSource | null, liveMirror: false };
const MAX_TRIAL_SECONDS = 120;
const HISTORY_SECONDS = 10;

type Source =
  | { kind: 'camera'; cam: OpenCamera; loop: ReturnType<typeof startFrameLoop>; landmarker: Landmarker }
  | { kind: 'video'; name: string; url: string; loop: ReturnType<typeof startFrameLoop>; landmarker: Landmarker; width: number; height: number }
  | { kind: 'synthetic'; activity: SyntheticActivity; raf: number };
let source: Source | null = null;
let starting = false;
let lastSample: LiveSample | null = null;
let recent: LiveSample[] = [];
let customSelection = false;
let mirrorTouched = false;
let tiltDeg: number | null = null;
let pickMode: 'cal' | 'origin' | null = null;
let picks: { x: number; y: number }[] = [];
let musclesDrawn: string[] = [];
let findMessage = '';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const animTime = () => (reducedMotion.matches ? null : performance.now() / 1000);
const history = { t: [] as number[], series: new Map<string, number[]>() };
const shots: { name: string; blob: Blob; url: string }[] = [];

// Teaching overlays: what the last drawn frame found, for the text beside the picture.
let teachInfo: { gravity: string; moment: StaticMoment | null; view: ViewInfo | null; facing: { plane: PlaneId; offDeg: number } | null } = { gravity: '', moment: null, view: null, facing: null };
// Weight lifting mode.
const tracker = new PlateTracker();
let proposal: CircleHit | null = null;
let proposalAt = 0;
/** Where the plate sits relative to the hands (pixels), learned while both are seen. */
let handOffset = { x: 0, y: 0 };
let barTrail: { x: number; y: number; t: number }[] = [];
let lastBg: { bg: CanvasImageSource; mirror: boolean; w: number; h: number } | null = null;
let liveRep: LiftRep | null = null;
const liftCanvas = document.createElement('canvas');
// Countdown calibration.
let countdown: { end: number; samples: (Lm[] | null)[]; beeped: number; metres: number } | null = null;
// Video file playback.
const vid = { analysing: false, cancel: false, in: null as number | null, out: null as number | null };

const isLift = () => !!PRESET_BY_ID.get(settings.preset)?.analysis.includes('lift');

// ---- Measurement selection ---------------------------------------------------------------------

function currentSides(): ('l' | 'r')[] {
  if (settings.side === 'left') return ['l'];
  if (settings.side === 'right') return ['r'];
  if (settings.side === 'both') return ['l', 'r'];
  const lm = lastSample?.lm;
  if (!lm) return ['l'];
  if (classifyView(bodyYaw(lastSample!.world)) === 'frontal') return ['l', 'r'];
  const vis = (s: 'l' | 'r') => lm[L[`${s}_shoulder`]].v + lm[L[`${s}_hip`]].v + lm[L[`${s}_knee`]].v + lm[L[`${s}_ankle`]].v;
  return [vis('l') >= vis('r') ? 'l' : 'r'];
}

function applyPreset(announce = false): void {
  const p = PRESET_BY_ID.get(settings.preset)!;
  const r = resolvePreset(p, currentSides());
  const changed = r.angles.join() !== settings.angles.join() || r.points.join() !== settings.points.join();
  settings.angles = r.angles.filter((id) => ANGLE_BY_ID.has(id));
  settings.points = r.points;
  customSelection = false;
  $('preset-guidance').textContent = p.guidance;
  if (changed) selectionChanged();
  $('mode-bike').hidden = !p.analysis.includes('bike');
  $('mode-run').hidden = !p.analysis.includes('run');
  $('mode-lift').hidden = !p.analysis.includes('lift');
  if (!p.analysis.includes('lift')) { tracker.release(); proposal = null; barTrail = []; }
  if (announce) {
    settings.cutoff = p.cutoff;
    $<HTMLInputElement>('cutoff').value = String(p.cutoff);
  }
}

function selectionChanged(): void {
  for (const el of document.querySelectorAll<HTMLInputElement>('#angle-list input')) el.checked = settings.angles.includes(el.value);
  for (const el of document.querySelectorAll<HTMLInputElement>('#point-list input')) el.checked = settings.points.includes(el.value as PointId);
  history.t = [];
  history.series.clear();
  recent = [];
  for (const id of ['live-aa-x', 'live-aa-y']) {
    const sel = $<HTMLSelectElement>(id), prev = sel.value;
    sel.innerHTML = settings.angles.map((a) => `<option value="${a}">${esc(ANGLE_BY_ID.get(a)?.label ?? a)}</option>`).join('');
    sel.value = settings.angles.includes(prev) ? prev : settings.angles[id === 'live-aa-x' ? 0 : Math.min(1, settings.angles.length - 1)] ?? '';
  }
  if (hasTrial()) reprocess();
}

function buildSelectionUi(): void {
  $('preset').innerHTML = PRESETS.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('');
  $('angle-list').insertAdjacentHTML('beforeend', ANGLES.map((a) => `<label class="inline"><input type="checkbox" value="${a.id}"> ${esc(a.label)}</label>`).join(''));
  $('point-list').insertAdjacentHTML('beforeend', TRACKABLE_POINTS.map((p) => `<label class="inline"><input type="checkbox" value="${p}"> ${esc(POINT_LABELS[p])}</label>`).join(''));
  $('ly-highlight').insertAdjacentHTML('beforeend', JOINT_GROUPS.map((j) => `<option value="${j}">${j[0].toUpperCase()}${j.slice(1)}</option>`).join(''));
  const onToggle = () => {
    settings.angles = [...document.querySelectorAll<HTMLInputElement>('#angle-list input:checked')].map((e) => e.value);
    settings.points = [...document.querySelectorAll<HTMLInputElement>('#point-list input:checked')].map((e) => e.value as PointId);
    customSelection = true;
    selectionChanged();
  };
  $('angle-list').addEventListener('change', onToggle);
  $('point-list').addEventListener('change', onToggle);
  $('preset').addEventListener('change', () => { settings.preset = $<HTMLSelectElement>('preset').value; applyPreset(true); });
  $('side').addEventListener('change', () => { settings.side = $<HTMLSelectElement>('side').value as typeof settings.side; applyPreset(); });
  $('convention').addEventListener('change', () => { settings.convention = $<HTMLSelectElement>('convention').value as typeof settings.convention; live.reset(); if (delayActive()) { replay.clear(); resetDelayView(); } selectionChanged(); });
  $('bodymodel').addEventListener('change', () => { settings.bodyModel = $<HTMLSelectElement>('bodymodel').value as typeof settings.bodyModel; if (hasTrial()) reprocess(); });
  $('minvis').addEventListener('input', () => {
    settings.minVisibility = Number($<HTMLInputElement>('minvis').value);
    $('minvis-out').textContent = settings.minVisibility.toFixed(2);
  });
  $('minvis').addEventListener('change', () => { if (hasTrial()) reprocess(); });
  $('include3d').addEventListener('change', () => {
    settings.include3d = $<HTMLInputElement>('include3d').checked;
    document.body.classList.toggle('show3d', settings.include3d);
    if (hasTrial()) reprocess();
  });
}

// ---- Rendering ---------------------------------------------------------------------------------

function trailsFrom(samples: LiveSample[]): Map<PointId, { x: number; y: number }[]> {
  const m = new Map<PointId, { x: number; y: number }[]>();
  for (const id of settings.points) m.set(id, []);
  for (const s of samples) for (const [id, p] of s.points) m.get(id)?.push({ x: p.px, y: p.py });
  return m;
}

function render(sample: LiveSample | null, bg: CanvasImageSource | null, mirrorBg: boolean, trailSamples: LiveSample[], hudExtra: string[] = [], banner: { text: string; sub: string } | null = null): void {
  const w = sample?.w ?? canvas.width, h = sample?.h ?? canvas.height;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const hud = [...hudExtra];
  if (recorder.recording) hud.push(`Trial ${recorder.elapsed.toFixed(1)} s`);
  if (source?.kind === 'synthetic') hud.push('DEMO: synthetic data');
  const lift = isLift();
  const res = drawScene(ctx, {
    w, h, bg, mirrorBg, sample, layers, angles: settings.angles, minVisibility: settings.minVisibility, calibration: cal.current,
    mirrored: settings.mirror && source?.kind === 'camera', trails: trailsFrom(trailSamples), picks, hud, recording: recorder.recording, time: animTime(),
    bodyModel: settings.bodyModel, bodyMassKg: settings.bodyMassKg, loadKg: lift ? settings.liftLoadKg || 0 : settings.handLoadKg,
    barTrail: !lift ? [] : rp || delayActive() ? trailSamples.flatMap((x) => (x.bar ? [{ x: x.bar.px, y: x.bar.py }] : [])) : barTrail,
    proposal: lift && !tracker.lock && !rp && !delayActive() ? proposal : null, countdown: banner ?? countdownView(),
  });
  teachInfo = { gravity: res.gravity, moment: res.moment, view: res.view, facing: res.facing };
  musclesDrawn = res.musclesDrawn;
  findMessage = res.search?.message ?? '';
}

const unit = () => cal.current.unit;

function updateReadouts(s: LiveSample | null): void {
  const rows: string[] = [];
  const u = unit(), d = u === 'm' ? 2 : 0;
  for (const id of settings.angles) {
    const def = ANGLE_BY_ID.get(id)!;
    const a = s?.angles.get(id);
    const sw = `<span class="swatch" style="--c:${SIDE_COLOR[def.side]}"></span> `;
    if (!a || !Number.isFinite(a.value)) rows.push(`<tr><td>${sw}${esc(def.label)}</td><td class="low" colspan="2">not visible</td><td class="col3d"></td></tr>`);
    else rows.push(`<tr><td>${sw}${esc(def.label)}</td><td>${f(a.value)}${DEG}</td><td>${f(a.velocity, 0)} ${DEG}/s</td><td class="col3d">${Number.isFinite(a.value3d) ? `${f(a.value3d)}${DEG}` : ''}</td></tr>`);
  }
  for (const id of settings.points) {
    const p = s?.points.get(id);
    if (!p) rows.push(`<tr><td>${esc(POINT_LABELS[id])}</td><td class="low" colspan="2">not visible</td><td class="col3d"></td></tr>`);
    else rows.push(`<tr><td>${esc(POINT_LABELS[id])}</td><td>(${f(p.x, d)}, ${f(p.y, d)}) ${u}</td><td>${f(p.speed, d)} ${u}/s</td><td class="col3d"></td></tr>`);
  }
  if (isLift()) {
    const b = s?.bar;
    const src = b ? (b.src === 'plate' ? 'plate tracked' : 'from the hands') : '';
    rows.unshift(
      b ? `<tr><td><strong>Bar</strong> <span class="muted">${src}</span></td><td>height ${f(b.y, d)} ${u}</td><td><span class="lift-big">${f(b.vy, d)}</span> ${u}/s</td><td class="col3d"></td></tr>` : '<tr><td><strong>Bar</strong></td><td class="low" colspan="2">not located</td><td class="col3d"></td></tr>',
      liveRep ? `<tr><td><strong>Last lift</strong></td><td>mean ${f(liveRep.meanVelocity, 2)} m/s</td><td>peak ${f(liveRep.peakVelocity, 2)} m/s, ${f(liveRep.rom * 100, 0)} cm</td><td class="col3d"></td></tr>` : `<tr><td><strong>Last lift</strong></td><td class="low" colspan="2">${u === 'm' ? 'none yet' : 'calibrate to see velocity in m/s'}</td><td class="col3d"></td></tr>`,
    );
  }
  const mode = PRESET_BY_ID.get(settings.preset)?.analysis.find((a) => a === 'bike' || a === 'run');
  if (mode && !rp) {
    const c = liveCadence();
    rows.unshift(`<tr><td><strong>${mode === 'bike' ? 'Cadence' : 'Step rate'}</strong></td><td>${Number.isFinite(c) ? `${(mode === 'bike' ? c : 2 * c).toFixed(0)} ${mode === 'bike' ? 'rev/min' : 'steps/min'}` : '\u2013'}</td><td class="low">last ${HISTORY_SECONDS} s</td><td class="col3d"></td></tr>`);
  }
  $('readouts').querySelector('tbody')!.innerHTML = rows.join('') || '<tr><td colspan="4" class="low">No measurements selected.</td></tr>';
}

/** Cycles per minute of the first selected knee angle over the live history window. */
function liveCadence(): number {
  const id = settings.angles.find((a) => a.endsWith('_knee'));
  const v = id ? history.series.get(`angle:${id}`) : undefined;
  if (!v || v.length < 20) return NaN;
  const peaks = findExtrema(v, 15).maxima;
  if (peaks.length < 3) return NaN;
  return ((peaks.length - 1) * 60) / (history.t[peaks[peaks.length - 1]] - history.t[peaks[0]]);
}

function pushHistory(s: LiveSample): void {
  history.t.push(s.t);
  const put = (k: string, v: number) => {
    let a = history.series.get(k);
    if (!a) { a = new Array(history.t.length - 1).fill(NaN); history.series.set(k, a); }
    a.push(v);
  };
  for (const id of settings.angles) {
    const a = s.angles.get(id);
    put(`angle:${id}`, a ? a.value : NaN);
    put(`vel:${id}`, a ? a.velocity : NaN);
  }
  for (const id of settings.points) put(`speed:${id}`, s.points.get(id)?.speed ?? NaN);
  put('bar:x', s.bar?.x ?? NaN);
  put('bar:y', s.bar?.y ?? NaN);
  put('bar:vy', s.bar?.vy ?? NaN);
  for (const a of history.series.values()) while (a.length < history.t.length) a.push(NaN);
  while (history.t.length > 2 && s.t - history.t[0] > HISTORY_SECONDS) {
    history.t.shift();
    for (const a of history.series.values()) a.shift();
  }
}

/** Most recent completed lift in the live history window (live estimate; the trial report is re-filtered). */
function updateLiveRep(): void {
  liveRep = null;
  const n = history.t.length, fs = fpsMeter.fps;
  if (!isLift() || cal.current.unit !== 'm' || n < 20 || !(fs > 5)) return;
  const grid = uniformGrid(history.t[0], history.t[n - 1], fs);
  const y = resample(history.t, history.series.get('bar:y') ?? [], grid, 0.25), x = resample(history.t, history.series.get('bar:x') ?? [], grid, 0.25);
  const done = analyseLift({ fs, x, y, massKg: settings.liftLoadKg > 0 ? settings.liftLoadKg : 1, minRise: 0.1 }).reps.filter((r) => r.end < grid.length - 3);
  liveRep = done[done.length - 1] ?? null;
}

function updateLiveChart(): void {
  const mode = $<HTMLSelectElement>('live-chart-mode').value;
  const now = history.t[history.t.length - 1] ?? 0;
  const x = history.t.map((t) => t - now);
  $('live-aa').hidden = mode !== 'aa';
  if (mode === 'aa') {
    const ax = $<HTMLSelectElement>('live-aa-x').value, ay = $<HTMLSelectElement>('live-aa-y').value;
    const sx = history.series.get(`angle:${ax}`) ?? [], sy = history.series.get(`angle:${ay}`) ?? [];
    const lab = (id: string) => ANGLE_BY_ID.get(id)?.label ?? id;
    const series: Series[] = ax && ay ? [{ label: `${lab(ay)} against ${lab(ax)} (last ${HISTORY_SECONDS} s; the dot is now)`, x: sx, y: sy, color: PALETTE[0] }] : [];
    drawChart($<HTMLCanvasElement>('live-chart'), series, { xLabel: `${lab(ax)} (deg)`, yLabel: `${lab(ay)} (deg)`, dots: [{ x: sx[sx.length - 1], y: sy[sy.length - 1], color: '#f8fafc' }] });
    const legend = legendHtml(series);
    if ($('live-legend').innerHTML !== legend) $('live-legend').innerHTML = legend;
    return;
  }
  if (mode === 'bar') {
    const series: Series[] = [{ label: 'Bar vertical velocity', x, y: history.series.get('bar:vy') ?? [], color: '#a3e635' }];
    drawChart($<HTMLCanvasElement>('live-chart'), series, { xRange: [-HISTORY_SECONDS, 0], xLabel: 'seconds before now', yLabel: `${unit()}/s` });
    const legend = legendHtml(series);
    if ($('live-legend').innerHTML !== legend) $('live-legend').innerHTML = legend;
    return;
  }
  const ids = mode === 'speed' ? settings.points : settings.angles;
  const series: Series[] = ids.map((id, i) => ({
    label: mode === 'speed' ? POINT_LABELS[id as PointId] : ANGLE_BY_ID.get(id)!.label,
    x, y: history.series.get(`${mode}:${id}`) ?? [], color: PALETTE[i % PALETTE.length],
  }));
  const yLabel = mode === 'angle' ? 'deg' : mode === 'vel' ? 'deg/s' : `${unit()}/s`;
  drawChart($<HTMLCanvasElement>('live-chart'), series, { xRange: [-HISTORY_SECONDS, 0], xLabel: 'seconds before now', yLabel });
  const legend = legendHtml(series);
  if ($('live-legend').innerHTML !== legend) $('live-legend').innerHTML = legend;
}

function updateCoach(s: LiveSample | null): void {
  const checks = coachChecks({
    lm: s?.lm ?? null, world: s?.world ?? null, w: s?.w ?? canvas.width, h: s?.h ?? canvas.height, fps: fpsMeter.fps,
    expectedView: PRESET_BY_ID.get(settings.preset)?.view ?? null, tiltDeg, minFps: PRESET_BY_ID.get(settings.preset)?.minFps,
  });
  const html = checks.map((c) => `<li class="${c.status}"><strong>${esc(c.label)}</strong><span class="sr"> (${c.status === 'na' ? 'not checked' : c.status})</span><span class="detail">${esc(c.detail)}</span></li>`).join('');
  if ($('coach').innerHTML !== html) $('coach').innerHTML = html;
}

function updateMuscleList(): void {
  const ul = $('muscle-list');
  if (!layers.muscles) { ul.innerHTML = ''; return; }
  const html = MUSCLES.filter((m) => musclesDrawn.includes(m.id)).map((m) => {
    const on = !layers.highlight || m.joints.includes(layers.highlight);
    return `<li class="${on ? '' : 'dim'}"><strong>${esc(m.label)}</strong> <span class="muted">crosses: ${m.joints.join(', ')}</span>${m.note ? `<small>${esc(m.note)}</small>` : ''}</li>`;
  }).join('');
  if (ul.innerHTML !== html) ul.innerHTML = html;
}

let lowFpsSince = 0;
function updateChips(): void {
  const fps = fpsMeter.fps;
  $('status-fps').textContent = Number.isFinite(fps) ? `${fps.toFixed(0)} fps` : '-- fps';
  $('status-fps').classList.toggle('bad', fps < 20);
  $('status-model').textContent = !source ? 'no source' : source.kind === 'synthetic' ? `demo: ${source.activity}` : `${source.landmarker.tier} model, ${source.landmarker.delegate}, ${source.kind === 'video' ? `file ${source.width}x${source.height}` : `${source.cam.width}x${source.cam.height}`}`;
  $('status-units').textContent = cal.current.unit === 'm' ? `metres (${cal.current.method.replace('-', ' ')})` : 'pixels (uncalibrated)';
  if (source?.kind === 'camera' && fps < 18 && settings.tier !== 'lite') {
    lowFpsSince ||= performance.now();
    if (performance.now() - lowFpsSince > 6000) { say('The frame rate is low. Try the Lite pose model (Camera and setup), add light, or close other apps.'); lowFpsSince = performance.now() + 60_000; }
  } else if (lowFpsSince < performance.now()) lowFpsSince = 0;
}

// ---- Frame handling ----------------------------------------------------------------------------

const throttle = { readouts: 0, chart: 0, coach: 0, chips: 0, sides: 0 };
let rp: { entries: ReplayEntry[]; i: number; playing: boolean } | null = null;

const liveSettings = () => ({
  angles: settings.angles, points: settings.points, convention: settings.convention, minVisibility: settings.minVisibility, bodyModel: settings.bodyModel,
  calibration: cal.current, include3d: settings.include3d, mirrored: settings.mirror && source?.kind === 'camera', frameMode: settings.frameMode,
});

/** Mid-point of the hands, the fallback estimate of where the bar is. */
function handsPoint(lm: Lm[] | null): { x: number; y: number } | null {
  if (!lm) return null;
  const ws = [lm[L.l_wrist], lm[L.r_wrist]].filter((p) => p.v >= settings.minVisibility);
  return ws.length ? { x: ws.reduce((a, p) => a + p.x, 0) / ws.length, y: ws.reduce((a, p) => a + p.y, 0) / ws.length } : null;
}

/** Weight lifting mode: locates the bar in this frame (tracked plate, else the hands). */
function observeBar(frame: PoseFrame, bg: CanvasImageSource | null, mirror: boolean): BarObs | null {
  if (!isLift()) return null;
  lastBg = bg ? { bg, mirror, w: frame.w, h: frame.h } : null;
  const hands = handsPoint(frame.lm), grab = bg ? makeGrab(bg, mirror, frame.w, frame.h) : null;
  if (tracker.lock && grab) {
    const hit = tracker.update(grab, frame.t);
    if (hit) {
      if (hands) handOffset = { x: handOffset.x + 0.2 * (hit.x - hands.x - handOffset.x), y: handOffset.y + 0.2 * (hit.y - hands.y - handOffset.y) };
      return { x: hit.x, y: hit.y, r: hit.r, src: 'plate' };
    }
    // Lost: look again around where the hands say the plate should be.
    if (hands && tracker.missed > 4) { tracker.lock.x = hands.x + handOffset.x; tracker.lock.y = hands.y + handOffset.y; }
  } else if (grab && frame.lm && performance.now() - proposalAt > 400) {
    proposalAt = performance.now();
    const lm = frame.lm, S = Math.hypot((lm[L.l_shoulder].x + lm[L.r_shoulder].x - lm[L.l_hip].x - lm[L.r_hip].x) / 2, (lm[L.l_shoulder].y + lm[L.r_shoulder].y - lm[L.l_hip].y - lm[L.r_hip].y) / 2);
    const c = hands ?? { x: (lm[L.l_shoulder].x + lm[L.r_shoulder].x) / 2, y: (lm[L.l_shoulder].y + lm[L.r_shoulder].y) / 2 };
    proposal = S > 20 ? PlateTracker.search(grab, c.x, c.y, 0.8 * S, 0.22 * S, 0.62 * S, { minScore: 0.55 }) : null;
  }
  if (!hands) return null;
  const off = tracker.lock ? handOffset : { x: 0, y: 0 };
  return { x: hands.x + off.x, y: hands.y + off.y, r: 0, src: 'hands' };
}

const currentGrab = () => (lastBg ? makeGrab(lastBg.bg, lastBg.mirror, lastBg.w, lastBg.h) : null);

function lockPlate(found: CircleHit, t: number): void {
  const g = currentGrab();
  const hit = (g && PlateTracker.measure(g, found)) || found;
  tracker.lockTo(hit, t);
  proposal = null;
  const hands = handsPoint(lastSample?.lm ?? null);
  handOffset = hands ? { x: hit.x - hands.x, y: hit.y - hands.y } : { x: 0, y: 0 };
  barTrail = [];
  say(`Plate locked (${(2 * hit.r).toFixed(0)} pixels across). ${cal.current.unit === 'm' ? '' : 'Press "Calibrate from the plate" to set the scale from its diameter.'}`);
  updateTeachStatus();
}

function onPose(frame: PoseFrame, bg: CanvasImageSource | null, mirrorBg: boolean): void {
  fpsMeter.add(frame.t);
  if (rp) return;
  if (frame.bar === undefined) frame.bar = observeBar(frame, bg, mirrorBg);
  const sample = live.process(frame, liveSettings());
  lastSample = sample;
  if (sample.bar) {
    barTrail.push({ x: sample.bar.px, y: sample.bar.py, t: frame.t });
    while (barTrail.length > 4000 || (!recorder.recording && barTrail.length > 2 && (frame.t - barTrail[0].t > 4 || frame.t < barTrail[0].t))) barTrail.shift();
  }
  tickCountdown(sample);
  recorder.add(frame);
  replay.push(frame, sample, bg, mirrorBg);
  const delayed = delayActive();
  if (delayed) {
    delay.liveBg = bg;
    delay.liveMirror = mirrorBg;
    showDelayed(frame.t);
  } else {
    recent.push(sample);
    while (recent.length > 2 && sample.t - recent[0].t > 1.5) recent.shift();
    pushHistory(sample);
    render(sample, bg, mirrorBg, recent);
  }

  const now = performance.now();
  if (recorder.recording) {
    $('trial-clock').textContent = `${recorder.elapsed.toFixed(1)} s`;
    if (recorder.elapsed >= MAX_TRIAL_SECONDS) { say(`Trial stopped automatically at ${MAX_TRIAL_SECONDS} s.`); void stopTrial(); }
  }
  if (now - throttle.readouts > 120) { throttle.readouts = now; updateReadouts(delayed ? delay.shown : sample); }
  if (now - throttle.chart > 100) { throttle.chart = now; updateLiveChart(); }
  if (now - throttle.coach > 400) { throttle.coach = now; updateCoach(sample); updateMuscleList(); updateFindStatus(); updateLiveRep(); updateTeachStatus(); }
  if (now - throttle.chips > 500) { throttle.chips = now; updateChips(); if (settings.delayOn) updateDelayState(); }
  if (now - throttle.sides > 1500 && !customSelection && !recorder.recording && settings.side === 'auto') { throttle.sides = now; applyPreset(); }
}

// ---- Sources -----------------------------------------------------------------------------------

function setRunning(on: boolean): void {
  $('start-panel').hidden = on;
  for (const id of ['btn-trial', 'btn-shot', 'btn-replay', 'btn-stop']) $<HTMLButtonElement>(id).disabled = !on;
  if (!on) $<HTMLButtonElement>('btn-mark').disabled = true;
}

function resetForNewSource(w: number, h: number): void {
  live.reset();
  fpsMeter.reset();
  replay.clear();
  resetDelayView();
  lastSample = null;
  if (cal.current.method === 'none' || canvas.width !== w || canvas.height !== h) {
    cal.current = defaultCalibration(h);
    calStatus();
  }
  canvas.width = w;
  canvas.height = h;
}

async function stopSource(): Promise<void> {
  if (recorder.recording) await stopTrial();
  if (rp) exitReplay();
  if (source?.kind === 'camera') {
    source.loop.stop();
    source.landmarker.close();
    closeCamera(video);
  } else if (source?.kind === 'video') {
    vid.cancel = true;
    source.loop.stop();
    source.landmarker.close();
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(source.url);
    $('video-bar').hidden = true;
    $('video-fields').hidden = true;
  } else if (source?.kind === 'synthetic') cancelAnimationFrame(source.raf);
  tracker.release();
  proposal = null;
  barTrail = [];
  countdown = null;
  source = null;
  resetDelayView();
  setRunning(false);
  updateChips();
}

/** Runs the pose model on the current video frame. */
function detectFrame(landmarker: Landmarker, t: number, mirror: boolean): PoseFrame {
  const w = video.videoWidth, h = video.videoHeight;
  const det = landmarker.detect(video, w, h);
  if (mirror) {
    det.lm?.forEach((p) => { p.x = w - p.x; });
    det.world?.forEach((p) => { p.x = -p.x; });
  }
  return { t, w, h, lm: det.lm, world: det.world };
}

async function startCamera(): Promise<void> {
  if (starting) return;
  starting = true;
  try {
    await stopSource();
    say(`Loading the ${settings.tier} pose model…`);
    const landmarker = new Landmarker(settings.tier);
    const deviceId = $<HTMLSelectElement>('camera').value || undefined;
    const [, cam] = await Promise.all([landmarker.load(), openCamera(video, { deviceId, frameRate: settings.fps, height: 720, facingMode: isMobile ? 'environment' : 'user' })]);
    if (!mirrorTouched) {
      settings.mirror = cam.facingMode !== 'environment';
      $<HTMLInputElement>('mirror').checked = settings.mirror;
    }
    resetForNewSource(cam.width, cam.height);
    const loop = startFrameLoop(video, (t) => {
      if (rp || !source || source.kind !== 'camera') return;
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return;
      onPose(detectFrame(landmarker, t, settings.mirror), video, settings.mirror);
    });
    source = { kind: 'camera', cam, loop, landmarker };
    setRunning(true);
    say(`Camera running${Number.isFinite(cam.nominalFps) ? ` (camera reports ${cam.nominalFps.toFixed(0)} fps)` : ''}. Check the setup coach, then start a trial.`);
    await refreshCameraList(cam.label);
  } catch (err) {
    const e = err as Error;
    const msg = e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access for this site in your browser settings, then try again.'
      : e.name === 'NotFoundError' || e.name === 'OverconstrainedError' ? 'No matching camera was found. Connect a camera or choose another one.'
      : e.name === 'NotReadableError' ? 'The camera is in use by another application.'
      : `Could not start: ${e.message}`;
    say(msg);
    closeCamera(video);
    setRunning(false);
  } finally {
    starting = false;
  }
}

async function refreshCameraList(activeLabel: string): Promise<void> {
  const sel = $<HTMLSelectElement>('camera');
  const cams = await listCameras();
  const active = cams.find((c) => c.label === activeLabel)?.deviceId ?? sel.value;
  sel.innerHTML = '<option value="">Default camera</option>' + cams.map((c) => `<option value="${esc(c.deviceId)}">${esc(c.label)}</option>`).join('');
  sel.value = active;
}

async function startDemo(activity: SyntheticActivity): Promise<void> {
  await stopSource();
  if (activity === 'lift' && settings.preset !== 'lift') {
    settings.preset = 'lift';
    $<HTMLSelectElement>('preset').value = 'lift';
    applyPreset(true);
  }
  resetForNewSource(SYNTH.width, SYNTH.height);
  const t0 = performance.now();
  const s: Source = { kind: 'synthetic', activity, raf: 0 };
  const step = (now: number) => {
    if (source !== s) return;
    const t = (now - t0) / 1000;
    let bg: CanvasImageSource | null = null;
    if (activity === 'lift') {
      // The barbell is drawn into the backdrop so the demo runs the real plate tracker.
      const b = syntheticBar(t);
      drawLiftScene(liftCanvas, SYNTH.width, SYNTH.height, SYNTH.groundY, SYNTH.width / 2 + b.x * SYNTH.pxPerMetre, SYNTH.groundY - b.y * SYNTH.pxPerMetre, SYNTH.plateRadius * SYNTH.pxPerMetre, t * 0.7);
      bg = liftCanvas;
    }
    onPose(syntheticFrame(t, activity), bg, false);
    s.raf = requestAnimationFrame(step);
  };
  source = s;
  s.raf = requestAnimationFrame(step);
  setRunning(true);
  say('Demo running with synthetic data of known kinematics (300 pixels per metre). Calibrate under "Calibration" to see metres.');
}

// ---- Video files -------------------------------------------------------------------------------

type RvfcVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number };
const once = (el: EventTarget, type: string) => new Promise<void>((resolve) => el.addEventListener(type, () => resolve(), { once: true }));

/** Frame rate of a file, measured from the timestamps of the frames it presents during a short play. */
async function measureFileFps(): Promise<number> {
  const v = video as RvfcVideo;
  if (!v.requestVideoFrameCallback) return NaN;
  const times: number[] = [];
  try { await video.play(); } catch { return NaN; }
  await new Promise<void>((resolve) => {
    const t0 = performance.now();
    const step = (_: number, meta: { mediaTime: number }) => {
      times.push(meta.mediaTime);
      if (times.length >= 45 || performance.now() - t0 > 1800 || video.ended) resolve(); else v.requestVideoFrameCallback!(step);
    };
    v.requestVideoFrameCallback!(step);
    setTimeout(resolve, 2600);
  });
  video.pause();
  return frameRate(times);
}

/**
 * Seeks to time t and resolves with the timestamp of the frame then showing. `tol` is how far (s) a
 * presented frame's own timestamp may be from t and still be the frame asked for: a frame notification
 * that arrives late from an earlier seek must not be mistaken for this one.
 */
function seekFrame(t: number, tol = Infinity, fallback = t): Promise<number> {
  return new Promise((resolve) => {
    const v = video as RvfcVideo;
    let done = false;
    const finish = (time: number) => { if (!done) { done = true; clearTimeout(timer); resolve(time); } };
    const timer = setTimeout(() => finish(fallback), 5000);
    const onFrame = (_: number, meta: { mediaTime: number }) => {
      if (done) return;
      if (!video.seeking && Math.abs(meta.mediaTime - t) <= tol) finish(meta.mediaTime);
      else v.requestVideoFrameCallback!(onFrame);
    };
    const notifies = !!v.requestVideoFrameCallback;
    if (notifies) v.requestVideoFrameCallback!(onFrame);
    // Once the seek has completed the frame is available even if the browser sends no notification
    // (for example when it was already showing); the requested time is then the best timestamp.
    video.addEventListener('seeked', () => setTimeout(() => finish(fallback), notifies ? 350 : 0), { once: true });
    video.currentTime = t;
  });
}

const fileFps = () => Number($<HTMLInputElement>('video-fps').value);
const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

function updateVideoBar(): void {
  if (source?.kind !== 'video') return;
  const d = video.duration || 0;
  $<HTMLInputElement>('video-slider').value = String(video.currentTime);
  $('video-time').textContent = `${clock(video.currentTime)} / ${clock(d)}`;
  $('video-play').textContent = video.paused ? 'Play' : 'Pause';
  $('video-range').textContent = vid.in !== null || vid.out !== null ? `Analysing ${clock(vid.in ?? 0)} to ${clock(vid.out ?? d)}` : '';
}

async function startVideo(file: File): Promise<void> {
  if (starting) return;
  starting = true;
  try {
    await stopSource();
    say(`Opening ${file.name} and loading the ${settings.tier} pose model…`);
    const landmarker = new Landmarker(settings.tier);
    const url = URL.createObjectURL(file);
    video.srcObject = null;
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.playbackRate = 1;
    const loaded = Promise.race([once(video, 'loadeddata'), once(video, 'error').then(() => { throw new Error('This browser cannot play that video. Phone clips saved as HEVC (.mov) often need converting to H.264 MP4 first.'); })]);
    await Promise.all([landmarker.load(), loaded]);
    if (!video.videoWidth) throw new Error('The file has no video track this browser can decode.');
    const fps = await measureFileFps();
    await seekFrame(0);
    $<HTMLInputElement>('video-fps').value = Number.isFinite(fps) ? String(Math.round(fps * 100) / 100) : '30';
    $('video-info').textContent = `${file.name}: ${video.videoWidth}x${video.videoHeight}, ${clock(video.duration)} long. ${Number.isFinite(fps) ? `Measured ${fps.toFixed(2)} frames per second.` : 'The frame rate could not be measured: enter it above.'} If the clip was filmed in slow motion, set the factor so times and velocities are real.`;
    vid.in = vid.out = null;
    vid.cancel = false;
    resetForNewSource(video.videoWidth, video.videoHeight);
    const loop = startFrameLoop(video, (t) => {
      if (rp || vid.analysing || source?.kind !== 'video' || !video.videoWidth) return;
      onPose(detectFrame(landmarker, t / settings.slowMotion, false), video, false);
      updateVideoBar();
    }, 'mediaTime');
    source = { kind: 'video', name: file.name, url, loop, landmarker, width: video.videoWidth, height: video.videoHeight };
    $('video-bar').hidden = false;
    $('video-fields').hidden = false;
    $<HTMLInputElement>('video-slider').max = String(video.duration);
    setRunning(true);
    updateVideoBar();
    await seekFrame(Math.min(0.001, video.duration / 2));
    say('Video loaded. Play it to watch with live measurements, or press "Analyse every frame" for a full trial with no skipped frames.');
  } catch (err) {
    say(`Could not open the video: ${(err as Error).message}`);
    video.removeAttribute('src');
    setRunning(false);
  } finally {
    starting = false;
    $<HTMLInputElement>('file-video').value = '';
  }
}

/** Steps through the file one frame at a time and turns the result into a trial. */
async function analyseVideo(): Promise<void> {
  const src = source;
  if (src?.kind !== 'video') return;
  if (vid.analysing) { vid.cancel = true; return; }
  const fps = fileFps();
  if (!(fps > 0)) { say('Enter the frame rate of the video first.'); return; }
  if (!liftReady()) return;
  if (recorder.recording) await stopTrial();
  if (rp) exitReplay();
  video.pause();
  vid.analysing = true;
  vid.cancel = false;
  $('video-analyse').textContent = 'Cancel';
  live.reset();
  recent = [];
  barTrail = [];
  const from = vid.in ?? 0, to = vid.out ?? video.duration, n = Math.max(1, Math.ceil((to - from) * fps));
  const frames: PoseFrame[] = [];
  const meta = buildMeta();
  let t0 = NaN, last = -1;
  for (let i = 0; i < n && !vid.cancel && source === src; i++) {
    // Aim at the middle of each frame so rounding cannot land on a neighbour.
    // If the browser does not report the frame's own timestamp, its start time is the estimate.
    const shown = await seekFrame(Math.min(video.duration - 1e-3, from + (i + 0.5) / fps), 0.75 / fps, from + i / fps);
    if (vid.cancel || source !== src) break;
    if (shown <= last + 1e-5) continue;
    last = shown;
    const frame = detectFrame(src.landmarker, shown / settings.slowMotion, false);
    frame.bar = observeBar(frame, video, false);
    if (Number.isNaN(t0)) t0 = frame.t;
    frames.push(storeFrame(frame, t0));
    const sample = live.process(frame, liveSettings());
    lastSample = sample;
    recent.push(sample);
    while (recent.length > 2 && sample.t - recent[0].t > 1.5) recent.shift();
    if (sample.bar) barTrail.push({ x: sample.bar.px, y: sample.bar.py, t: frame.t });
    render(sample, video, false, recent, [`Analysing frame ${i + 1} of ${n}`]);
    if (i % 10 === 0) { say(`Analysing every frame: ${Math.round((100 * (i + 1)) / n)} %`); updateVideoBar(); }
  }
  const cancelled = vid.cancel;
  vid.analysing = false;
  vid.cancel = false;
  $('video-analyse').textContent = 'Analyse every frame';
  live.reset();
  if (source !== src) return;
  updateVideoBar();
  if (cancelled) { say('Analysis cancelled.'); return; }
  if (frames.length < 5) { say('Fewer than 5 frames could be read from that part of the video.'); return; }
  showTrial({ meta, frames, marks: [] }, null, '');
}

// ---- Trials ------------------------------------------------------------------------------------

function buildMeta(startedAt = new Date()): TrialMeta {
  const cam = source?.kind === 'camera' ? source : null, file = source?.kind === 'video' ? source : null, real = cam ?? file;
  return {
    appVersion: __APP_VERSION__, startedAt: startedAt.toISOString(), source: cam ? 'camera' : file ? 'video' : 'synthetic',
    cameraLabel: cam ? cam.cam.label : file ? `video file ${file.name}` : `synthetic ${source?.kind === 'synthetic' ? source.activity : ''}`,
    nominalFps: cam ? cam.cam.nominalFps : file ? fileFps() * settings.slowMotion : 60, timestampSource: (real ? real.loop.source() : 'synthetic') as TimestampSource,
    model: (real ? real.landmarker.tier : 'synthetic') as ModelTier | 'synthetic', delegate: real ? real.landmarker.delegate : 'none',
    mirrored: !!cam && settings.mirror, width: canvas.width, height: canvas.height, calibration: structuredClone(cal.current),
    bodyModel: settings.bodyModel, preset: settings.preset, notes: '',
    ...(file && settings.slowMotion !== 1 ? { slowMotion: settings.slowMotion } : {}),
    ...(isLift() ? { lift: { lift: settings.lift, loadKg: settings.liftLoadKg, ...(settings.bodyMassKg > 0 ? { bodyMassKg: settings.bodyMassKg } : {}) } } : {}),
  };
}

/** Weight lifting needs real units and a load before a trial means anything. */
function liftReady(): boolean {
  if (!isLift()) return true;
  if (cal.current.unit !== 'm') { say('Weight lifting mode needs calibration first: tap the plate and press "Calibrate from the plate", or use another method under "Calibration".'); return false; }
  if (!(settings.liftLoadKg > 0)) { say('Type in the total load on the bar (including the bar) first.'); $('lift-load').focus(); return false; }
  return true;
}

function startTrial(): void {
  if (!source || recorder.recording || rp || vid.analysing) return;
  if (!liftReady()) return;
  if (!customSelection && settings.side === 'auto') applyPreset();
  barTrail = [];
  recorder.start(buildMeta());
  // The view is the delayed picture while the delay is on, so a recording of it would not match the data.
  if ($<HTMLInputElement>('chk-video').checked && videoRec.supported && !delayActive()) videoRec.start(canvas, fpsMeter.fps);
  const b = $<HTMLButtonElement>('btn-trial');
  b.innerHTML = 'Stop trial <kbd>Space</kbd>';
  b.classList.add('recording');
  $<HTMLButtonElement>('btn-mark').disabled = false;
  say(delayActive() ? 'Recording trial (measurements only: no video while the delayed view is on). Press M to mark key moments.' : 'Recording trial. Press M to mark key moments.');
}

async function stopTrial(): Promise<void> {
  if (!recorder.recording) return;
  const trial = recorder.stop();
  const blob = await videoRec.stop();
  const b = $<HTMLButtonElement>('btn-trial');
  b.innerHTML = 'Start trial <kbd>Space</kbd>';
  b.classList.remove('recording');
  $<HTMLButtonElement>('btn-mark').disabled = true;
  $('trial-clock').textContent = '';
  if (trial) showTrial(trial, blob, videoRec.extension);
}

async function screenshot(caption: string): Promise<void> {
  try {
    const blob = await canvasPng(canvas);
    const name = `motion-${stamp()}-${shots.length + 1}.png`;
    const shot = { name, blob, url: URL.createObjectURL(blob) };
    shots.push(shot);
    $('gallery-card').hidden = false;
    const fig = document.createElement('figure');
    fig.innerHTML = `<img src="${shot.url}" alt="Screenshot: ${esc(caption)}"><figcaption><span>${esc(caption)}</span><button>Save</button></figcaption>`;
    fig.querySelector('button')!.addEventListener('click', () => download(blob, name));
    $('gallery').prepend(fig);
  } catch (err) {
    say((err as Error).message);
  }
}

function markMoment(): void {
  if (!recorder.recording) return;
  const n = (recorder.trial?.marks.length ?? 0) + 1;
  const m = recorder.mark(`mark ${n}`);
  if (!m) return;
  // The picture on screen is from earlier while the delay is on, so it is not a picture of this moment.
  if (delayActive()) { say(`Marked key moment ${n} at ${m.t.toFixed(2)} s (no screenshot while the delayed view is on).`); return; }
  void screenshot(`Key moment ${n} at ${m.t.toFixed(2)} s`);
  say(`Marked key moment ${n} at ${m.t.toFixed(2)} s.`);
}

// ---- Delayed view ------------------------------------------------------------------------------

/** The delay applies to the camera and the demo; a video file is already a recording. */
const delayActive = () => settings.delayOn && !!source && source.kind !== 'video';
const shotCaption = () => (rp ? 'Replay frame' : delayActive() ? `Delayed view (${settings.delaySeconds} s ago)` : 'Screenshot');

/** Sizes the shared replay buffer: long enough for the delay, with the picture stored smaller as the delay grows. */
function configureReplay(): void {
  if (!settings.delayOn) { replay.configure(REPLAY_SECONDS, REPLAY_WIDTH); return; }
  const seconds = Math.max(REPLAY_SECONDS, settings.delaySeconds + 1);
  // At most about 30 pictures a second are kept, so a 60 frames-per-second camera does not double the memory.
  replay.configure(seconds, delayWidth(seconds, REPLAY_WIDTH, DELAY_MAX_WIDTH), 0.024);
}

/** Forgets what the view was showing. The plots and trails restart, because their time line has jumped. */
function resetDelayView(): void {
  delay.last = null;
  delay.shown = null;
  recent = [];
  history.t = [];
  history.series.clear();
}

function setDelay(on: boolean): void {
  if (on && videoRec.active) {
    $<HTMLInputElement>('delay-on').checked = false;
    say('Stop the trial before switching the delayed view on: the trial video is being recorded from this view.');
    return;
  }
  settings.delayOn = on;
  configureReplay();
  resetDelayView();
  if (!on) { delay.player.dispose(); delay.liveBg = null; }
  updateDelayUi();
  say(!on ? 'Delayed view off. The picture is live again.'
    : source?.kind === 'video' ? 'Delayed view is on, but it only applies to the camera and the demo, not to video files.'
    : `Delayed view on: the picture and measurements are from ${settings.delaySeconds} s ago. The small picture in the corner is live.`);
}

function updateDelayUi(): void {
  const d = settings.delaySeconds, on = settings.delayOn;
  const slider = $<HTMLInputElement>('delay-seconds');
  $<HTMLInputElement>('delay-on').checked = on;
  slider.value = String(d);
  slider.setAttribute('aria-valuetext', `${d} seconds`);
  $('delay-out').textContent = `${d} s`;
  $('delay-bar').classList.toggle('on', on);
  const width = delayWidth(Math.max(REPLAY_SECONDS, d + 1), REPLAY_WIDTH, DELAY_MAX_WIDTH);
  $('delay-note').textContent = `Shows what the camera saw 5 to 60 seconds ago, so you can move and then turn to watch. Longer delays store a less sharp picture so that memory use stays about the same: at ${d} s the picture is kept up to ${width} pixels wide${width > REPLAY_WIDTH ? `, falling to ${REPLAY_WIDTH} at 60 s` : ''}.`;
  const chk = $<HTMLInputElement>('chk-video');
  chk.disabled = on;
  chk.parentElement!.title = on ? 'Not available while the delayed view is on: the video would be out of step with the measurements.' : '';
  $('live-tag').textContent = on ? `delayed ${d} s` : 'live estimate';
  updateDelayState();
}

function updateDelayState(): void {
  const el = $('delay-state');
  let text = '';
  if (settings.delayOn) {
    const e = replay.entries, wait = lastSample ? pickDelayed((i) => e[i].frame.t, e.length, lastSample.t, settings.delaySeconds).wait : settings.delaySeconds;
    const mb = `${(replay.bytes / 1e6).toFixed(0)} MB of video held in memory`;
    text = !source ? 'Starts when the camera starts. Trials record measurements only while this is on.'
      : source.kind === 'video' ? 'Not used with video files.'
      : rp ? 'Paused during instant replay.'
      : wait > 0 ? `Filling: the delayed picture starts in ${Math.ceil(wait)} s.`
      : `Showing the picture from ${settings.delaySeconds} s ago. ${replay.bytes > 0 ? `${mb}${replay.storedWidth ? `, ${replay.storedWidth} pixels wide` : ''}. ` : ''}Trials record measurements only.`;
  }
  if (el.textContent !== text) el.textContent = text;
}

/** Text with a dark backing, sized to be read from across a room. */
function badge(str: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign): void {
  ctx.font = `700 ${size}px system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(str).width, pad = size * 0.4;
  const left = align === 'center' ? x - tw / 2 : align === 'right' ? x - tw : x;
  ctx.fillStyle = 'rgba(11,18,32,0.78)';
  ctx.fillRect(left - pad, y - size * 0.72, tw + 2 * pad, size * 1.44);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

/** Label for the delayed picture and a small live picture in the corner, so framing can still be checked. */
function drawDelayChrome(label: string): void {
  const W = canvas.width, H = canvas.height, k = Math.max(W, H) / 1000;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (label) badge(label, W / 2, 30 * k, 26 * k, '#fde047', 'center');
  const iw = Math.round(W * (H > W ? 0.3 : 0.24)), ih = Math.round((iw * H) / W), x0 = Math.round(12 * k), y0 = H - ih - Math.round(12 * k);
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(x0, y0, iw, ih);
  if (delay.liveBg) {
    try {
      if (delay.liveMirror) { ctx.save(); ctx.translate(x0 + iw, y0); ctx.scale(-1, 1); ctx.drawImage(delay.liveBg, 0, 0, iw, ih); ctx.restore(); }
      else ctx.drawImage(delay.liveBg, x0, y0, iw, ih);
    } catch { /* the source went away between frames */ }
  }
  const s = lastSample;
  if (s?.lm) {
    const sx = iw / s.w, sy = ih / s.h, lm = s.lm;
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = Math.max(1, 1.6 * k);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [a, b] of SKELETON) {
      const p = lm[L[a]], q = lm[L[b]];
      if (p.v < settings.minVisibility || q.v < settings.minVisibility) continue;
      ctx.moveTo(x0 + p.x * sx, y0 + p.y * sy);
      ctx.lineTo(x0 + q.x * sx, y0 + q.y * sy);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = Math.max(1, 2 * k);
  ctx.strokeRect(x0, y0, iw, ih);
  badge('LIVE', x0 + 8 * k, y0 + 14 * k, 13 * k, '#f8fafc', 'left');
  ctx.restore();
}

/** Draws the buffered frame from `delaySeconds` before `now`, or a countdown while the buffer fills. */
function showDelayed(now: number): void {
  const entries = replay.entries, d = settings.delaySeconds;
  const pick = pickDelayed((i) => entries[i].frame.t, entries.length, now, d);
  if (pick.index < 0) {
    if (delay.last || recent.length) resetDelayView();
    if (!delay.busy) render(null, null, false, [], [], { text: String(Math.ceil(pick.wait)), sub: `seconds until the picture from ${d} s ago starts` });
    drawDelayChrome('');
    return;
  }
  // Pictures are stored for at most every other frame at high frame rates: step back to a frame that has one,
  // so the skeleton drawn is the one that belongs to the picture.
  let i = pick.index;
  for (let j = i; j >= 0 && i - j <= 4; j--) if (entries[j].image) { i = j; break; }
  const entry = entries[i];
  if (entry === delay.last || delay.busy) { drawDelayChrome(delay.last ? `DELAYED ${d} s` : ''); return; }
  const draw = (bmp: ImageBitmap | null) => {
    if (recent.length && entry.sample.t <= recent[recent.length - 1].t) resetDelayView();
    delay.last = entry;
    delay.shown = entry.sample;
    recent.push(entry.sample);
    while (recent.length > 2 && entry.sample.t - recent[0].t > 1.5) recent.shift();
    pushHistory(entry.sample);
    render(entry.sample, bmp, false, recent);
    drawDelayChrome(`DELAYED ${d} s`);
  };
  if (!entry.image) { draw(null); return; }
  const src = source;
  delay.busy = true;
  delay.player.image(entries, i).then((bmp) => {
    delay.busy = false;
    if (source === src && delayActive() && !rp && replay.entries.includes(entry)) draw(bmp);
  }, () => { delay.busy = false; });
}

// ---- Instant replay ----------------------------------------------------------------------------

async function showReplayFrame(i: number): Promise<void> {
  if (!rp) return;
  rp.i = Math.max(0, Math.min(rp.entries.length - 1, i));
  const idx = rp.i, e = rp.entries[idx];
  const bmp = await player.image(rp.entries, idx);
  if (!rp || rp.i !== idx) return;
  const t0 = rp.entries[0].frame.t;
  const from = rp.entries.findIndex((x) => e.frame.t - x.frame.t <= 1.5);
  render(e.sample, bmp, false, rp.entries.slice(from, idx + 1).map((x) => x.sample), [`REPLAY ${(e.frame.t - t0).toFixed(2)} s`]);
  updateReadouts(e.sample);
  $<HTMLInputElement>('replay-slider').value = String(idx);
  $('replay-time').textContent = `${(e.frame.t - t0).toFixed(2)} / ${(rp.entries[rp.entries.length - 1].frame.t - t0).toFixed(2)} s`;
}

function enterReplay(): void {
  if (!source || rp || recorder.recording) return;
  if (replay.entries.length < 5) { say('Nothing to replay yet.'); return; }
  rp = { entries: replay.entries.slice(), i: 0, playing: false };
  const slider = $<HTMLInputElement>('replay-slider');
  slider.max = String(rp.entries.length - 1);
  $('replay-bar').hidden = false;
  $<HTMLButtonElement>('btn-trial').disabled = true;
  say(`Replaying the last ${replay.duration.toFixed(1)} s. Live tracking is paused.`);
  updateDelayState();
  void showReplayFrame(Math.max(0, rp.entries.length - 1));
  slider.focus();
}

function exitReplay(): void {
  if (!rp) return;
  rp = null;
  player.dispose();
  $('replay-bar').hidden = true;
  $('replay-play').textContent = 'Play';
  $<HTMLButtonElement>('btn-trial').disabled = !source;
  live.reset();
  recent = [];
  if (settings.delayOn) resetDelayView();
  say(delayActive() ? `Back to the delayed view (${settings.delaySeconds} s).` : 'Back to live.');
  updateDelayState();
}

function playReplay(): void {
  if (!rp) return;
  if (rp.playing) { rp.playing = false; $('replay-play').textContent = 'Play'; return; }
  if (rp.i >= rp.entries.length - 1) rp.i = 0;
  rp.playing = true;
  $('replay-play').textContent = 'Pause';
  const wall0 = performance.now(), t0 = rp.entries[rp.i].frame.t;
  const speed = Number($<HTMLSelectElement>('replay-speed').value);
  const tick = () => {
    if (!rp || !rp.playing) return;
    const target = t0 + ((performance.now() - wall0) / 1000) * speed;
    let i = rp.i;
    while (i < rp.entries.length - 1 && rp.entries[i + 1].frame.t <= target) i++;
    if (i !== rp.i) void showReplayFrame(i);
    if (i >= rp.entries.length - 1) { rp.playing = false; $('replay-play').textContent = 'Play'; return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function replayToTrial(): void {
  if (!rp) return;
  const t0 = rp.entries[0].frame.t;
  const trial: Trial = { meta: buildMeta(), frames: rp.entries.map((e) => storeFrame(e.frame, t0)), marks: [] };
  exitReplay();
  showTrial(trial, null, '');
}

// ---- Calibration -------------------------------------------------------------------------------

function calStatus(extra = ''): void {
  const c = cal.current;
  $('cal-status').textContent = (c.unit === 'm'
    ? `Calibrated by ${c.method.replace('-', ' ')}: ${(1 / c.scale).toFixed(1)} pixels per metre.`
    : 'Not calibrated. Angles are unaffected; lengths are in pixels.') + ` Origin at pixel (${c.origin.x.toFixed(0)}, ${c.origin.y.toFixed(0)}). ${extra}`;
  updateChips();
}

function calibrationChanged(message: string): void {
  live.reset();
  history.t = [];
  history.series.clear();
  // Buffered measurements are in the old units: start the delayed view again rather than mislabel them.
  if (delayActive()) { replay.clear(); resetDelayView(); }
  calStatus(message);
  say(message);
}

function setPickMode(mode: typeof pickMode): void {
  pickMode = mode;
  picks = [];
  canvas.classList.toggle('picking', !!mode);
  if (mode === 'cal') say('Click the two ends of the reference object on the picture.');
  if (mode === 'origin') say('Click the point on the picture that should be the origin (0, 0).');
}

function onCanvasClick(ev: MouseEvent): void {
  const r = canvas.getBoundingClientRect();
  const p = { x: ((ev.clientX - r.left) / r.width) * canvas.width, y: ((ev.clientY - r.top) / r.height) * canvas.height };
  if (!pickMode) {
    // Weight lifting mode: a tap on the plate starts following it.
    if (!isLift() || rp || !lastBg) return;
    if (delayActive()) { say(`Switch the delayed view off to tap the plate: the picture on screen is from ${settings.delaySeconds} s ago.`); return; }
    const t = lastSample?.t ?? NaN;
    if (proposal && Math.hypot(p.x - proposal.x, p.y - proposal.y) <= proposal.r) { lockPlate(proposal, t); return; }
    const size = Math.min(canvas.width, canvas.height);
    const hit = PlateTracker.search(makeGrab(lastBg.bg, lastBg.mirror, lastBg.w, lastBg.h), p.x, p.y, 0.05 * size, 0.03 * size, 0.28 * size, { near: { x: p.x, y: p.y, maxDist: 0.2 * size }, minScore: 0.5 });
    if (hit && Math.hypot(p.x - hit.x, p.y - hit.y) <= hit.r * 1.15) lockPlate(hit, t);
    else say('No round plate edge was found where you tapped. Tap the middle of the plate, with the plate facing the camera. Until then the bar is estimated from the hands.');
    return;
  }
  if (pickMode === 'origin') {
    cal.current = { ...cal.current, origin: p };
    setPickMode(null);
    calibrationChanged('Origin set.');
    return;
  }
  picks.push(p);
  if (picks.length === 2) {
    const metres = Number($<HTMLInputElement>('cal-length').value);
    try {
      cal.current = calibrateFromLength(picks[0], picks[1], metres, cal.current.origin);
      const [a, b] = picks;
      setPickMode(null);
      picks = [a, b];
      setTimeout(() => { picks = []; }, 2500);
      calibrationChanged(`Calibrated: ${metres} m spans ${Math.hypot(b.x - a.x, b.y - a.y).toFixed(0)} pixels. This is valid only in the plane of the reference object.`);
    } catch (err) {
      setPickMode(null);
      say((err as Error).message);
    }
  }
}

/** Typed height in metres, or NaN if it is not a plausible stature. */
function heightMetres(): number {
  const v = Number($<HTMLInputElement>('cal-height').value), unit = $<HTMLSelectElement>('cal-height-unit').value;
  const m = unit === 'cm' ? v / 100 : unit === 'in' ? v * 0.0254 : v;
  return m >= 0.5 && m <= 2.5 ? m : NaN;
}

function beep(freq: number, ms: number): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ac: AudioContext = ((beep as unknown as { ac?: AudioContext }).ac ??= new AC());
    const osc = ac.createOscillator(), gain = ac.createGain();
    osc.frequency.value = freq;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + ms / 1000);
  } catch { /* sound is optional */ }
}

const HOLD_MS = 700;
function countdownView(): { text: string; sub: string } | null {
  if (!countdown) return null;
  const rem = (countdown.end - performance.now()) / 1000;
  return rem > 0 ? { text: String(Math.ceil(rem)), sub: 'Stand tall where you will move, whole body in the picture' } : { text: 'Hold', sub: 'Measuring. Stand still.' };
}

function startCountdown(): void {
  if (!source) { say('Start the camera first.'); return; }
  if (countdown) { countdown = null; say('Countdown cancelled.'); return; }
  const metres = heightMetres();
  if (!Number.isFinite(metres)) { say('Enter your height first (between 0.5 and 2.5 m).'); return; }
  const secs = Number($<HTMLSelectElement>('cal-count').value);
  countdown = { end: performance.now() + secs * 1000, samples: [], beeped: secs + 1, metres };
  say(`Calibration in ${secs} s: walk to where you will move, stand tall and keep still at zero.`);
}

/** Runs once per frame while a countdown is active; calibrates when it has finished and enough frames are in. */
function tickCountdown(s: LiveSample): void {
  const c = countdown;
  if (!c) return;
  const rem = c.end - performance.now();
  if (rem > 0) {
    const n = Math.ceil(rem / 1000);
    if (n < c.beeped) { c.beeped = n; beep(660, 90); }
    return;
  }
  if (c.beeped > 0) { c.beeped = 0; beep(990, 350); }
  c.samples.push(s.lm);
  if (rem > -HOLD_MS) return;
  countdown = null;
  const r = standingHeightSpan(c.samples, s.w, s.h, settings.minVisibility);
  if (!r.ok) { say(`Not calibrated: ${r.reason} Press the countdown button to try again.`); return; }
  // The origin moves to the floor under the feet, so heights read from the ground.
  cal.current = calibrateFromLength(r.eye, r.heel, EYE_HEIGHT_FRACTION * c.metres, { x: r.heel.x, y: r.heel.y }, 'subject-height');
  calibrationChanged(`Calibrated from your height (${c.metres.toFixed(2)} m, ${r.n} frames): ${(1 / cal.current.scale).toFixed(0)} pixels per metre, origin at your feet. Rough: expect a few percent error, and it holds only at this distance from the camera.`);
}

function calibrateFromPlate(): void {
  const k = tracker.lock, d = Number($<HTMLInputElement>('plate-diameter').value);
  if (!k) { say('Tap the plate in the picture first, so it is being followed.'); return; }
  if (!(d >= 0.1 && d <= 0.6)) { say('Enter the plate diameter in metres (0.450 for Olympic and bumper plates).'); return; }
  settings.plateDiameterM = d;
  // The diameter is measured afresh at full resolution, because every later number scales with it.
  const g = currentGrab(), fine = g ? PlateTracker.measure(g, k) : null;
  if (!fine) { say('The plate rim is not clear enough in this frame to measure. Make sure the whole plate is visible and try again.'); return; }
  cal.current = calibrateFromLength({ x: fine.x - fine.r, y: fine.y }, { x: fine.x + fine.r, y: fine.y }, d, cal.current.origin, 'plate-diameter');
  calibrationChanged(`Calibrated from the plate: ${d} m spans ${(2 * fine.r).toFixed(1)} pixels (${Math.round(fine.score * 100)} % of the rim visible). This is valid in the plane of the plate, which is the plane the bar moves in.`);
}

function calibrateFromHeight(): void {
  const lm = lastSample?.lm;
  const H = heightMetres();
  if (!lm) { say('No person is being tracked.'); return; }
  if (!Number.isFinite(H)) { say('Enter the height first (between 0.5 and 2.5 m).'); return; }
  const need = [L.l_eye, L.r_eye, L.l_heel, L.r_heel];
  if (need.some((i) => lm[i].v < settings.minVisibility)) { say('The eyes and both heels must be visible. Stand upright facing or side-on to the camera.'); return; }
  const eye = { x: (lm[L.l_eye].x + lm[L.r_eye].x) / 2, y: (lm[L.l_eye].y + lm[L.r_eye].y) / 2 };
  const heel = { x: eye.x, y: (lm[L.l_heel].y + lm[L.r_heel].y) / 2 };
  // Eye height is about 0.936 of stature (Drillis & Contini, 1966).
  cal.current = calibrateFromLength(eye, heel, EYE_HEIGHT_FRACTION * H, cal.current.origin, 'subject-height');
  calibrationChanged('Calibrated from standing height (eye level taken as 93.6 % of stature). Expect a few percent error: use a reference object for lab data.');
}

// ---- Wiring ------------------------------------------------------------------------------------

function initLayers(): void {
  const bind = (id: string, key: keyof typeof layers, numeric = false) => {
    const el = $<HTMLInputElement>(id);
    el.addEventListener('input', () => { (layers as any)[key] = numeric ? Number(el.value) : el.checked; });
  };
  bind('ly-video', 'videoOpacity', true);
  bind('ly-skeleton', 'skeleton'); bind('ly-labels', 'labels'); bind('ly-trails', 'trails'); bind('ly-com', 'com'); bind('ly-axes', 'axes');
  bind('ly-bones', 'bones'); bind('ly-bones-op', 'bonesOpacity', true); bind('ly-muscles', 'muscles'); bind('ly-muscles-op', 'musclesOpacity', true);
  $('ly-highlight').addEventListener('change', () => { layers.highlight = ($<HTMLSelectElement>('ly-highlight').value || null) as JointGroup | null; });
  bind('ly-systems-op', 'systemsOpacity', true);
  $('system-list').insertAdjacentHTML('beforeend', SYSTEMS.map((sys) => `<label class="inline"><input type="checkbox" id="ly-sys-${sys.id}" value="${sys.id}"> <span class="swatch" style="--c:${sys.color}"></span> ${esc(sys.label)}</label>`).join(''));
  $('system-list').addEventListener('change', (ev) => {
    const el = ev.target as HTMLInputElement;
    layers.systems[el.value as SystemId] = el.checked;
  });
}

// ---- Teaching tools and weight lifting ---------------------------------------------------------

function initTeachTools(): void {
  $('plane-list').insertAdjacentHTML('beforeend', PLANE_IDS.map((id) => `<label class="inline"><input type="checkbox" id="ly-plane-${id}" value="${id}"> <span class="swatch" style="--c:${PLANES[id].color}"></span> ${esc(PLANES[id].label)}</label>`).join(''));
  $('axis-list').insertAdjacentHTML('beforeend', PLANE_IDS.map((id) => `<label class="inline"><input type="checkbox" id="ly-axis-${id}" value="${id}"> <span class="swatch dashed" style="--c:${PLANES[id].color}"></span> ${esc(PLANES[id].axis)} <span class="muted">(${PLANES[id].label.replace(/ \(.*\)/, '').replace(' plane', '').toLowerCase()}-plane motion)</span></label>`).join(''));
  $('plane-list').addEventListener('change', (ev) => { const el = ev.target as HTMLInputElement; layers.planes[el.value as PlaneId] = el.checked; updateTeachStatus(); });
  $('axis-list').addEventListener('change', (ev) => { const el = ev.target as HTMLInputElement; layers.planeAxes[el.value as PlaneId] = el.checked; updateTeachStatus(); });
  const centre = $<HTMLSelectElement>('plane-centre');
  centre.innerHTML = JOINT_MOTIONS.map((j) => `<option value="${j.id}">${esc(j.label)}</option>`).join('');
  centre.addEventListener('change', () => { layers.planeCentre = centre.value; updateTeachStatus(); });
  $('plane-mode').addEventListener('change', () => { settings.frameMode = $<HTMLSelectElement>('plane-mode').value as typeof settings.frameMode; live.reset(); });
  $('ly-plane-inset').addEventListener('change', () => { layers.planeInset = $<HTMLInputElement>('ly-plane-inset').checked; });
  $('ly-gravity').addEventListener('change', () => { layers.gravity = $<HTMLInputElement>('ly-gravity').checked; updateTeachStatus(); });
  $('ly-vectors').addEventListener('change', () => { layers.vectors = $<HTMLInputElement>('ly-vectors').checked; });
  const mj = $<HTMLSelectElement>('moment-joint');
  mj.insertAdjacentHTML('beforeend', STATIC_JOINTS.map((j) => `<option value="${j.id}">${esc(j.label)}</option>`).join(''));
  mj.addEventListener('change', () => { layers.moment = (mj.value || null) as StaticJoint | null; updateTeachStatus(); });
  $('hand-load').addEventListener('change', () => { settings.handLoadKg = Math.max(0, Number($<HTMLInputElement>('hand-load').value) || 0); });
  $('body-mass').addEventListener('change', () => { const v = Number($<HTMLInputElement>('body-mass').value); settings.bodyMassKg = v > 0 ? v : NaN; updateTeachStatus(); });

  $('lift-type').innerHTML = LIFTS.map((l) => `<option value="${l.id}">${esc(l.label)}</option>`).join('');
  $('lift-type').addEventListener('change', () => { settings.lift = $<HTMLSelectElement>('lift-type').value; updateTeachStatus(); });
  const load = () => {
    const v = Number($<HTMLInputElement>('lift-load').value);
    settings.liftUnit = $<HTMLSelectElement>('lift-unit').value as 'kg' | 'lb';
    settings.liftLoadKg = v > 0 ? v * (settings.liftUnit === 'lb' ? KG_PER_LB : 1) : NaN;
    updateTeachStatus();
  };
  $('lift-load').addEventListener('change', load);
  $('lift-unit').addEventListener('change', load);
  $('btn-plate-cal').addEventListener('click', calibrateFromPlate);
  $('btn-plate-release').addEventListener('click', () => { tracker.release(); barTrail = []; say('Plate released. Tap the plate to follow it again.'); updateTeachStatus(); });
  $('btn-cal-countdown').addEventListener('click', startCountdown);
}

const setHtml = (id: string, html: string) => { if ($(id).innerHTML !== html) $(id).innerHTML = html; };

/** Text beside the picture for the planes, line of gravity, joint moment and lifting steps. */
function updateTeachStatus(): void {
  const { facing, view, moment } = teachInfo;
  const anyPlane = PLANE_IDS.some((id) => layers.planes[id] || layers.planeAxes[id]);
  if (!anyPlane) setHtml('plane-status', 'Switch on a plane or an axis. Motion in a plane is rotation about the axis at right angles to it.');
  else {
    const j = JOINT_MOTIONS.find((x) => x.id === layers.planeCentre) ?? JOINT_MOTIONS[0];
    const seen = facing ? `<p><strong>Camera view:</strong> you are looking at the ${PLANES[facing.plane].label.toLowerCase()}${facing.offDeg > 20 ? `, but about ${facing.offDeg.toFixed(0)}° away from square-on, so angles measured in the picture mix planes` : ''}. Movement you can see in the picture, and every planar angle this app measures, is ${facing.plane}-plane motion about the ${PLANES[facing.plane].axis.toLowerCase()}.</p>` : '<p>Start the camera or a demo to see which plane the camera is looking at.</p>';
    const rows = PLANE_IDS.map((id) => `<tr><th scope="row"><span class="sw" style="--c:${PLANES[id].color}"></span>${esc(PLANES[id].label)}<br><small>divides ${PLANES[id].divides}</small></th><td>${esc(PLANES[id].axis)}<br><small>${esc(PLANES[id].axisAlias)}</small></td><td>${esc(j[id])}</td></tr>`).join('');
    setHtml('plane-status', `${seen}<table><caption>${esc(j.label)}: movements in each plane, described from the anatomical position</caption><thead><tr><th scope="col">Plane</th><th scope="col">Axis of rotation</th><th scope="col">Movements</th></tr></thead><tbody>${rows}</tbody></table>${j.note ? `<p>${esc(j.note)}</p>` : ''}<p>The orientation of the planes comes from the pose model's depth estimate, which is its least reliable output, so they are held square-on when the body is within about 10° of a front or side view. Real joint axes are oblique and shift during movement; these are the textbook reference axes.</p>`);
  }
  setHtml('gravity-status', layers.gravity ? `${esc(teachInfo.gravity || 'Centre of mass not visible.')}. The base of support is shown only along the direction the camera can see, and the vertical assumes a level camera. A line of gravity outside the base means the posture cannot be held still, not that the person is falling: moving bodies are routinely outside it.` : '');
  if (!layers.moment) setHtml('moment-status', '');
  else if (!(settings.bodyMassKg > 0)) setHtml('moment-status', 'Enter body mass under "Activity and measurements" to see the moment.');
  else if (!moment) setHtml('moment-status', 'The joint and everything it supports must be visible.');
  else {
    const def = STATIC_JOINTS.find((x) => x.id === layers.moment)!;
    const who = view?.view === 'lateral' ? resistingGroup(layers.moment, moment.armPx, view.facing) : null;
    const si = Number.isFinite(moment.momentNm);
    setHtml('moment-status', `<p><strong>${esc(def.label)}</strong> support ${esc(def.supports)}: ${moment.massPct.toFixed(0)} % of body mass${moment.massKg - (moment.massPct / 100) * settings.bodyMassKg > 0.01 ? ' plus the load' : ''}, ${moment.massKg.toFixed(1)} kg, weight W = ${moment.weightN.toFixed(0)} N.</p>
      <p>Moment arm d = ${si ? `${Math.abs(moment.armM).toFixed(3)} m` : `${Math.abs(moment.armPx).toFixed(0)} pixels (calibrate for metres)`}${si ? `, so the moment of gravity M = W × d = <strong>${Math.abs(moment.momentNm).toFixed(0)} N·m</strong>` : ''}, ${moment.armPx > 0 ? 'clockwise' : 'counter-clockwise'} in the picture.</p>
      ${who ? `<p>Gravity tends to ${esc(who.tendency)}. To hold this position the ${esc(who.muscles)} must supply an equal and opposite moment.</p>` : layers.moment === 'hips' || layers.moment === 'knees' || layers.moment === 'ankles' ? '<p>Use a side view to see which muscle group resists this moment.</p>' : ''}
      <p>Static estimate from a segmental body model (de Leva, 1996): it ignores acceleration, so it is valid for held or slow postures only, and for the leg joints it assumes both legs share the load equally.${moment.mirrored ? ' A hidden limb was placed using the opposite side.' : ''}</p>`);
  }
  if (isLift()) {
    const c = cal.current, lift = LIFTS.find((l) => l.id === settings.lift) ?? LIFTS[0];
    const li = (ok: boolean, text: string) => `<li class="${ok ? 'done' : 'todo'}">${ok ? '&#10003;' : '&#9675;'} ${text}</li>`;
    setHtml('lift-steps', [
      li(c.unit === 'm', c.unit === 'm' ? `Calibrated (${c.method.replace('-', ' ')}, ${(1 / c.scale).toFixed(0)} pixels per metre)` : 'Calibrate: tap the plate and use its diameter, or use your height or a reference object under "Calibration"'),
      li(settings.liftLoadKg > 0, settings.liftLoadKg > 0 ? `Load ${settings.liftLoadKg.toFixed(1)} kg${settings.liftUnit === 'lb' ? ` (${(settings.liftLoadKg / KG_PER_LB).toFixed(1)} lb)` : ''}` : 'Type in the total load on the bar'),
      li(!!tracker.lock, tracker.lock ? (tracker.missed > 5 ? 'Plate lost: bar estimated from the hands until it is found again' : 'Following the plate') : 'Tap the plate in the picture to follow it (otherwise the bar is estimated from the hands)'),
      '<li>Start a trial, lift, then stop the trial for the report</li>',
    ].join(''));
    const warnFps = lift.fast && fpsMeter.fps < 50 ? ` The frame rate is ${Number.isFinite(fpsMeter.fps) ? fpsMeter.fps.toFixed(0) : '--'} fps: peak velocity and power will be underestimated for this lift.` : '';
    setHtml('lift-status', `${esc(lift.guidance)}${warnFps}`);
  }
}

// ---- Anatomy search ----------------------------------------------------------------------------

function updateFindStatus(): void {
  if (!layers.find) return;
  const msg = findMessage || `${CATALOG_BY_ID.get(layers.find)?.name ?? ''}: start the camera or the demo to locate it.`;
  if ($('find-status').textContent !== msg) $('find-status').textContent = msg;
}

function setLayer(id: CatalogEntry['layer'], on: boolean): void {
  if (id === 'bones' || id === 'muscles') {
    layers[id] = on;
    $<HTMLInputElement>(`ly-${id}`).checked = on;
  } else {
    layers.systems[id] = on;
    $<HTMLInputElement>(`ly-sys-${id}`).checked = on;
  }
}

function initFind(): void {
  const input = $<HTMLInputElement>('find-input'), list = $('find-list'), clear = $<HTMLButtonElement>('find-clear');
  let results: CatalogEntry[] = [], active = -1;
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const paint = () => {
    list.innerHTML = results.map((e, i) => `<li role="option" id="find-opt-${i}" aria-selected="${i === active}" data-i="${i}"><span>${esc(e.name)}</span><small>${esc(LAYER_LABELS[e.layer])}</small></li>`).join('');
    if (active >= 0) { input.setAttribute('aria-activedescendant', `find-opt-${active}`); list.children[active]?.scrollIntoView({ block: 'nearest' }); }
  };
  const choose = (e: CatalogEntry) => {
    layers.find = e.id;
    setLayer(e.layer, true);
    input.value = e.name;
    clear.hidden = false;
    close();
    findMessage = '';
    $('find-status').textContent = `Looking for ${e.name}. The ${LAYER_LABELS[e.layer]} layer was switched on.`;
  };
  input.addEventListener('input', () => {
    results = searchCatalog(input.value);
    active = results.length ? 0 : -1;
    list.hidden = !input.value.trim();
    input.setAttribute('aria-expanded', String(!list.hidden));
    if (!results.length && input.value.trim()) { list.innerHTML = '<li role="option" aria-disabled="true">No matching structure in this app\'s atlas.</li>'; return; }
    paint();
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      if (!results.length) return;
      ev.preventDefault();
      active = (active + (ev.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
      paint();
    } else if (ev.key === 'Enter' && results[active]) { ev.preventDefault(); choose(results[active]); }
    else if (ev.key === 'Escape') close();
  });
  list.addEventListener('mousedown', (ev) => {
    const li = (ev.target as HTMLElement).closest<HTMLElement>('li[data-i]');
    if (li) { ev.preventDefault(); choose(results[Number(li.dataset.i)]); }
  });
  input.addEventListener('blur', () => setTimeout(close, 100));
  clear.addEventListener('click', () => {
    layers.find = null;
    input.value = '';
    clear.hidden = true;
    $('find-status').textContent = 'Search cleared.';
    input.focus();
  });
}

function initTilt(): void {
  const btn = $<HTMLButtonElement>('btn-tilt');
  if (!('DeviceOrientationEvent' in window) || !isMobile) { btn.hidden = true; return; }
  btn.addEventListener('click', async () => {
    try {
      const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
      if (D.requestPermission && (await D.requestPermission()) !== 'granted') { say('Motion sensor permission was not granted.'); return; }
      window.addEventListener('deviceorientation', (e) => { if (e.beta !== null && e.gamma !== null) tiltDeg = tiltFromOrientation(e.beta, e.gamma); });
      btn.disabled = true;
      btn.textContent = 'Tilt sensor on';
    } catch { say('The tilt sensor is not available.'); }
  });
}

function init(): void {
  buildSelectionUi();
  initLayers();
  initResults();
  initTilt();
  initFind();
  initTeachTools();
  updateTeachStatus();
  for (const [id, key] of [['inseam', 'inseamCm'], ['saddle', 'saddleCm'], ['speed', 'speedKmh']] as const) {
    $(id).addEventListener('change', () => { const v = Number($<HTMLInputElement>(id).value); settings[key] = v > 0 ? v : NaN; if (hasTrial()) reprocess(); });
  }
  $<HTMLSelectElement>('tier').value = settings.tier;
  $<HTMLInputElement>('mirror').checked = settings.mirror;
  $('version').innerHTML = `Real-Time Motion Lab by <a href="https://github.com/HealthProf/realtime_motion_tracking">Timothy Curry</a>, version ${__APP_VERSION__}. Free for educational use; no commercial use or alteration without permission (<a href="https://github.com/HealthProf/realtime_motion_tracking/blob/main/LICENSE">license</a>). Runs entirely in your browser.`;
  applyPreset(true);
  calStatus();
  updateReadouts(null);
  if (!videoRec.supported) { $<HTMLInputElement>('chk-video').checked = false; $<HTMLInputElement>('chk-video').disabled = true; }

  $('btn-start-camera').addEventListener('click', () => void startCamera());
  $('file-video').addEventListener('change', () => { const file = $<HTMLInputElement>('file-video').files?.[0]; if (file) void startVideo(file); });
  $('video-play').addEventListener('click', () => { if (vid.analysing) return; if (video.paused) { if (video.ended) video.currentTime = 0; void video.play(); } else video.pause(); });
  const stepVideo = (dir: number) => { if (!vid.analysing && source?.kind === 'video') { video.pause(); video.currentTime = Math.min(video.duration, Math.max(0, video.currentTime + dir / (fileFps() || 30))); } };
  $('video-prev').addEventListener('click', () => stepVideo(-1));
  $('video-next').addEventListener('click', () => stepVideo(1));
  $('video-slider').addEventListener('input', () => { if (!vid.analysing) { video.pause(); video.currentTime = Number($<HTMLInputElement>('video-slider').value); } });
  $('video-speed').addEventListener('change', () => { video.playbackRate = Number($<HTMLSelectElement>('video-speed').value); });
  $('video-in').addEventListener('click', () => { vid.in = video.currentTime; if (vid.out !== null && vid.out <= vid.in) vid.out = null; updateVideoBar(); });
  $('video-out').addEventListener('click', () => { vid.out = video.currentTime; if (vid.in !== null && vid.in >= vid.out) vid.in = null; updateVideoBar(); });
  $('video-analyse').addEventListener('click', () => void analyseVideo());
  $('video-slow').addEventListener('change', () => { const v = Number($<HTMLInputElement>('video-slow').value); settings.slowMotion = v >= 1 ? v : 1; live.reset(); recent = []; history.t = []; history.series.clear(); });
  for (const ev of ['play', 'pause', 'ended', 'timeupdate']) video.addEventListener(ev, updateVideoBar);
  video.addEventListener('seeking', () => {
    if (source?.kind !== 'video' || vid.analysing) return;
    // Time is no longer continuous: stop anything that assumes it is.
    if (recorder.recording) { say('Trial stopped because the video position was changed.'); void stopTrial(); }
    live.reset(); fpsMeter.reset(); replay.clear(); recent = []; barTrail = []; history.t = []; history.series.clear();
  });
  $('btn-start-demo').addEventListener('click', () => void startDemo($<HTMLSelectElement>('demo-activity').value as SyntheticActivity));
  $('btn-stop').addEventListener('click', () => { void stopSource(); say('Source stopped.'); });
  $('btn-trial').addEventListener('click', () => (recorder.recording ? void stopTrial() : startTrial()));
  $('btn-mark').addEventListener('click', markMoment);
  $('btn-shot').addEventListener('click', () => void screenshot(shotCaption()));
  $('btn-replay').addEventListener('click', () => (rp ? exitReplay() : enterReplay()));
  $('replay-exit').addEventListener('click', exitReplay);
  $('replay-play').addEventListener('click', playReplay);
  $('replay-prev').addEventListener('click', () => rp && void showReplayFrame(rp.i - 1));
  $('replay-next').addEventListener('click', () => rp && void showReplayFrame(rp.i + 1));
  $('replay-slider').addEventListener('input', () => { if (rp) { rp.playing = false; $('replay-play').textContent = 'Play'; void showReplayFrame(Number($<HTMLInputElement>('replay-slider').value)); } });
  $('replay-save').addEventListener('click', replayToTrial);
  $('delay-on').addEventListener('change', () => setDelay($<HTMLInputElement>('delay-on').checked));
  $('delay-seconds').addEventListener('input', () => {
    settings.delaySeconds = clampDelay(Number($<HTMLInputElement>('delay-seconds').value));
    configureReplay();
    resetDelayView();
    updateDelayUi();
  });
  updateDelayUi();
  $('btn-gallery-all').addEventListener('click', () => shots.forEach((s, i) => setTimeout(() => download(s.blob, s.name), i * 300)));

  $('camera').addEventListener('change', () => { if (source?.kind === 'camera') void startCamera(); });
  $('fps').addEventListener('change', () => { settings.fps = Number($<HTMLSelectElement>('fps').value); if (source?.kind === 'camera') void startCamera(); });
  $('tier').addEventListener('change', () => { settings.tier = $<HTMLSelectElement>('tier').value as ModelTier; if (source?.kind === 'camera') void startCamera(); });
  $('mirror').addEventListener('change', () => { settings.mirror = $<HTMLInputElement>('mirror').checked; mirrorTouched = true; live.reset(); replay.clear(); recent = []; if (settings.delayOn) resetDelayView(); });

  $('btn-cal-pick').addEventListener('click', () => setPickMode('cal'));
  $('btn-origin').addEventListener('click', () => setPickMode('origin'));
  $('btn-cal-height').addEventListener('click', calibrateFromHeight);
  $('btn-origin-feet').addEventListener('click', () => {
    const lm = lastSample?.lm;
    if (!lm) { say('No person is being tracked.'); return; }
    cal.current = { ...cal.current, origin: { x: (lm[L.l_heel].x + lm[L.r_heel].x) / 2, y: Math.max(lm[L.l_heel].y, lm[L.r_heel].y, lm[L.l_toe].y, lm[L.r_toe].y) } };
    calibrationChanged('Origin set at the feet.');
  });
  $('btn-cal-reset').addEventListener('click', () => { cal.current = defaultCalibration(canvas.height); setPickMode(null); calibrationChanged('Calibration reset.'); });
  canvas.addEventListener('click', onCanvasClick);

  $('file-session').addEventListener('change', async () => {
    const file = $<HTMLInputElement>('file-session').files?.[0];
    if (!file) return;
    try {
      const trial = parseSession(await file.text());
      settings.preset = PRESET_BY_ID.has(trial.meta.preset) ? trial.meta.preset : 'free';
      $<HTMLSelectElement>('preset').value = settings.preset;
      if (!settings.angles.length && !settings.points.length) applyPreset(true);
      showTrial(trial, null, '');
    } catch (err) {
      say((err as Error).message);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea, select, [contenteditable]')) return;
    if (e.code === 'Space') {
      if (el.closest('button, summary, a')) return;
      e.preventDefault();
      if (source && !rp) (recorder.recording ? void stopTrial() : startTrial());
    } else if (e.key === 'm' || e.key === 'M') markMoment();
    else if ((e.key === 's' || e.key === 'S') && source) void screenshot(shotCaption());
    else if (e.key === 'd' || e.key === 'D') setDelay(!settings.delayOn);
    else if ((e.key === 'r' || e.key === 'R') && source) (rp ? exitReplay() : enterReplay());
    else if (e.key === 'Escape' && pickMode) { setPickMode(null); say('Cancelled.'); }
  });
  $('live-chart-mode').addEventListener('change', updateLiveChart);
  document.addEventListener('visibilitychange', () => { if (document.hidden && recorder.recording) { say('Trial stopped because the page was hidden.'); void stopTrial(); } });

  drawScene(ctx, { w: canvas.width, h: canvas.height, bg: null, mirrorBg: false, sample: null, layers, angles: [], minVisibility: 0.5, calibration: cal.current, mirrored: false, trails: new Map(), picks: [], hud: [], recording: false, time: null });
  const q = new URLSearchParams(location.search);
  const demo = q.get('demo');
  if (demo === 'squat' || demo === 'jump' || demo === 'raise' || demo === 'cycle' || demo === 'run' || demo === 'lift') void startDemo(demo);
  else if (q.get('autostart') === 'camera') void startCamera();
}

init();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register(`sw.js?v=${__APP_VERSION__}`).catch(() => undefined);
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) say('The app was updated. Reload the page to use the new version.'); });
}
