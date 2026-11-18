// Draws shapes on a canvas whose pixels are surface pixels.
import { arrow, label } from '../../render/teach';
import { angleAt, AXIS_LABELS, handles, PLANE_COLORS, PLANE_LABELS, textBox, textLines, textSize, type Pt, type Shape } from './shapes';

type Ctx = CanvasRenderingContext2D;

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

export const measurer = (ctx: Ctx) => (line: string, size: number) => {
  ctx.font = `600 ${size}px ${FONT}`;
  return ctx.measureText(line).width;
};

function stroke(ctx: Ctx, pts: Pt[], color: string, width: number, dashed = false, closed = false): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass ? color : 'rgba(0,0,0,0.7)';
    ctx.lineWidth = pass ? width : width + 2.5;
    ctx.setLineDash(dashed ? [width * 3, width * 2.5] : []);
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    if (closed) ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

function hexAlpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Draws one shape. surfaceH sets the default text size. */
export function drawShape(ctx: Ctx, s: Shape, surfaceH: number): void {
  const P = s.pts, w = s.width, size = textSize(s, surfaceH);
  switch (s.type) {
    case 'line':
      stroke(ctx, P, s.color, w, s.dashed);
      break;
    case 'arrow':
      arrow(ctx, P[0], P[1], s.color, w, s.dashed);
      break;
    case 'force': {
      arrow(ctx, P[0], P[1], s.color, w * 1.3, s.dashed);
      if (s.text) label(ctx, s.text, P[1].x + size * 0.4, P[1].y, size * 0.8, s.color);
      break;
    }
    case 'freehand':
      stroke(ctx, P, s.color, w, s.dashed);
      break;
    case 'ellipse': {
      const cx = (P[0].x + P[1].x) / 2, cy = (P[0].y + P[1].y) / 2;
      const rx = Math.abs(P[1].x - P[0].x) / 2, ry = Math.abs(P[1].y - P[0].y) / 2;
      const n = 64, pts: Pt[] = [];
      for (let i = 0; i <= n; i++) pts.push({ x: cx + rx * Math.cos((2 * Math.PI * i) / n), y: cy + ry * Math.sin((2 * Math.PI * i) / n) });
      stroke(ctx, pts, s.color, w, s.dashed);
      break;
    }
    case 'angle': {
      stroke(ctx, [P[0], P[1], P[2]], s.color, w, s.dashed);
      const deg = angleAt(P[0], P[1], P[2]);
      if (!Number.isFinite(deg)) break;
      const a0 = Math.atan2(P[0].y - P[1].y, P[0].x - P[1].x), a1 = Math.atan2(P[2].y - P[1].y, P[2].x - P[1].x);
      let d = a1 - a0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const r = Math.max(size * 0.9, Math.min(size * 2.2, 0.35 * Math.min(Math.hypot(P[0].x - P[1].x, P[0].y - P[1].y), Math.hypot(P[2].x - P[1].x, P[2].y - P[1].y))));
      ctx.save();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(1.5, w * 0.6);
      ctx.beginPath();
      ctx.arc(P[1].x, P[1].y, r, a0, a0 + d, d < 0);
      ctx.stroke();
      ctx.restore();
      const mid = a0 + d / 2;
      label(ctx, `${deg.toFixed(0)}°`, P[1].x + Math.cos(mid) * (r + size * 0.9), P[1].y + Math.sin(mid) * (r + size * 0.9), size * 0.85, s.color, 'center');
      break;
    }
    case 'text': {
      const b = textBox(s, surfaceH, measurer(ctx)), pad = size * 0.3;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.beginPath();
      ctx.roundRect(b.x, b.y, b.w, b.h, size * 0.25);
      ctx.fill();
      ctx.font = `600 ${size}px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = s.color;
      textLines(s).forEach((line, i) => ctx.fillText(line, b.x + pad, b.y + pad + i * size * 1.25 + size * 0.1));
      ctx.restore();
      break;
    }
    case 'plane': {
      const color = s.plane ? PLANE_COLORS[s.plane] : s.color;
      ctx.save();
      ctx.fillStyle = hexAlpha(color, 0.22);
      ctx.beginPath();
      P.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      stroke(ctx, P, color, w, s.dashed, true);
      const text = s.text ?? (s.plane ? PLANE_LABELS[s.plane] : '');
      if (text) label(ctx, text, P[0].x + size * 0.3, P[0].y + size * 0.8, size * 0.8, color);
      break;
    }
    case 'axis': {
      stroke(ctx, P, s.color, w, true);
      // A curved arrow around the middle of the axis shows rotation about it.
      const mx = (P[0].x + P[1].x) / 2, my = (P[0].y + P[1].y) / 2;
      const ang = Math.atan2(P[1].y - P[0].y, P[1].x - P[0].x), r = size * 1.2;
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(ang);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = Math.max(2, w * 0.8);
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.45, r, 0, -Math.PI * 0.8, Math.PI * 0.6);
      ctx.stroke();
      const ex = r * 0.45 * Math.cos(Math.PI * 0.6), ey = r * Math.sin(Math.PI * 0.6);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.moveTo(ex + r * 0.35, ey);
      ctx.lineTo(ex - r * 0.1, ey - r * 0.32);
      ctx.lineTo(ex - r * 0.18, ey + r * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      const text = s.text ?? (s.axis ? AXIS_LABELS[s.axis] : '');
      if (text) label(ctx, text, P[1].x + size * 0.4, P[1].y, size * 0.8, s.color);
      break;
    }
  }
}

/** Selection outline and drag handles. k = surface pixels per screen pixel. */
export function drawSelection(ctx: Ctx, s: Shape, surfaceH: number, k: number): void {
  ctx.save();
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 1.5 * k;
  ctx.setLineDash([5 * k, 4 * k]);
  if (s.type === 'text') {
    const b = textBox(s, surfaceH, measurer(ctx));
    ctx.strokeRect(b.x - 3 * k, b.y - 3 * k, b.w + 6 * k, b.h + 6 * k);
  } else if (s.type === 'freehand') {
    const xs = s.pts.map((q) => q.x), ys = s.pts.map((q) => q.y), pad = s.width + 4 * k;
    ctx.strokeRect(Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + 2 * pad, Math.max(...ys) - Math.min(...ys) + 2 * pad);
  }
  ctx.setLineDash([]);
  for (const h of s.type === 'text' ? [] : handles(s)) {
    ctx.fillStyle = '#fbbf24';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5 * k;
    ctx.beginPath();
    ctx.arc(h.x, h.y, 7 * k, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
