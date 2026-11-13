import { describe, expect, it } from 'vitest';
import { filtfilt, filtfiltGaps, filterForward, lowpassCoefficients, passCorrection } from '../../src/kinematics/butterworth';
import { derivative, median, pathLength, resample, secondDerivative, uniformGrid } from '../../src/kinematics/series';
import { includedAngle, segmentAngle, unwrapDegrees } from '../../src/kinematics/angles';
import { calibrateFromLength, toAnalysis } from '../../src/kinematics/calibration';
import { OneEuro } from '../../src/kinematics/oneEuro';

const sine = (f: number, fs: number, n: number, amp = 1) => Float64Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / fs));
const rms = (a: ArrayLike<number>, from = 0, to = a.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i] * a[i];
  return Math.sqrt(s / (to - from));
};

describe('butterworth', () => {
  it('dual-pass correction factor matches Winter (0.802)', () => {
    expect(passCorrection(2)).toBeCloseTo(0.802, 3);
    expect(passCorrection(1)).toBe(1);
  });

  it('has unity DC gain', () => {
    const c = lowpassCoefficients(6, 30);
    expect(c.a0 + c.a1 + c.a2 + c.b1 + c.b2).toBeCloseTo(1, 12);
    const y = filterForward(new Float64Array(50).fill(3.5), c);
    expect(y[49]).toBeCloseTo(3.5, 10);
  });

  it('zero-phase filter is -3 dB at the requested cutoff', () => {
    const fs = 100, fc = 6, n = 2000;
    const y = filtfilt(sine(fc, fs, n), fc, fs);
    const gain = rms(y, 500, 1500) / rms(sine(fc, fs, n), 500, 1500);
    expect(gain).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it('passes low frequencies and rejects high frequencies without phase lag', () => {
    const fs = 100, n = 1000;
    const low = sine(1, fs, n);
    const noisy = low.map((v, i) => v + 0.2 * Math.sin((2 * Math.PI * 30 * i) / fs));
    const y = filtfilt(noisy, 6, fs);
    let maxErr = 0;
    for (let i = 100; i < n - 100; i++) maxErr = Math.max(maxErr, Math.abs(y[i] - low[i]));
    expect(maxErr).toBeLessThan(0.01);
  });

  it('rejects a cutoff at or above Nyquist', () => {
    expect(() => lowpassCoefficients(15, 30)).toThrow();
  });

  it('filters runs separately and leaves gaps as NaN', () => {
    const x = Array.from(sine(1, 50, 100));
    for (let i = 40; i < 45; i++) x[i] = NaN;
    for (let i = 90; i < 96; i++) x[i] = NaN; // leaves a 4-sample tail: too short to filter
    const y = filtfiltGaps(x, 6, 50);
    expect(Number.isFinite(y[10])).toBe(true);
    expect(Number.isNaN(y[42])).toBe(true);
    expect(Number.isFinite(y[60])).toBe(true);
    expect(Number.isNaN(y[98])).toBe(true);
  });
});

describe('series', () => {
  it('resamples irregular samples of a line exactly', () => {
    const t = [0, 0.03, 0.07, 0.1, 0.14, 0.2];
    const v = t.map((x) => 2 * x + 1);
    const g = uniformGrid(0, 0.2, 50);
    const r = resample(t, v, g, 1);
    expect(g.length).toBe(11);
    r.forEach((val, i) => expect(val).toBeCloseTo(2 * g[i] + 1, 12));
  });

  it('does not interpolate across long gaps or missing samples', () => {
    const r = resample([0, 0.1, 0.2, 1.0, 1.1], [0, 1, NaN, 10, 11], uniformGrid(0, 1.1, 10), 0.25);
    expect(r[1]).toBeCloseTo(1);
    expect(Number.isNaN(r[5])).toBe(true);
    expect(r[10]).toBeCloseTo(10);
    expect(r[11]).toBeCloseTo(11);
  });

  it('differentiates a sinusoid (velocity and acceleration) within tolerance', () => {
    const fs = 100, f = 1, n = 400, w = 2 * Math.PI * f;
    const x = sine(f, fs, n);
    const v = derivative(x, 1 / fs);
    const a = secondDerivative(x, 1 / fs);
    for (let i = 5; i < n - 5; i++) {
      expect(v[i]).toBeCloseTo(w * Math.cos((w * i) / fs), 1);
      expect(Math.abs(a[i] + w * w * Math.sin((w * i) / fs))).toBeLessThan(0.02 * w * w);
    }
  });

  it('recovers constant acceleration exactly (projectile)', () => {
    const fs = 60, g = -9.81;
    const y = Float64Array.from({ length: 60 }, (_, i) => 1 + 3 * (i / fs) + 0.5 * g * (i / fs) ** 2);
    const a = secondDerivative(y, 1 / fs);
    const v = derivative(y, 1 / fs);
    a.forEach((val) => expect(val).toBeCloseTo(g, 6));
    expect(v[30]).toBeCloseTo(3 + g * 0.5, 6);
  });

  it('recovers pendulum angular velocity after filtering noisy samples', () => {
    const fs = 60, n = 600, w = Math.sqrt(9.81 / 1.0), A = 20;
    let seed = 42;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 2;
    const theta = Float64Array.from({ length: n }, (_, i) => A * Math.cos((w * i) / fs) + 0.3 * rand());
    const omega = derivative(filtfilt(theta, 4, fs), 1 / fs);
    let maxErr = 0;
    for (let i = 60; i < n - 60; i++) maxErr = Math.max(maxErr, Math.abs(omega[i] + A * w * Math.sin((w * i) / fs)));
    expect(maxErr).toBeLessThan(0.05 * A * w);
  });

  it('accumulates path length and handles gaps', () => {
    const p = pathLength([0, 3, 3, NaN, 3], [0, 4, 4, NaN, 10]);
    expect(p[1]).toBeCloseTo(5);
    expect(p[2]).toBeCloseTo(5);
    expect(Number.isNaN(p[3])).toBe(true);
    expect(p[4]).toBeCloseTo(11);
  });

  it('median ignores NaN', () => {
    expect(median([3, NaN, 1, 2])).toBe(2);
  });
});

describe('angles', () => {
  it('computes included angles', () => {
    expect(includedAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90);
    expect(includedAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: -1, y: 0 })).toBeCloseTo(180);
    expect(includedAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(45);
    expect(includedAngle({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 2 })).toBeCloseTo(90);
    expect(Number.isNaN(includedAngle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }))).toBe(true);
  });

  it('computes segment angles in a y-up frame', () => {
    expect(segmentAngle({ x: 0, y: 0 }, { x: 1, y: 1 }, 'horizontal')).toBeCloseTo(45);
    expect(segmentAngle({ x: 0, y: 0 }, { x: 0, y: 1 }, 'vertical')).toBeCloseTo(0);
    expect(segmentAngle({ x: 0, y: 0 }, { x: 1, y: 1 }, 'vertical')).toBeCloseTo(45);
    expect(segmentAngle({ x: 0, y: 0 }, { x: -1, y: 0 }, 'vertical')).toBeCloseTo(-90);
  });

  it('unwraps across +-180', () => {
    const u = unwrapDegrees([170, 179, -179, -170, NaN, -160]);
    expect(Array.from(u.slice(0, 4))).toEqual([170, 179, 181, 190]);
    expect(u[5]).toBe(200);
  });
});

describe('calibration', () => {
  it('scales and flips y about the origin', () => {
    const c = calibrateFromLength({ x: 100, y: 400 }, { x: 100, y: 200 }, 1, { x: 50, y: 450 });
    expect(c.scale).toBeCloseTo(0.005);
    const p = toAnalysis(c, 250, 250);
    expect(p.x).toBeCloseTo(1);
    expect(p.y).toBeCloseTo(1);
  });
});

describe('one euro filter', () => {
  it('converges to a constant and reduces jitter', () => {
    const f = new OneEuro();
    let seed = 7;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 2;
    const out: number[] = [];
    for (let i = 0; i < 300; i++) out.push(f.filter(5 + 0.1 * rand(), i / 30));
    const tail = out.slice(100);
    const mean = tail.reduce((a, b) => a + b) / tail.length;
    expect(mean).toBeCloseTo(5, 1);
    expect(Math.sqrt(tail.reduce((a, b) => a + (b - mean) ** 2, 0) / tail.length)).toBeLessThan(0.04);
  });
});
