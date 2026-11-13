import { JOINT_GROUPS, MUSCLES, type JointGroup } from './anatomy/anatomy';
import { CATALOG_BY_ID, LAYER_LABELS, type CatalogEntry } from './anatomy/catalog';
import { searchCatalog } from './anatomy/search';
import { SYSTEMS, type SystemId } from './anatomy/systems';
import { findExtrema } from './modes/cycles';
import { closeCamera, listCameras, openCamera, startFrameLoop, type OpenCamera } from './camera/camera';
import { parseSession } from './capture/csv';
import { canvasPng, download, stamp, VideoRecorder } from './capture/media';
import { ReplayBuffer, ReplayPlayer, type ReplayEntry } from './capture/replay';
import { storeFrame, TrialRecorder, type Trial, type TrialMeta } from './capture/trial';
import { bodyYaw, classifyView, coachChecks, tiltFromOrientation } from './coach/coach';
import { calibrateFromLength, defaultCalibration } from './kinematics/calibration';
import { FpsMeter, LiveEngine, type LiveSample } from './live';
import { ANGLES, ANGLE_BY_ID, DEG } from './measure/definitions';
import { Landmarker } from './pose/landmarker';
import { L, POINT_LABELS, TRACKABLE_POINTS, type PointId } from './pose/landmarks';
import { syntheticFrame, SYNTH, type SyntheticActivity } from './pose/synthetic';
import { PRESETS, PRESET_BY_ID, resolvePreset } from './presets/presets';
import { drawChart, legendHtml, PALETTE, type Series } from './render/chart';
import { drawScene, SIDE_COLOR } from './render/overlay';
import { $, cal, esc, f, isMobile, layers, say, settings } from './state';
import type { ModelTier, PoseFrame, TimestampSource } from './types';
import { hasTrial, initResults, reprocess, showTrial } from './ui/results';

const canvas = $<HTMLCanvasElement>('view');
const ctx = canvas.getContext('2d')!;
const video = $<HTMLVideoElement>('cam');

const live = new LiveEngine();
const fpsMeter = new FpsMeter();
const recorder = new TrialRecorder();
const videoRec = new VideoRecorder();
const replay = new ReplayBuffer(isMobile ? 10 : 20, isMobile ? 480 : 640);
const player = new ReplayPlayer();
const MAX_TRIAL_SECONDS = 120;
const HISTORY_SECONDS = 10;

type Source =
  | { kind: 'camera'; cam: OpenCamera; loop: ReturnType<typeof startFrameLoop>; landmarker: Landmarker }
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
  $('convention').addEventListener('change', () => { settings.convention = $<HTMLSelectElement>('convention').value as typeof settings.convention; live.reset(); selectionChanged(); });
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

function render(sample: LiveSample | null, bg: CanvasImageSource | null, mirrorBg: boolean, trailSamples: LiveSample[], hudExtra: string[] = []): void {
  const w = sample?.w ?? canvas.width, h = sample?.h ?? canvas.height;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const hud = [...hudExtra];
  if (recorder.recording) hud.push(`Trial ${recorder.elapsed.toFixed(1)} s`);
  if (source?.kind === 'synthetic') hud.push('DEMO: synthetic data');
  const res = drawScene(ctx, {
    w, h, bg, mirrorBg, sample, layers, angles: settings.angles, minVisibility: settings.minVisibility, calibration: cal.current,
    mirrored: settings.mirror && source?.kind === 'camera', trails: trailsFrom(trailSamples), picks, hud, recording: recorder.recording, time: animTime(),
  });
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
  for (const a of history.series.values()) while (a.length < history.t.length) a.push(NaN);
  while (history.t.length > 2 && s.t - history.t[0] > HISTORY_SECONDS) {
    history.t.shift();
    for (const a of history.series.values()) a.shift();
  }
}

function updateLiveChart(): void {
  const mode = $<HTMLSelectElement>('live-chart-mode').value;
  const now = history.t[history.t.length - 1] ?? 0;
  const x = history.t.map((t) => t - now);
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
  $('status-model').textContent = !source ? 'no source' : source.kind === 'synthetic' ? `demo: ${source.activity}` : `${source.landmarker.tier} model, ${source.landmarker.delegate}, ${source.cam.width}x${source.cam.height}`;
  $('status-units').textContent = cal.current.unit === 'm' ? `metres (${cal.current.method.replace('-', ' ')})` : 'pixels (uncalibrated)';
  if (source?.kind === 'camera' && fps < 18 && settings.tier !== 'lite') {
    lowFpsSince ||= performance.now();
    if (performance.now() - lowFpsSince > 6000) { say('The frame rate is low. Try the Lite pose model (Camera and setup), add light, or close other apps.'); lowFpsSince = performance.now() + 60_000; }
  } else if (lowFpsSince < performance.now()) lowFpsSince = 0;
}

// ---- Frame handling ----------------------------------------------------------------------------

const throttle = { readouts: 0, chart: 0, coach: 0, chips: 0, sides: 0 };
let rp: { entries: ReplayEntry[]; i: number; playing: boolean } | null = null;

function onPose(frame: PoseFrame, bg: CanvasImageSource | null, mirrorBg: boolean): void {
  fpsMeter.add(frame.t);
  if (rp) return;
  const sample = live.process(frame, { angles: settings.angles, points: settings.points, convention: settings.convention, minVisibility: settings.minVisibility, bodyModel: settings.bodyModel, calibration: cal.current, include3d: settings.include3d });
  lastSample = sample;
  recent.push(sample);
  while (recent.length > 2 && sample.t - recent[0].t > 1.5) recent.shift();
  pushHistory(sample);
  recorder.add(frame);
  render(sample, bg, mirrorBg, recent);
  replay.push(frame, sample, bg, mirrorBg);

  const now = performance.now();
  if (recorder.recording) {
    $('trial-clock').textContent = `${recorder.elapsed.toFixed(1)} s`;
    if (recorder.elapsed >= MAX_TRIAL_SECONDS) { say(`Trial stopped automatically at ${MAX_TRIAL_SECONDS} s.`); void stopTrial(); }
  }
  if (now - throttle.readouts > 120) { throttle.readouts = now; updateReadouts(sample); }
  if (now - throttle.chart > 100) { throttle.chart = now; updateLiveChart(); }
  if (now - throttle.coach > 400) { throttle.coach = now; updateCoach(sample); updateMuscleList(); updateFindStatus(); }
  if (now - throttle.chips > 500) { throttle.chips = now; updateChips(); }
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
  recent = [];
  history.t = [];
  history.series.clear();
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
  } else if (source?.kind === 'synthetic') cancelAnimationFrame(source.raf);
  source = null;
  setRunning(false);
  updateChips();
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
      const det = landmarker.detect(video, w, h);
      if (settings.mirror) {
        det.lm?.forEach((p) => { p.x = w - p.x; });
        det.world?.forEach((p) => { p.x = -p.x; });
      }
      onPose({ t, w, h, lm: det.lm, world: det.world }, video, settings.mirror);
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
  resetForNewSource(SYNTH.width, SYNTH.height);
  const t0 = performance.now();
  const s: Source = { kind: 'synthetic', activity, raf: 0 };
  const step = (now: number) => {
    if (source !== s) return;
    onPose(syntheticFrame((now - t0) / 1000, activity), null, false);
    s.raf = requestAnimationFrame(step);
  };
  source = s;
  s.raf = requestAnimationFrame(step);
  setRunning(true);
  say('Demo running with synthetic data of known kinematics (300 pixels per metre). Calibrate under "Calibration" to see metres.');
}

// ---- Trials ------------------------------------------------------------------------------------

function buildMeta(startedAt = new Date()): TrialMeta {
  const cam = source?.kind === 'camera' ? source : null;
  return {
    appVersion: __APP_VERSION__, startedAt: startedAt.toISOString(), source: cam ? 'camera' : 'synthetic',
    cameraLabel: cam ? cam.cam.label : `synthetic ${source?.kind === 'synthetic' ? source.activity : ''}`,
    nominalFps: cam ? cam.cam.nominalFps : 60, timestampSource: (cam ? cam.loop.source() : 'synthetic') as TimestampSource,
    model: (cam ? cam.landmarker.tier : 'synthetic') as ModelTier | 'synthetic', delegate: cam ? cam.landmarker.delegate : 'none',
    mirrored: !!cam && settings.mirror, width: canvas.width, height: canvas.height, calibration: structuredClone(cal.current),
    bodyModel: settings.bodyModel, preset: settings.preset, notes: '',
  };
}

function startTrial(): void {
  if (!source || recorder.recording || rp) return;
  if (!customSelection && settings.side === 'auto') applyPreset();
  recorder.start(buildMeta());
  if ($<HTMLInputElement>('chk-video').checked && videoRec.supported) videoRec.start(canvas, fpsMeter.fps);
  const b = $<HTMLButtonElement>('btn-trial');
  b.innerHTML = 'Stop trial <kbd>Space</kbd>';
  b.classList.add('recording');
  $<HTMLButtonElement>('btn-mark').disabled = false;
  say('Recording trial. Press M to mark key moments.');
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
  if (m) { void screenshot(`Key moment ${n} at ${m.t.toFixed(2)} s`); say(`Marked key moment ${n} at ${m.t.toFixed(2)} s.`); }
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
  say('Back to live.');
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
  if (!pickMode) return;
  const r = canvas.getBoundingClientRect();
  const p = { x: ((ev.clientX - r.left) / r.width) * canvas.width, y: ((ev.clientY - r.top) / r.height) * canvas.height };
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

function calibrateFromHeight(): void {
  const lm = lastSample?.lm;
  const H = Number($<HTMLInputElement>('cal-height').value);
  if (!lm) { say('No person is being tracked.'); return; }
  if (!(H > 0.5)) { say('Enter the subject height in metres.'); return; }
  const need = [L.l_eye, L.r_eye, L.l_heel, L.r_heel];
  if (need.some((i) => lm[i].v < settings.minVisibility)) { say('The eyes and both heels must be visible. Stand upright facing or side-on to the camera.'); return; }
  const eye = { x: (lm[L.l_eye].x + lm[L.r_eye].x) / 2, y: (lm[L.l_eye].y + lm[L.r_eye].y) / 2 };
  const heel = { x: eye.x, y: (lm[L.l_heel].y + lm[L.r_heel].y) / 2 };
  // Eye height is about 0.936 of stature (Drillis & Contini, 1966).
  cal.current = calibrateFromLength(eye, heel, 0.936 * H, cal.current.origin, 'subject-height');
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
  for (const [id, key] of [['inseam', 'inseamCm'], ['saddle', 'saddleCm'], ['speed', 'speedKmh']] as const) {
    $(id).addEventListener('change', () => { const v = Number($<HTMLInputElement>(id).value); settings[key] = v > 0 ? v : NaN; if (hasTrial()) reprocess(); });
  }
  $<HTMLSelectElement>('tier').value = settings.tier;
  $<HTMLInputElement>('mirror').checked = settings.mirror;
  $('version').innerHTML = `Real-Time Motion Lab by <a href="https://github.com/HealthProf/realtime_motion_tracking">HealthProf</a>, version ${__APP_VERSION__}. Free for educational use; no commercial use or alteration without permission (<a href="https://github.com/HealthProf/realtime_motion_tracking/blob/main/LICENSE">license</a>). Runs entirely in your browser.`;
  applyPreset(true);
  calStatus();
  updateReadouts(null);
  if (!videoRec.supported) { $<HTMLInputElement>('chk-video').checked = false; $<HTMLInputElement>('chk-video').disabled = true; }

  $('btn-start-camera').addEventListener('click', () => void startCamera());
  $('btn-start-demo').addEventListener('click', () => void startDemo($<HTMLSelectElement>('demo-activity').value as SyntheticActivity));
  $('btn-stop').addEventListener('click', () => { void stopSource(); say('Source stopped.'); });
  $('btn-trial').addEventListener('click', () => (recorder.recording ? void stopTrial() : startTrial()));
  $('btn-mark').addEventListener('click', markMoment);
  $('btn-shot').addEventListener('click', () => void screenshot(rp ? 'Replay frame' : 'Screenshot'));
  $('btn-replay').addEventListener('click', () => (rp ? exitReplay() : enterReplay()));
  $('replay-exit').addEventListener('click', exitReplay);
  $('replay-play').addEventListener('click', playReplay);
  $('replay-prev').addEventListener('click', () => rp && void showReplayFrame(rp.i - 1));
  $('replay-next').addEventListener('click', () => rp && void showReplayFrame(rp.i + 1));
  $('replay-slider').addEventListener('input', () => { if (rp) { rp.playing = false; $('replay-play').textContent = 'Play'; void showReplayFrame(Number($<HTMLInputElement>('replay-slider').value)); } });
  $('replay-save').addEventListener('click', replayToTrial);
  $('btn-gallery-all').addEventListener('click', () => shots.forEach((s, i) => setTimeout(() => download(s.blob, s.name), i * 300)));

  $('camera').addEventListener('change', () => { if (source?.kind === 'camera') void startCamera(); });
  $('fps').addEventListener('change', () => { settings.fps = Number($<HTMLSelectElement>('fps').value); if (source?.kind === 'camera') void startCamera(); });
  $('tier').addEventListener('change', () => { settings.tier = $<HTMLSelectElement>('tier').value as ModelTier; if (source?.kind === 'camera') void startCamera(); });
  $('mirror').addEventListener('change', () => { settings.mirror = $<HTMLInputElement>('mirror').checked; mirrorTouched = true; live.reset(); replay.clear(); recent = []; });

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
    else if ((e.key === 's' || e.key === 'S') && source) void screenshot(rp ? 'Replay frame' : 'Screenshot');
    else if ((e.key === 'r' || e.key === 'R') && source) (rp ? exitReplay() : enterReplay());
    else if (e.key === 'Escape' && pickMode) { setPickMode(null); say('Cancelled.'); }
  });
  $('live-chart-mode').addEventListener('change', updateLiveChart);
  document.addEventListener('visibilitychange', () => { if (document.hidden && recorder.recording) { say('Trial stopped because the page was hidden.'); void stopTrial(); } });

  drawScene(ctx, { w: canvas.width, h: canvas.height, bg: null, mirrorBg: false, sample: null, layers, angles: [], minVisibility: 0.5, calibration: cal.current, mirrored: false, trails: new Map(), picks: [], hud: [], recording: false, time: null });
  const q = new URLSearchParams(location.search);
  const demo = q.get('demo');
  if (demo === 'squat' || demo === 'jump' || demo === 'raise' || demo === 'cycle' || demo === 'run') void startDemo(demo);
  else if (q.get('autostart') === 'camera') void startCamera();
}

init();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register(`sw.js?v=${__APP_VERSION__}`).catch(() => undefined);
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) say('The app was updated. Reload the page to use the new version.'); });
}
