// Teaching overlays: cardinal planes and axes of rotation, line of gravity and base of support,
// velocity vectors, gravitational moment about a joint, and the tracked barbell.
import { PLANE_IDS, PLANES, planeBasis, facingPlane, type BodyFrame, type PlaneId, type V3 } from '../analysis/bodyFrame';
import type { StaticMoment, Support } from '../analysis/statics';
import type { Calibration } from '../kinematics/calibration';
import type { LiveSample } from '../live';
import { ANGLE_BY_ID } from '../measure/definitions';
import { getPoint } from '../pose/landmarks';
import type { Lm } from '../types';

type Ctx = CanvasRenderingContext2D;
type P = { x: number; y: number };

export function label(ctx: Ctx, s: string, x: number, y: number, size: number, color = '#fff', align: CanvasTextAlign = 'left'): void {
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

export function arrow(ctx: Ctx, a: P, b: P, color: string, width: number, dashed = false): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return;
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, head = Math.min(len * 0.45, width * 4.5);
  ctx.save();
  ctx.lineCap = 'round';
  for (const pass of [0, 1]) {
    ctx.strokeStyle = ctx.fillStyle = pass ? color : 'rgba(0,0,0,0.75)';
    ctx.lineWidth = pass ? width : width + 2.5;
    ctx.setLineDash(dashed ? [width * 3, width * 2.5] : []);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x - ux * head * 0.8, b.y - uy * head * 0.8); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - ux * head - uy * head * 0.5, b.y - uy * head + ux * head * 0.5);
    ctx.lineTo(b.x - ux * head + uy * head * 0.5, b.y - uy * head - ux * head * 0.5);
    ctx.closePath();
    if (pass) ctx.fill(); else ctx.stroke();
  }
  ctx.restore();
}

/** Keeps labels from being drawn on top of each other: a colliding label is moved down until it fits. */
export class LabelPlacer {
  private boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  /** Reserves an area that labels should stay out of. */
  reserve(x0: number, y0: number, x1: number, y1: number): void { this.boxes.push({ x0, y0, x1, y1 }); }
  draw(ctx: Ctx, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left'): void {
    ctx.font = `600 ${size}px system-ui, -apple-system, sans-serif`;
    const w = ctx.measureText(s).width + size * 0.5, h = size * 1.25;
    let yy = y;
    const box = () => { const x0 = align === 'left' ? x : align === 'right' ? x - w : x - w / 2; return { x0, y0: yy - h / 2, x1: x0 + w, y1: yy + h / 2 }; };
    for (let i = 0; i < 12; i++) {
      const b = box();
      if (!this.boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0)) break;
      yy += h;
    }
    this.boxes.push(box());
    label(ctx, s, x, yy, size, color, align);
  }
}

// ---- Planes and axes --------------------------------------------------------------------------

export interface PlaneOptions {
  planes: Record<PlaneId, boolean>;
  axes: Record<PlaneId, boolean>;
}

/** Half-extents (metres) of each plane sheet along its two spanning vectors, for a whole body. */
const EXTENT: Record<PlaneId, [number, number]> = { sagittal: [0.5, 0.98], frontal: [0.5, 0.98], transverse: [0.5, 0.5] };

/**
 * Draws the selected planes and axes at `c` (image pixels). World offsets (metres; x right, y down) are
 * projected straight onto the picture, which is how the camera sees them apart from perspective.
 * `size` scales the sheets (1 = whole body, about 0.3 for a single joint).
 */
export function drawPlanes(ctx: Ctx, f: BodyFrame, c: P, pxPerM: number, size: number, o: PlaneOptions, k: number, place: LabelPlacer | null, span?: { below: number; above: number }): void {
  const labels = !!place;
  const pr = (v: V3, m: number): P => ({ x: c.x + v.x * m * pxPerM, y: c.y + v.y * m * pxPerM });
  const at = (u: V3, a: number, v: V3, b: number): P => ({ x: c.x + (u.x * a + v.x * b) * pxPerM, y: c.y + (u.y * a + v.y * b) * pxPerM });
  ctx.save();
  ctx.lineJoin = 'round';
  // Far planes first: the one seen most edge-on is drawn last so it stays visible as a line.
  const order = PLANE_IDS.filter((p) => o.planes[p]).sort((p, q) => Math.abs(planeBasis(f, q).normal.z) - Math.abs(planeBasis(f, p).normal.z));
  for (const id of order) {
    // A sheet at a single joint is a small square; a whole-body sheet has the proportions of the body.
    const { u, v, normal } = planeBasis(f, id), [eu, ev] = size < 0.45 ? [0.6 * size, 0.6 * size] : EXTENT[id].map((e) => e * size), col = PLANES[id].color;
    // Upright planes of a whole body run from the feet to the top of the head rather than being centred.
    const lo = span && id !== 'transverse' ? -span.below : -ev, hi = span && id !== 'transverse' ? span.above : ev;
    const q = [at(u, -eu, v, lo), at(u, eu, v, lo), at(u, eu, v, hi), at(u, -eu, v, hi)];
    const path = () => { ctx.beginPath(); q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); };
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = col;
    path(); ctx.fill();
    // Internal grid lines give the sheet some depth.
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1 * k;
    for (const t of [-0.5, 0, 0.5]) {
      const vm = (lo + hi) / 2 + t * (hi - lo);
      const a = at(u, t * eu, v, lo), b = at(u, t * eu, v, hi), d = at(u, -eu, v, vm), e = at(u, eu, v, vm);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.moveTo(d.x, d.y); ctx.lineTo(e.x, e.y); ctx.stroke();
    }
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = (Math.abs(normal.z) < 0.25 ? 3.5 : 2) * k;
    path(); ctx.stroke();
    ctx.globalAlpha = 1;
    if (labels) {
      // Face-on sheets are labelled inside their top-left corner; edge-on ones at the end of their line.
      const xs = q.map((p) => p.x), ys = q.map((p) => p.y);
      const faceOn = Math.abs(normal.z) > 0.5;
      if (faceOn) place!.draw(ctx, PLANES[id].label, Math.min(...xs) + 8 * k, Math.min(...ys) + 14 * k, 14 * k, col);
      else if (Math.max(...ys) - Math.min(...ys) > Math.max(...xs) - Math.min(...xs)) place!.draw(ctx, PLANES[id].label, q[0].x + 8 * k, Math.max(...ys) - 14 * k, 14 * k, col);
      else place!.draw(ctx, PLANES[id].label, Math.min(...xs) - 6 * k, (ys[0] + ys[1]) / 2 - 14 * k, 14 * k, col, 'left');
    }
  }
  for (const id of PLANE_IDS) {
    if (!o.axes[id]) continue;
    const { normal, u, v } = planeBasis(f, id), col = PLANES[id].color, half = 0.62 * size;
    const a = pr(normal, -half), b = pr(normal, half), seen = Math.hypot(b.x - a.x, b.y - a.y);
    ctx.lineCap = 'round';
    if (seen < 26 * k) {
      // The axis points at the camera: drawn as the usual dot-in-circle symbol for "out of the page".
      for (const pass of [0, 1]) {
        ctx.strokeStyle = ctx.fillStyle = pass ? col : 'rgba(0,0,0,0.8)';
        ctx.lineWidth = (pass ? 2.5 : 5) * k;
        ctx.beginPath(); ctx.arc(c.x, c.y, 11 * k, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(c.x, c.y, 3.5 * k, 0, Math.PI * 2); ctx.fill();
      }
      if (labels) place!.draw(ctx, `${PLANES[id].axis} (points at the camera)`, c.x + 18 * k, c.y + 24 * k, 14 * k, col);
    } else {
      for (const pass of [0, 1]) {
        ctx.strokeStyle = pass ? col : 'rgba(0,0,0,0.8)';
        ctx.lineWidth = (pass ? 3 : 5.5) * k;
        ctx.setLineDash(pass ? [10 * k, 4 * k, 2 * k, 4 * k] : []);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.setLineDash([]);
      if (labels) {
        // Vertical axes are labelled at the top; others at their right-hand end.
        const vertical = Math.abs(b.y - a.y) > Math.abs(b.x - a.x), e = vertical ? (a.y < b.y ? a : b) : a.x > b.x ? a : b;
        place!.draw(ctx, PLANES[id].axis, e.x + (vertical ? 8 : -4) * k, e.y + (vertical ? 4 : -14) * k, 14 * k, col, vertical ? 'left' : 'right');
      }
    }
    // Curved arrow: rotation about this axis takes place in the matching plane.
    const r = 0.2 * size, n = 28;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5 * k;
    ctx.beginPath();
    let last: P = c, prev: P = c;
    for (let i = 0; i <= n; i++) {
      const th = (i / n) * 1.5 * Math.PI;
      const p = at(u, r * Math.cos(th), v, r * Math.sin(th));
      if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
      prev = last; last = p;
    }
    ctx.stroke();
    const dl = Math.hypot(last.x - prev.x, last.y - prev.y);
    if (dl > 0.3) arrow(ctx, { x: last.x - ((last.x - prev.x) / dl) * 9 * k, y: last.y - ((last.y - prev.y) / dl) * 9 * k }, { x: last.x + ((last.x - prev.x) / dl) * 4 * k, y: last.y + ((last.y - prev.y) / dl) * 4 * k }, col, 2.5 * k);
  }
  ctx.restore();
}

// A simple figure in the anatomical position: [mediolateral (toward the subject's left), anteroposterior, up] in metres.
const MAN: Record<string, [number, number, number]> = {
  head: [0, 0, 1.62], neck: [0, 0, 1.46], ls: [0.19, 0, 1.43], rs: [-0.19, 0, 1.43], le: [0.23, 0, 1.13], re: [-0.23, 0, 1.13],
  lw: [0.26, 0.03, 0.86], rw: [-0.26, 0.03, 0.86], pelvis: [0, 0, 0.95], lh: [0.1, 0, 0.93], rh: [-0.1, 0, 0.93],
  lk: [0.1, 0, 0.5], rk: [-0.1, 0, 0.5], la: [0.1, 0, 0.08], ra: [-0.1, 0, 0.08], lt: [0.12, 0.2, 0.02], rt: [-0.12, 0.2, 0.02],
};
const MAN_LINES: [string, string][] = [['neck', 'pelvis'], ['ls', 'rs'], ['ls', 'le'], ['le', 'lw'], ['rs', 're'], ['re', 'rw'], ['lh', 'rh'], ['lh', 'lk'], ['lk', 'la'], ['la', 'lt'], ['rh', 'rk'], ['rk', 'ra'], ['ra', 'rt']];

/**
 * Fixed three-quarter view of a figure with all three planes, so that none is ever hidden edge-on.
 * Selected planes are filled; the plane the camera is looking at is outlined and the camera position shown.
 */
export function drawPlaneInset(ctx: Ctx, w: number, h: number, k: number, f: BodyFrame | null, o: PlaneOptions): void {
  const size = Math.min(w, h) * 0.3, x0 = w - size - 10 * k, y0 = h - size - 10 * k;
  const yaw = (-38 * Math.PI) / 180, pitch = (16 * Math.PI) / 180, s = size / 2.5;
  // Body coordinates -> inset pixels (orthographic, viewed from the subject's front-left and slightly above).
  const P3 = ([ml, ap, up]: [number, number, number]): P => {
    const x = ml * Math.cos(yaw) - ap * Math.sin(yaw), z = ml * Math.sin(yaw) + ap * Math.cos(yaw), y = up - 0.9;
    return { x: x0 + size / 2 + x * s, y: y0 + size * 0.54 - (y * Math.cos(pitch) + z * Math.sin(pitch)) * s };
  };
  ctx.save();
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = '#0b1220';
  ctx.strokeStyle = 'rgba(148,163,184,0.7)';
  ctx.lineWidth = 1 * k;
  ctx.beginPath(); ctx.roundRect(x0, y0, size, size, 8 * k); ctx.fill(); ctx.stroke();
  ctx.globalAlpha = 1;
  const facing = f ? facingPlane(f) : null;
  const C: [number, number, number] = [0, 0, 0.95];
  const quad = (id: PlaneId): P[] => {
    const e = 0.55, v = 0.9;
    const corners: [number, number, number][] = id === 'sagittal' ? [[0, -e, -v], [0, e, -v], [0, e, v], [0, -e, v]] : id === 'frontal' ? [[-e, 0, -v], [e, 0, -v], [e, 0, v], [-e, 0, v]] : [[-e, -e, 0], [e, -e, 0], [e, e, 0], [-e, e, 0]];
    return corners.map(([a, b, c]) => P3([C[0] + a, C[1] + b, C[2] + c]));
  };
  const drawPlane = (id: PlaneId) => {
    const q = quad(id), col = PLANES[id].color;
    ctx.beginPath(); q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
    ctx.fillStyle = col;
    ctx.globalAlpha = o.planes[id] ? 0.38 : 0.07;
    ctx.fill();
    ctx.globalAlpha = o.planes[id] ? 1 : 0.45;
    ctx.strokeStyle = col;
    ctx.lineWidth = (facing?.plane === id ? 3 : 1.2) * k;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  const man = () => {
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2.2 * k;
    ctx.lineCap = 'round';
    for (const [a, b] of MAN_LINES) { const p = P3(MAN[a]), q = P3(MAN[b]); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
    const hd = P3(MAN.head);
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath(); ctx.arc(hd.x, hd.y, 0.1 * s, 0, Math.PI * 2); ctx.fill();
  };
  // Back to front for this viewpoint: frontal plane's far half is hidden by the figure anyway; keep it simple.
  drawPlane('transverse'); drawPlane('frontal'); man(); drawPlane('sagittal');
  const AX: Record<PlaneId, [number, number, number]> = { sagittal: [1, 0, 0], frontal: [0, 1, 0], transverse: [0, 0, 1] };
  for (const id of PLANE_IDS) {
    if (!o.axes[id]) continue;
    const d = AX[id], len = id === 'transverse' ? 1.05 : 0.75;
    const a = P3([C[0] - d[0] * len, C[1] - d[1] * len, C[2] - d[2] * len]), b = P3([C[0] + d[0] * len, C[1] + d[1] * len, C[2] + d[2] * len]);
    ctx.strokeStyle = PLANES[id].color;
    ctx.lineWidth = 2.5 * k;
    ctx.setLineDash([7 * k, 3 * k, 2 * k, 3 * k]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (f) {
    // Where the camera is, in body coordinates: it looks along +z, so it sits at -z from the body.
    const cam: [number, number, number] = [-f.ml.z, -f.ap.z, -f.up.z];
    const p = P3([C[0] + cam[0] * 1.15, C[1] + cam[1] * 1.15, C[2] + cam[2] * 1.15]), q = P3([C[0] + cam[0] * 0.45, C[1] + cam[1] * 0.45, C[2] + cam[2] * 0.45]);
    arrow(ctx, p, q, '#fde047', 2 * k);
    ctx.fillStyle = '#fde047';
    ctx.strokeStyle = '#0b1220';
    ctx.lineWidth = 1 * k;
    ctx.beginPath(); ctx.roundRect(p.x - 7 * k, p.y - 5 * k, 14 * k, 10 * k, 2 * k); ctx.fill(); ctx.stroke();
  }
  const fs = Math.max(9, size * 0.058);
  let ly = y0 + fs * 1.1;
  for (const id of PLANE_IDS) {
    label(ctx, `${PLANES[id].label.replace(/ \(.*\)/, '').replace(' plane', '')}${facing?.plane === id ? ' (camera view)' : ''}`, x0 + 7 * k, ly, fs, PLANES[id].color);
    ly += fs * 1.25;
  }
  if (f) label(ctx, 'camera', x0 + size - 7 * k, y0 + size - fs, fs, '#fde047', 'right');
  ctx.restore();
}

// ---- Line of gravity and base of support --------------------------------------------------------

export function drawGravity(ctx: Ctx, com: P, sup: Support | null, cal: Calibration, h: number, k: number): string {
  const footY = sup ? sup.y : h - 4 * k;
  ctx.save();
  let text = 'Line of gravity (feet not visible)';
  if (sup) {
    const inside = sup.margin >= 0, col = inside ? '#4ade80' : '#f87171';
    ctx.lineCap = 'round';
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass ? col : 'rgba(0,0,0,0.8)';
      ctx.lineWidth = (pass ? 6 : 9) * k;
      ctx.beginPath(); ctx.moveTo(sup.x0, footY + 5 * k); ctx.lineTo(sup.x1, footY + 5 * k); ctx.stroke();
    }
    const width = sup.x1 - sup.x0;
    const dist = cal.unit === 'm' ? `${(Math.abs(sup.margin) * cal.scale * 100).toFixed(0)} cm` : `${((100 * Math.abs(sup.margin)) / Math.max(1, width)).toFixed(0)} % of the base width`;
    text = inside ? `Line of gravity inside the base of support, ${dist} from its nearest edge` : `Line of gravity outside the base of support by ${dist}`;
    label(ctx, 'base of support', (sup.x0 + sup.x1) / 2, footY + 20 * k, 13 * k, col, 'center');
  }
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass ? '#f8fafc' : 'rgba(0,0,0,0.8)';
    ctx.lineWidth = (pass ? 2 : 4.5) * k;
    ctx.setLineDash([8 * k, 6 * k]);
    ctx.beginPath(); ctx.moveTo(com.x, com.y); ctx.lineTo(com.x, footY + 5 * k); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath(); ctx.moveTo(com.x, footY + 5 * k); ctx.lineTo(com.x - 6 * k, footY - 7 * k); ctx.lineTo(com.x + 6 * k, footY - 7 * k); ctx.closePath(); ctx.fill();
  ctx.restore();
  return text;
}

// ---- Velocity vectors -----------------------------------------------------------------------

/** Seconds of travel an arrow represents: its length is where the point would be this much later. */
export const VECTOR_SECONDS = 0.15;

export function drawVelocityVectors(ctx: Ctx, s: LiveSample, lm: Lm[], angles: string[], cal: Calibration, k: number): void {
  const u = cal.unit, d = u === 'm' ? 2 : 0;
  for (const [, p] of s.points) {
    const vx = (p.vx / cal.scale) * VECTOR_SECONDS, vy = (-p.vy / cal.scale) * VECTOR_SECONDS;
    if (Math.hypot(vx, vy) < 6 * k) continue;
    arrow(ctx, { x: p.px, y: p.py }, { x: p.px + vx, y: p.py + vy }, '#a78bfa', 3 * k);
    label(ctx, `${p.speed.toFixed(d)} ${u}/s`, p.px + vx + 8 * k, p.py + vy, 13 * k, '#c4b5fd');
  }
  if (s.bar && Math.hypot(s.bar.vx, s.bar.vy) / cal.scale * VECTOR_SECONDS >= 6 * k) {
    const b = s.bar, vx = (b.vx / cal.scale) * VECTOR_SECONDS, vy = (-b.vy / cal.scale) * VECTOR_SECONDS;
    arrow(ctx, { x: b.px, y: b.py }, { x: b.px + vx, y: b.py + vy }, '#a3e635', 3 * k);
  }
  // Tangential velocity of the far end of a rotating segment, relative to its near end: v = omega x r.
  for (const id of angles) {
    const def = ANGLE_BY_ID.get(id), a = s.angles.get(id);
    if (!def || def.kind !== 'segment' || !a || !Number.isFinite(a.velocity)) continue;
    const from = getPoint(lm, def.from, 0), to = getPoint(lm, def.to, 0);
    if (!from || !to) continue;
    // Segment angles are counter-clockwise positive, except lean from the vertical (clockwise positive).
    const omega = ((a.velocity * Math.PI) / 180) * (def.ref === 'vertical' ? -1 : 1);
    const dx = to.x - from.x, dy = to.y - from.y;
    const vx = omega * dy * VECTOR_SECONDS, vy = -omega * dx * VECTOR_SECONDS;
    if (Math.hypot(vx, vy) < 6 * k) continue;
    arrow(ctx, to, { x: to.x + vx, y: to.y + vy }, '#f472b6', 2.5 * k, true);
    const speed = Math.abs(omega) * Math.hypot(dx, dy) * cal.scale;
    label(ctx, `vₜ ${speed.toFixed(d)} ${u}/s`, to.x + vx + 8 * k, to.y + vy, 13 * k, '#f9a8d4');
  }
}

// ---- Gravitational moment about a joint -------------------------------------------------------

export function drawMoment(ctx: Ctx, m: StaticMoment, k: number): void {
  const { pivot: p, com: c } = m, col = '#fb923c';
  ctx.save();
  // Line of action of the weight.
  ctx.strokeStyle = 'rgba(251,146,60,0.7)';
  ctx.lineWidth = 1.5 * k;
  ctx.setLineDash([5 * k, 5 * k]);
  ctx.beginPath(); ctx.moveTo(c.x, Math.min(c.y, p.y) - 30 * k); ctx.lineTo(c.x, Math.max(c.y, p.y) + 40 * k); ctx.stroke();
  ctx.setLineDash([]);
  // Moment arm: the perpendicular (horizontal) distance from the joint to the line of action.
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass ? '#fde047' : 'rgba(0,0,0,0.8)';
    ctx.lineWidth = (pass ? 3 : 5.5) * k;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y); ctx.lineTo(c.x, p.y);
    ctx.moveTo(c.x, p.y - 7 * k); ctx.lineTo(c.x, p.y + 7 * k);
    ctx.stroke();
  }
  // Right-angle mark where the arm meets the line of action.
  const sg = Math.sign(p.x - c.x) || 1, q = 9 * k;
  ctx.strokeStyle = '#fde047';
  ctx.lineWidth = 1.5 * k;
  ctx.beginPath(); ctx.moveTo(c.x + sg * q, p.y); ctx.lineTo(c.x + sg * q, p.y - q); ctx.lineTo(c.x, p.y - q); ctx.stroke();
  const armText = Number.isFinite(m.armM) ? `d = ${Math.abs(m.armM).toFixed(2)} m` : `d = ${Math.abs(m.armPx).toFixed(0)} px`;
  label(ctx, armText, (p.x + c.x) / 2, p.y + 16 * k, 14 * k, '#fde047', 'center');
  // Weight vector at the centre of mass of what the joint supports.
  ctx.fillStyle = col;
  ctx.strokeStyle = '#0b1220';
  ctx.lineWidth = 1.5 * k;
  ctx.beginPath(); ctx.arc(c.x, c.y, 6 * k, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  arrow(ctx, c, { x: c.x, y: c.y + 85 * k }, col, 4 * k);
  label(ctx, `W = ${m.weightN.toFixed(0)} N`, c.x + 10 * k, c.y + 60 * k, 14 * k, col);
  // Joint marker and direction of the moment.
  ctx.strokeStyle = '#fde047';
  ctx.lineWidth = 3 * k;
  ctx.beginPath(); ctx.arc(p.x, p.y, 8 * k, 0, Math.PI * 2); ctx.stroke();
  if (Math.abs(m.armPx) > 2) {
    const cw = m.armPx > 0, r = 24 * k, a0 = -Math.PI * 0.75, a1 = cw ? a0 + Math.PI * 1.1 : a0 - Math.PI * 1.1;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, a0, a1, !cw); ctx.stroke();
    const e = { x: p.x + r * Math.cos(a1), y: p.y + r * Math.sin(a1) }, t = cw ? a1 + Math.PI / 2 : a1 - Math.PI / 2;
    arrow(ctx, { x: e.x - Math.cos(t) * 6 * k, y: e.y - Math.sin(t) * 6 * k }, { x: e.x + Math.cos(t) * 6 * k, y: e.y + Math.sin(t) * 6 * k }, '#fde047', 3 * k);
  }
  if (Number.isFinite(m.momentNm)) label(ctx, `M = W × d = ${Math.abs(m.momentNm).toFixed(0)} N·m`, p.x, p.y - 38 * k, 15 * k, '#fde047', 'center');
  ctx.restore();
}

// ---- Barbell ----------------------------------------------------------------------------------

export function drawBar(ctx: Ctx, bar: { px: number; py: number; r: number; src: 'plate' | 'hands' } | null, proposal: { x: number; y: number; r: number } | null, trail: P[], k: number): void {
  ctx.save();
  if (trail.length > 1) {
    // Vertical reference through the start of the bar path, as used in lifting analysis.
    ctx.strokeStyle = 'rgba(248,250,252,0.55)';
    ctx.lineWidth = 1.2 * k;
    ctx.setLineDash([4 * k, 5 * k]);
    const ys = trail.map((p) => p.y);
    ctx.beginPath(); ctx.moveTo(trail[0].x, Math.min(...ys)); ctx.lineTo(trail[0].x, Math.max(...ys)); ctx.stroke();
    ctx.setLineDash([]);
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass ? '#a3e635' : 'rgba(0,0,0,0.7)';
      ctx.lineWidth = (pass ? 2.5 : 5) * k;
      ctx.lineJoin = 'round';
      ctx.beginPath(); trail.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
    }
  }
  if (proposal && !bar?.r) {
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 3 * k;
    ctx.setLineDash([9 * k, 7 * k]);
    ctx.beginPath(); ctx.arc(proposal.x, proposal.y, proposal.r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    label(ctx, 'Plate? Tap it to confirm', proposal.x, proposal.y - proposal.r - 14 * k, 16 * k, '#fde047', 'center');
  }
  if (bar) {
    const plate = bar.src === 'plate', col = plate ? '#a3e635' : '#fb923c';
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass ? col : 'rgba(0,0,0,0.8)';
      ctx.lineWidth = (pass ? 2.5 : 5) * k;
      ctx.setLineDash(plate ? [] : [6 * k, 5 * k]);
      ctx.beginPath();
      if (bar.r > 0) ctx.arc(bar.px, bar.py, bar.r, 0, Math.PI * 2);
      ctx.moveTo(bar.px - 13 * k, bar.py); ctx.lineTo(bar.px + 13 * k, bar.py);
      ctx.moveTo(bar.px, bar.py - 13 * k); ctx.lineTo(bar.px, bar.py + 13 * k);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (!plate) label(ctx, 'bar estimated from the hands', bar.px + 18 * k, bar.py - 16 * k, 13 * k, col);
  }
  ctx.restore();
}

export function drawCountdown(ctx: Ctx, text: string, sub: string, w: number, h: number, k: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(11,18,32,0.35)';
  ctx.fillRect(0, 0, w, h);
  label(ctx, text, w / 2, h * 0.42, 150 * k, '#fde047', 'center');
  label(ctx, sub, w / 2, h * 0.42 + 105 * k, 22 * k, '#fff', 'center');
  ctx.restore();
}
