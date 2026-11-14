import { describe, expect, it } from 'vitest';
import { findCircle, PlateTracker, type Grab, type Gray } from '../../src/lift/circle';
import { analyseLift, G, liftSeries } from '../../src/lift/metrics';
import { SYNTH, syntheticBar } from '../../src/pose/synthetic';

/** Anti-aliased synthetic scene: a plate (rim, inner ring, hub) on a textured background. */
function scene(w: number, h: number, plates: { x: number; y: number; r: number; level?: number }[], noise = 6): (x: number, y: number) => number {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5);
  const tex = Float32Array.from({ length: w * h }, () => noise * rnd());
  return (x, y) => {
    const xi = Math.min(w - 1, Math.max(0, Math.round(x))), yi = Math.min(h - 1, Math.max(0, Math.round(y)));
    let v = 70 + 20 * Math.sin(x / 37) + tex[yi * w + xi];
    for (const p of plates) {
      const d = Math.hypot(x - p.x, y - p.y);
      const disc = (rad: number) => Math.min(1, Math.max(0, rad - d + 0.5));
      const a = disc(p.r);
      v = v * (1 - a) + (p.level ?? 200) * a;
      v = v * (1 - disc(p.r * 0.6)) + 120 * disc(p.r * 0.6);
      v = v * (1 - disc(p.r * 0.15)) + 30 * disc(p.r * 0.15);
    }
    return v;
  };
}
const grabber = (img: (x: number, y: number) => number, W: number, H: number): Grab => (x0, y0, x1, y1, step) => {
  const ox = Math.max(0, Math.floor(x0)), oy = Math.max(0, Math.floor(y0));
  const w = Math.floor((Math.min(W, x1) - ox) / step), h = Math.floor((Math.min(H, y1) - oy) / step);
  if (w < 8 || h < 8) return null;
  const data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = img(ox + i * step, oy + j * step);
  return { w, h, data, ox, oy, step } as Gray;
};

describe('plate detection', () => {
  it('finds the outer rim of a plate to sub-pixel accuracy', () => {
    const img = scene(400, 300, [{ x: 203.4, y: 141.7, r: 61.3 }]);
    const hit = findCircle(grabber(img, 400, 300)(0, 0, 400, 300, 1)!, 20, 90, { preferOuter: true })!;
    expect(hit).not.toBeNull();
    expect(hit.x).toBeCloseTo(203.4, 0);
    expect(hit.y).toBeCloseTo(141.7, 0);
    expect(Math.abs(hit.r - 61.3)).toBeLessThan(1);
    expect(hit.score).toBeGreaterThan(0.8);
  });
  it('still finds a plate that is one third hidden, and reports nothing where there is no circle', () => {
    const base = scene(400, 300, [{ x: 200, y: 150, r: 60 }]);
    const occluded = (x: number, y: number) => (y > 170 ? 90 : base(x, y));
    const hit = findCircle(grabber(occluded, 400, 300)(0, 0, 400, 300, 1)!, 40, 80)!;
    expect(Math.hypot(hit.x - 200, hit.y - 150)).toBeLessThan(2);
    expect(findCircle(grabber(scene(400, 300, []), 400, 300)(0, 0, 400, 300, 1)!, 20, 90)).toBeNull();
    const stripes = (x: number) => (Math.floor(x / 25) % 2 ? 200 : 40);
    expect(findCircle(grabber(stripes, 400, 300)(0, 0, 400, 300, 1)!, 20, 90)).toBeNull();
  });
  it('works on a downsampled patch', () => {
    const img = scene(800, 600, [{ x: 412, y: 305, r: 150 }]);
    const hit = PlateTracker.search(grabber(img, 800, 600), 400, 300, 60, 80, 200)!;
    expect(Math.hypot(hit.x - 412, hit.y - 305)).toBeLessThan(2);
    expect(Math.abs(hit.r - 150)).toBeLessThan(3);
  });
});

describe('plate tracking', () => {
  it('follows a fast-moving plate and ignores a second plate nearby', () => {
    const W = 640, H = 720, r = 68, fs = 30;
    const yAt = (t: number) => 560 - 380 * (0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, t / 0.8))); // 1.9 m rise scaled: peak ~750 px/s
    const tr = new PlateTracker();
    tr.lockTo({ x: 320, y: yAt(0), r });
    let worst = 0, found = 0;
    for (let k = 0; k <= 30; k++) {
      const t = k / fs;
      const img = scene(W, H, [{ x: 320 + 8 * Math.sin(4 * t), y: yAt(t), r }, { x: 520, y: 600, r: 68, level: 180 }]);
      const hit = tr.update(grabber(img, W, H), t);
      if (!hit) continue;
      found++;
      worst = Math.max(worst, Math.hypot(hit.x - (320 + 8 * Math.sin(4 * t)), hit.y - yAt(t)));
    }
    expect(found).toBe(31);
    expect(worst).toBeLessThan(1);
  });
  it('reports a miss when the plate disappears and recovers when it returns', () => {
    const W = 400, H = 400, tr = new PlateTracker();
    tr.lockTo({ x: 200, y: 200, r: 50 });
    const withPlate = grabber(scene(W, H, [{ x: 204, y: 198, r: 50 }]), W, H), empty = grabber(scene(W, H, []), W, H);
    expect(tr.update(withPlate, 0)).not.toBeNull();
    expect(tr.update(empty, 1 / 30)).toBeNull();
    expect(tr.update(empty, 2 / 30)).toBeNull();
    expect(tr.missed).toBe(2);
    expect(tr.update(withPlate, 3 / 30)).not.toBeNull();
    expect(tr.missed).toBe(0);
  });
});

describe('lifting mechanics', () => {
  const fs = 120, mass = 100;
  /** Smooth lift of height h in time T starting at t0 (minimum-jerk profile: v = 0 at both ends). */
  const profile = (t: number, t0: number, T: number, h: number) => {
    const u = Math.min(1, Math.max(0, (t - t0) / T));
    return h * (10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5);
  };
  it('work equals m g h and mean power equals work over time for a lift that starts and ends at rest', () => {
    const n = 3 * fs, h = 0.6, T = 1.2;
    const y = Float64Array.from({ length: n }, (_, i) => 0.3 + profile(i / fs, 0.5, T, h));
    const x = new Float64Array(n);
    const { reps, warnings } = analyseLift({ fs, x, y, massKg: mass });
    expect(warnings).toEqual([]);
    expect(reps).toHaveLength(1);
    const r = reps[0];
    expect(r.rom).toBeCloseTo(h, 2);
    expect(r.work).toBeCloseTo(mass * G * h, -1);
    expect(Math.abs(r.work - mass * G * h) / (mass * G * h)).toBeLessThan(0.01);
    expect(r.meanVelocity).toBeCloseTo(r.rom / r.duration, 9);
    expect(r.meanPower).toBeCloseTo(r.work / r.duration, 9);
    // Minimum-jerk peak velocity is 1.875 h / T.
    expect(r.peakVelocity).toBeCloseTo((1.875 * h) / T, 2);
    expect(r.timeToPeakVelocity).toBeCloseTo(r.duration / 2, 1);
    // Mean force over a lift that starts and ends at rest is the weight.
    expect(r.meanForce / (mass * G)).toBeCloseTo(1, 2);
    expect(r.peakForce).toBeGreaterThan(mass * G);
    expect(r.pathDeviation).toBe(0);
    expect(r.loweringTime).toBeNaN();
    expect(r.systemWork).toBeNaN();
  });
  it('force and power follow F = m (g + a) and P = F v', () => {
    const y = Float64Array.from({ length: 200 }, (_, i) => 0.5 * 2 * (i / fs) ** 2); // constant 2 m/s^2
    const s = liftSeries(new Float64Array(200), y, fs, mass);
    expect(s.ay[100]).toBeCloseTo(2, 6);
    expect(s.force[100]).toBeCloseTo(mass * (G + 2), 4);
    expect(s.power[100]).toBeCloseTo(mass * (G + 2) * 2 * (100 / fs), 3);
  });
  it('counts repetitions, lowering time and bar path, including a rep that ends the recording', () => {
    const period = 3, n = Math.round(2.5 * period * fs);
    // Down-up cycles: starts at the top, ends at the top with no lowering after the last lift.
    const y = Float64Array.from({ length: n }, (_, i) => 1.4 - 0.5 * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (period * fs))));
    const x = Float64Array.from({ length: n }, (_, i) => 0.03 * Math.sin((2 * Math.PI * i) / (period * fs)));
    const { reps } = analyseLift({ fs, x, y, massKg: mass });
    expect(reps.length).toBe(2);
    for (const r of reps) {
      expect(r.rom).toBeCloseTo(0.5, 2);
      expect(r.loweringTime).toBeCloseTo(period / 2, 1);
      expect(r.pathDeviation).toBeGreaterThan(0.02);
      expect(r.pathDeviation).toBeLessThan(0.065);
    }
    // A lift from the floor at the very start (deadlift) is found too.
    const dl = Float64Array.from({ length: 3 * fs }, (_, i) => 0.22 + profile(i / fs, 0.3, 1, 0.5));
    expect(analyseLift({ fs, x: new Float64Array(dl.length), y: dl, massKg: mass }).reps).toHaveLength(1);
  });
  it('ends the propulsive phase when the bar decelerates faster than gravity', () => {
    const n = 2 * fs, T = 0.35, h = 0.9; // fast: peak deceleration exceeds g
    const y = Float64Array.from({ length: n }, (_, i) => 0.2 + profile(i / fs, 0.3, T, h));
    const r = analyseLift({ fs, x: new Float64Array(n), y, massKg: 40 }).reps[0];
    expect(r.meanPropulsiveVelocity).toBeGreaterThan(r.meanVelocity);
    const slow = Float64Array.from({ length: 4 * fs }, (_, i) => 0.2 + profile(i / fs, 0.3, 2.5, 0.5));
    const rs = analyseLift({ fs, x: new Float64Array(slow.length), y: slow, massKg: 40 }).reps[0];
    expect(rs.meanPropulsiveVelocity).toBeCloseTo(rs.meanVelocity, 1);
  });
  it('system work uses the combined centre of mass and total mass', () => {
    const n = 3 * fs;
    const y = Float64Array.from({ length: n }, (_, i) => 0.9 + profile(i / fs, 0.5, 1.2, 0.6));
    const sysY = Float64Array.from({ length: n }, (_, i) => 0.7 + profile(i / fs, 0.5, 1.2, 0.4));
    const r = analyseLift({ fs, x: new Float64Array(n), y, massKg: mass, system: { y: sysY, massKg: 180 } }).reps[0];
    expect(Math.abs(r.systemWork - 180 * G * 0.4) / (180 * G * 0.4)).toBeLessThan(0.01);
    expect(r.systemMeanPower).toBeCloseTo(r.systemWork / r.duration, 9);
  });
  it('warns about fast lifts at low frame rates and when nothing was lifted', () => {
    const f30 = 30;
    const y = Float64Array.from({ length: 60 }, (_, i) => 0.2 + profile(i / f30, 0.3, 0.6, 1.0));
    expect(analyseLift({ fs: f30, x: new Float64Array(60), y, massKg: 60 }).warnings.join(' ')).toMatch(/frame rate/);
    expect(analyseLift({ fs, x: new Float64Array(100), y: new Float64Array(100).fill(1), massKg: 60 }).warnings.join(' ')).toMatch(/not tracked|No lift/);
  });
  it('the synthetic barbell squat rises by a known amount', () => {
    const fsS = 60, n = 2 * SYNTH.liftPeriod * fsS + 1;
    const y = Float64Array.from({ length: n }, (_, i) => syntheticBar(i / fsS).y), x = Float64Array.from({ length: n }, (_, i) => syntheticBar(i / fsS).x);
    const rise = syntheticBar(0).y - syntheticBar(SYNTH.liftPeriod / 2).y;
    const { reps } = analyseLift({ fs: fsS, x, y, massKg: 80 });
    expect(reps).toHaveLength(2);
    expect(reps[0].rom).toBeCloseTo(rise, 2);
    expect(Math.abs(reps[0].work - 80 * G * rise) / (80 * G * rise)).toBeLessThan(0.02);
  });
});

describe('frame rate from timestamps', () => {
  it('is exact for millisecond-rounded timestamps and for skipped frames', async () => {
    const { frameRate } = await import('../../src/kinematics/series');
    const exact = Array.from({ length: 90 }, (_, i) => i / 30);
    expect(frameRate(exact)).toBeCloseTo(30, 9);
    // WebM stores times in whole milliseconds: 0, 33, 67, 100...
    const rounded = exact.map((t) => Math.round(t * 1000) / 1000);
    expect(frameRate(rounded)).toBeCloseTo(30, 1);
    expect(1 / 0.033).toBeGreaterThan(30.2); // what the median interval alone would give
    const dropped = exact.filter((_, i) => i % 7 !== 3);
    expect(frameRate(dropped)).toBeCloseTo(30, 6);
    expect(frameRate([0, 1])).toBeNaN();
  });
});
