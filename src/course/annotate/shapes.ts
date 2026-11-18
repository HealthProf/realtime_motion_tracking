// Drawing shapes for snapshots and the comparison. Pure data and geometry, no DOM.
// Every shape is a list of control points in surface pixels (the pixels of the captured frame, or of
// the comparison picture), so drawings keep their place at any screen size and in exports.

export type Pt = { x: number; y: number };

export type ShapeType = 'line' | 'arrow' | 'force' | 'freehand' | 'ellipse' | 'text' | 'angle' | 'plane' | 'axis';
export type PlaneKind = 'sagittal' | 'frontal' | 'transverse';
export type AxisKind = 'mediolateral' | 'anteroposterior' | 'longitudinal';

export interface Shape {
  id: string;
  type: ShapeType;
  /**
   * line, arrow, force, axis: [start, end]. ellipse: two opposite corners of its box.
   * angle: [end 1, vertex, end 2]. text: [top-left]. plane: four corners in order. freehand: the stroke.
   */
  pts: Pt[];
  color: string;
  /** Line width in surface pixels. */
  width: number;
  dashed?: boolean;
  /** text: the words. force, plane, axis: the label the student chose or typed. */
  text?: string;
  /** Font size in surface pixels (text, and labels of other shapes). */
  size?: number;
  plane?: PlaneKind;
  axis?: AxisKind;
}

export const COLORS = ['#facc15', '#f87171', '#60a5fa', '#4ade80', '#ffffff', '#f472b6', '#22d3ee', '#111827'];
export const PLANE_COLORS: Record<PlaneKind, string> = { sagittal: '#f87171', frontal: '#60a5fa', transverse: '#4ade80' };
export const PLANE_LABELS: Record<PlaneKind, string> = { sagittal: 'Sagittal plane', frontal: 'Frontal plane', transverse: 'Transverse plane' };
export const AXIS_LABELS: Record<AxisKind, string> = { mediolateral: 'Mediolateral axis', anteroposterior: 'Anteroposterior axis', longitudinal: 'Longitudinal axis' };
/** Starting labels offered for force arrows. The student chooses which one, if any, applies. */
export const FORCE_LABELS = ['Friction', 'Weight (gravity)', 'Normal force', 'Drag', 'Buoyancy', 'Applied force', 'Ground reaction force'];

let counter = 0;
export const newId = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Distance from p to the segment ab. */
export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Angle at the vertex b between rays b->a and b->c, in degrees, 0 to 180. */
export function angleAt(a: Pt, b: Pt, c: Pt): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
  const n = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (n === 0) return NaN;
  const cos = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / n));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** True if p is inside the polygon (even-odd rule). */
export function inPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export const textSize = (s: Shape, surfaceH: number) => s.size ?? Math.round(surfaceH * 0.035);

/** Lines of a text shape (an empty text still has one line). */
export const textLines = (s: Shape) => (s.text ?? '').split('\n');

/** Box of a text shape, with an estimated width when no measuring function is given. */
export function textBox(s: Shape, surfaceH: number, measure?: (line: string, size: number) => number): { x: number; y: number; w: number; h: number } {
  const size = textSize(s, surfaceH), pad = size * 0.3, lines = textLines(s);
  const w = Math.max(size * 2, ...lines.map((l) => (measure ? measure(l, size) : l.length * size * 0.55)));
  return { x: s.pts[0].x, y: s.pts[0].y, w: w + 2 * pad, h: lines.length * size * 1.25 + 2 * pad };
}

/** Whether p touches the shape, within tol surface pixels. */
export function hitTest(s: Shape, p: Pt, tol: number, surfaceH: number, measure?: (line: string, size: number) => number): boolean {
  const near = (a: Pt, b: Pt) => distToSegment(p, a, b) <= tol + s.width / 2;
  const P = s.pts;
  switch (s.type) {
    case 'line': case 'arrow': case 'force': case 'axis':
      return near(P[0], P[1]);
    case 'angle':
      return near(P[0], P[1]) || near(P[1], P[2]);
    case 'freehand':
      return P.length === 1 ? dist(p, P[0]) <= tol + s.width : P.some((q, i) => i > 0 && near(P[i - 1], q));
    case 'ellipse': {
      const cx = (P[0].x + P[1].x) / 2, cy = (P[0].y + P[1].y) / 2;
      const rx = Math.abs(P[1].x - P[0].x) / 2, ry = Math.abs(P[1].y - P[0].y) / 2;
      if (rx < 1 || ry < 1) return dist(p, { x: cx, y: cy }) <= tol + Math.max(rx, ry);
      // Distance to the outline, approximated by the radial distance scaled to the ellipse.
      const k = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
      return Math.abs(k - 1) * Math.min(rx, ry) <= tol + s.width / 2;
    }
    case 'text': {
      const b = textBox(s, surfaceH, measure);
      return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
    }
    case 'plane':
      return inPolygon(p, P) || P.some((q, i) => near(P[(i + P.length - 1) % P.length], q));
  }
}

/** Control points the student can drag. Freehand strokes are only moved as a whole. */
export const handles = (s: Shape): Pt[] => (s.type === 'freehand' ? [] : s.pts);

export function translate(s: Shape, dx: number, dy: number): Shape {
  return { ...s, pts: s.pts.map((q) => ({ x: q.x + dx, y: q.y + dy })) };
}

export function moveHandle(s: Shape, i: number, p: Pt): Shape {
  const pts = s.pts.slice();
  pts[i] = { x: p.x, y: p.y };
  return { ...s, pts };
}

/** Bounding box of all control points. */
export function bounds(s: Shape): { x0: number; y0: number; x1: number; y1: number } {
  const xs = s.pts.map((q) => q.x), ys = s.pts.map((q) => q.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * Corners of a new plane panel centred on c. Each kind starts with a different perspective so it reads
 * as that plane seen from the front; the student drags the corners to fit the picture.
 */
export function planeCorners(kind: PlaneKind, c: Pt, size: number): Pt[] {
  const w = size, h = size;
  const quad = (pts: [number, number][]) => pts.map(([x, y]) => ({ x: c.x + x, y: c.y + y }));
  if (kind === 'frontal') return quad([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]);
  if (kind === 'sagittal') return quad([[-w * 0.18, -h / 2], [w * 0.18, -h * 0.38], [w * 0.18, h * 0.62], [-w * 0.18, h / 2]]);
  return quad([[-w / 2, -h * 0.12], [w * 0.3, -h * 0.12], [w / 2, h * 0.12], [-w * 0.3, h * 0.12]]);
}

/** Drops shapes too small to be intentional (a click with a drawing tool). */
export function isDegenerate(s: Shape, minLen: number): boolean {
  switch (s.type) {
    case 'text': return !(s.text ?? '').trim();
    case 'freehand': return s.pts.length < 2;
    case 'angle': return dist(s.pts[0], s.pts[1]) < minLen || dist(s.pts[1], s.pts[2]) < minLen;
    case 'plane': return false;
    default: return dist(s.pts[0], s.pts[1]) < minLen;
  }
}

/** Undo and redo over whole-list states. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(private limit = 100) {}
  /** Records the state before a change. */
  push(state: T): void {
    this.past.push(state);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(current);
    return prev;
  }
  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    return next;
  }
  /** Forgets the last recorded state (a change that was abandoned before it was finished). */
  discardLast(): void { this.past.pop(); }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  clear(): void { this.past = []; this.future = []; }
}
