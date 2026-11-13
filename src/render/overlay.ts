// Draws one composited frame: video, anatomy layers, skeleton, measurements, HUD.
// Everything on this canvas ends up in screenshots and recorded video.
import { detectView, drawBones, drawMuscles, type JointGroup } from '../anatomy/anatomy';
import type { Calibration } from '../kinematics/calibration';
import type { LiveSample } from '../live';
import { ANGLE_BY_ID, DEG } from '../measure/definitions';
import { getPoint, L, POINT_LABELS, sideOf, SKELETON, type PointId } from '../pose/landmarks';

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

export function drawScene(ctx: CanvasRenderingContext2D, sc: Scene): string[] {
  const { w, h, layers: ly } = sc;
  const k = Math.max(w, h) / 1000;
  let musclesDrawn: string[] = [];
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
    const info = (ly.bones || ly.muscles) ? detectView(lm, s!.world, sc.mirrored) : null;
    if (info && ly.bones) drawBones(ctx, lm, info, ly.bonesOpacity);
    if (info && ly.muscles) musclesDrawn = drawMuscles(ctx, lm, info, ly.musclesOpacity, ly.highlight, sc.minVisibility);

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

  sc.hud.forEach((line, i) => text(ctx, line, 14 * k, (22 + i * 24) * k, 16 * k));
  if (sc.recording) {
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.arc(w - 28 * k, 24 * k, 9 * k, 0, Math.PI * 2); ctx.fill();
    text(ctx, 'REC', w - 44 * k, 24 * k, 16 * k, '#fff', 'right');
  }
  return musclesDrawn;
}

export const trailLabel = (id: PointId) => POINT_LABELS[id];
