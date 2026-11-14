// Draws one composited frame: video, anatomy layers, skeleton, measurements, HUD.
// Everything on this canvas ends up in screenshots and recorded video.
import { facingPlane, type PlaneId } from '../analysis/bodyFrame';
import type { BodyModel } from '../analysis/com';
import { baseOfSupport, staticMoment, type StaticJoint, type StaticMoment } from '../analysis/statics';
import { buildRig, detectView, drawMuscles, type JointGroup, type ViewInfo } from '../anatomy/anatomy';
import { drawBones } from '../anatomy/bones';
import { CATALOG_BY_ID } from '../anatomy/catalog';
import { locate, type LocateResult } from '../anatomy/search';
import { drawSystem, type SystemId } from '../anatomy/systems';
import type { Calibration } from '../kinematics/calibration';
import type { LiveSample } from '../live';
import { ANGLE_BY_ID, DEG } from '../measure/definitions';
import { getPoint, L, POINT_LABELS, sideOf, SKELETON, type PointId } from '../pose/landmarks';
import type { Lm } from '../types';
import { drawBar, drawCountdown, drawGravity, drawMoment, drawPlaneInset, drawPlanes, drawVelocityVectors, LabelPlacer } from './teach';

export interface Layers {
  videoOpacity: number;
  skeleton: boolean;
  labels: boolean;
  trails: boolean;
  com: boolean;
  bones: boolean;
  bonesOpacity: number;
  muscles: boolean;
  musclesOpacity: number;
  highlight: JointGroup | null;
  axes: boolean;
  systems: Record<SystemId, boolean>;
  systemsOpacity: number;
  /** Catalog id of the structure being searched for, or null. */
  find: string | null;
  /** Cardinal planes and their axes of rotation. */
  planes: Record<PlaneId, boolean>;
  planeAxes: Record<PlaneId, boolean>;
  /** Where the planes and axes are centred: 'body' (centre of mass), 'trunk', or a joint name. */
  planeCentre: string;
  planeInset: boolean;
  /** Line of gravity and base of support. */
  gravity: boolean;
  /** Velocity vectors on the tracked points and rotating segments. */
  vectors: boolean;
  /** Joint for the gravitational moment overlay, or null. */
  moment: StaticJoint | null;
}

export interface Scene {
  w: number;
  h: number;
  /** Background image (video frame or replay bitmap); null draws the demo backdrop. */
  bg: CanvasImageSource | null;
  mirrorBg: boolean;
  sample: LiveSample | null;
  layers: Layers;
  angles: string[];
  minVisibility: number;
  calibration: Calibration;
  mirrored: boolean;
  trails: Map<PointId, { x: number; y: number }[]>;
  /** Points picked so far for calibration / origin, in image pixels. */
  picks: { x: number; y: number }[];
  hud: string[];
  recording: boolean;
  /** Seconds, for animation (blood flow, search pulse). Null = no animation (reduced motion). */
  time: number | null;
  bodyModel?: BodyModel;
  /** Body mass (kg) and hand-held or barbell load (kg) for the joint-moment overlay. */
  bodyMassKg?: number;
  loadKg?: number;
  /** Weight lifting mode: recent bar positions (image pixels) and a plate awaiting confirmation. */
  barTrail?: { x: number; y: number }[];
  proposal?: { x: number; y: number; r: number } | null;
  /** Large centred countdown text, when a countdown is running. */
  countdown?: { text: string; sub: string } | null;
}

export interface SceneResult {
  musclesDrawn: string[];
  search: LocateResult | null;
  /** Results of the teaching overlays, for the text readouts beside the picture. */
  gravity: string;
  moment: StaticMoment | null;
  view: ViewInfo | null;
  facing: { plane: PlaneId; offDeg: number } | null;
}

/** Pixels per metre at the subject, from the trunk: its length in the picture against its estimated real length. */
function pxPerMetre(lm: Lm[], world: Lm[] | null): number {
  const mid = (a: Lm, b: Lm) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const ms = mid(lm[L.l_shoulder], lm[L.r_shoulder]), mh = mid(lm[L.l_hip], lm[L.r_hip]);
  const px = Math.hypot(ms.x - mh.x, ms.y - mh.y) || 1;
  if (world) {
    const ws = mid(world[L.l_shoulder], world[L.r_shoulder]), wh = mid(world[L.l_hip], world[L.r_hip]);
    const m = Math.hypot(ws.x - wh.x, ws.y - wh.y);
    if (m > 0.15) return px / m;
  }
  return px / 0.5;
}

export const SIDE_COLOR = { l: '#ffb020', r: '#22d3ee', c: '#f8fafc' } as const;

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color = '#fff', align: CanvasTextAlign = 'left'): void {
  ctx.font = `600 ${size}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineWidth = size * 0.28;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.lineJoin = 'round';
  ctx.strokeText(s, x, y);
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

export function drawScene(ctx: CanvasRenderingContext2D, sc: Scene): SceneResult {
  const { w, h, layers: ly } = sc;
  const k = Math.max(w, h) / 1000;
  let musclesDrawn: string[] = [];
  let gravityText = '', moment: StaticMoment | null = null, view: ViewInfo | null = null;
  const anyPlane = Object.values(ly.planes).some(Boolean) || Object.values(ly.planeAxes).some(Boolean);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(0, 0, w, h);
  if (sc.bg) {
    ctx.save();
    ctx.globalAlpha = ly.videoOpacity;
    if (sc.mirrorBg) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(sc.bg, 0, 0, w, h);
    ctx.restore();
  } else {
    // Demo backdrop: floor line and a metre grid so the synthetic scale is visible.
    ctx.strokeStyle = 'rgba(148,163,184,0.18)';
    ctx.lineWidth = 1;
    for (let x = w / 2 % 150; x < w; x += 150) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 660; y > 0; y -= 150) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(248,250,252,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 660); ctx.lineTo(w, 660); ctx.stroke();
  }

  const s = sc.sample;
  const lm = s?.lm ?? null;
  if (lm) {
    const anySystem = Object.values(ly.systems).some(Boolean);
    const info = (ly.bones || ly.muscles || anySystem) ? detectView(lm, s!.world, sc.mirrored) : null;
    if (info) {
      // Deep to superficial.
      const rig = anySystem ? buildRig(lm, info) : null;
      const o = { alpha: ly.systemsOpacity, time: sc.time, labels: false };
      if (rig && ly.systems.organs) drawSystem(ctx, 'organs', rig, o);
      if (ly.bones) drawBones(ctx, lm, info, ly.bonesOpacity);
      if (rig) for (const sys of ['ligaments', 'veins', 'arteries', 'nerves', 'lymph'] as const) if (ly.systems[sys]) drawSystem(ctx, sys, rig, o);
      if (ly.muscles) musclesDrawn = drawMuscles(ctx, lm, info, ly.musclesOpacity, ly.highlight, sc.minVisibility);
      if (rig && ly.systems.landmarks) drawSystem(ctx, 'landmarks', rig, { ...o, alpha: 1, labels: true });
    }

    view = info ?? ((anyPlane && ly.planeCentre !== 'body' && ly.planeCentre !== 'trunk') || ly.moment ? detectView(lm, s!.world, sc.mirrored) : null);
    if (anyPlane && s!.frame) {
      const ppm = pxPerMetre(lm, s!.world), o = { planes: ly.planes, axes: ly.planeAxes };
      const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const place = new LabelPlacer();
      if (ly.planeCentre === 'body' || ly.planeCentre === 'trunk') {
        const trunk = mid(mid(lm[L.l_shoulder], lm[L.r_shoulder]), mid(lm[L.l_hip], lm[L.r_hip]));
        const whole = ly.planeCentre === 'body', c = whole && s!.com ? s!.com : trunk;
        // With the vertical as the long axis, upright sheets span from the lowest foot to above the head.
        const feet = Math.max(lm[L.l_heel].y, lm[L.r_heel].y, lm[L.l_toe].y, lm[L.r_toe].y), head = Math.min(lm[L.l_ear].y, lm[L.r_ear].y, lm[L.nose].y);
        const span = whole && Math.abs(s!.frame.up.y) > 0.98 && feet > c.y && head < c.y ? { below: (feet - c.y) / ppm + 0.03, above: (c.y - head) / ppm + 0.22 } : undefined;
        drawPlanes(ctx, s!.frame, c, ppm, whole ? 1 : 0.5, o, k, place, span);
      } else if (view) {
        const sides = view.view === 'lateral' ? [view.nearSide] : (['l', 'r'] as const);
        sides.forEach((sd, i) => {
          const p = lm[L[`${sd}_${ly.planeCentre}` as keyof typeof L]];
          if (p && p.v >= sc.minVisibility) drawPlanes(ctx, s!.frame!, p, ppm, 0.3, o, k, i === 0 ? place : null);
        });
      }
    }

    if (ly.skeleton) {
      ctx.lineCap = 'round';
      for (const [a, b] of SKELETON) {
        const p = lm[L[a]], q = lm[L[b]];
        const ok = p.v >= sc.minVisibility && q.v >= sc.minVisibility;
        const side = sideOf(a) === sideOf(b) ? sideOf(a) : 'c';
        ctx.strokeStyle = ok ? SIDE_COLOR[side] : 'rgba(148,163,184,0.55)';
        ctx.lineWidth = (ok ? 4 : 2) * k;
        ctx.setLineDash(ok ? [] : [6 * k, 6 * k]);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
      ctx.setLineDash([]);
      for (let i = 11; i < 33; i++) {
        if (i >= 17 && i <= 22) continue;
        const p = lm[i];
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5 * k, 0, Math.PI * 2);
        ctx.fillStyle = p.v >= sc.minVisibility ? '#0b1220' : 'rgba(100,116,139,0.6)';
        ctx.fill();
        ctx.lineWidth = 2 * k;
        ctx.strokeStyle = p.v >= sc.minVisibility ? '#f8fafc' : 'rgba(148,163,184,0.6)';
        ctx.stroke();
      }
      const nose = lm[L.nose];
      if (nose.v >= sc.minVisibility) { ctx.beginPath(); ctx.arc(nose.x, nose.y, 4 * k, 0, Math.PI * 2); ctx.fillStyle = '#f8fafc'; ctx.fill(); }
    }

    if (ly.trails) {
      let ci = 0;
      for (const [, pts] of sc.trails) {
        ctx.strokeStyle = ['#a78bfa', '#4ade80', '#fb7185', '#facc15', '#60a5fa'][ci++ % 5];
        ctx.lineWidth = 2.5 * k;
        for (let i = 1; i < pts.length; i++) {
          ctx.globalAlpha = (i / pts.length) * 0.9;
          ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }

    if (ly.com && s!.com) {
      const c = s!.com, r = 9 * k;
      ctx.lineWidth = 2 * k;
      ctx.strokeStyle = '#0b1220';
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#0b1220';
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.arc(c.x, c.y, r, 0, Math.PI / 2); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.arc(c.x, c.y, r, Math.PI, 1.5 * Math.PI); ctx.closePath(); ctx.fill();
    }

    if (ly.gravity && s!.com) gravityText = drawGravity(ctx, s!.com, baseOfSupport(lm, s!.com.x, sc.minVisibility), sc.calibration, h, k);
    if (ly.vectors) drawVelocityVectors(ctx, s!, lm, sc.angles, sc.calibration, k);
    if (ly.moment && view) {
      const lw = lm[L.l_wrist], rw = lm[L.r_wrist];
      const hands = s!.bar ? { x: s!.bar.px, y: s!.bar.py } : { x: (lw.x + rw.x) / 2, y: (lw.y + rw.y) / 2 };
      moment = staticMoment({
        lm, joint: ly.moment, side: view.nearSide, bodyModel: sc.bodyModel ?? 'average', minVisibility: sc.minVisibility, bodyMassKg: sc.bodyMassKg ?? NaN,
        scale: sc.calibration.unit === 'm' ? sc.calibration.scale : NaN, load: sc.loadKg ? { kg: sc.loadKg, ...hands } : null,
      });
      if (moment) drawMoment(ctx, moment, k);
    }

    if (ly.labels) {
      for (const id of sc.angles) {
        const def = ANGLE_BY_ID.get(id), a = s!.angles.get(id);
        if (!def || !a || !Number.isFinite(a.value)) continue;
        const color = SIDE_COLOR[def.side];
        const label = `${a.value.toFixed(0)}${DEG}`;
        if (def.kind === 'joint') {
          const pa = getPoint(lm, def.a, 0), pb = getPoint(lm, def.b, 0), pc = getPoint(lm, def.c, 0);
          if (!pa || !pb || !pc) continue;
          const a1 = Math.atan2(pa.y - pb.y, pa.x - pb.x), a2 = Math.atan2(pc.y - pb.y, pc.x - pb.x);
          let d = a2 - a1;
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          const rr = 30 * k;
          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.lineWidth = 2.5 * k;
          ctx.globalAlpha = 0.25;
          ctx.beginPath(); ctx.moveTo(pb.x, pb.y); ctx.arc(pb.x, pb.y, rr, a1, a1 + d, d < 0); ctx.closePath(); ctx.fill();
          ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.arc(pb.x, pb.y, rr, a1, a1 + d, d < 0); ctx.stroke();
          const midA = a1 + d / 2;
          text(ctx, label, pb.x + Math.cos(midA) * rr * 2.1, pb.y + Math.sin(midA) * rr * 2.1, 20 * k, color, 'center');
        } else {
          const from = getPoint(lm, def.from, 0), to = getPoint(lm, def.to, 0);
          if (!from || !to) continue;
          ctx.strokeStyle = color;
          ctx.lineWidth = 2 * k;
          ctx.setLineDash([6 * k, 5 * k]);
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          if (def.ref === 'vertical') ctx.lineTo(from.x, from.y - 90 * k); else ctx.lineTo(from.x + 90 * k, from.y);
          ctx.stroke();
          ctx.setLineDash([]);
          text(ctx, label, (from.x + to.x) / 2 + 14 * k, (from.y + to.y) / 2, 18 * k, color);
        }
      }
    }
  }

  if (ly.axes) {
    const o = sc.calibration.origin, len = 70 * k;
    ctx.strokeStyle = '#4ade80';
    ctx.fillStyle = '#4ade80';
    ctx.lineWidth = 2.5 * k;
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + len, o.y); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x, o.y - len); ctx.stroke();
    text(ctx, 'x', o.x + len + 10 * k, o.y, 16 * k, '#4ade80');
    text(ctx, 'y', o.x, o.y - len - 12 * k, 16 * k, '#4ade80', 'center');
  }
  sc.picks.forEach((p, i) => {
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 2.5 * k;
    ctx.beginPath(); ctx.arc(p.x, p.y, 9 * k, 0, Math.PI * 2); ctx.moveTo(p.x - 14 * k, p.y); ctx.lineTo(p.x + 14 * k, p.y); ctx.moveTo(p.x, p.y - 14 * k); ctx.lineTo(p.x, p.y + 14 * k); ctx.stroke();
    if (i > 0) { ctx.beginPath(); ctx.moveTo(sc.picks[i - 1].x, sc.picks[i - 1].y); ctx.lineTo(p.x, p.y); ctx.stroke(); }
  });

  // Anatomy search: ring on-screen structures, arrow toward off-screen ones.
  let search: LocateResult | null = null;
  const target = ly.find ? CATALOG_BY_ID.get(ly.find) : undefined;
  if (target) {
    search = locate(target, lm, s?.world ?? null, sc.mirrored, w, h, sc.minVisibility);
    const pulse = sc.time === null ? 0.5 : 0.5 + 0.5 * Math.sin(sc.time * 5);
    for (const m of search.marks) {
      const name = `${m.side === 'l' ? 'L ' : m.side === 'r' ? 'R ' : ''}${target.name}`;
      ctx.strokeStyle = '#fde047';
      ctx.fillStyle = '#fde047';
      if (m.status === 'offscreen') {
        const a = m.arrowAt!, ang = m.angle!, len = (34 + 10 * pulse) * k;
        ctx.save();
        ctx.translate(a.x, a.y);
        ctx.rotate(ang);
        ctx.lineWidth = 5 * k;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        for (const pass of [0, 1]) {
          if (pass) { ctx.strokeStyle = '#fde047'; ctx.lineWidth = 2.5 * k; }
          ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len * 0.4, 0); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(len, 0); ctx.lineTo(len * 0.35, -len * 0.4); ctx.lineTo(len * 0.35, len * 0.4); ctx.closePath();
          if (pass) ctx.fill(); else ctx.stroke();
        }
        ctx.restore();
        const tx = Math.min(w - 12 * k, Math.max(12 * k, a.x - Math.cos(ang) * 70 * k)), ty = Math.min(h - 16 * k, Math.max(16 * k, a.y - Math.sin(ang) * 70 * k));
        text(ctx, `${name} is this way`, tx, ty, 17 * k, '#fde047', tx > w * 0.66 ? 'right' : tx < w * 0.33 ? 'left' : 'center');
      } else {
        const r = (22 + 8 * pulse) * k;
        ctx.setLineDash(m.status === 'uncertain' ? [6 * k, 5 * k] : []);
        ctx.lineWidth = 6 * k;
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.beginPath(); ctx.arc(m.p.x, m.p.y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 3 * k;
        ctx.strokeStyle = '#fde047';
        ctx.beginPath(); ctx.arc(m.p.x, m.p.y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
        const right = m.p.x < w * 0.7, lx = m.p.x + (right ? 1 : -1) * 70 * k, lyy = Math.max(18 * k, m.p.y - 46 * k);
        ctx.lineWidth = 2 * k;
        ctx.beginPath(); ctx.moveTo(m.p.x + (right ? r : -r) * 0.7, m.p.y - r * 0.7); ctx.lineTo(lx, lyy); ctx.stroke();
        text(ctx, m.status === 'uncertain' ? `${name} (position uncertain)` : name, lx + (right ? 6 : -6) * k, lyy, 17 * k, '#fde047', right ? 'left' : 'right');
      }
    }
  }

  if (s?.bar || sc.proposal || sc.barTrail?.length) drawBar(ctx, s?.bar ?? null, sc.proposal ?? null, sc.barTrail ?? [], k);
  if (anyPlane && ly.planeInset) drawPlaneInset(ctx, w, h, k, s?.frame ?? null, { planes: ly.planes, axes: ly.planeAxes });
  if (sc.countdown) drawCountdown(ctx, sc.countdown.text, sc.countdown.sub, w, h, k);

  sc.hud.forEach((line, i) => text(ctx, line, 14 * k, (22 + i * 24) * k, 16 * k));
  if (sc.recording) {
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.arc(w - 28 * k, 24 * k, 9 * k, 0, Math.PI * 2); ctx.fill();
    text(ctx, 'REC', w - 44 * k, 24 * k, 16 * k, '#fff', 'right');
  }
  return { musclesDrawn, search, gravity: gravityText, moment, view, facing: s?.frame ? facingPlane(s.frame) : null };
}

export const trailLabel = (id: PointId) => POINT_LABELS[id];
