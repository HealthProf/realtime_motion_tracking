// Skeleton layer: schematic bone silhouettes drawn in code and fitted to the tracked joints.
//
// Every bone is an original outline built from curves, shaded to look rounded. The shapes follow
// textbook proportions for an average adult scaled to the trunk length; they are not this person's
// bones. Three views are drawn (front, back, side). Rotation of a limb about its own long axis
// cannot be seen from keypoints, so each bone is always shown in its standard orientation.
import type { Lm } from '../types';
import { buildRig, type P, type Rig, type ViewInfo } from './anatomy';

type Ctx = CanvasRenderingContext2D;

const LIGHT = '#fdf8ea', BONE = '#ecdfbe', SHADE = '#b9a77a', EDGE = '#5f5338', HOLE = 'rgba(40,32,20,0.78)', CARTILAGE = '#c9d6dc';

const lerp = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const dist = (a: P, b: P) => Math.hypot(b.x - a.x, b.y - a.y);

/** Fills a bone outline with rounded shading across its width (local y from -hw to +hw) and outlines it. */
function paint(ctx: Ctx, path: Path2D, hw: number, lw: number, rule: CanvasFillRule = 'nonzero'): void {
  const g = ctx.createLinearGradient(0, -hw, 0, hw);
  g.addColorStop(0, SHADE); g.addColorStop(0.28, LIGHT); g.addColorStop(0.62, BONE); g.addColorStop(1, SHADE);
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = lw * 2;
  ctx.lineJoin = 'round';
  // Outline first, then fill over its inner half: overlapping parts of one bone merge without seams.
  ctx.stroke(path);
  ctx.fillStyle = g;
  ctx.fill(path, rule);
}

/** Shading for broad bones (skull, pelvis, scapula): lit from the upper left. */
function paintBroad(ctx: Ctx, path: Path2D, cx: number, cy: number, r: number, lw: number, rule: CanvasFillRule = 'nonzero'): void {
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.05, cx, cy, r * 1.15);
  g.addColorStop(0, LIGHT); g.addColorStop(0.55, BONE); g.addColorStop(1, SHADE);
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = lw * 2;
  ctx.lineJoin = 'round';
  ctx.stroke(path);
  ctx.fillStyle = g;
  ctx.fill(path, rule);
}

/** Thin bones drawn as a shaded stroke along a path (ribs, clavicle, finger and toe bones). */
function strokeBone(ctx: Ctx, path: Path2D, width: number, color = BONE): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = width + Math.max(1.2, width * 0.3);
  ctx.stroke(path);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke(path);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = Math.max(0.6, width * 0.3);
  ctx.stroke(path);
}

/**
 * Runs `draw` in a frame with x along a -> b and +y toward `toward` (a direction in the picture, e.g. the
 * lateral or anterior side). Distances inside are in pixels; `len` is the a-b distance.
 */
function along(ctx: Ctx, a: P, b: P, toward: P, draw: (len: number) => void): void {
  const len = dist(a, b);
  if (len < 2) return;
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  const flip = toward.x * -uy + toward.y * ux >= 0 ? 1 : -1;
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(Math.atan2(uy, ux));
  ctx.scale(1, flip);
  draw(len);
  ctx.restore();
}

/** Generic long-bone outline: flared ends of half-width p (proximal) and d (distal), shaft half-width s. */
function shaft(len: number, p: number, s: number, d: number, pf = 0.18, df = 0.18): Path2D {
  const a = Math.min(len * pf, len * 0.4), b = Math.min(len * df, len * 0.4), q = new Path2D();
  q.moveTo(0, -p);
  q.bezierCurveTo(a * 0.55, -p, a * 0.6, -s, a, -s);
  q.lineTo(len - b, -s);
  q.bezierCurveTo(len - b * 0.6, -s, len - b * 0.55, -d, len, -d);
  q.quadraticCurveTo(len + d * 0.55, 0, len, d);
  q.bezierCurveTo(len - b * 0.55, d, len - b * 0.6, s, len - b, s);
  q.lineTo(a, s);
  q.bezierCurveTo(a * 0.6, s, a * 0.55, p, 0, p);
  q.quadraticCurveTo(-p * 0.55, 0, 0, -p);
  q.closePath();
  return q;
}

const circle = (x: number, y: number, r: number): Path2D => { const q = new Path2D(); q.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2); return q; };
const oval = (x: number, y: number, rx: number, ry: number, rot = 0): Path2D => { const q = new Path2D(); q.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), rot, 0, Math.PI * 2); return q; };

// ---- Limbs --------------------------------------------------------------------------------------

function femur(ctx: Ctx, hip: P, knee: P, toward: P, S: number, lateralView: boolean, lw: number): void {
  along(ctx, hip, knee, toward, (L) => {
    const s = S, q = new Path2D();
    if (lateralView) {
      // +y is anterior. The shaft bows forward; the condyles project backward.
      q.moveTo(0.03 * s, 0.04 * s);
      q.quadraticCurveTo(L * 0.5, 0.062 * s, L - 0.09 * s, 0.04 * s);
      q.quadraticCurveTo(L - 0.02 * s, 0.062 * s, L + 0.025 * s, 0.03 * s);
      q.quadraticCurveTo(L + 0.045 * s, -0.03 * s, L + 0.0 * s, -0.07 * s);
      q.quadraticCurveTo(L - 0.07 * s, -0.085 * s, L - 0.1 * s, -0.03 * s);
      q.quadraticCurveTo(L * 0.5, -0.004 * s, 0.07 * s, -0.03 * s);
      q.quadraticCurveTo(0.02 * s, -0.075 * s, -0.035 * s, -0.045 * s);
      q.quadraticCurveTo(-0.07 * s, 0.01 * s, -0.02 * s, 0.045 * s);
      q.closePath();
      paint(ctx, q, 0.06 * s, lw);
      paint(ctx, circle(0, 0, 0.047 * s), 0.047 * s, lw);
      return;
    }
    // +y is lateral. Head at the hip joint, neck running out to the greater trochanter, oblique shaft.
    q.moveTo(0.035 * s, 0.022 * s);
    q.quadraticCurveTo(0.09 * s, 0.028 * s, 0.14 * s, 0.038 * s);
    q.quadraticCurveTo(0.168 * s, 0.022 * s, 0.195 * s, 0.05 * s);
    q.bezierCurveTo(L * 0.5, 0.03 * s, L - 0.2 * s, -0.03 * s, L - 0.1 * s, -0.035 * s);
    q.quadraticCurveTo(L - 0.07 * s, -0.07 * s, L - 0.02 * s, -0.068 * s);
    q.quadraticCurveTo(L + 0.03 * s, -0.062 * s, L + 0.022 * s, -0.024 * s);
    q.quadraticCurveTo(L + 0.004 * s, 0, L + 0.022 * s, 0.024 * s);
    q.quadraticCurveTo(L + 0.03 * s, 0.06 * s, L - 0.02 * s, 0.064 * s);
    q.quadraticCurveTo(L - 0.07 * s, 0.064 * s, L - 0.1 * s, 0.035 * s);
    q.bezierCurveTo(L - 0.2 * s, 0.03 * s, L * 0.5, 0.092 * s, 0.2 * s, 0.112 * s);
    q.quadraticCurveTo(0.12 * s, 0.128 * s, 0.05 * s, 0.132 * s);
    q.quadraticCurveTo(-0.014 * s, 0.128 * s, -0.008 * s, 0.092 * s);
    q.lineTo(-0.036 * s, 0.03 * s);
    q.closePath();
    paint(ctx, q, 0.1 * s, lw);
    paint(ctx, circle(0, 0, 0.05 * s), 0.05 * s, lw);
  });
}

function lowerLeg(ctx: Ctx, knee: P, ankle: P, toward: P, S: number, lateralView: boolean, lw: number): void {
  along(ctx, knee, ankle, toward, (L) => {
    const s = S;
    // Fibula: lateral to the tibia (front and back views), behind it (side view), ending as the lateral malleolus.
    ctx.save();
    ctx.translate(0.05 * s, lateralView ? -0.045 * s : 0.058 * s);
    ctx.rotate(Math.atan2((lateralView ? 0.012 : -0.014) * s, L));
    paint(ctx, shaft(L + 0.01 * s, 0.022 * s, 0.011 * s, 0.021 * s, 0.1, 0.12), 0.022 * s, lw);
    ctx.restore();
    const q = new Path2D();
    if (lateralView) {
      // +y anterior: tibial tuberosity and the sharp anterior border.
      q.moveTo(0, -0.055 * s);
      q.quadraticCurveTo(0.05 * s, -0.05 * s, 0.11 * s, -0.022 * s);
      q.lineTo(L - 0.07 * s, -0.018 * s);
      q.quadraticCurveTo(L - 0.01 * s, -0.03 * s, L + 0.012 * s, -0.012 * s);
      q.quadraticCurveTo(L + 0.02 * s, 0.03 * s, L - 0.02 * s, 0.035 * s);
      q.quadraticCurveTo(L * 0.6, 0.03 * s, 0.14 * s, 0.045 * s);
      q.quadraticCurveTo(0.08 * s, 0.075 * s, 0.03 * s, 0.058 * s);
      q.quadraticCurveTo(-0.01 * s, 0.05 * s, 0, 0.04 * s);
      q.closePath();
    } else {
      // +y lateral: broad plateau, tapering shaft, medial malleolus projecting below the ankle.
      q.moveTo(0, -0.066 * s);
      q.bezierCurveTo(0.07 * s, -0.064 * s, 0.1 * s, -0.03 * s, 0.17 * s, -0.026 * s);
      q.lineTo(L - 0.09 * s, -0.022 * s);
      q.quadraticCurveTo(L - 0.03 * s, -0.045 * s, L + 0.03 * s, -0.04 * s);
      q.quadraticCurveTo(L + 0.045 * s, -0.015 * s, L + 0.005 * s, -0.006 * s);
      q.quadraticCurveTo(L + 0.012 * s, 0.03 * s, L - 0.02 * s, 0.032 * s);
      q.quadraticCurveTo(L - 0.08 * s, 0.024 * s, L - 0.12 * s, 0.022 * s);
      q.lineTo(0.17 * s, 0.03 * s);
      q.bezierCurveTo(0.1 * s, 0.034 * s, 0.07 * s, 0.062 * s, 0, 0.064 * s);
      q.quadraticCurveTo(-0.012 * s, 0, 0, -0.066 * s);
      q.closePath();
    }
    paint(ctx, q, 0.06 * s, lw);
  });
}

function patella(ctx: Ctx, at: P, axis: P, S: number, lw: number): void {
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(Math.atan2(axis.y, axis.x));
  const s = S, q = new Path2D();
  q.moveTo(-0.04 * s, -0.012 * s);
  q.bezierCurveTo(-0.04 * s, -0.045 * s, 0.01 * s, -0.045 * s, 0.03 * s, -0.022 * s);
  q.quadraticCurveTo(0.052 * s, 0, 0.03 * s, 0.022 * s);
  q.bezierCurveTo(0.01 * s, 0.045 * s, -0.04 * s, 0.045 * s, -0.04 * s, 0.012 * s);
  q.closePath();
  paint(ctx, q, 0.04 * s, lw);
  ctx.restore();
}

function foot(ctx: Ctx, heel: P, toe: P, ankle: P, S: number, lateralView: boolean, lw: number): void {
  const F = dist(heel, toe);
  if (lateralView && F > 0.12 * S) {
    // Side view: calcaneus, talus under the tibia, the tarsal arch, a metatarsal and the toe bones.
    along(ctx, heel, toe, { x: ankle.x - heel.x, y: ankle.y - heel.y }, (L) => {
      const q = new Path2D();
      q.moveTo(0, 0.01 * L);
      q.quadraticCurveTo(-0.045 * L, 0.12 * L, 0.03 * L, 0.2 * L);
      q.lineTo(0.25 * L, 0.235 * L);
      q.lineTo(0.35 * L, 0.11 * L);
      q.quadraticCurveTo(0.2 * L, 0.0, 0.05 * L, -0.012 * L);
      q.closePath();
      paint(ctx, q, 0.13 * L, lw);
      const t = new Path2D();
      t.moveTo(0.33 * L, 0.11 * L); t.lineTo(0.3 * L, 0.27 * L); t.quadraticCurveTo(0.42 * L, 0.27 * L, 0.52 * L, 0.2 * L); t.lineTo(0.53 * L, 0.075 * L); t.closePath();
      paint(ctx, t, 0.13 * L, lw);
      const ux = (toe.x - heel.x) / L, uy = (toe.y - heel.y) / L;
      const ax = (ankle.x - heel.x) * ux + (ankle.y - heel.y) * uy;
      paint(ctx, oval(Math.min(0.32 * L, Math.max(0.16 * L, ax)), 0.27 * L, 0.115 * L, 0.07 * L), 0.09 * L, lw);
      const m = new Path2D(); m.moveTo(0.53 * L, 0.135 * L); m.quadraticCurveTo(0.68 * L, 0.11 * L, 0.8 * L, 0.045 * L);
      strokeBone(ctx, m, 0.055 * L);
      for (const [x0, x1, y0, y1] of [[0.83, 0.915, 0.04, 0.024], [0.935, 1.0, 0.022, 0.014]]) { const ph = new Path2D(); ph.moveTo(x0 * L, y0 * L); ph.lineTo(x1 * L, y1 * L); strokeBone(ctx, ph, 0.04 * L); }
    });
    return;
  }
  // Front and back views: the foot points at the camera, so it is drawn foreshortened as a fan of rays.
  const dir = dist(ankle, toe) > 2 ? { x: (toe.x - ankle.x) / dist(ankle, toe), y: (toe.y - ankle.y) / dist(ankle, toe) } : { x: 0, y: 1 };
  const reach = Math.max(dist(ankle, toe), 0.09 * S), px = -dir.y, py = dir.x;
  ctx.save();
  ctx.translate(ankle.x, ankle.y);
  paintBroad(ctx, oval(dir.x * reach * 0.25, dir.y * reach * 0.25, 0.055 * S, Math.max(0.03 * S, reach * 0.3), Math.atan2(dir.y, dir.x) + Math.PI / 2), 0, 0, 0.07 * S, lw);
  for (let i = -2; i <= 2; i++) {
    const m = new Path2D();
    m.moveTo(dir.x * reach * 0.4 + px * i * 0.016 * S, dir.y * reach * 0.4 + py * i * 0.016 * S);
    m.lineTo(dir.x * reach * (1 - Math.abs(i) * 0.06) + px * i * 0.026 * S, dir.y * reach * (1 - Math.abs(i) * 0.06) + py * i * 0.026 * S);
    strokeBone(ctx, m, 0.016 * S);
  }
  ctx.restore();
}

function humerus(ctx: Ctx, shoulder: P, elbow: P, toward: P, S: number, lateralView: boolean, lw: number): void {
  along(ctx, shoulder, elbow, toward, (L) => {
    const s = S, q = new Path2D();
    // Front and back: +y lateral, so the head faces the midline (-y). Side: the head sits on top of the shaft.
    const hy = lateralView ? 0 : -0.012 * s;
    q.moveTo(0.02 * s, 0.045 * s);
    q.quadraticCurveTo(0.09 * s, 0.045 * s, 0.14 * s, 0.03 * s);
    q.lineTo(L - 0.12 * s, 0.024 * s);
    q.quadraticCurveTo(L - 0.05 * s, 0.03 * s, L - 0.02 * s, 0.052 * s);
    q.quadraticCurveTo(L + 0.02 * s, 0.05 * s, L + 0.014 * s, 0.018 * s);
    q.quadraticCurveTo(L + 0.002 * s, 0, L + 0.014 * s, -0.02 * s);
    q.quadraticCurveTo(L + 0.02 * s, -0.058 * s, L - 0.02 * s, -0.058 * s);
    q.quadraticCurveTo(L - 0.05 * s, -0.03 * s, L - 0.12 * s, -0.024 * s);
    q.lineTo(0.14 * s, -0.028 * s);
    q.quadraticCurveTo(0.08 * s, -0.03 * s, 0.03 * s, -0.04 * s);
    q.closePath();
    paint(ctx, q, 0.055 * s, lw);
    paint(ctx, circle(0.002 * s, hy, 0.048 * s), 0.048 * s, lw);
  });
}

function forearm(ctx: Ctx, elbow: P, wrist: P, toward: P, S: number, lw: number): void {
  along(ctx, elbow, wrist, toward, (L) => {
    const s = S;
    // Ulna: large at the elbow (olecranon), small at the wrist. Radius: small head, broad at the wrist.
    ctx.save();
    ctx.translate(-0.03 * s, -0.022 * s);
    ctx.rotate(Math.atan2(0.006 * s, L));
    paint(ctx, shaft(L + 0.03 * s, 0.03 * s, 0.013 * s, 0.014 * s, 0.2, 0.08), 0.03 * s, lw);
    ctx.restore();
    ctx.save();
    ctx.translate(0.012 * s, 0.022 * s);
    ctx.rotate(Math.atan2(-0.004 * s, L));
    paint(ctx, shaft(L - 0.012 * s, 0.019 * s, 0.013 * s, 0.03 * s, 0.1, 0.24), 0.03 * s, lw);
    ctx.restore();
  });
}

function hand(ctx: Ctx, wrist: P, index: P, pinky: P, thumb: P, S: number, lw: number): void {
  let a = index, b = pinky;
  const mid = lerp(a, b, 0.5), reach = dist(wrist, mid);
  if (reach < 0.02 * S) return;
  const dir = { x: (mid.x - wrist.x) / reach, y: (mid.y - wrist.y) / reach }, nx = -dir.y, ny = dir.x;
  if (dist(a, b) < 0.04 * S) {
    // Knuckle landmarks coincide (hand edge-on): spread the rays a little so the hand still reads as a hand.
    a = { x: mid.x + nx * 0.035 * S, y: mid.y + ny * 0.035 * S };
    b = { x: mid.x - nx * 0.035 * S, y: mid.y - ny * 0.035 * S };
  }
  // Carpal bones: two short rows between the forearm and the metacarpals.
  ctx.save();
  ctx.translate(wrist.x + dir.x * reach * 0.16, wrist.y + dir.y * reach * 0.16);
  ctx.rotate(Math.atan2(dir.y, dir.x));
  paintBroad(ctx, oval(0, 0, reach * 0.17, Math.max(0.03 * S, dist(a, b) * 0.42)), 0, 0, 0.05 * S, lw);
  ctx.restore();
  const w = Math.max(1.5, 0.014 * S);
  for (let i = 0; i < 4; i++) {
    const k = lerp(a, b, i / 3), base = lerp(lerp(wrist, mid, 0.34), lerp(wrist, k, 0.34), 0.75);
    const m = new Path2D(); m.moveTo(base.x, base.y); m.lineTo(k.x, k.y);
    strokeBone(ctx, m, w);
    // Three phalanges continue beyond the knuckle, slightly curled.
    const fx = (k.x - base.x) / (dist(base, k) || 1), fy = (k.y - base.y) / (dist(base, k) || 1);
    let p = { x: k.x + fx * w * 0.9, y: k.y + fy * w * 0.9 };
    const lens = [0.5, 0.32, 0.24].map((f) => f * reach * (i === 0 || i === 2 ? 1 : i === 1 ? 1.08 : 0.82));
    for (const len of lens) {
      const e = { x: p.x + fx * len, y: p.y + fy * len };
      const ph = new Path2D(); ph.moveTo(p.x, p.y); ph.lineTo(e.x, e.y);
      strokeBone(ctx, ph, w * 0.82);
      p = { x: e.x + fx * w * 0.8, y: e.y + fy * w * 0.8 };
    }
  }
  if (dist(wrist, thumb) > 0.03 * S && dist(thumb, mid) > 0.02 * S) {
    const t = new Path2D(); t.moveTo(wrist.x + dir.x * reach * 0.2, wrist.y + dir.y * reach * 0.2); t.lineTo(thumb.x, thumb.y);
    strokeBone(ctx, t, w);
    const d = dist(wrist, thumb), tx = (thumb.x - wrist.x) / d, ty = (thumb.y - wrist.y) / d;
    const e = new Path2D(); e.moveTo(thumb.x + tx * w, thumb.y + ty * w); e.lineTo(thumb.x + tx * (w + reach * 0.4), thumb.y + ty * (w + reach * 0.4));
    strokeBone(ctx, e, w * 0.85);
  }
}

// ---- Trunk and head -----------------------------------------------------------------------------

/** Runs `draw` in the trunk frame: origin `o`, +x toward `xDir` (unit vector in the picture), +y down the trunk. */
function frame(ctx: Ctx, o: P, xDir: P, yDir: P, draw: () => void): void {
  ctx.save();
  ctx.transform(xDir.x, xDir.y, yDir.x, yDir.y, o.x, o.y);
  draw();
  ctx.restore();
}

function pelvis(ctx: Ctx, S: number, hw: number, view: ViewInfo['view'], lw: number): void {
  const s = S;
  if (view === 'lateral') {
    // +x anterior. Sacrum and coccyx behind, then the hip bone: iliac fan, pubis in front, ischium below.
    const sac = new Path2D();
    sac.moveTo(-0.07 * s, -0.24 * s); sac.quadraticCurveTo(-0.17 * s, -0.16 * s, -0.16 * s, -0.04 * s); sac.quadraticCurveTo(-0.15 * s, 0.02 * s, -0.11 * s, 0.04 * s);
    sac.quadraticCurveTo(-0.12 * s, -0.04 * s, -0.1 * s, -0.12 * s); sac.quadraticCurveTo(-0.07 * s, -0.19 * s, -0.02 * s, -0.22 * s); sac.closePath();
    paintBroad(ctx, sac, -0.1 * s, -0.1 * s, 0.14 * s, lw);
    const q = new Path2D();
    q.moveTo(-0.13 * s, -0.19 * s);
    q.bezierCurveTo(-0.1 * s, -0.31 * s, 0.09 * s, -0.31 * s, 0.13 * s, -0.19 * s);
    q.quadraticCurveTo(0.14 * s, -0.12 * s, 0.07 * s, -0.07 * s);
    q.quadraticCurveTo(0.11 * s, -0.01 * s, 0.085 * s, 0.045 * s);
    q.quadraticCurveTo(0.04 * s, 0.085 * s, -0.01 * s, 0.075 * s);
    q.quadraticCurveTo(-0.02 * s, 0.15 * s, -0.08 * s, 0.15 * s);
    q.quadraticCurveTo(-0.14 * s, 0.11 * s, -0.1 * s, 0.03 * s);
    q.quadraticCurveTo(-0.17 * s, -0.05 * s, -0.15 * s, -0.12 * s);
    q.closePath();
    q.ellipse(0.005 * s, 0.075 * s, 0.03 * s, 0.022 * s, -0.5, 0, Math.PI * 2);
    paintBroad(ctx, q, 0, -0.1 * s, 0.24 * s, lw, 'evenodd');
    ctx.strokeStyle = EDGE; ctx.lineWidth = lw * 1.2;
    ctx.stroke(circle(0, 0, 0.056 * s));
    return;
  }
  // Front and back views. Sacrum in the middle (wider, with visible foramina, from behind).
  const sac = new Path2D();
  sac.moveTo(-0.17 * hw, -0.235 * s); sac.lineTo(0.17 * hw, -0.235 * s);
  sac.quadraticCurveTo(0.16 * hw, -0.1 * s, 0.03 * hw, -0.005 * s); sac.lineTo(-0.03 * hw, -0.005 * s);
  sac.quadraticCurveTo(-0.16 * hw, -0.1 * s, -0.17 * hw, -0.235 * s); sac.closePath();
  const half = (sx: number) => {
    const X = (v: number) => sx * v * hw, q = new Path2D();
    q.moveTo(X(0.12), -0.215 * s);
    q.bezierCurveTo(X(0.38), -0.315 * s, X(0.78), -0.285 * s, X(0.84), -0.165 * s);
    q.bezierCurveTo(X(0.86), -0.085 * s, X(0.72), -0.035 * s, X(0.64), 0.02 * s);
    q.quadraticCurveTo(X(0.68), 0.095 * s, X(0.52), 0.155 * s);
    q.quadraticCurveTo(X(0.37), 0.195 * s, X(0.23), 0.135 * s);
    q.lineTo(X(0.05), 0.085 * s);
    q.lineTo(X(0.03), 0.025 * s);
    q.quadraticCurveTo(X(0.25), -0.005 * s, X(0.37), -0.06 * s);
    q.quadraticCurveTo(X(0.2), -0.1 * s, X(0.13), -0.1 * s);
    q.closePath();
    // Obturator foramen.
    q.ellipse(X(0.3), 0.078 * s, 0.115 * hw, 0.043 * s, sx * 0.5, 0, Math.PI * 2);
    paintBroad(ctx, q, X(0.45), -0.12 * s, 0.3 * s, lw, 'evenodd');
    ctx.strokeStyle = EDGE; ctx.lineWidth = lw * 1.2;
    ctx.stroke(circle(X(0.5), 0, 0.056 * s));
  };
  if (view === 'posterior') { half(-1); half(1); paintBroad(ctx, sac, 0, -0.14 * s, 0.14 * s, lw); } else { paintBroad(ctx, sac, 0, -0.14 * s, 0.14 * s, lw); half(-1); half(1); }
  ctx.fillStyle = HOLE;
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) ctx.fill(circle(sx * (0.075 - i * 0.012) * hw, (-0.185 + i * 0.045) * s, Math.max(0.8, 0.008 * s)));
}

function ribCage(ctx: Ctx, S: number, chestW: number, view: ViewInfo['view'], facing: number): void {
  const s = S, w = Math.max(1.6, 0.017 * s);
  // Barrel profile: narrow at the first rib, widest about two thirds of the way down.
  const halfAt = (i: number) => chestW * (0.42 + 0.58 * Math.sin(Math.min(1, (i + 1.2) / 9) * Math.PI * 0.62));
  ctx.fillStyle = 'rgba(236,223,190,0.13)';
  ctx.fill(oval(0, 0.31 * s, chestW * 0.98, 0.3 * s));
  for (let i = 0; i < 12; i++) {
    const y = (0.02 + i * 0.047) * s, half = halfAt(i), q = new Path2D();
    if (view === 'lateral') {
      // Ribs run downward and forward from the spine.
      const back = -half * 0.86 * facing, front = half * (i < 10 ? 1 : 0.35) * facing;
      q.moveTo(back, y - 0.01 * s);
      q.quadraticCurveTo((back + front) * 0.4, y - 0.015 * s, front, y + (i < 10 ? 0.105 : 0.04) * s);
      strokeBone(ctx, q, w);
    } else {
      for (const sx of [-1, 1]) {
        const r = new Path2D();
        if (view === 'posterior') {
          r.moveTo(sx * 0.05 * s, y - 0.005 * s);
          r.bezierCurveTo(sx * half * 0.5, y - 0.03 * s, sx * half * 0.98, y - 0.005 * s, sx * half, y + (i < 10 ? 0.075 : 0.03) * s);
          strokeBone(ctx, r, w);
        } else if (i < 10) {
          // From the side of the chest the rib curves forward and down to its cartilage.
          const endX = sx * (i < 7 ? 0.2 : 0.2 + (i - 6) * 0.13) * chestW, endY = (i < 7 ? 0.085 + i * 0.062 : 0.5 + (i - 7) * 0.025) * s;
          r.moveTo(sx * half, y + 0.02 * s);
          r.bezierCurveTo(sx * half * 1.02, y + 0.075 * s, sx * half * 0.7, endY + 0.03 * s, endX + sx * 0.14 * chestW, endY + 0.012 * s);
          strokeBone(ctx, r, w);
          const c = new Path2D();
          c.moveTo(endX + sx * 0.14 * chestW, endY + 0.012 * s);
          c.quadraticCurveTo(endX + sx * 0.06 * chestW, endY + 0.004 * s, i < 7 ? sx * 0.075 * chestW : endX - sx * 0.1 * chestW, i < 7 ? endY - 0.006 * s : endY - 0.04 * s);
          strokeBone(ctx, c, w * 0.85, CARTILAGE);
        }
      }
    }
  }
  if (view === 'anterior') {
    // Sternum: manubrium, body and xiphoid process.
    const m = new Path2D();
    m.moveTo(-0.13 * chestW, 0.045 * s); m.quadraticCurveTo(0, 0.07 * s, 0.13 * chestW, 0.045 * s);
    m.lineTo(0.1 * chestW, 0.13 * s); m.lineTo(0.085 * chestW, 0.145 * s);
    m.quadraticCurveTo(0.11 * chestW, 0.3 * s, 0.07 * chestW, 0.455 * s);
    m.quadraticCurveTo(0.02 * chestW, 0.5 * s, 0, 0.54 * s); m.quadraticCurveTo(-0.02 * chestW, 0.5 * s, -0.07 * chestW, 0.455 * s);
    m.quadraticCurveTo(-0.11 * chestW, 0.3 * s, -0.085 * chestW, 0.145 * s); m.lineTo(-0.1 * chestW, 0.13 * s);
    m.closePath();
    paintBroad(ctx, m, 0, 0.25 * s, 0.25 * s, Math.max(1, s * 0.007));
    ctx.strokeStyle = EDGE; ctx.lineWidth = Math.max(0.8, s * 0.005);
    ctx.beginPath(); ctx.moveTo(-0.09 * chestW, 0.14 * s); ctx.lineTo(0.09 * chestW, 0.14 * s); ctx.stroke();
  }
}

function skull(ctx: Ctx, hr: number, view: ViewInfo['view'], lw: number): void {
  const u = hr;
  const P2 = (pts: (string | number)[]) => {
    // Compact path builder in head radii: M x y | L x y | Q cx cy x y | C c1x c1y c2x c2y x y | Z
    const q = new Path2D();
    for (let i = 0; i < pts.length;) {
      const c = pts[i++] as string, n = (k: number) => (pts[i + k] as number) * u;
      if (c === 'M') { q.moveTo(n(0), n(1)); i += 2; }
      else if (c === 'L') { q.lineTo(n(0), n(1)); i += 2; }
      else if (c === 'Q') { q.quadraticCurveTo(n(0), n(1), n(2), n(3)); i += 4; }
      else if (c === 'C') { q.bezierCurveTo(n(0), n(1), n(2), n(3), n(4), n(5)); i += 6; }
      else q.closePath();
    }
    return q;
  };
  const line = (pts: (string | number)[], width = lw) => { ctx.strokeStyle = 'rgba(95,83,56,0.75)'; ctx.lineWidth = width; ctx.stroke(P2(pts)); };
  if (view === 'lateral') {
    // +x anterior, origin at the ear opening.
    paintBroad(ctx, P2(['M', 0.02, 0.1, 'L', 0.17, 0.12, 'L', 0.25, 0.57, 'L', 0.84, 0.58, 'Q', 0.97, 0.78, 0.87, 1.0, 'Q', 0.5, 1.04, 0.04, 0.84, 'Z']), 0.45 * u, 0.6 * u, 0.6 * u, lw);
    paintBroad(ctx, P2(['M', 0.12, 0.16, 'C', -0.6, 0.48, -1.22, 0.2, -1.2, -0.45, 'C', -1.2, -1.26, -0.3, -1.44, 0.25, -1.36, 'C', 0.76, -1.28, 1.0, -0.85, 0.9, -0.42, 'L', 1.01, -0.07, 'L', 0.86, 0.03, 'L', 0.9, 0.43, 'L', 0.36, 0.46, 'L', 0.22, 0.2, 'Z']), -0.2 * u, -0.5 * u, 1.25 * u, lw);
    ctx.fillStyle = HOLE;
    ctx.fill(oval(0.67 * u, -0.2 * u, 0.15 * u, 0.2 * u, 0.15));
    ctx.fill(P2(['M', 0.88, -0.02, 'L', 0.99, -0.05, 'L', 0.9, 0.2, 'Z']));
    ctx.fill(circle(0, 0, 0.055 * u));
    // Teeth, zygomatic arch and sutures.
    ctx.fillStyle = LIGHT; ctx.strokeStyle = EDGE; ctx.lineWidth = lw * 0.7;
    for (let i = 0; i < 6; i++) { const x = (0.42 + i * 0.078) * u; ctx.fillRect(x, 0.43 * u, 0.07 * u, 0.075 * u); ctx.strokeRect(x, 0.43 * u, 0.07 * u, 0.075 * u); ctx.fillRect(x, 0.515 * u, 0.07 * u, 0.07 * u); ctx.strokeRect(x, 0.515 * u, 0.07 * u, 0.07 * u); }
    line(['M', 0.6, 0.08, 'Q', 0.35, 0.0, 0.08, 0.04], lw * 1.6);
    line(['M', 0.2, -1.36, 'Q', 0.05, -0.8, 0.3, -0.3]);
    line(['M', -0.95, -0.9, 'Q', -0.6, -0.5, -0.75, 0.05]);
    line(['M', 0.3, -0.3, 'Q', -0.2, -0.55, -0.62, -0.2, 'Q', -0.5, 0.05, -0.2, 0.12]);
    return;
  }
  if (view === 'posterior') {
    paintBroad(ctx, P2(['M', -0.7, 0.72, 'C', -0.6, 1.04, -0.3, 1.2, 0, 1.2, 'C', 0.3, 1.2, 0.6, 1.04, 0.7, 0.72, 'L', 0.72, 0.2, 'L', -0.72, 0.2, 'Z']), 0, 0.7 * u, 0.7 * u, lw);
    paintBroad(ctx, P2(['M', -0.82, 0.1, 'C', -1.02, -0.5, -0.86, -1.36, 0, -1.36, 'C', 0.86, -1.36, 1.02, -0.5, 0.82, 0.1, 'Q', 0.7, 0.5, 0.3, 0.62, 'L', -0.3, 0.62, 'Q', -0.7, 0.5, -0.82, 0.1, 'Z']), 0, -0.45 * u, 1.2 * u, lw);
    line(['M', 0, -1.36, 'L', 0, -0.45]);
    line(['M', -0.78, -0.05, 'Q', -0.4, -0.5, 0, -0.45, 'Q', 0.4, -0.5, 0.78, -0.05]);
    line(['M', -0.5, 0.42, 'Q', 0, 0.3, 0.5, 0.42]);
    return;
  }
  // Anterior. Mandible first, then cranium and face over its joints.
  paintBroad(ctx, P2(['M', -0.75, 0.08, 'L', -0.7, 0.74, 'C', -0.6, 1.06, -0.3, 1.24, 0, 1.24, 'C', 0.3, 1.24, 0.6, 1.06, 0.7, 0.74, 'L', 0.75, 0.08, 'L', 0.6, 0.14, 'L', 0.52, 0.72, 'C', 0.4, 0.93, 0.2, 0.99, 0, 0.99, 'C', -0.2, 0.99, -0.4, 0.93, -0.52, 0.72, 'L', -0.6, 0.14, 'Z']), 0, 0.7 * u, 0.8 * u, lw);
  paintBroad(ctx, P2(['M', -0.82, 0.06, 'C', -1.02, -0.5, -0.86, -1.36, 0, -1.36, 'C', 0.86, -1.36, 1.02, -0.5, 0.82, 0.06, 'Q', 0.8, 0.32, 0.56, 0.42, 'L', 0.45, 0.66, 'L', -0.45, 0.66, 'L', -0.56, 0.42, 'Q', -0.8, 0.32, -0.82, 0.06, 'Z']), 0, -0.4 * u, 1.2 * u, lw);
  ctx.fillStyle = HOLE;
  for (const sx of [-1, 1]) {
    const o = new Path2D();
    o.roundRect((sx * 0.36 - 0.24) * u, -0.42 * u, 0.48 * u, 0.4 * u, 0.15 * u);
    ctx.fill(o);
  }
  ctx.fill(P2(['M', 0, 0.02, 'Q', 0.2, 0.3, 0.13, 0.4, 'Q', 0, 0.34, -0.13, 0.4, 'Q', -0.2, 0.3, 0, 0.02, 'Z']));
  ctx.fillStyle = LIGHT; ctx.strokeStyle = EDGE; ctx.lineWidth = lw * 0.7;
  for (let i = -4; i < 4; i++) {
    ctx.fillRect(i * 0.095 * u, 0.6 * u, 0.09 * u, 0.1 * u); ctx.strokeRect(i * 0.095 * u, 0.6 * u, 0.09 * u, 0.1 * u);
    if (i >= -3 && i < 3) { ctx.fillRect(i * 0.09 * u + 0.005 * u, 0.715 * u, 0.085 * u, 0.09 * u); ctx.strokeRect(i * 0.09 * u + 0.005 * u, 0.715 * u, 0.085 * u, 0.09 * u); }
  }
  // Cheekbones and the coronal suture.
  line(['M', -0.8, 0.04, 'Q', -0.62, 0.16, -0.5, 0.04]);
  line(['M', 0.8, 0.04, 'Q', 0.62, 0.16, 0.5, 0.04]);
  line(['M', -0.8, -0.75, 'Q', 0, -1.1, 0.8, -0.75]);
}

// ---- Whole skeleton -----------------------------------------------------------------------------

export function drawBones(ctx: Ctx, lm: Lm[], info: ViewInfo, alpha: number): void {
  const r: Rig = buildRig(lm, info);
  const S = r.S, lateral = info.view === 'lateral', lw = Math.max(0.8, S * 0.0065);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';

  const ms = lerp(r.pt('l_shoulder'), r.pt('r_shoulder'), 0.5), mh = lerp(r.pt('l_hip'), r.pt('r_hip'), 0.5);
  const axis = { x: (mh.x - ms.x) / S, y: (mh.y - ms.y) / S };
  // Across the trunk: toward the front in a side view, toward image right in front and back views.
  const across = lateral ? r.seg('trunk', info.nearSide).n : { x: axis.y, y: -axis.x };
  const xDir = lateral ? across : { x: axis.y, y: -axis.x };
  const head = lerp(r.pt('l_ear'), r.pt('r_ear'), 0.5);
  const hw = Math.max(dist(r.pt('l_hip'), r.pt('r_hip')), S * 0.3);
  const sw = dist(r.pt('l_shoulder'), r.pt('r_shoulder'));

  frame(ctx, mh, xDir, axis, () => pelvis(ctx, S, hw, info.view, lw));

  // Spine: 5 lumbar and 12 thoracic vertebrae from the sacrum to the shoulder line, then 7 cervical.
  const back = lateral ? -1 : 0;
  const spineAt = (t: number): P => {
    const base = lerp(mh, ms, t);
    // Side view: lumbar lordosis and thoracic kyphosis, set back from the trunk midline.
    const curve = lateral ? S * (0.1 + 0.05 * Math.sin(Math.PI * (t * 1.6 - 0.3))) : 0;
    return { x: base.x + across.x * back * curve, y: base.y + across.y * back * curve };
  };
  const vertebra = (c: P, width: number, height: number, angle: number, spinous: number) => {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(angle);
    if (lateral) {
      // Spinous process pointing backward and down.
      const dirn = -Math.sign(Math.cos(angle) * across.x + Math.sin(angle) * across.y) || 1, sp = new Path2D();
      sp.moveTo(dirn * width * 0.45, -height * 0.25); sp.lineTo(dirn * (width * 0.5 + spinous), height * 0.55); sp.lineTo(dirn * width * 0.45, height * 0.3); sp.closePath();
      paint(ctx, sp, height, lw * 0.8);
    } else {
      const tp = new Path2D();
      tp.roundRect(-width * 0.5 - spinous, -height * 0.22, width + 2 * spinous, height * 0.44, height * 0.2);
      paint(ctx, tp, height * 0.3, lw * 0.8);
    }
    const body = new Path2D();
    body.roundRect(-width / 2, -height / 2, width, height, height * 0.28);
    const g = ctx.createLinearGradient(-width / 2, 0, width / 2, 0);
    g.addColorStop(0, SHADE); g.addColorStop(0.3, LIGHT); g.addColorStop(0.65, BONE); g.addColorStop(1, SHADE);
    ctx.strokeStyle = EDGE; ctx.lineWidth = lw * 1.6; ctx.stroke(body);
    ctx.fillStyle = g; ctx.fill(body);
    ctx.restore();
  };
  const N = 17;
  for (let i = 0; i < N; i++) {
    const t = 0.17 + (i / (N - 1)) * 0.85, c = spineAt(t), c2 = spineAt(t + 0.02);
    vertebra(c, S * (0.09 - 0.034 * (i / (N - 1))), ((S * 0.85) / N) * 0.74, Math.atan2(c2.y - c.y, c2.x - c.x) + Math.PI / 2, S * (lateral ? 0.05 : 0.022));
  }
  const neckBase = spineAt(1.03);
  const skullBase = { x: head.x + axis.x * S * 0.07 + across.x * back * S * 0.045, y: head.y + axis.y * S * 0.07 + across.y * back * S * 0.045 };
  const neckLen = dist(neckBase, skullBase);
  for (let i = 0; i < 7; i++) {
    const t = (i + 0.5) / 7, c = lerp(neckBase, skullBase, t);
    // Cervical lordosis in the side view.
    const bow = lateral ? Math.sin(Math.PI * t) * 0.022 * S : 0;
    vertebra({ x: c.x + across.x * bow, y: c.y + across.y * bow }, S * 0.05, (neckLen / 7) * 0.72, Math.atan2(skullBase.y - neckBase.y, skullBase.x - neckBase.x) + Math.PI / 2, S * (lateral ? 0.032 : 0.012));
  }

  const chestW = lateral ? S * 0.25 : Math.max(sw * 0.43, S * 0.25);
  const chestO = lateral ? { x: ms.x + across.x * S * 0.02, y: ms.y + across.y * S * 0.02 } : ms;
  frame(ctx, chestO, xDir, axis, () => ribCage(ctx, S, chestW, info.view, 1));

  // Shoulder girdle.
  if (!lateral) {
    const notch = { x: ms.x + axis.x * S * 0.05, y: ms.y + axis.y * S * 0.05 };
    for (const sd of ['l', 'r'] as const) {
      const sh = r.pt(`${sd}_shoulder`), g = r.seg('trunk', sd);
      if (info.view === 'posterior') {
        // Scapula: triangular blade with its spine running out to the acromion.
        const at = (out: number, down: number): P => ({ x: sh.x - g.n.x * S * out + g.u.x * S * down, y: sh.y - g.n.y * S * out + g.u.y * S * down });
        const b = new Path2D(), p0 = at(0.0, 0.0), p1 = at(0.27, 0.0), p2 = at(0.21, 0.38), p3 = at(0.03, 0.12);
        b.moveTo(p0.x, p0.y); b.quadraticCurveTo(at(0.14, -0.04).x, at(0.14, -0.04).y, p1.x, p1.y);
        b.quadraticCurveTo(at(0.29, 0.2).x, at(0.29, 0.2).y, p2.x, p2.y);
        b.quadraticCurveTo(at(0.1, 0.28).x, at(0.1, 0.28).y, p3.x, p3.y); b.closePath();
        const c = at(0.15, 0.16);
        const gr = ctx.createRadialGradient(c.x - S * 0.06, c.y - S * 0.08, S * 0.01, c.x, c.y, S * 0.26);
        gr.addColorStop(0, LIGHT); gr.addColorStop(0.6, BONE); gr.addColorStop(1, SHADE);
        ctx.strokeStyle = EDGE; ctx.lineWidth = lw * 2; ctx.stroke(b); ctx.fillStyle = gr; ctx.fill(b);
        const sp = new Path2D(); sp.moveTo(at(0.26, 0.09).x, at(0.26, 0.09).y); sp.quadraticCurveTo(at(0.1, 0.03).x, at(0.1, 0.03).y, at(-0.03, -0.03).x, at(-0.03, -0.03).y);
        strokeBone(ctx, sp, Math.max(2, S * 0.022));
      }
      // Clavicle: gentle S-curve from the sternum to the acromion.
      const end = { x: sh.x - axis.x * S * 0.03, y: sh.y - axis.y * S * 0.03 }, d = { x: end.x - notch.x, y: end.y - notch.y };
      const cl = new Path2D();
      cl.moveTo(notch.x + d.x * 0.08, notch.y + d.y * 0.08);
      cl.bezierCurveTo(notch.x + d.x * 0.4 + axis.x * S * 0.035, notch.y + d.y * 0.4 + axis.y * S * 0.035, notch.x + d.x * 0.65 - axis.x * S * 0.035, notch.y + d.y * 0.65 - axis.y * S * 0.035, end.x, end.y);
      strokeBone(ctx, cl, Math.max(2.5, S * 0.03));
    }
  }

  const ear = dist(r.pt('l_ear'), r.pt('r_ear'));
  const hr = lateral ? S * 0.19 : Math.max(ear * 0.62, S * 0.14);
  frame(ctx, head, xDir, axis, () => skull(ctx, hr, info.view, lw));

  // Limbs: the far side first in front and back views is not needed (they do not overlap); near side only in side views.
  for (const sd of r.sides) {
    const th = r.seg('thigh', sd), sk = r.seg('shank', sd), ua = r.seg('upperarm', sd), fa = r.seg('forearm', sd);
    femur(ctx, th.a, th.b, th.n, S, lateral, lw);
    lowerLeg(ctx, sk.a, sk.b, sk.n, S, lateral, lw);
    foot(ctx, r.pt(`${sd}_heel`), r.pt(`${sd}_toe`), r.pt(`${sd}_ankle`), S, lateral, lw);
    if (info.view !== 'posterior') patella(ctx, lateral ? { x: th.b.x + th.n.x * S * 0.062, y: th.b.y + th.n.y * S * 0.062 } : th.b, th.u, S, lw);
    humerus(ctx, ua.a, ua.b, ua.n, S, lateral, lw);
    forearm(ctx, fa.a, fa.b, fa.n, S, lw);
    hand(ctx, r.pt(`${sd}_wrist`), r.pt(`${sd}_index`), r.pt(`${sd}_pinky`), r.pt(`${sd}_thumb`), S, lw);
  }
  ctx.restore();
}
