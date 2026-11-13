// Schematic bone and muscle layers, drawn procedurally and fitted to the tracked skeleton.
// This is a generic atlas positioned from keypoints: it illustrates where structures lie relative to
// the segments. It is NOT an image of the subject's own anatomy, and rotation about a segment's long
// axis (e.g. forearm pronation) cannot be shown because keypoints do not capture it.
import { bodyYaw } from '../coach/coach';
import { L, type LandmarkName } from '../pose/landmarks';
import type { Lm } from '../types';

export type AnatomyView = 'anterior' | 'posterior' | 'lateral';
export type JointGroup = 'ankle' | 'knee' | 'hip' | 'trunk' | 'shoulder' | 'elbow' | 'wrist';

type P = { x: number; y: number };
type SegName = 'thigh' | 'shank' | 'foot' | 'upperarm' | 'forearm' | 'trunk';
/** Attachment point: segment, fraction along it (0 = proximal), offset along the segment normal (in body units). */
type Att = [SegName, number, number];

export interface MuscleDef {
  id: string;
  label: string;
  joints: JointGroup[];
  /** Clarifies which parts of a group cross which joint. */
  note?: string;
  shapes: Partial<Record<AnatomyView, { from: Att; to: Att; width: number; belly?: number }[]>>;
}

// Offsets: lateral view, + = anterior. Frontal views, + = lateral (away from the midline).
export const MUSCLES: MuscleDef[] = [
  { id: 'quadriceps', label: 'Quadriceps', joints: ['knee', 'hip'], note: 'All four heads extend the knee; only rectus femoris also crosses the hip.',
    shapes: { lateral: [{ from: ['thigh', 0.06, 0.1], to: ['thigh', 0.97, 0.07], width: 0.17 }], anterior: [{ from: ['thigh', 0.08, 0.02], to: ['thigh', 0.95, 0], width: 0.2 }] } },
  { id: 'hamstrings', label: 'Hamstrings', joints: ['hip', 'knee'], note: 'The short head of biceps femoris crosses only the knee.',
    shapes: { lateral: [{ from: ['thigh', 0.02, -0.1], to: ['shank', 0.07, -0.05], width: 0.14 }], posterior: [{ from: ['thigh', 0.06, 0], to: ['shank', 0.06, 0], width: 0.18 }] } },
  { id: 'gluteus_maximus', label: 'Gluteus maximus', joints: ['hip'],
    shapes: { lateral: [{ from: ['trunk', 0.9, -0.17], to: ['thigh', 0.28, -0.05], width: 0.2 }], posterior: [{ from: ['trunk', 0.86, -0.17], to: ['thigh', 0.22, 0.05], width: 0.2 }] } },
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
    shapes: { lateral: [{ from: ['trunk', 0.38, 0.2], to: ['trunk', 0.98, 0.14], width: 0.09 }], anterior: [{ from: ['trunk', 0.4, -0.24], to: ['trunk', 1.0, -0.15], width: 0.1 }] } },
  { id: 'obliques', label: 'Abdominal obliques', joints: ['trunk'],
    shapes: { anterior: [{ from: ['trunk', 0.45, -0.04], to: ['trunk', 0.95, -0.07], width: 0.12 }] } },
  { id: 'erector_spinae', label: 'Erector spinae', joints: ['trunk'],
    shapes: { lateral: [{ from: ['trunk', 0.05, -0.16], to: ['trunk', 0.95, -0.15], width: 0.08 }], posterior: [{ from: ['trunk', 0.25, -0.3], to: ['trunk', 1.0, -0.19], width: 0.07 }] } },
  { id: 'trapezius', label: 'Trapezius', joints: ['shoulder'], note: 'Acts on the scapula (shoulder girdle), not the glenohumeral joint itself.',
    shapes: { posterior: [{ from: ['trunk', -0.06, -0.1], to: ['trunk', 0.5, -0.32], width: 0.16 }] } },
  { id: 'latissimus_dorsi', label: 'Latissimus dorsi', joints: ['shoulder'],
    shapes: { lateral: [{ from: ['trunk', 0.62, -0.15], to: ['upperarm', 0.2, -0.03], width: 0.12 }], posterior: [{ from: ['trunk', 0.85, -0.2], to: ['upperarm', 0.2, -0.02], width: 0.18 }] } },
  { id: 'pectoralis_major', label: 'Pectoralis major', joints: ['shoulder'],
    shapes: { lateral: [{ from: ['trunk', 0.2, 0.18], to: ['upperarm', 0.25, 0.03], width: 0.12 }], anterior: [{ from: ['trunk', 0.16, -0.24], to: ['upperarm', 0.22, 0], width: 0.17 }] } },
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

interface Rig {
  S: number;
  info: ViewInfo;
  pt: (n: LandmarkName) => P;
  /** Proximal point, unit axis and unit normal of a segment on one side. */
  seg: (name: SegName, side: 'l' | 'r') => { a: P; b: P; u: P; n: P; len: number };
  at: (att: Att, side: 'l' | 'r') => P;
  sides: ('l' | 'r')[];
}

function buildRig(lm: Lm[], info: ViewInfo): Rig {
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
  return { S, info, pt, seg, at, sides: info.view === 'lateral' ? [info.nearSide] : ['l', 'r'] };
}

const BONE = '#f3ead2', BONE_EDGE = '#8a7a55';

function longBone(ctx: CanvasRenderingContext2D, a: P, b: P, shaft: number, ends: number): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return;
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
  const e = Math.min(ends, len * 0.3);
  ctx.beginPath();
  ctx.moveTo(0, -ends / 2);
  ctx.bezierCurveTo(e, -ends / 2, e, -shaft / 2, e * 1.8, -shaft / 2);
  ctx.lineTo(len - e * 1.8, -shaft / 2);
  ctx.bezierCurveTo(len - e, -shaft / 2, len - e, -ends / 2, len, -ends / 2);
  ctx.quadraticCurveTo(len + ends * 0.35, 0, len, ends / 2);
  ctx.bezierCurveTo(len - e, ends / 2, len - e, shaft / 2, len - e * 1.8, shaft / 2);
  ctx.lineTo(e * 1.8, shaft / 2);
  ctx.bezierCurveTo(e, shaft / 2, e, ends / 2, 0, ends / 2);
  ctx.quadraticCurveTo(-ends * 0.35, 0, 0, -ends / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function ellipse(ctx: CanvasRenderingContext2D, c: P, rx: number, ry: number, rot = 0, fill = true): void {
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, Math.max(0.5, rx), Math.max(0.5, ry), rot, 0, Math.PI * 2);
  if (fill) ctx.fill();
  ctx.stroke();
}

export function drawBones(ctx: CanvasRenderingContext2D, lm: Lm[], info: ViewInfo, alpha: number): void {
  const r = buildRig(lm, info);
  const S = r.S, lateral = info.view === 'lateral';
  const lerp = (a: P, b: P, t: number): P => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = BONE;
  ctx.strokeStyle = BONE_EDGE;
  ctx.lineWidth = Math.max(1, S * 0.008);
  ctx.lineJoin = 'round';

  const trunk = r.seg('trunk', info.nearSide);
  const ms = lerp(r.pt('l_shoulder'), r.pt('r_shoulder'), 0.5), mh = lerp(r.pt('l_hip'), r.pt('r_hip'), 0.5);
  const axis = { x: (mh.x - ms.x) / S, y: (mh.y - ms.y) / S };
  const rot = Math.atan2(axis.y, axis.x) - Math.PI / 2;
  // In lateral views the normal points anterior; in frontal views use the image-right normal.
  const nrm = lateral ? trunk.n : { x: axis.y, y: -axis.x };
  const head = lerp(r.pt('l_ear'), r.pt('r_ear'), 0.5);

  // Pelvis.
  if (lateral) {
    ctx.save();
    ellipse(ctx, { x: mh.x - axis.x * S * 0.1 - nrm.x * S * 0.03, y: mh.y - axis.y * S * 0.1 - nrm.y * S * 0.03 }, S * 0.15, S * 0.17, rot + 0.3 * info.facing);
    ctx.restore();
  } else {
    const hw = Math.max(Math.hypot(r.pt('l_hip').x - r.pt('r_hip').x, r.pt('l_hip').y - r.pt('r_hip').y), S * 0.3);
    for (const sgn of [-1, 1]) {
      const c = { x: mh.x - axis.x * S * 0.12 + nrm.x * sgn * hw * 0.42, y: mh.y - axis.y * S * 0.12 + nrm.y * sgn * hw * 0.42 };
      ellipse(ctx, c, hw * 0.36, S * 0.15, rot + sgn * 0.45);
    }
    ctx.beginPath();
    const top = { x: mh.x - axis.x * S * 0.22, y: mh.y - axis.y * S * 0.22 };
    ctx.moveTo(top.x + nrm.x * hw * 0.16, top.y + nrm.y * hw * 0.16);
    ctx.lineTo(top.x - nrm.x * hw * 0.16, top.y - nrm.y * hw * 0.16);
    ctx.lineTo(mh.x + axis.x * S * 0.02, mh.y + axis.y * S * 0.02);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  }

  // Spine: lumbar + thoracic from pelvis to shoulders, cervical up to the skull base.
  const back = lateral ? -1 : 0;
  const spineAt = (t: number): P => {
    // t: 0 at the sacrum, 1 at the shoulder line. Lateral view adds the thoracic/lumbar curves.
    const base = lerp(mh, ms, t);
    const curve = lateral ? S * (0.1 + 0.05 * Math.sin(Math.PI * (t * 1.6 - 0.3))) : 0;
    return { x: base.x + nrm.x * back * curve, y: base.y + nrm.y * back * curve };
  };
  const vertebra = (c: P, wv: number, hv: number, angle: number) => {
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.roundRect(-wv / 2, -hv / 2, wv, hv, hv * 0.3);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  };
  const nVert = 17;
  for (let i = 0; i < nVert; i++) {
    const t = 0.16 + (i / (nVert - 1)) * 0.86;
    const c = spineAt(t), c2 = spineAt(t + 0.02);
    vertebra(c, S * (0.085 - 0.03 * t), (S * 0.86) / nVert * 0.78, Math.atan2(c2.y - c.y, c2.x - c.x) + Math.PI / 2);
  }
  const neckBase = spineAt(1.02);
  const skullBase = { x: head.x + axis.x * S * 0.08 + nrm.x * back * S * 0.04, y: head.y + axis.y * S * 0.08 + nrm.y * back * S * 0.04 };
  for (let i = 0; i < 6; i++) {
    const c = lerp(neckBase, skullBase, (i + 0.5) / 6);
    vertebra(c, S * 0.05, Math.hypot(skullBase.x - neckBase.x, skullBase.y - neckBase.y) / 6 * 0.75, Math.atan2(skullBase.y - neckBase.y, skullBase.x - neckBase.x) + Math.PI / 2);
  }

  // Rib cage.
  const sw = Math.hypot(r.pt('l_shoulder').x - r.pt('r_shoulder').x, r.pt('l_shoulder').y - r.pt('r_shoulder').y);
  const chestW = lateral ? S * 0.24 : Math.max(sw * 0.4, S * 0.24);
  const chestC = { x: ms.x + axis.x * S * 0.3 + (lateral ? nrm.x * S * 0.02 : 0), y: ms.y + axis.y * S * 0.3 + (lateral ? nrm.y * S * 0.02 : 0) };
  ctx.save();
  ctx.fillStyle = 'rgba(243,234,210,0.18)';
  ellipse(ctx, chestC, chestW, S * 0.3, rot);
  ctx.restore();
  ctx.save();
  ctx.translate(chestC.x, chestC.y);
  ctx.rotate(rot);
  ctx.lineWidth = Math.max(1.5, S * 0.016);
  ctx.strokeStyle = BONE;
  for (let i = 0; i < 8; i++) {
    const y = -S * 0.24 + i * S * 0.062;
    const half = chestW * Math.sqrt(Math.max(0, 1 - (y / (S * 0.3)) ** 2));
    if (lateral) {
      // Ribs slope down toward the front.
      ctx.beginPath();
      ctx.moveTo(-half * info.facing, y - S * 0.03);
      ctx.quadraticCurveTo(0, y - S * 0.01, half * info.facing * 0.95, y + S * 0.05);
      ctx.stroke();
    } else {
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(sgn * chestW * 0.08, y - S * 0.015);
        ctx.quadraticCurveTo(sgn * half * 0.9, y - S * 0.04, sgn * half, y + S * 0.03);
        ctx.stroke();
      }
    }
  }
  if (info.view === 'anterior') {
    ctx.fillStyle = BONE;
    ctx.strokeStyle = BONE_EDGE;
    ctx.lineWidth = Math.max(1, S * 0.008);
    ctx.beginPath();
    ctx.roundRect(-chestW * 0.09, -S * 0.27, chestW * 0.18, S * 0.36, S * 0.03);
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();

  // Shoulder girdle.
  if (!lateral) {
    const sternum = { x: ms.x + axis.x * S * 0.04, y: ms.y + axis.y * S * 0.04 };
    for (const s of ['l', 'r'] as const) {
      const sh = r.pt(`${s}_shoulder`);
      if (info.view === 'posterior') {
        const g = r.seg('trunk', s);
        ctx.beginPath();
        ctx.moveTo(sh.x - g.n.x * S * 0.02, sh.y - g.n.y * S * 0.02);
        ctx.lineTo(sh.x - g.n.x * S * 0.26 + g.u.x * S * 0.03, sh.y - g.n.y * S * 0.26 + g.u.y * S * 0.03);
        ctx.lineTo(sh.x - g.n.x * S * 0.2 + g.u.x * S * 0.36, sh.y - g.n.y * S * 0.2 + g.u.y * S * 0.36);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
      longBone(ctx, sternum, sh, S * 0.03, S * 0.045);
    }
  }

  // Skull.
  const ear = Math.hypot(r.pt('l_ear').x - r.pt('r_ear').x, r.pt('l_ear').y - r.pt('r_ear').y);
  const hr = lateral ? S * 0.19 : Math.max(ear * 0.62, S * 0.14);
  const fwd = lateral ? nrm : { x: 0, y: 0 };
  const cranium = { x: head.x - axis.x * hr * 0.25 + fwd.x * hr * 0.1, y: head.y - axis.y * hr * 0.25 + fwd.y * hr * 0.1 };
  ellipse(ctx, cranium, lateral ? hr * 1.05 : hr * 0.92, hr * 1.1, rot);
  const jaw = { x: head.x + axis.x * hr * 0.75 + fwd.x * hr * 0.42, y: head.y + axis.y * hr * 0.75 + fwd.y * hr * 0.42 };
  ellipse(ctx, jaw, lateral ? hr * 0.5 : hr * 0.58, hr * 0.36, rot);
  if (info.view !== 'posterior') {
    ctx.save();
    ctx.fillStyle = BONE_EDGE;
    const eyes = lateral ? [fwd.x * hr * 0.62] : [-hr * 0.38, hr * 0.38];
    for (const e of eyes) {
      const c = lateral ? { x: head.x - axis.x * hr * 0.2 + fwd.x * hr * 0.62, y: head.y - axis.y * hr * 0.2 + fwd.y * hr * 0.62 } : { x: head.x - axis.x * hr * 0.2 + axis.y * e, y: head.y - axis.y * hr * 0.2 - axis.x * e };
      ellipse(ctx, c, hr * 0.2, hr * 0.17, rot);
    }
    ctx.restore();
  }

  // Limbs.
  for (const s of r.sides) {
    const th = r.seg('thigh', s), sk = r.seg('shank', s), ua = r.seg('upperarm', s), fa = r.seg('forearm', s);
    longBone(ctx, th.a, th.b, S * 0.055, S * 0.105);
    const off = (g: typeof sk, t: number, d: number): P => ({ x: g.a.x + g.u.x * g.len * t + g.n.x * d * S, y: g.a.y + g.u.y * g.len * t + g.n.y * d * S });
    // Fibula lies lateral (frontal views) / posterior (lateral view) to the tibia.
    const fibSign = lateral ? -1 : 1;
    longBone(ctx, off(sk, 0.06, 0.055 * fibSign), off(sk, 1.0, 0.045 * fibSign), S * 0.018, S * 0.035);
    longBone(ctx, sk.a, sk.b, S * 0.045, S * 0.095);
    if (info.view !== 'posterior') ellipse(ctx, off(th, 1.0, lateral ? 0.06 : 0), S * 0.04, S * 0.045, 0);
    // Foot: calcaneus, tarsals and a metatarsal ray.
    const heel = r.pt(`${s}_heel`), toe = r.pt(`${s}_toe`), ankle = r.pt(`${s}_ankle`);
    ctx.beginPath();
    ctx.moveTo(heel.x, heel.y);
    ctx.quadraticCurveTo(ankle.x - (toe.x - heel.x) * 0.15, ankle.y, ankle.x, ankle.y);
    ctx.quadraticCurveTo(lerp(ankle, toe, 0.5).x, lerp(ankle, toe, 0.5).y - S * 0.02, toe.x, toe.y);
    ctx.quadraticCurveTo(lerp(heel, toe, 0.5).x, lerp(heel, toe, 0.5).y - S * 0.03, heel.x, heel.y);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    longBone(ctx, ua.a, ua.b, S * 0.042, S * 0.085);
    // Radius and ulna drawn side by side (their crossing in pronation cannot be inferred from keypoints).
    longBone(ctx, off(fa, 0, 0.02), off(fa, 1, 0.022), S * 0.02, S * 0.04);
    longBone(ctx, off(fa, 0, -0.02), off(fa, 1, -0.018), S * 0.02, S * 0.036);
    const wrist = r.pt(`${s}_wrist`);
    ctx.save();
    ctx.lineWidth = Math.max(1.5, S * 0.018);
    ctx.strokeStyle = BONE;
    ctx.lineCap = 'round';
    for (const f of ['index', 'pinky', 'thumb'] as const) {
      const tip = r.pt(`${s}_${f}`);
      ctx.beginPath(); ctx.moveTo(wrist.x, wrist.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

function spindle(ctx: CanvasRenderingContext2D, a: P, b: P, width: number, belly: number): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 2) return;
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
  const bx = len * belly, h = width / 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(bx * 0.4, -h * 1.25, bx * 1.3, -h * 1.25, Math.min(len * 0.82, bx * 2.2), -h * 0.45);
  ctx.quadraticCurveTo(len * 0.92, -h * 0.12, len, 0);
  ctx.quadraticCurveTo(len * 0.92, h * 0.12, Math.min(len * 0.82, bx * 2.2), h * 0.45);
  ctx.bezierCurveTo(bx * 1.3, h * 1.25, bx * 0.4, h * 1.25, 0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Fibre lines.
  ctx.globalAlpha *= 0.45;
  ctx.beginPath();
  for (const k of [-0.45, 0, 0.45]) {
    ctx.moveTo(len * 0.06, k * h * 0.5);
    ctx.quadraticCurveTo(bx, k * h * 1.5, len * 0.9, k * h * 0.2);
  }
  ctx.stroke();
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
    ctx.fillStyle = highlight && on ? '#ff4d4d' : '#c0392b';
    ctx.strokeStyle = highlight && on ? '#fff3c4' : '#6e1f17';
    let any = false;
    for (const side of r.sides) {
      for (const sh of shapes) {
        if (!visible(sh.from[0], side) || !visible(sh.to[0], side)) continue;
        spindle(ctx, r.at(sh.from, side), r.at(sh.to, side), sh.width * r.S, sh.belly ?? 0.42);
        any = true;
      }
    }
    if (any) drawn.push(m.id);
  }
  ctx.restore();
  return drawn;
}
