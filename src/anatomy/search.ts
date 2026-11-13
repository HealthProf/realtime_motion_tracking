// Find a structure by name and work out whether it is on screen, hidden, or outside the picture.
import { L } from '../pose/landmarks';
import type { Lm } from '../types';
import { buildRig, detectView, type AnatomyView, type P } from './anatomy';
import { CATALOG, LAYER_LABELS, type CatalogEntry } from './catalog';
import { REGION_KEYPOINTS } from './systems';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Ranked matches: name prefix, then word prefix, then alias, then substring. Results come only from the catalog. */
export function searchCatalog(query: string, limit = 8): CatalogEntry[] {
  const q = norm(query);
  if (!q) return [];
  const scored: { e: CatalogEntry; score: number }[] = [];
  for (const e of CATALOG) {
    const name = norm(e.name), aliases = e.aliases.map(norm);
    let score = 0;
    if (name === q || aliases.includes(q)) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.split(' ').some((w) => w.startsWith(q))) score = 60;
    else if (aliases.some((a) => a.startsWith(q))) score = 55;
    else if (aliases.some((a) => a.split(' ').some((w) => w.startsWith(q)))) score = 45;
    else if (name.includes(q) || aliases.some((a) => a.includes(q))) score = 30;
    if (score) scored.push({ e, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.e.name.length - b.e.name.length).slice(0, limit).map((s) => s.e);
}

export type LocateStatus = 'onscreen' | 'uncertain' | 'offscreen' | 'wrong-view' | 'not-tracked';

export interface Mark {
  side: 'l' | 'r' | 'c';
  /** Estimated position (may be outside the frame). */
  p: P;
  status: 'onscreen' | 'uncertain' | 'offscreen';
  /** For off-screen marks: where to draw the arrow (inside the frame) and its direction (radians). */
  arrowAt?: P;
  angle?: number;
}

export interface LocateResult {
  status: LocateStatus;
  message: string;
  marks: Mark[];
}

export const VIEW_NAMES: Record<AnatomyView, string> = { anterior: 'front view', posterior: 'back view', lateral: 'side view' };

function directions(p: P, w: number, h: number): string {
  const parts: string[] = [];
  if (p.y > h) parts.push('below the picture: tilt the camera down');
  if (p.y < 0) parts.push('above the picture: tilt the camera up');
  if (p.x < 0) parts.push('past the left edge: turn the camera toward the left edge of the picture');
  if (p.x > w) parts.push('past the right edge: turn the camera toward the right edge of the picture');
  return `${parts.join(' and ')}, or move the camera back`;
}

/**
 * Locates a structure for the current pose. The body's position outside the frame is extrapolated by
 * the pose model with low confidence, so off-screen results give a reliable direction but not distance.
 */
export function locate(entry: CatalogEntry, lm: Lm[] | null, world: Lm[] | null, mirrored: boolean, w: number, h: number, minVis: number): LocateResult {
  const layer = LAYER_LABELS[entry.layer];
  if (!lm) return { status: 'not-tracked', message: `${entry.name}: no person is being tracked.`, marks: [] };
  const trunkSeen = [L.l_shoulder, L.r_shoulder, L.l_hip, L.r_hip].filter((i) => lm[i].v >= minVis).length;
  if (trunkSeen < 2) return { status: 'not-tracked', message: `${entry.name}: the shoulders and hips are not being tracked, so it cannot be located. Bring the trunk into view.`, marks: [] };
  const info = detectView(lm, world, mirrored);
  if (entry.views && !entry.views.includes(info.view)) {
    return { status: 'wrong-view', message: `${entry.name} is drawn in the ${entry.views.map((v) => VIEW_NAMES[v]).join(' and ')}, not in this ${VIEW_NAMES[info.view]}.`, marks: [] };
  }
  const rig = buildRig(lm, info);
  const sides: ('l' | 'r')[] = !entry.bilateral ? [info.nearSide] : info.view === 'lateral' ? [info.nearSide] : ['l', 'r'];
  const marks: Mark[] = sides.map((side) => {
    const p = entry.anchor(rig, side);
    const inside = p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h;
    if (!inside) {
      const m = 0.07 * Math.min(w, h);
      const arrowAt = { x: Math.min(w - m, Math.max(m, p.x)), y: Math.min(h - m, Math.max(m, p.y)) };
      return { side: entry.bilateral ? side : 'c', p, status: 'offscreen' as const, arrowAt, angle: Math.atan2(p.y - arrowAt.y, p.x - arrowAt.x) };
    }
    const vis = Math.min(...entry.regions.flatMap((r) => REGION_KEYPOINTS[r](side)).map((n) => lm[L[n]].v));
    return { side: entry.bilateral ? side : 'c', p, status: vis >= minVis ? ('onscreen' as const) : ('uncertain' as const) };
  });
  const sideWord = (m: Mark) => (m.side === 'c' ? '' : m.side === 'l' ? 'Left ' : 'Right ');
  const on = marks.filter((m) => m.status === 'onscreen'), off = marks.filter((m) => m.status === 'offscreen'), unc = marks.filter((m) => m.status === 'uncertain');
  const parts: string[] = [];
  if (on.length) parts.push(`${entry.name} is highlighted${on.length < marks.length ? ` (${on.map((m) => sideWord(m).trim().toLowerCase()).join(', ')} side)` : ''} in the ${layer} layer.`);
  for (const m of unc) parts.push(`${sideWord(m)}${entry.name.toLowerCase()} should be in the picture but that part of the body is hidden or tracked with low confidence, so the position shown is a guess.`);
  for (const m of off) parts.push(`${sideWord(m)}${m.side === 'c' ? entry.name : entry.name.toLowerCase()} is ${directions(m.p, w, h)}.`);
  return { status: on.length ? 'onscreen' : unc.length ? 'uncertain' : 'offscreen', message: parts.join(' '), marks };
}
