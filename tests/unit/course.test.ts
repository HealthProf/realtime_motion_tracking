import { describe, expect, it } from 'vitest';
import { angleAt, dist, distToSegment, hitTest, History, isDegenerate, moveHandle, planeCorners, translate, type Shape } from '../../src/course/annotate/shapes';
import { normaliseCode, openFile, openPack, sealFile, sealPack, WrongCodeError, type PackEnvelope } from '../../src/course/crypto';
import { exportBase, slug } from '../../src/course/export';
import { analysisWork, emptyWork, fromBackup, loadWork, MemoryKV, toBackup } from '../../src/course/store';
import { activeAt, drifted, offsetOf, partnerTime, syncRange } from '../../src/course/sync';
import type { ProjectDef } from '../../src/course/types';

const FAST = 1000; // PBKDF2 iterations for tests only; the real default is 600 000.

describe('course pack encryption', () => {
  it('opens with the right code and rejects a wrong one', async () => {
    const env = await sealPack({ hello: 'world', n: 3 }, 'Purple Tiger Canoe', FAST);
    expect(env.kdf.iterations).toBe(FAST);
    expect(JSON.stringify(env)).not.toContain('world');
    await expect(openPack(env, 'purple tiger canoe')).resolves.toEqual({ hello: 'world', n: 3 });
    await expect(openPack(env, '  PURPLE   tiger canoe ')).resolves.toEqual({ hello: 'world', n: 3 });
    await expect(openPack(env, 'purple tiger kayak')).rejects.toBeInstanceOf(WrongCodeError);
  });

  it('rejects a tampered pack', async () => {
    const env = await sealPack({ a: 1 }, 'a long enough code', FAST);
    const bytes = Uint8Array.from(atob(env.data), (c) => c.charCodeAt(0));
    bytes[0] ^= 1;
    const bad: PackEnvelope = { ...env, data: btoa(String.fromCharCode(...bytes)) };
    await expect(openPack(bad, 'a long enough code')).rejects.toBeInstanceOf(WrongCodeError);
  });

  it('salts every pack differently', async () => {
    const a = await sealPack({ a: 1 }, 'same code here', FAST), b = await sealPack({ a: 1 }, 'same code here', FAST);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.data).not.toBe(b.data);
  });

  it('round-trips a file under its own key', async () => {
    const data = new Uint8Array(100_000).map((_, i) => (i * 31) % 251);
    const sealed = await sealFile(data);
    expect(sealed.data.length).toBe(data.length + 16); // AES-GCM tag
    expect(new Uint8Array(await openFile(sealed.data, sealed.key, sealed.iv))).toEqual(data);
  });

  it('normalises codes for forgiving typing', () => {
    expect(normaliseCode('  Blue\tSky   Ten ')).toBe('blue sky ten');
  });

});

const shape = (type: Shape['type'], pts: { x: number; y: number }[], extra: Partial<Shape> = {}): Shape => ({ id: 'x', type, pts, color: '#fff', width: 4, ...extra });

describe('drawing geometry', () => {
  it('measures angles at the vertex', () => {
    expect(angleAt({ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(90, 9);
    expect(angleAt({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 7, y: 0 })).toBeCloseTo(180, 9);
    expect(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(45, 9);
    expect(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: Math.cos(2), y: -Math.sin(2) })).toBeCloseTo((2 * 180) / Math.PI, 9);
    expect(angleAt({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNaN();
  });

  it('measures distance to a segment', () => {
    expect(distToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });

  it('hit-tests each kind of shape', () => {
    const line = shape('line', [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(hitTest(line, { x: 50, y: 4 }, 3, 720)).toBe(true);
    expect(hitTest(line, { x: 50, y: 9 }, 3, 720)).toBe(false);
    const ring = shape('ellipse', [{ x: 0, y: 0 }, { x: 200, y: 100 }]);
    expect(hitTest(ring, { x: 200, y: 50 }, 3, 720)).toBe(true);
    expect(hitTest(ring, { x: 100, y: 50 }, 3, 720)).toBe(false);
    const text = shape('text', [{ x: 10, y: 10 }], { text: 'Hello', size: 20 });
    expect(hitTest(text, { x: 20, y: 20 }, 0, 720)).toBe(true);
    expect(hitTest(text, { x: 500, y: 20 }, 0, 720)).toBe(false);
    const plane = shape('plane', planeCorners('frontal', { x: 100, y: 100 }, 100));
    expect(hitTest(plane, { x: 100, y: 100 }, 0, 720)).toBe(true);
    expect(hitTest(plane, { x: 300, y: 100 }, 0, 720)).toBe(false);
    const ang = shape('angle', [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }]);
    expect(hitTest(ang, { x: 75, y: 25 }, 2, 720)).toBe(true);
  });

  it('moves shapes and handles without changing the original', () => {
    const s = shape('arrow', [{ x: 0, y: 0 }, { x: 10, y: 10 }]);
    const t = translate(s, 5, -2);
    expect(t.pts).toEqual([{ x: 5, y: -2 }, { x: 15, y: 8 }]);
    expect(s.pts[0]).toEqual({ x: 0, y: 0 });
    expect(moveHandle(s, 1, { x: 20, y: 0 }).pts[1]).toEqual({ x: 20, y: 0 });
  });

  it('drops accidental clicks with a drawing tool', () => {
    expect(isDegenerate(shape('line', [{ x: 0, y: 0 }, { x: 2, y: 0 }]), 6)).toBe(true);
    expect(isDegenerate(shape('line', [{ x: 0, y: 0 }, { x: 20, y: 0 }]), 6)).toBe(false);
    expect(isDegenerate(shape('text', [{ x: 0, y: 0 }], { text: '  ' }), 6)).toBe(true);
    expect(isDegenerate(shape('angle', [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 21, y: 0 }]), 6)).toBe(true);
  });

  it('places plane panels centred on the click', () => {
    for (const kind of ['sagittal', 'frontal', 'transverse'] as const) {
      const c = planeCorners(kind, { x: 50, y: 60 }, 100);
      expect(c).toHaveLength(4);
      const cx = c.reduce((s, p) => s + p.x, 0) / 4, cy = c.reduce((s, p) => s + p.y, 0) / 4;
      expect(dist({ x: cx, y: cy }, { x: 50, y: 60 })).toBeLessThan(15);
    }
  });

  it('undoes and redoes whole states', () => {
    const h = new History<number[]>();
    let cur = [1];
    h.push(cur); cur = [1, 2];
    h.push(cur); cur = [1, 2, 3];
    cur = h.undo(cur)!; expect(cur).toEqual([1, 2]);
    cur = h.undo(cur)!; expect(cur).toEqual([1]);
    expect(h.undo(cur)).toBeNull();
    cur = h.redo(cur)!; expect(cur).toEqual([1, 2]);
    h.push(cur); cur = [9];
    expect(h.canRedo).toBe(false);
    h.push(cur);
    h.discardLast();
    expect(h.undo(cur)).toEqual([1, 2]);
  });
});

describe('synced comparison', () => {
  const s = { a: 2.0, b: 3.5 };
  it('maps clip 1 time to clip 2 time', () => {
    expect(offsetOf(s)).toBeCloseTo(1.5, 12);
    expect(partnerTime(s, 4)).toBeCloseTo(5.5, 12);
  });
  it('limits the shared timeline to where both clips have pictures', () => {
    expect(syncRange(s, 10, 8)).toEqual({ start: 0, end: 6.5 });
    expect(syncRange({ a: 3, b: 1 }, 10, 20)).toEqual({ start: 2, end: 10 });
    const r = syncRange({ a: 0, b: 0 }, 5, 5);
    expect(r).toEqual({ start: 0, end: 5 });
    expect(syncRange({ a: 0, b: 30 }, 5, 10).end).toBe(0); // no overlap: an empty range, not a negative one
  });
  it('detects drift beyond one frame', () => {
    expect(drifted(s, 4, 5.5 + 0.02, 30)).toBe(false);
    expect(drifted(s, 4, 5.5 + 0.05, 30)).toBe(true);
  });
  it('finds overlays on screen at a time', () => {
    const item = (id: string, start: number, end: number) => ({ shape: { ...shape('text', [{ x: 0, y: 0 }]), id }, start, end });
    const items = [item('a', 0, 2), item('b', 1.5, 4), item('c', 5, 6)];
    expect(activeAt(items, 1.7).map((i) => i.shape.id)).toEqual(['a', 'b']);
    expect(activeAt(items, 4).map((i) => i.shape.id)).toEqual(['b']);
    expect(activeAt(items, 4.5)).toEqual([]);
  });
});

describe('saving work', () => {
  it('starts empty and keeps work per course', async () => {
    const kv = new MemoryKV();
    const w = await loadWork(kv, 'c1');
    expect(w).toEqual(emptyWork());
    analysisWork(w, 'p1', 'a1').snapshots.push({ id: 's1', name: 'A1 Snapshot 1', promptId: null, videoId: 'v', time: 1, image: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }), width: 10, height: 10, shapes: [] });
    await kv.set('work:c1', w);
    expect((await loadWork(kv, 'c1')).projects.p1.analyses.a1.snapshots).toHaveLength(1);
    expect(await loadWork(kv, 'c2')).toEqual(emptyWork());
  });

  it('round-trips a backup with pictures and drawings', async () => {
    const w = emptyWork();
    w.student = 'Sam Rivera';
    const line = shape('line', [{ x: 1, y: 2 }, { x: 3, y: 4 }]);
    analysisWork(w, 'p1', 'a1').snapshots.push({ id: 's1', name: 'A1 Snapshot 1', promptId: 'friction', videoId: 'v', time: 1.25, image: new Blob([new Uint8Array([9, 8, 7, 6])], { type: 'image/jpeg' }), width: 640, height: 360, shapes: [line] });
    analysisWork(w, 'p1', 'a3').compare = { sync: { a: 1, b: 2 }, posA: 0, posB: 0, items: [{ shape: line, start: 1, end: 3 }] };
    const json = JSON.parse(JSON.stringify(await toBackup(w, 'c1')));
    const back = fromBackup(json, 'c1');
    const snap = back.projects.p1.analyses.a1.snapshots[0];
    expect(snap.shapes).toEqual([line]);
    expect(snap.image.type).toBe('image/jpeg');
    expect(new Uint8Array(await snap.image.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7, 6]));
    expect(back.projects.p1.analyses.a3.compare).toEqual(w.projects.p1.analyses.a3.compare);
    expect(back.student).toBe('Sam Rivera');
    expect(() => fromBackup(json, 'other')).toThrow(/different course/);
  });
});

describe('export names', () => {
  const p: ProjectDef = { id: 'p1', short: 'P1', title: 'Project 1', analyses: [] };
  it('uses the family name, project and analysis', () => {
    expect(exportBase('Sam Rivera', p, 0)).toBe('Rivera-P1-A1');
    expect(exportBase('  José   Núñez ', p, 2)).toBe('Nunez-P1-A3');
    expect(exportBase('', p, 1)).toBe('student-P1-A2');
    expect(slug('a/b\\c: d')).toBe('a-b-c-d');
  });
});
