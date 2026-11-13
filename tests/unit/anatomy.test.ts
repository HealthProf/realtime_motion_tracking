import { describe, expect, it } from 'vitest';
import { buildRig, detectView } from '../../src/anatomy/anatomy';
import { CATALOG, CATALOG_BY_ID } from '../../src/anatomy/catalog';
import { locate, searchCatalog } from '../../src/anatomy/search';
import { STRUCTURES, SYSTEMS } from '../../src/anatomy/systems';
import { L } from '../../src/pose/landmarks';
import { SYNTH, syntheticFrame } from '../../src/pose/synthetic';
import type { Lm } from '../../src/types';

const front = () => syntheticFrame(0, 'raise');
const side = () => syntheticFrame(0, 'squat');
/** Back view: swap left and right keypoints of the front view. */
const back = () => {
  const f = front();
  const lm = f.lm!.map((p) => ({ ...p }));
  for (const [name, i] of Object.entries(L)) if (name.startsWith('l_')) { const j = L[`r_${name.slice(2)}` as keyof typeof L]; [lm[i], lm[j]] = [lm[j], lm[i]]; }
  return { ...f, lm };
};
const E = (id: string) => CATALOG_BY_ID.get(id)!;
const W = SYNTH.width, Hh = SYNTH.height;
const shift = (lm: Lm[], dx: number, dy: number) => lm.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));

describe('anatomy catalog', () => {
  it('has unique ids, names, and covers every system', () => {
    expect(new Set(CATALOG.map((e) => e.id)).size).toBe(CATALOG.length);
    for (const e of CATALOG) { expect(e.name.length).toBeGreaterThan(2); expect(e.regions.length).toBeGreaterThan(0); }
    for (const s of SYSTEMS) expect(STRUCTURES.some((st) => st.system === s.id)).toBe(true);
    expect(CATALOG.length).toBeGreaterThan(100);
  });

  it('places every structure inside the body region in each view it is drawn in', () => {
    const cases = [['anterior', front()], ['posterior', back()], ['lateral', side()]] as const;
    for (const [view, f] of cases) {
      const info = detectView(f.lm!, f.world, false);
      expect(info.view).toBe(view);
      const rig = buildRig(f.lm!, info);
      const xs = f.lm!.map((p) => p.x), ys = f.lm!.map((p) => p.y), pad = 0.35 * rig.S;
      for (const e of CATALOG) {
        if (e.views && !e.views.includes(view)) continue;
        for (const sd of rig.sides) {
          const a = e.anchor(rig, sd);
          expect(Number.isFinite(a.x) && Number.isFinite(a.y), `${e.id} ${view}`).toBe(true);
          expect(a.x, `${e.id} ${view} x`).toBeGreaterThan(Math.min(...xs) - pad);
          expect(a.x, `${e.id} ${view} x`).toBeLessThan(Math.max(...xs) + pad);
          expect(a.y, `${e.id} ${view} y`).toBeGreaterThan(Math.min(...ys) - pad);
          expect(a.y, `${e.id} ${view} y`).toBeLessThan(Math.max(...ys) + pad);
        }
      }
    }
  });

  it('respects left and right: liver on the subject\'s right, heart and spleen on the left', () => {
    for (const f of [front(), back()]) {
      const rig = buildRig(f.lm!, detectView(f.lm!, f.world, false));
      const leftward = Math.sign(f.lm![L.l_shoulder].x - f.lm![L.r_shoulder].x);
      const mid = (f.lm![L.l_shoulder].x + f.lm![L.r_shoulder].x) / 2;
      expect(Math.sign(E('liver').anchor(rig, 'l').x - mid)).toBe(-leftward);
      expect(Math.sign(E('spleen').anchor(rig, 'l').x - mid)).toBe(leftward);
      expect(Math.sign(E('heart').anchor(rig, 'l').x - mid)).toBe(leftward);
    }
    // Side view: the heart is in front of the spine, the kidneys behind the stomach.
    const f = side(), rig = buildRig(f.lm!, detectView(f.lm!, f.world, false));
    expect(rig.info.facing).toBe(1);
    expect(E('heart').anchor(rig, 'l').x).toBeGreaterThan(E('thoracic_spine').anchor(rig, 'l').x);
    expect(E('kidneys').anchor(rig, 'l').x).toBeLessThan(E('stomach').anchor(rig, 'l').x);
    expect(E('patella').anchor(rig, 'l').x).toBeGreaterThan(f.lm![L.l_knee].x);
  });
});

describe('anatomy search', () => {
  it('matches names, common names and partial words', () => {
    expect(searchCatalog('femur')[0].id).toBe('femur');
    expect(searchCatalog('thigh bone')[0].id).toBe('femur');
    expect(searchCatalog('kneecap')[0].id).toBe('patella');
    expect(searchCatalog('ACL')[0].id).toBe('acl');
    expect(searchCatalog('quads')[0].id).toBe('quadriceps');
    expect(searchCatalog('calf').map((e) => e.id)).toContain('triceps_surae');
    expect(searchCatalog('aort')[0].id).toBe('aorta');
    expect(searchCatalog('fem').map((e) => e.id)).toEqual(expect.arrayContaining(['femur', 'femoral_artery', 'femoral_nerve']));
    expect(searchCatalog('zzz')).toEqual([]);
    expect(searchCatalog('  ')).toEqual([]);
  });

  it('reports on-screen structures', () => {
    const f = front();
    const r = locate(E('liver'), f.lm, f.world, false, W, Hh, 0.5);
    expect(r.status).toBe('onscreen');
    expect(r.marks.length).toBe(1);
    expect(locate(E('femur'), f.lm, f.world, false, W, Hh, 0.5).marks.length).toBe(2);
  });

  it('points an arrow toward structures beyond each edge of the frame', () => {
    const f = front();
    const cases: [number, number, RegExp, (a: number) => boolean][] = [
      [0, 500, /below the picture/, (a) => Math.sin(a) > 0.9],
      [0, -700, /above the picture/, (a) => Math.sin(a) < -0.9],
      [-900, 0, /left edge/, (a) => Math.cos(a) < -0.9],
      [900, 0, /right edge/, (a) => Math.cos(a) > 0.9],
    ];
    for (const [dx, dy, text, check] of cases) {
      const r = locate(E('tibia'), shift(f.lm!, dx, dy), f.world, false, W, Hh, 0.5);
      expect(r.status).toBe('offscreen');
      expect(r.message).toMatch(text);
      for (const m of r.marks) {
        expect(check(m.angle!)).toBe(true);
        expect(m.arrowAt!.x).toBeGreaterThan(0); expect(m.arrowAt!.x).toBeLessThan(W);
        expect(m.arrowAt!.y).toBeGreaterThan(0); expect(m.arrowAt!.y).toBeLessThan(Hh);
      }
    }
    // Legs out of frame, trunk still visible: the heart is on screen while the tibia is not.
    const lm = shift(f.lm!, 0, 300);
    expect(locate(E('heart'), lm, f.world, false, W, Hh, 0.5).status).toBe('onscreen');
    expect(locate(E('tibia'), lm, f.world, false, W, Hh, 0.5).status).toBe('offscreen');
  });

  it('explains wrong views, hidden parts and missing people', () => {
    const f = front();
    const wrong = locate(E('scapula'), f.lm, f.world, false, W, Hh, 0.5);
    expect(wrong.status).toBe('wrong-view');
    expect(wrong.message).toMatch(/back view/);
    expect(locate(E('scapula'), back().lm, back().world, false, W, Hh, 0.5).status).toBe('onscreen');
    const hidden = f.lm!.map((p) => ({ ...p }));
    hidden[L.l_knee].v = 0.1; hidden[L.r_knee].v = 0.1;
    expect(locate(E('femur'), hidden, f.world, false, W, Hh, 0.5).status).toBe('uncertain');
    expect(locate(E('femur'), null, null, false, W, Hh, 0.5).status).toBe('not-tracked');
    const noTrunk = f.lm!.map((p) => ({ ...p, v: 0.1 }));
    expect(locate(E('femur'), noTrunk, f.world, false, W, Hh, 0.5).status).toBe('not-tracked');
  });
});
