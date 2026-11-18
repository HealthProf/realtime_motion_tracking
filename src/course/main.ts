// Course projects: code entry, project home, snapshot analyses and the synced comparison.
import { download, stamp, VideoRecorder } from '../capture/media';
import { clock, seekFrame } from '../capture/videoFile';
import { Editor } from './annotate/editor';
import { drawShape } from './annotate/render';
import { type Shape } from './annotate/shapes';
import { analysisPdf, exportBase } from './export';
import { rememberCode, rememberedCode, unlock, videoUrl, WrongCodeError } from './pack';
import { buildBar, ClipPlayer, drawContained, frameRateOf, loadVideo, type Bar } from './player';
import { analysisWork, fromBackup, loadWork, localVideoKey, openKV, projectWork, Saver, toBackup, type Backup, type KV } from './store';
import { activeAt, DEFAULT_OVERLAY_SECONDS, drifted, partnerTime, syncRange, type SyncPair } from './sync';
import { buildToolbar, toolForKey, type ToolbarHandle } from './toolbar';
import type { AnalysisDef, CompareWork, CourseConfig, ProjectDef, Snapshot, TimedShape, VideoDef, Work } from './types';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const say = (msg: string) => { $('status').textContent = msg; };

// ---- State --------------------------------------------------------------------------------------

let cfg: CourseConfig;
let kv: KV;
let work: Work;
let saver: Saver;
let projectId = '';
let view: 'gate' | 'home' | 'work' | 'compare' = 'gate';

const project = (): ProjectDef => cfg.projects.find((p) => p.id === projectId) ?? cfg.projects[0];
const label = (k: 'snapshot' | 'analysis') => cfg.labels?.[k] ?? (k === 'snapshot' ? 'Snapshot' : 'Analysis');
const fpsCache = new Map<string, number>();
const bitmaps = new Map<string, Promise<ImageBitmap>>();
const bitmapOf = (s: Snapshot) => {
  let b = bitmaps.get(s.id);
  if (!b) { b = createImageBitmap(s.image); bitmaps.set(s.id, b); }
  return b;
};

function show(next: typeof view): void {
  view = next;
  for (const id of ['gate', 'home', 'work', 'compare'] as const) $(id).hidden = id !== next;
  if (next !== 'work') clipVideo.pause();
  if (next !== 'compare') { cmp.v1.pause(); cmp.v2.pause(); }
}

function changed(): void {
  saver.schedule();
}

// ---- Busy dialog --------------------------------------------------------------------------------

let busyCancel: (() => void) | null = null;
function busy(text: string | null, progress?: number, onCancel?: () => void): void {
  $('busy').hidden = text === null;
  if (text === null) { busyCancel = null; return; }
  $('busy-text').textContent = text;
  const bar = $<HTMLProgressElement>('busy-progress');
  if (progress === undefined) bar.removeAttribute('value'); else bar.value = progress;
  busyCancel = onCancel ?? null;
  $('busy-cancel').hidden = !onCancel;
}

// ---- Code gate ----------------------------------------------------------------------------------

async function tryOpen(code: string, remember: boolean): Promise<boolean> {
  $('gate-error').textContent = '';
  $<HTMLButtonElement>('gate-open').disabled = true;
  say('Checking the code…');
  try {
    cfg = await unlock(code);
  } catch (err) {
    say('');
    $('gate-error').textContent = err instanceof WrongCodeError ? 'Code not recognised. Check it with your instructor and try again.' : (err as Error).message;
    if (err instanceof WrongCodeError) rememberCode(null);
    return false;
  } finally {
    $<HTMLButtonElement>('gate-open').disabled = false;
  }
  rememberCode(remember ? code : null);
  const opened = await openKV();
  kv = opened.kv;
  work = await loadWork(kv, cfg.id);
  saver = new Saver(kv, cfg.id, () => work, (ok) => saveChip(ok && opened.persistent));
  saveChip(opened.persistent, true);
  projectId = cfg.projects[0]?.id ?? '';
  $('course-title').textContent = cfg.title;
  document.title = `${cfg.title} · Course Projects`;
  say(opened.persistent ? '' : 'This browser is not letting the app save (private window?). Download a backup before you close the page.');
  renderHome();
  show('home');
  return true;
}

function saveChip(ok: boolean, initial = false): void {
  const chip = $('save-chip');
  chip.hidden = false;
  chip.className = `chip ${ok ? 'ok' : 'warn'}`;
  chip.textContent = ok ? (initial ? 'Saves on this device' : 'Saved') : 'Not saving: download a backup';
}

// ---- Home ---------------------------------------------------------------------------------------

function groups(): string[] {
  return [...new Set(cfg.videos.map((v) => v.group))];
}

function clipDef(clip: 1 | 2): VideoDef | null {
  const g = projectWork(work, projectId).group;
  return cfg.videos.find((v) => v.group === g && v.clip === clip) ?? null;
}

const usesLocalFiles = () => cfg.videos.length === 0;

function analysisProgress(a: AnalysisDef): string {
  const aw = work.projects[projectId]?.analyses[a.id];
  if (a.kind === 'compare') {
    const c = aw?.compare;
    return `${c?.sync ? 'Clips locked together' : 'Clips not locked yet'} · ${c?.items.length ?? 0} item${c?.items.length === 1 ? '' : 's'} over the video`;
  }
  const n = aw?.snapshots.length ?? 0, want = a.snapshots ?? a.prompts.length;
  return `${n} of ${want} ${label('snapshot').toLowerCase()}s · clip ${a.clip ?? 1}${a.points ? ` · ${a.points} points` : ''}`;
}

function renderHome(): void {
  const p = project();
  $('home-h').textContent = p.title;
  $('home-instructions').textContent = p.instructions ?? '';
  const pick = $('project-pick');
  pick.hidden = cfg.projects.length < 2;
  const sel = $<HTMLSelectElement>('project-select');
  sel.innerHTML = cfg.projects.map((x) => `<option value="${esc(x.id)}">${esc(x.title)}</option>`).join('');
  sel.value = p.id;
  $<HTMLInputElement>('student-name').value = work.student;
  updateStudentChip();

  const pw = projectWork(work, p.id), gs = groups(), opts = $('pair-options');
  if (usesLocalFiles()) {
    opts.innerHTML = '';
    $('pair-note').textContent = 'Your instructor has not added course videos yet. Each analysis will ask you to choose a video file from your device (clip 1 and clip 2).';
  } else {
    opts.innerHTML = gs.map((g, i) => `<label class="pair"><input type="radio" name="pair" value="${esc(g)}" id="pair-${i}"${pw.group === g ? ' checked' : ''}> ${esc(g)}: ${cfg.videos.filter((v) => v.group === g).sort((a, b) => a.clip - b.clip).map((v) => esc(v.title)).join(' and ')}</label>`).join('');
    $('pair-note').textContent = pw.group ? '' : 'Choose one pair. Both clips must be from the same pair.';
    opts.querySelectorAll<HTMLInputElement>('input[name=pair]').forEach((r) => r.addEventListener('change', () => {
      const had = Object.values(pw.analyses).some((a) => a.snapshots.length || a.compare?.items.length);
      if (had && pw.group && !confirm('You already have work on the other clips. Switch pair? Your existing snapshots stay, but new ones will come from the new clips.')) { renderHome(); return; }
      pw.group = r.value;
      changed();
      renderHome();
    }));
  }

  const list = $('analysis-list');
  list.innerHTML = '';
  p.analyses.forEach((a, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="title">${esc(a.title)}</span><span class="meta">${esc(analysisProgress(a))}</span>`;
    const b = document.createElement('button');
    b.className = 'primary';
    b.textContent = 'Open';
    b.disabled = !usesLocalFiles() && !pw.group;
    b.title = b.disabled ? 'Choose your pair of clips first' : `Open ${a.title}`;
    b.addEventListener('click', () => void (a.kind === 'compare' ? openCompare(i) : openAnalysis(i)));
    li.appendChild(b);
    list.appendChild(li);
  });
}

function updateStudentChip(): void {
  const chip = $('student-chip');
  chip.hidden = !work.student;
  chip.textContent = work.student;
}

function needName(): boolean {
  if (work.student.trim()) return false;
  const n = prompt('Type your name. It is printed on your exports.');
  if (!n?.trim()) return true;
  work.student = n.trim();
  updateStudentChip();
  changed();
  return false;
}

// ---- Getting a clip -----------------------------------------------------------------------------

/** URL and identity of clip 1 or 2 of the current project, or null if the student must choose a file. */
async function clipSource(clip: 1 | 2): Promise<{ url: string; id: string; title: string; fps?: number } | null> {
  if (usesLocalFiles()) {
    const blob = await kv.get<Blob>(localVideoKey(cfg.id, projectId, clip));
    if (!blob) return null;
    return { url: URL.createObjectURL(blob), id: `local:${clip}`, title: (blob as File).name ?? `Clip ${clip}` };
  }
  const def = clipDef(clip);
  if (!def) return null;
  busy(`Loading ${def.title}…`, 0);
  try {
    const url = await videoUrl(def, (f) => busy(`Loading ${def.title}…`, f));
    return { url, id: def.id, title: def.title, fps: def.fps };
  } finally {
    busy(null);
  }
}

async function storeLocalClip(clip: 1 | 2, file: File): Promise<void> {
  await kv.set(localVideoKey(cfg.id, projectId, clip), file);
}

// ---- Snapshot analysis --------------------------------------------------------------------------

const clipVideo = $<HTMLVideoElement>('clip');
let player: ClipPlayer;
let snapEditor: Editor;
let snapTools: ToolbarHandle;
const ana = { index: -1, clipId: '', clipTitle: '', current: null as Snapshot | null };

const analysisDef = () => project().analyses[ana.index];
const aWork = () => analysisWork(work, projectId, analysisDef().id);

async function openAnalysis(i: number): Promise<void> {
  ana.index = i;
  ana.current = null;
  const a = analysisDef();
  $('work-h').textContent = a.title;
  $('work-instructions').textContent = a.instructions ?? '';
  $('btn-capture').innerHTML = `Capture ${esc(label('snapshot').toLowerCase())} <kbd>C</kbd>`;
  show('work');
  setMode('video');
  renderSnapList();
  await loadAnalysisClip();
}

async function loadAnalysisClip(): Promise<void> {
  const clip = analysisDef().clip ?? 1;
  $('video-pane').hidden = true;
  $('clip-missing').hidden = true;
  let src: Awaited<ReturnType<typeof clipSource>>;
  try {
    src = await clipSource(clip);
  } catch (err) {
    say((err as Error).message);
    return;
  }
  if (!src) {
    $('clip-missing-text').textContent = `Choose the video file for clip ${clip}.`;
    $('clip-missing').hidden = false;
    return;
  }
  try {
    say(`Opening ${src.title}…`);
    await loadVideo(clipVideo, src.url);
    ana.clipId = src.id;
    ana.clipTitle = src.title;
    $('video-pane').hidden = ana.current !== null;
    let fps = fpsCache.get(src.id);
    if (!fps) { fps = await frameRateOf(clipVideo, src.fps); fpsCache.set(src.id, fps); }
    player.fps = fps;
    await seekFrame(clipVideo, Math.min(0.001, clipVideo.duration / 2));
    player.refresh();
    say(`${src.title}: ${clock(clipVideo.duration)} long, ${fps.toFixed(fps % 1 ? 2 : 0)} frames per second.`);
  } catch (err) {
    say((err as Error).message);
  }
}

function setMode(mode: 'video' | 'edit'): void {
  $('video-pane').hidden = mode !== 'video' || !clipVideo.currentSrc;
  $('edit-pane').hidden = mode !== 'edit';
  $('snap-props').hidden = mode !== 'edit';
  if (mode === 'video') { ana.current = null; renderSnapList(); }
}

function nextPromptId(): string | null {
  const a = analysisDef(), snaps = aWork().snapshots;
  if (!a.prompts.length) return null;
  const counts = a.prompts.map((p) => snaps.filter((s) => s.promptId === p.id).length);
  return a.prompts[counts.indexOf(Math.min(...counts))].id;
}

async function capture(): Promise<void> {
  if (view !== 'work' || !clipVideo.videoWidth || ana.current) return;
  clipVideo.pause();
  const vw = clipVideo.videoWidth, vh = clipVideo.videoHeight, k = Math.min(1, 1920 / Math.max(vw, vh));
  const w = Math.round(vw * k), h = Math.round(vh * k);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(clipVideo, 0, 0, w, h);
  const image = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not capture the picture.'))), 'image/jpeg', 0.92));
  const aw = aWork(), n = aw.snapshots.length + 1;
  const snap: Snapshot = { id: `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, name: `A${ana.index + 1} ${label('snapshot')} ${n}`, promptId: nextPromptId(), videoId: ana.clipId, time: clipVideo.currentTime, image, width: w, height: h, shapes: [] };
  aw.snapshots.push(snap);
  changed();
  say(`Captured ${snap.name} at ${clock(snap.time)}. Draw and write on it, then go back to the video for the next one.`);
  await editSnapshot(snap);
}

async function editSnapshot(s: Snapshot): Promise<void> {
  ana.current = s;
  const bmp = await bitmapOf(s);
  snapBg = bmp;
  setMode('edit');
  snapEditor.load(s.width, s.height, s.shapes);
  $<HTMLInputElement>('snap-name').value = s.name;
  const sel = $<HTMLSelectElement>('snap-prompt');
  sel.innerHTML = `<option value="">(none)</option>${analysisDef().prompts.map((p) => `<option value="${esc(p.id)}">${esc(p.title)}</option>`).join('')}`;
  sel.value = s.promptId ?? '';
  $('snap-time').textContent = `Clip time ${clock(s.time)}`;
  updatePromptDetail();
  renderSnapList();
  snapTools.sync();
}

let snapBg: ImageBitmap | null = null;

function updatePromptDetail(): void {
  const p = analysisDef().prompts.find((x) => x.id === ana.current?.promptId);
  $('snap-prompt-detail').textContent = p ? `${p.detail ?? ''}${p.points ? ` (${p.points} points)` : ''}` : '';
}

const hasText = (s: Snapshot) => s.shapes.some((x) => (x.type === 'text' || x.type === 'force' || x.type === 'plane' || x.type === 'axis') && (x.text ?? '').trim());
const hasDrawing = (s: Snapshot) => s.shapes.some((x) => x.type !== 'text');

function renderSnapList(): void {
  if (ana.index < 0) return;
  const a = analysisDef(), snaps = aWork().snapshots;
  const drawingReq = a.drawing !== 'optional';
  const yes = (on: boolean, text: string) => `<span class="${on ? 'yes' : 'no'}">${on ? '✓' : '○'} ${text}</span>`;
  $('prompt-list').innerHTML = a.prompts.map((p) => {
    const mine = snaps.filter((s) => s.promptId === p.id);
    return `<li><b>${esc(p.title)}</b>${p.points ? ` <span class="pts">${p.points} pts</span>` : ''}<span class="detail">${esc(p.detail ?? '')}</span>
      <span class="checks">${yes(mine.length > 0, `${mine.length} ${label('snapshot').toLowerCase()}${mine.length === 1 ? '' : 's'}`)}${yes(mine.some(hasText), 'text')}${yes(mine.some(hasDrawing), drawingReq ? 'drawing' : 'drawing (optional)')}</span></li>`;
  }).join('');
  const list = $('snap-list');
  list.innerHTML = '';
  $('snap-empty').hidden = snaps.length > 0;
  for (const s of snaps) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-current', String(ana.current?.id === s.id));
    const thumb = document.createElement('canvas');
    const p = a.prompts.find((x) => x.id === s.promptId);
    b.appendChild(thumb);
    b.insertAdjacentHTML('beforeend', `<span><span class="sn-name">${esc(s.name)}</span><span class="sn-meta">${esc(p?.title ?? 'No prompt chosen')} · ${clock(s.time)} · ${s.shapes.length} item${s.shapes.length === 1 ? '' : 's'}</span></span>`);
    b.addEventListener('click', () => void editSnapshot(s));
    li.appendChild(b);
    list.appendChild(li);
    void drawThumb(thumb, s);
  }
}

async function drawThumb(c: HTMLCanvasElement, s: Snapshot): Promise<void> {
  const bmp = await bitmapOf(s);
  const k = 192 / s.width;
  c.width = 192;
  c.height = Math.round(s.height * k);
  const ctx = c.getContext('2d')!;
  ctx.scale(k, k);
  ctx.drawImage(bmp, 0, 0, s.width, s.height);
  for (const sh of s.shapes) drawShape(ctx, sh, s.height);
}

async function exportPdf(): Promise<void> {
  const a = analysisDef(), snaps = aWork().snapshots;
  if (!snaps.length) { say(`Capture at least one ${label('snapshot').toLowerCase()} first.`); return; }
  if (needName()) return;
  busy('Making the PDF…');
  try {
    const titles = new Map<string, string>(cfg.videos.map((v) => [v.id, v.title]));
    const clipTitle = [...new Set(snaps.map((s) => titles.get(s.videoId) ?? (s.videoId.startsWith('local:') ? ana.clipTitle || `Clip ${a.clip ?? 1}` : s.videoId)))].join(', ');
    const blob = await analysisPdf(snaps, { course: cfg.title, student: work.student, project: project(), analysis: a, clipTitle, snapshotLabel: label('snapshot') });
    download(blob, `${exportBase(work.student, project(), ana.index)}.pdf`);
    say('PDF downloaded. Upload it to the assignment on your course site.');
  } catch (err) {
    say(`Could not make the PDF: ${(err as Error).message}`);
  } finally {
    busy(null);
  }
}

// ---- Comparison ---------------------------------------------------------------------------------

const CW = 1280, CH = 720;
const cmp = {
  index: -1,
  v1: $<HTMLVideoElement>('cmp-v1'),
  v2: $<HTMLVideoElement>('cmp-v2'),
  p1: null as unknown as ClipPlayer,
  p2: null as unknown as ClipPlayer,
  syncBar: null as unknown as Bar,
  editor: null as unknown as Editor,
  tools: null as unknown as ToolbarHandle,
  fps1: 30,
  fps2: 30,
  raf: 0,
  playing: false,
  lastFix: 0,
  exporting: false,
  ready: false,
};

const cmpDef = () => project().analyses[cmp.index];
const cWork = (): CompareWork => {
  const aw = analysisWork(work, projectId, cmpDef().id);
  return (aw.compare ??= { sync: null, posA: 0, posB: 0, items: [] });
};
const range = (s: SyncPair) => syncRange(s, cmp.v1.duration || 0, cmp.v2.duration || 0);

async function openCompare(i: number): Promise<void> {
  cmp.index = i;
  cmp.ready = false;
  const a = cmpDef();
  $('cmp-h').textContent = a.title;
  $('cmp-instructions').textContent = a.instructions ?? '';
  $('cmp-prompts').innerHTML = a.prompts.map((p) => `<li><b>${esc(p.title)}</b>${p.points ? ` <span class="pts">${p.points} pts</span>` : ''}<span class="detail">${esc(p.detail ?? '')}</span></li>`).join('');
  show('compare');
  $('cmp-pane').hidden = true;
  $('cmp-missing').hidden = true;
  let s1, s2;
  try {
    [s1, s2] = [await clipSource(1), await clipSource(2)];
  } catch (err) {
    say((err as Error).message);
    return;
  }
  if (!s1 || !s2) {
    $('cmp-missing').hidden = false;
    say(`Choose ${!s1 && !s2 ? 'both clips' : !s1 ? 'clip 1' : 'clip 2'}.`);
    return;
  }
  try {
    say('Opening both clips…');
    await Promise.all([loadVideo(cmp.v1, s1.url), loadVideo(cmp.v2, s2.url)]);
    for (const [s, v, key] of [[s1, cmp.v1, 'fps1'], [s2, cmp.v2, 'fps2']] as const) {
      let fps = fpsCache.get(s.id);
      if (!fps) { fps = await frameRateOf(v, s.fps); fpsCache.set(s.id, fps); }
      cmp[key] = fps;
    }
    cmp.p1.fps = cmp.fps1;
    cmp.p2.fps = cmp.fps2;
    const cw = cWork();
    cmp.editor.load(CW, CH, cw.items.map((it) => it.shape));
    $('cmp-pane').hidden = false;
    cmp.ready = true;
    if (cw.sync) {
      await seekFrame(cmp.v1, Math.max(range(cw.sync).start, cw.sync.a));
      await seekFrame(cmp.v2, partnerTime(cw.sync, cmp.v1.currentTime));
    } else {
      await seekFrame(cmp.v1, Math.min(cw.posA, cmp.v1.duration - 1e-3));
      await seekFrame(cmp.v2, Math.min(cw.posB, cmp.v2.duration - 1e-3));
    }
    applyLockUi();
    say(cw.sync ? 'Clips are locked together. Pause where you want to explain something and add text.' : 'Move each clip to the same moment, then press Lock clips together.');
  } catch (err) {
    say((err as Error).message);
  }
}

function drawComposite(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, CW, CH);
  drawContained(ctx, cmp.v1, cmp.v1.videoWidth, cmp.v1.videoHeight, 0, 0, CW / 2, CH);
  drawContained(ctx, cmp.v2, cmp.v2.videoWidth, cmp.v2.videoHeight, CW / 2, 0, CW / 2, CH);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(CW / 2 - 1, 0, 2, CH);
}

function applyLockUi(): void {
  const s = cWork().sync;
  $('cmp-free').hidden = !!s;
  $('cmp-locked').hidden = !s;
  $('cmp-canvas').style.pointerEvents = s ? '' : 'none';
  if (!s) cmp.editor.setTool('select');
  cmp.tools.sync();
  renderItems();
  refreshCompare();
}

function refreshCompare(): void {
  if (!cmp.ready) return;
  const s = cWork().sync;
  if (s) {
    const r = range(s);
    cmp.syncBar.update(cmp.v1.currentTime, r.start, r.end, cmp.playing);
  }
  cmp.editor.redraw();
  markActiveItems();
}

function lock(): void {
  const cw = cWork();
  cw.sync = { a: cmp.v1.currentTime, b: cmp.v2.currentTime };
  changed();
  applyLockUi();
  say(`Locked: clip 1 at ${clock(cw.sync.a)} matches clip 2 at ${clock(cw.sync.b)}. Both now play and step together.`);
}

function unlockClips(): void {
  pauseSynced();
  const cw = cWork();
  if (cw.items.length && !confirm('Unlock the clips to re-align them? Your text and drawings stay, timed to clip 1.')) return;
  cw.posA = cmp.v1.currentTime;
  cw.posB = cmp.v2.currentTime;
  cw.sync = null;
  changed();
  applyLockUi();
}

function playSynced(): void {
  const s = cWork().sync;
  if (!s || cmp.playing) return;
  const r = range(s);
  if (cmp.v1.currentTime >= r.end - 1e-3) cmp.v1.currentTime = r.start;
  cmp.v2.currentTime = partnerTime(s, cmp.v1.currentTime);
  cmp.playing = true;
  void cmp.v1.play().catch(() => undefined);
  void cmp.v2.play().catch(() => undefined);
  const tick = () => {
    if (!cmp.playing) return;
    const t = cmp.v1.currentTime;
    if (t >= r.end - 1e-3 || cmp.v1.ended || cmp.v2.ended) { pauseSynced(); return; }
    const now = performance.now();
    if (now - cmp.lastFix > 500 && drifted(s, t, cmp.v2.currentTime, cmp.fps2)) { cmp.v2.currentTime = partnerTime(s, t); cmp.lastFix = now; }
    refreshCompare();
    cmp.raf = requestAnimationFrame(tick);
  };
  cmp.raf = requestAnimationFrame(tick);
  refreshCompare();
}

function pauseSynced(): void {
  cmp.playing = false;
  cancelAnimationFrame(cmp.raf);
  cmp.v1.pause();
  cmp.v2.pause();
  refreshCompare();
}

async function seekSynced(t: number, exact = true): Promise<void> {
  const s = cWork().sync;
  if (!s) return;
  const r = range(s), tt = Math.min(r.end - 1e-3, Math.max(r.start, t));
  if (!exact) { cmp.v1.currentTime = tt; cmp.v2.currentTime = partnerTime(s, tt); refreshCompare(); return; }
  const shown = await seekFrame(cmp.v1, tt);
  await seekFrame(cmp.v2, partnerTime(s, shown));
  refreshCompare();
}

let stepPending = 0, stepBusy = false;
/** Steps both clips by whole frames of clip 1; quick repeated clicks add up. */
async function stepSynced(dir: -1 | 1): Promise<void> {
  pauseSynced();
  stepPending += dir;
  if (stepBusy) return;
  stepBusy = true;
  try {
    while (stepPending !== 0) {
      const n = stepPending;
      stepPending = 0;
      const f = Math.round(cmp.v1.currentTime * cmp.fps1 - 0.5) + n;
      await seekSynced((f + 0.5) / cmp.fps1);
    }
  } finally {
    stepBusy = false;
  }
}

function itemName(it: TimedShape): string {
  const s = it.shape;
  if (s.text?.trim()) return s.text.trim().split('\n')[0].slice(0, 60);
  return { line: 'Line', arrow: 'Arrow', force: 'Force arrow', freehand: 'Pen drawing', ellipse: 'Circle', text: 'Text', angle: 'Angle', plane: 'Plane', axis: 'Axis' }[s.type];
}

function onCompareShapes(shapes: Shape[], created?: Shape): void {
  const cw = cWork(), byId = new Map(cw.items.map((it) => [it.shape.id, it]));
  const s = cw.sync, t = cmp.v1.currentTime, end = s ? range(s).end : t + DEFAULT_OVERLAY_SECONDS;
  cw.items = shapes.map((sh) => {
    const old = byId.get(sh.id);
    if (old) return { ...old, shape: sh };
    return { shape: sh, start: t, end: Math.min(end, t + DEFAULT_OVERLAY_SECONDS) };
  });
  if (created) say('Added. It shows for 3 seconds from here: change its times in the list on the right.');
  changed();
  renderItems();
}

function renderItems(): void {
  const cw = cWork(), list = $('cmp-items');
  list.innerHTML = '';
  $('cmp-items-empty').hidden = cw.items.length > 0;
  const s = cw.sync, base = s ? range(s).start : 0;
  const sorted = [...cw.items].sort((a, b) => a.start - b.start);
  for (const it of sorted) {
    const li = document.createElement('li');
    li.dataset.id = it.shape.id;
    li.innerHTML = `<span class="it-name"></span>
      <span class="it-times">
        <label for="st-${it.shape.id}">From</label><input type="number" id="st-${it.shape.id}" step="0.01" min="0" value="${(it.start - base).toFixed(2)}"><button type="button" data-a="st">Now</button>
        <label for="en-${it.shape.id}">To</label><input type="number" id="en-${it.shape.id}" step="0.01" min="0" value="${(it.end - base).toFixed(2)}"><button type="button" data-a="en">Now</button>
      </span>
      <div class="row wrap"><button type="button" data-a="go">Go to start</button><button type="button" data-a="del" class="danger">Delete</button></div>`;
    li.querySelector('.it-name')!.textContent = itemName(it);
    const [st, en] = li.querySelectorAll<HTMLInputElement>('input');
    const setTimes = (start: number, end: number) => {
      it.start = Math.max(0, start);
      it.end = Math.max(it.start + 0.04, end);
      changed();
      renderItems();
      refreshCompare();
    };
    st.addEventListener('change', () => setTimes(base + Number(st.value), it.end));
    en.addEventListener('change', () => setTimes(it.start, base + Number(en.value)));
    li.querySelector('[data-a=st]')!.addEventListener('click', () => setTimes(cmp.v1.currentTime, Math.max(it.end, cmp.v1.currentTime + 0.04)));
    li.querySelector('[data-a=en]')!.addEventListener('click', () => setTimes(it.start, cmp.v1.currentTime));
    li.querySelector('[data-a=go]')!.addEventListener('click', () => { pauseSynced(); void seekSynced(it.start).then(() => cmp.editor.select(it.shape.id)); });
    li.querySelector('[data-a=del]')!.addEventListener('click', () => { cmp.editor.select(it.shape.id); cmp.editor.deleteSelected(); cmp.tools.sync(); });
    list.appendChild(li);
  }
  markActiveItems();
}

function markActiveItems(): void {
  const active = new Set(activeAt(cWork().items, cmp.v1.currentTime).map((it) => it.shape.id));
  $('cmp-items').querySelectorAll<HTMLLIElement>('li').forEach((li) => li.classList.toggle('active', active.has(li.dataset.id!)));
}

async function exportVideo(): Promise<void> {
  const cw = cWork(), s = cw.sync;
  if (!cmp.ready) return;
  if (!s) { say('Lock the clips together first.'); return; }
  if (needName()) return;
  const rec = new VideoRecorder();
  if (!rec.supported) { say('This browser cannot record video. Try a current Chrome, Edge, Firefox or Safari.'); return; }
  const r = range(s);
  cmp.exporting = true;
  cmp.editor.select(null);
  let cancelled = false;
  busy('Recording the comparison. Keep this tab open and visible…', 0, () => { cancelled = true; });
  try {
    pauseSynced();
    for (const v of [cmp.v1, cmp.v2]) v.playbackRate = 1;
    await seekSynced(r.start);
    rec.start(cmp.editor.canvas, 30);
    await new Promise<void>((resolve) => {
      cmp.playing = true;
      void cmp.v1.play();
      void cmp.v2.play();
      const tick = () => {
        const t = cmp.v1.currentTime;
        if (cancelled || t >= r.end - 1e-3 || cmp.v1.ended || cmp.v2.ended) { resolve(); return; }
        if (drifted(s, t, cmp.v2.currentTime, cmp.fps2) && performance.now() - cmp.lastFix > 500) { cmp.v2.currentTime = partnerTime(s, t); cmp.lastFix = performance.now(); }
        cmp.editor.redraw();
        busy('Recording the comparison. Keep this tab open and visible…', (t - r.start) / Math.max(0.01, r.end - r.start), () => { cancelled = true; });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    pauseSynced();
    const blob = await rec.stop();
    if (cancelled) { say('Export cancelled.'); return; }
    if (!blob || !blob.size) { say('The recording came out empty. Try again, keeping this tab in front.'); return; }
    download(blob, `${exportBase(work.student, project(), cmp.index)}.${rec.extension}`);
    say(`Video downloaded (${rec.extension.toUpperCase()}, ${(blob.size / 1e6).toFixed(1)} MB). Upload it to the assignment on your course site.`);
  } catch (err) {
    say(`Could not export the video: ${(err as Error).message}`);
  } finally {
    cmp.exporting = false;
    busy(null);
  }
}

// ---- Set-up -------------------------------------------------------------------------------------

function initAnalysisUi(): void {
  player = new ClipPlayer(clipVideo, $('clip-bar'));
  snapEditor = new Editor($<HTMLCanvasElement>('snap-canvas'), {
    drawBackground: (ctx) => { if (snapBg && ana.current) ctx.drawImage(snapBg, 0, 0, ana.current.width, ana.current.height); },
    onChange: (shapes) => {
      if (!ana.current) return;
      ana.current.shapes = shapes;
      changed();
      renderSnapList();
      snapTools.sync();
    },
    onSelect: () => snapTools?.sync(),
    onTool: () => snapTools.sync(),
  });
  snapTools = buildToolbar($('snap-tools'), snapEditor);
  $('btn-capture').addEventListener('click', () => void capture());
  $('btn-back-video').addEventListener('click', () => { snapEditor.select(null); setMode('video'); $('video-pane').hidden = !clipVideo.currentSrc; });
  $('work-back').addEventListener('click', () => { renderHome(); show('home'); });
  $('btn-pdf').addEventListener('click', () => void exportPdf());
  $('snap-name').addEventListener('input', () => {
    if (!ana.current) return;
    ana.current.name = $<HTMLInputElement>('snap-name').value;
    changed();
    renderSnapList();
  });
  $('snap-prompt').addEventListener('change', () => {
    if (!ana.current) return;
    ana.current.promptId = $<HTMLSelectElement>('snap-prompt').value || null;
    changed();
    updatePromptDetail();
    renderSnapList();
  });
  const move = (d: -1 | 1) => {
    const list = aWork().snapshots, i = list.findIndex((s) => s.id === ana.current?.id), j = i + d;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    changed();
    renderSnapList();
  };
  $('snap-up').addEventListener('click', () => move(-1));
  $('snap-down').addEventListener('click', () => move(1));
  $('snap-delete').addEventListener('click', () => {
    const s = ana.current;
    if (!s || !confirm(`Delete ${s.name} and its drawings? This cannot be undone.`)) return;
    const aw = aWork();
    aw.snapshots = aw.snapshots.filter((x) => x.id !== s.id);
    bitmaps.delete(s.id);
    changed();
    setMode('video');
    $('video-pane').hidden = !clipVideo.currentSrc;
    say(`Deleted ${s.name}.`);
  });
  $('file-clip').addEventListener('change', async () => {
    const f = $<HTMLInputElement>('file-clip').files?.[0];
    $<HTMLInputElement>('file-clip').value = '';
    if (!f) return;
    await storeLocalClip(analysisDef().clip ?? 1, f);
    await loadAnalysisClip();
  });
}

function initCompareUi(): void {
  const onChange = () => {
    if (cmp.exporting) return;
    if (!cWork().sync && cmp.ready) { const cw = cWork(); cw.posA = cmp.v1.currentTime; cw.posB = cmp.v2.currentTime; }
    refreshCompare();
  };
  cmp.p1 = new ClipPlayer(cmp.v1, $('cmp-bar-1'), onChange, 'Clip 1');
  cmp.p2 = new ClipPlayer(cmp.v2, $('cmp-bar-2'), onChange, 'Clip 2');
  cmp.syncBar = buildBar($('cmp-bar-sync'), {
    toggle: () => (cmp.playing ? pauseSynced() : playSynced()),
    step: (d) => void stepSynced(d),
    seek: (t, final) => { pauseSynced(); void seekSynced(t, final); },
    speed: (rate) => { cmp.v1.playbackRate = rate; cmp.v2.playbackRate = rate; },
  }, 'Both');
  cmp.editor = new Editor($<HTMLCanvasElement>('cmp-canvas'), {
    drawBackground: drawComposite,
    onChange: (shapes, created) => { onCompareShapes(shapes, created); cmp.tools.sync(); },
    onSelect: () => cmp.tools?.sync(),
    onTool: () => cmp.tools.sync(),
    isVisible: (sh) => {
      const it = cWork().items.find((x) => x.shape.id === sh.id);
      // A shape just drawn has no item yet: it is on screen now by definition.
      return !it || activeAt([it], cmp.v1.currentTime).length > 0;
    },
  });
  cmp.tools = buildToolbar($('cmp-tools'), cmp.editor, { disabled: () => (cmp.index >= 0 && !cWork().sync ? 'Lock the clips together before adding text or drawings.' : null) });
  $('btn-lock').addEventListener('click', lock);
  $('btn-unlock').addEventListener('click', unlockClips);
  $('cmp-back').addEventListener('click', () => { pauseSynced(); renderHome(); show('home'); });
  $('btn-export-video').addEventListener('click', () => void exportVideo());
  for (const clip of [1, 2] as const) {
    $(`file-cmp-${clip}`).addEventListener('change', async () => {
      const input = $<HTMLInputElement>(`file-cmp-${clip}`), f = input.files?.[0];
      input.value = '';
      if (!f) return;
      await storeLocalClip(clip, f);
      await openCompare(cmp.index);
    });
  }
}

function initHomeUi(): void {
  $('project-select').addEventListener('change', () => { projectId = $<HTMLSelectElement>('project-select').value; renderHome(); });
  $('student-name').addEventListener('input', () => { work.student = $<HTMLInputElement>('student-name').value; updateStudentChip(); changed(); });
  $('btn-backup').addEventListener('click', async () => {
    busy('Preparing the backup…');
    try {
      const b = await toBackup(work, cfg.id);
      download(new Blob([JSON.stringify(b)], { type: 'application/json' }), `course-work-${stamp()}.json`);
      say(usesLocalFiles() ? 'Backup downloaded. Video files you chose are not included: choose them again on the other device.' : 'Backup downloaded.');
    } finally {
      busy(null);
    }
  });
  $('file-backup').addEventListener('change', async () => {
    const input = $<HTMLInputElement>('file-backup'), f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      const restored = fromBackup(JSON.parse(await f.text()) as Backup, cfg.id);
      if (!confirm('Replace the work on this device with the backup?')) return;
      work = restored;
      bitmaps.clear();
      await saver.flush();
      renderHome();
      say('Backup restored.');
    } catch (err) {
      say(`Could not restore: ${(err as Error).message}`);
    }
  });
  $('btn-forget').addEventListener('click', () => {
    if (!confirm('Forget the course code on this device? Your saved work stays; you will need the code to open it again.')) return;
    rememberCode(null);
    location.reload();
  });
}

function initKeys(): void {
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable]')) return;
    if (view === 'work') {
      if (ana.current) {
        if (snapEditor.key(e)) { e.preventDefault(); snapTools.sync(); return; }
        const tool = !e.ctrlKey && !e.metaKey && !e.altKey ? toolForKey(e.key) : null;
        if (tool) { snapTools.setTool(tool); e.preventDefault(); }
        return;
      }
      if (e.key === ' ') { player.toggle(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { void player.step(-1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { void player.step(1); e.preventDefault(); }
      else if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey) { void capture(); e.preventDefault(); }
    } else if (view === 'compare' && cmp.ready && !cmp.exporting) {
      const locked = !!cWork().sync;
      if (locked && cmp.editor.key(e)) { e.preventDefault(); cmp.tools.sync(); return; }
      if (e.key === ' ' && locked) { if (cmp.playing) pauseSynced(); else playSynced(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft' && locked) { void stepSynced(-1); e.preventDefault(); }
      else if (e.key === 'ArrowRight' && locked) { void stepSynced(1); e.preventDefault(); }
      else if (locked && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tool = toolForKey(e.key);
        if (tool) { cmp.tools.setTool(tool); e.preventDefault(); }
      }
    }
  });
}

function init(): void {
  initAnalysisUi();
  initCompareUi();
  initHomeUi();
  initKeys();
  $('busy-cancel').addEventListener('click', () => busyCancel?.());
  $('gate-form').addEventListener('submit', (e) => {
    e.preventDefault();
    void tryOpen($<HTMLInputElement>('gate-code').value, $<HTMLInputElement>('gate-remember').checked);
  });
  window.addEventListener('pagehide', () => void saver?.flush());
  document.addEventListener('visibilitychange', () => { if (document.hidden) void saver?.flush(); });
  const code = rememberedCode();
  if (code) {
    void tryOpen(code, true).then((ok) => { if (!ok) { show('gate'); $('gate-code').focus(); } });
  } else {
    show('gate');
    $('gate-code').focus();
  }
}

init();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(`sw.js?v=${__APP_VERSION__}`).catch(() => undefined);
}

