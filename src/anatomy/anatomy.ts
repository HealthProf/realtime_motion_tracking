// Schematic bone and muscle layers, drawn procedurally and fitted to the tracked skeleton.
// This is a generic atlas positioned from keypoints: it illustrates where structures lie relative to
// the segments. It is NOT an image of the subject's own anatomy, and rotation about a segment's long
// axis (e.g. forearm pronation) cannot be shown because keypoints do not capture it.
import { bodyYaw } from '../coach/coach';
import { L, type LandmarkName } from '../pose/landmarks';
import type { Lm } from '../types';

export type AnatomyView = 'anterior' | 'posterior' | 'lateral';
export type JointGroup = 'ankle' | 'knee' | 'hip' | 'trunk' | 'shoulder' | 'elbow' | 'wrist';

export type P = { x: number; y: number };
export type SegName = 'thigh' | 'shank' | 'foot' | 'upperarm' | 'forearm' | 'trunk';
/** Attachment point: segment, fraction along it (0 = proximal), offset along the segment normal (in body units). */
export type Att = [SegName, number, number];

export interface MuscleDef {
  id: string;
  label: string;
  joints: JointGroup[];
  /** Clarifies which parts of a group cross which joint. */
  note?: string;
  shapes: Partial<Record<AnatomyView, MuscleShape[]>>;
}

export interface MuscleShape {
  from: Att;
  to: Att;
  width: number;
  /** Where the belly is thickest, as a fraction of the length (default 0.42). */
  belly?: number;
  /** Broad muscles: length (body units) of the origin, which runs along the `from` segment and converges on `to`. */
  fan?: number;
  /** Number of tendinous intersections drawn across the belly (rectus abdominis). */
  bands?: number;
}

// Offsets: lateral view, + = anterior. Frontal views, + = lateral (away from the midline).
export const MUSCLES: MuscleDef[] = [
  { id: 'quadriceps', label: 'Quadriceps', joints: ['knee', 'hip'], note: 'All four heads extend the knee; only rectus femoris also crosses the hip.',
    shapes: { lateral: [{ from: ['thigh', 0.06, 0.1], to: ['thigh', 0.97, 0.07], width: 0.17 }], anterior: [{ from: ['thigh', 0.08, 0.02], to: ['thigh', 0.95, 0], width: 0.2 }] } },
  { id: 'hamstrings', label: 'Hamstrings', joints: ['hip', 'knee'], note: 'The short head of biceps femoris crosses only the knee.',
    shapes: { lateral: [{ from: ['thigh', 0.02, -0.1], to: ['shank', 0.07, -0.05], width: 0.14 }], posterior: [{ from: ['thigh', 0.06, 0], to: ['shank', 0.06, 0], width: 0.18 }] } },
  { id: 'gluteus_maximus', label: 'Gluteus maximus', joints: ['hip'],
    shapes: { lateral: [{ from: ['trunk', 0.9, -0.17], to: ['thigh', 0.28, -0.05], width: 0.2 }], posterior: [{ from: ['trunk', 0.88, -0.16], to: ['thigh', 0.24, 0.06], width: 0.2, fan: 0.24 }] } },
  { id: 'gluteus_medius', label: 'Gluteus medius (hip abductors)', joints: ['hip'],
    shapes: { anterior: [{ from: ['trunk', 0.84, 0.05], to: ['thigh', 0.1, 0.08], width: 0.09 }], posterior: [{ from: ['trunk', 0.8, 0.04], to: ['thigh', 0.08, 0.08], width: 0.1 }] } },
  { id: 'iliopsoas', label: 'Iliopsoas (hip flexors)', joints: ['hip', 'trunk'], note: 'Psoas major also attaches to the lumbar spine.',
    shapes: { lateral: [{ from: ['trunk', 0.72, 0.04], to: ['thigh', 0.12, 0.04], width: 0.08 }] } },
  { id: 'adductors', label: 'Hip adductors', joints: ['hip'], note: 'Gracilis also crosses the knee.',
    shapes: { anterior: [{ from: ['thigh', 0.02, -0.1], to: ['thigh', 0.7, -0.03], width: 0.11 }] } },
  { id: 'triceps_surae', label: 'Gastrocnemius and soleus', joints: ['ankle', 'knee'], note: 'Gastrocnemius crosses the knee and ankle; soleus crosses only the ankle.',
    shapes: { lateral: [{ from: ['thigh', 0.95, -0.06], to: ['foot', 0.02, 0], width: 0.13, belly: 0.32 }], posterior: [{ from: ['thigh', 0.95, 0], to: ['foot', 0.02, 0], width: 0.15, belly: 0.3 }], anterior: [{ from: ['shank', 0.05, -0.06], to: ['shank', 0.55, -0.04], width: 0.06 }] } },
  { id: 'tibialis_anterior', label: 'Tibialis anterior', joints: ['ankle'],
    shapes: { lateral: [{ from: ['shank', 0.08, 0.07], to: ['shank', 1.0, 0.05], width: 0.07 }], anterior: [{ from: ['shank', 0.08, 0.03], to: ['shank', 0.96, -0.01], width: 0.07 }] } },
  { id: 'rectus_abdominis', label: 'Rectus abdominis', joints: ['trunk'],
    shapes: { lateral: [{ from: ['trunk', 0.38, 0.2], to: ['trunk', 0.98, 0.14], width: 0.09, belly: 0.5 }], anterior: [{ from: ['trunk', 0.4, -0.24], to: ['trunk', 1.0, -0.15], width: 0.1, belly: 0.5, bands: 3 }] } },
  { id: 'obliques', label: 'Abdominal obliques', joints: ['trunk'],
    shapes: { anterior: [{ from: ['trunk', 0.45, -0.04], to: ['trunk', 0.95, -0.07], width: 0.12 }] } },
  { id: 'erector_spinae', label: 'Erector spinae', joints: ['trunk'],
    shapes: { lateral: [{ from: ['trunk', 0.05, -0.16], to: ['trunk', 0.95, -0.15], width: 0.08 }], posterior: [{ from: ['trunk', 0.25, -0.3], to: ['trunk', 1.0, -0.19], width: 0.07 }] } },
  { id: 'trapezius', label: 'Trapezius', joints: ['shoulder'], note: 'Acts on the scapula (shoulder girdle), not the glenohumeral joint itself.',
    shapes: { posterior: [{ from: ['trunk', 0.2, -0.3], to: ['upperarm', -0.02, 0.0], width: 0.16, fan: 0.72 }] } },
  { id: 'latissimus_dorsi', label: 'Latissimus dorsi', joints: ['shoulder'],
    shapes: { lateral: [{ from: ['trunk', 0.62, -0.15], to: ['upperarm', 0.2, -0.03], width: 0.12 }], posterior: [{ from: ['trunk', 0.72, -0.27], to: ['upperarm', 0.2, -0.02], width: 0.18, fan: 0.5 }] } },
  { id: 'pectoralis_major', label: 'Pectoralis major', joints: ['shoulder'],
    shapes: { lateral: [{ from: ['trunk', 0.2, 0.18], to: ['upperarm', 0.25, 0.03], width: 0.12 }], anterior: [{ from: ['trunk', 0.24, -0.27], to: ['upperarm', 0.22, 0], width: 0.17, fan: 0.34 }] } },
  { id: 'deltoid', label: 'Deltoid', joints: ['shoulder'],
    shapes: { lateral: [{ from: ['upperarm', -0.06, 0], to: ['upperarm', 0.45, 0], width: 0.17, belly: 0.3 }], anterior: [{ from: ['upperarm', -0.05, 0.05], to: ['upperarm', 0.45, 0.03], width: 0.15, belly: 0.3 }], posterior: [{ from: ['upperarm', -0.05, 0.05], to: ['upperarm', 0.45, 0.03], width: 0.15, belly: 0.3 }] } },
  { id: 'biceps', label: 'Biceps brachii', joints: ['elbow', 'shoulder'],
    shapes: { lateral: [{ from: ['upperarm', 0.05, 0.07], to: ['forearm', 0.15, 0.03], width: 0.1 }], anterior: [{ from: ['upperarm', 0.1, -0.02], to: ['forearm', 0.12, 0], width: 0.1 }] } },
  { id: 'triceps', label: 'Triceps brachii', joints: ['elbow', 'shoulder'], note: 'Only the long head crosses the shoulder.',
    shapes: { lateral: [{ from: ['upperarm', 0.05, -0.07], to: ['forearm', 0.0, -0.05], width: 0.1 }], posterior: [{ from: ['upperarm', 0.1, 0], to: ['forearm', 0.0, 0], width: 0.11 }] } },
  { id: 'forearm_flexors', label: 'Forearm flexors', joints: ['wrist', 'elbow'],
    shapes: { lateral: [{ from: ['forearm', 0.02, 0.05], to: ['forearm', 0.9, 0.03], width: 0.07, belly: 0.35 }], anterior: [{ from: ['forearm', 0.02, -0.04], to: ['forearm', 0.9, -0.02], width: 0.07, belly: 0.35 }] } },
  { id: 'forearm_extensors', label: 'Forearm extensors', joints: ['wrist', 'elbow'],
    shapes: { lateral: [{ from: ['forearm', 0.02, -0.05], to: ['forearm', 0.9, -0.03], width: 0.07, belly: 0.35 }], posterior: [{ from: ['forearm', 0.02, 0.03], to: ['forearm', 0.9, 0.01], width: 0.07, belly: 0.35 }], anterior: [{ from: ['forearm', 0, 0.05], to: ['forearm', 0.85, 0.03], width: 0.06, belly: 0.35 }] } },
];

export const JOINT_GROUPS: JointGroup[] = ['ankle', 'knee', 'hip', 'trunk', 'shoulder', 'elbow', 'wrist'];
export const musclesCrossing = (j: JointGroup) => MUSCLES.filter((m) => m.joints.includes(j));

export interface ViewInfo {
  view: AnatomyView;
  /** Lateral view: +1 if the subject faces image right, -1 if left. */
  facing: 1 | -1;
  /** Lateral view: the side nearer the camera (the one drawn). */
  nearSide: 'l' | 'r';
}

export function detectView(lm: Lm[], world: Lm[] | null, mirrored: boolean): ViewInfo {
  const ls = lm[L.l_shoulder], rs = lm[L.r_shoulder];
  const torso = Math.hypot((ls.x + rs.x) / 2 - (lm[L.l_hip].x + lm[L.r_hip].x) / 2, (ls.y + rs.y) / 2 - (lm[L.l_hip].y + lm[L.r_hip].y) / 2) || 1;
  const yaw = bodyYaw(world);
  const lateral = Number.isFinite(yaw) ? yaw > 55 : Math.abs(ls.x - rs.x) / torso < 0.4;
  let f = 0;
  for (const s of ['l', 'r'] as const) f += lm[L[`${s}_toe`]].x - lm[L[`${s}_heel`]].x;
  if (Math.abs(f) < 0.02 * torso) f = lm[L.nose].x - (lm[L.l_ear].x + lm[L.r_ear].x) / 2;
  const vis = (s: 'l' | 'r') => lm[L[`${s}_shoulder`]].v + lm[L[`${s}_hip`]].v + lm[L[`${s}_knee`]].v + lm[L[`${s}_elbow`]].v;
  const nearSide = vis('l') >= vis('r') ? 'l' : 'r';
  if (lateral) return { view: 'lateral', facing: f >= 0 ? 1 : -1, nearSide };
  const facingCamera = (ls.x - rs.x) * (mirrored ? -1 : 1) > 0;
  return { view: facingCamera ? 'anterior' : 'posterior', facing: 1, nearSide };
}

export interface Rig {
  S: number;
  info: ViewInfo;
  pt: (n: LandmarkName) => P;
  /** Proximal point, unit axis and unit normal of a segment on one side. */
  seg: (name: SegName, side: 'l' | 'r') => { a: P; b: P; u: P; n: P; len: number };
  at: (att: Att, side: 'l' | 'r') => P;
  sides: ('l' | 'r')[];
  /**
   * Point inside the trunk. s: 0 at the shoulder line, 1 at the hip line. left: toward the subject's
   * left (used in front/back views). ant: toward the front of the body (used in side views). Units of S.
   */
  trunk: (s: number, left: number, ant: number) => P;
  /** Point in the head, in head radii from the mid-ear point: up, subject-left, anterior. */
  head: (up: number, left: number, ant: number) => P;
  headRadius: number;
}

export function buildRig(lm: Lm[], info: ViewInfo): Rig {
  const pt = (n: LandmarkName): P => lm[L[n]];
  const midp = (a: P, b: P): P => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const ms = midp(pt('l_shoulder'), pt('r_shoulder')), mh = midp(pt('l_hip'), pt('r_hip'));
  const S = Math.hypot(ms.x - mh.x, ms.y - mh.y) || 1;
  const leftOnRight = pt('l_shoulder').x >= pt('r_shoulder').x;
  const seg = (name: SegName, side: 'l' | 'r') => {
    let a: P, b: P;
    switch (name) {
      case 'thigh': a = pt(`${side}_hip`); b = pt(`${side}_knee`); break;
      case 'shank': a = pt(`${side}_knee`); b = pt(`${side}_ankle`); break;
      case 'foot': a = pt(`${side}_heel`); b = pt(`${side}_toe`); break;
      case 'upperarm': a = pt(`${side}_shoulder`); b = pt(`${side}_elbow`); break;
      case 'forearm': a = pt(`${side}_elbow`); b = pt(`${side}_wrist`); break;
      default:
        if (info.view === 'lateral') { a = ms; b = mh; } else { a = pt(`${side}_shoulder`); b = pt(`${side}_hip`); }
    }
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    // Normal sign: anterior in lateral views; lateral (away from the midline) in frontal views.
    const sgn = info.view === 'lateral' ? info.facing : (side === 'l') === leftOnRight ? 1 : -1;
    return { a, b, u, n: { x: u.y * sgn, y: -u.x * sgn }, len };
  };
  const at = ([name, s, off]: Att, side: 'l' | 'r'): P => {
    const g = seg(name, side);
    return { x: g.a.x + g.u.x * g.len * s + g.n.x * off * S, y: g.a.y + g.u.y * g.len * s + g.n.y * off * S };
  };
  const lateral = info.view === 'lateral';
  const axis = { x: (mh.x - ms.x) / S, y: (mh.y - ms.y) / S };
  const sw = Math.hypot(pt('l_shoulder').x - pt('r_shoulder').x, pt('l_shoulder').y - pt('r_shoulder').y) || 1;
  const leftDir = { x: (pt('l_shoulder').x - pt('r_shoulder').x) / sw, y: (pt('l_shoulder').y - pt('r_shoulder').y) / sw };
  const antDir = seg('trunk', info.nearSide).n;
  const across = (left: number, ant: number, unit: number): P => (lateral ? { x: antDir.x * ant * unit, y: antDir.y * ant * unit } : { x: leftDir.x * left * unit, y: leftDir.y * left * unit });
  const trunk = (s2: number, left: number, ant: number): P => { const o = across(left, ant, S); return { x: ms.x + axis.x * s2 * S + o.x, y: ms.y + axis.y * s2 * S + o.y }; };
  const earMid = midp(pt('l_ear'), pt('r_ear'));
  const earW = Math.hypot(pt('l_ear').x - pt('r_ear').x, pt('l_ear').y - pt('r_ear').y);
  const headRadius = lateral ? S * 0.19 : Math.max(earW * 0.62, S * 0.14);
  const head = (up: number, left: number, ant: number): P => { const o = across(left, ant, headRadius); return { x: earMid.x - axis.x * up * headRadius + o.x, y: earMid.y - axis.y * up * headRadius + o.y }; };
  return { S, info, pt, seg, at, sides: lateral ? [info.nearSide] : ['l', 'r'], trunk, head, headRadius };
}

interface MuscleColors { edge: string; dark: string; mid: string; light: string }
const MUSCLE: MuscleColors = { edge: '#4d120e', dark: '#8a2018', mid: '#c2392c', light: '#e8695a' };
const MUSCLE_HI: MuscleColors = { edge: '#fff3c4', dark: '#c81e1e', mid: '#ff4d4d', light: '#ffa08f' };
const TENDON = '240,232,214';

/** A fusiform muscle: shaded belly, pale tendons at both ends and fibre lines. */
function spindle(ctx: CanvasRenderingContext2D, a: P, b: P, width: number, belly: number, col: MuscleColors, bands = 0): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 2) return;
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
  const bx = len * belly, h = width / 2, x2 = Math.min(len * 0.82, bx * 2.2);
  const path = new Path2D();
  path.moveTo(0, 0);
  path.bezierCurveTo(bx * 0.4, -h * 1.25, bx * 1.3, -h * 1.25, x2, -h * 0.45);
  path.quadraticCurveTo(len * 0.92, -h * 0.12, len, 0);
  path.quadraticCurveTo(len * 0.92, h * 0.12, x2, h * 0.45);
  path.bezierCurveTo(bx * 1.3, h * 1.25, bx * 0.4, h * 1.25, 0, 0);
  path.closePath();
  const across = ctx.createLinearGradient(0, -h, 0, h);
  across.addColorStop(0, col.dark); across.addColorStop(0.3, col.light); across.addColorStop(0.6, col.mid); across.addColorStop(1, col.dark);
  ctx.strokeStyle = col.edge;
  ctx.stroke(path);
  ctx.fillStyle = across;
  ctx.fill(path);
  // Tendons: the ends fade from pale connective tissue into the red belly.
  const tend = ctx.createLinearGradient(0, 0, len, 0);
  tend.addColorStop(0, `rgba(${TENDON},0.95)`); tend.addColorStop(0.13, `rgba(${TENDON},0)`); tend.addColorStop(0.8, `rgba(${TENDON},0)`); tend.addColorStop(1, `rgba(${TENDON},0.95)`);
  ctx.fillStyle = tend;
  ctx.fill(path);
  // Fibre lines follow the outline of the belly.
  ctx.save();
  ctx.clip(path);
  ctx.lineWidth = Math.max(0.6, width * 0.025);
  for (const k of [-0.75, -0.45, -0.15, 0.15, 0.45, 0.75]) {
    ctx.strokeStyle = k < 0 ? 'rgba(255,205,190,0.32)' : 'rgba(55,8,6,0.38)';
    ctx.beginPath();
    ctx.moveTo(len * 0.04, k * h * 0.3);
    ctx.bezierCurveTo(bx * 0.6, k * h * 1.3, bx * 1.3, k * h * 1.3, len * 0.95, k * h * 0.12);
    ctx.stroke();
  }
  if (bands) {
    ctx.strokeStyle = `rgba(${TENDON},0.85)`;
    ctx.lineWidth = Math.max(1, width * 0.07);
    for (let i = 1; i <= bands; i++) { const x = len * (0.12 + (0.6 * i) / (bands + 0.5)); ctx.beginPath(); ctx.moveTo(x, -h * 1.3); ctx.lineTo(x, h * 1.3); ctx.stroke(); }
  }
  ctx.restore();
  ctx.restore();
}

/** A broad, fan-shaped muscle: fibres run from a long origin (o0 to o1) and converge on the insertion. */
function fan(ctx: CanvasRenderingContext2D, o0: P, o1: P, tip: P, col: MuscleColors): void {
  const mid = { x: (o0.x + o1.x) / 2, y: (o0.y + o1.y) / 2 }, len = Math.hypot(tip.x - mid.x, tip.y - mid.y);
  if (len < 2) return;
  const bulge = (o: P, k: number): P => ({ x: o.x + (tip.x - o.x) * 0.55 + (o.x - mid.x) * k, y: o.y + (tip.y - o.y) * 0.55 + (o.y - mid.y) * k });
  const c0 = bulge(o0, 0.25), c1 = bulge(o1, 0.25);
  const path = new Path2D();
  path.moveTo(o0.x, o0.y);
  path.quadraticCurveTo(c0.x, c0.y, tip.x, tip.y);
  path.quadraticCurveTo(c1.x, c1.y, o1.x, o1.y);
  path.closePath();
  const g = ctx.createLinearGradient(o0.x, o0.y, o1.x, o1.y);
  g.addColorStop(0, col.dark); g.addColorStop(0.3, col.light); g.addColorStop(0.65, col.mid); g.addColorStop(1, col.dark);
  ctx.strokeStyle = col.edge;
  ctx.stroke(path);
  ctx.fillStyle = g;
  ctx.fill(path);
  const tend = ctx.createLinearGradient(mid.x, mid.y, tip.x, tip.y);
  tend.addColorStop(0, `rgba(${TENDON},0.55)`); tend.addColorStop(0.1, `rgba(${TENDON},0)`); tend.addColorStop(0.72, `rgba(${TENDON},0)`); tend.addColorStop(1, `rgba(${TENDON},0.95)`);
  ctx.fillStyle = tend;
  ctx.fill(path);
  ctx.save();
  ctx.clip(path);
  ctx.lineWidth = Math.max(0.6, len * 0.006);
  for (let i = 1; i < 9; i++) {
    const o = { x: o0.x + ((o1.x - o0.x) * i) / 9, y: o0.y + ((o1.y - o0.y) * i) / 9 };
    ctx.strokeStyle = i % 2 ? 'rgba(55,8,6,0.36)' : 'rgba(255,205,190,0.3)';
    ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.quadraticCurveTo(bulge(o, 0.1).x, bulge(o, 0.1).y, tip.x, tip.y); ctx.stroke();
  }
  ctx.restore();
}

/** Draws the muscle layer. Returns the ids actually drawn in this view (for the legend). */
export function drawMuscles(ctx: CanvasRenderingContext2D, lm: Lm[], info: ViewInfo, alpha: number, highlight: JointGroup | null, minVis: number): string[] {
  const r = buildRig(lm, info);
  const drawn: string[] = [];
  const needs: Record<SegName, LandmarkName[]> = { thigh: ['l_hip', 'l_knee'], shank: ['l_knee', 'l_ankle'], foot: ['l_heel', 'l_toe'], upperarm: ['l_shoulder', 'l_elbow'], forearm: ['l_elbow', 'l_wrist'], trunk: ['l_shoulder', 'l_hip'] };
  const visible = (name: SegName, side: 'l' | 'r') => needs[name].every((n) => lm[L[n.replace(/^l_/, `${side}_`) as LandmarkName]].v >= minVis);
  ctx.save();
  ctx.lineWidth = Math.max(1, r.S * 0.006);
  ctx.lineJoin = 'round';
  for (const m of MUSCLES) {
    const shapes = m.shapes[info.view];
    if (!shapes) continue;
    const on = !highlight || m.joints.includes(highlight);
    ctx.globalAlpha = alpha * (on ? 1 : 0.22);
    const col = highlight && on ? MUSCLE_HI : MUSCLE;
    let any = false;
    for (const side of r.sides) {
      for (const sh of shapes) {
        if (!visible(sh.from[0], side) || !visible(sh.to[0], side)) continue;
        if (sh.fan) {
          // The origin runs along the segment it attaches to (for the trunk: along the spine or sternum).
          const [seg, t, off] = sh.from, half = sh.fan / 2 / (r.seg(seg, side).len / r.S || 1);
          fan(ctx, r.at([seg, t - half, off], side), r.at([seg, t + half, off], side), r.at(sh.to, side), col);
        } else spindle(ctx, r.at(sh.from, side), r.at(sh.to, side), sh.width * r.S, sh.belly ?? 0.42, col, sh.bands);
        any = true;
      }
    }
    if (any) drawn.push(m.id);
  }
  ctx.restore();
  return drawn;
}
