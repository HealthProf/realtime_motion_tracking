import { describe, expect, it } from 'vitest';
import { centreOfMass, HEAD_MASS, LIMB_SEGMENTS, TRUNK } from '../../src/analysis/com';
import { ANGLE_BY_ID, evalAngle } from '../../src/measure/definitions';
import { getPoint, L, type PointId } from '../../src/pose/landmarks';
import { squatKneeIncluded, SYNTH, syntheticFrame } from '../../src/pose/synthetic';

describe('centre of mass', () => {
  it('segment mass fractions sum to 100 % for both parameter sets', () => {
    for (const m of ['male', 'female'] as const) {
      const total = HEAD_MASS[m] + TRUNK.mass[m] + [...LIMB_SEGMENTS.l, ...LIMB_SEGMENTS.r].reduce((s, x) => s + x.mass[m], 0);
      expect(total).toBeCloseTo(100, 1);
    }
  });

  it('matches a hand-computed vertical stack', () => {
    // All landmarks on one vertical line: the COM x equals that x, and y is the mass-weighted mean.
    const f = syntheticFrame(0, 'raise');
    const lm = f.lm!.map((p) => ({ ...p, x: 100 }));
    const r = centreOfMass(lm, 'male', 0.5)!;
    expect(r.com.x).toBeCloseTo(100, 9);
    expect(r.mirrored).toBe(false);
    const yOf = (n: keyof typeof L) => lm[L[n]].y;
    const segY = (prox: number, dist: number, cm: number) => prox + (cm / 100) * (dist - prox);
    let sum = HEAD_MASS.male * ((yOf('l_ear') + yOf('r_ear')) / 2);
    sum += TRUNK.mass.male * segY((yOf('l_shoulder') + yOf('r_shoulder')) / 2, (yOf('l_hip') + yOf('r_hip')) / 2, TRUNK.cm.male);
    for (const s of [...LIMB_SEGMENTS.l, ...LIMB_SEGMENTS.r]) sum += s.mass.male * segY(yOf(s.prox as keyof typeof L), yOf(s.dist as keyof typeof L), s.cm.male);
    expect(r.com.y).toBeCloseTo(sum / 100, 6);
  });

  it('lies at a plausible height for upright standing (53-60 % of stature)', () => {
    const f = syntheticFrame(0, 'raise');
    const r = centreOfMass(f.lm, 'average', 0.5)!;
    const heightM = (SYNTH.groundY - r.com.y) / SYNTH.pxPerMetre;
    expect(heightM / 1.75).toBeGreaterThan(0.53);
    expect(heightM / 1.75).toBeLessThan(0.6);
  });

  it('mirrors a hidden limb and reports it; fails without a trunk', () => {
    const f = syntheticFrame(0, 'squat');
    const lm = f.lm!.map((p) => ({ ...p }));
    lm[L.r_knee].v = 0.1;
    expect(centreOfMass(lm, 'male', 0.5)!.mirrored).toBe(true);
    lm[L.l_hip].v = 0.1;
    expect(centreOfMass(lm, 'male', 0.5)).toBeNull();
  });
});

describe('angle definitions on synthetic poses', () => {
  const at = (t: number, activity: 'squat' | 'raise') => {
    const f = syntheticFrame(t, activity);
    return (id: PointId) => {
      const p = getPoint(f.lm, id, 0.5);
      return p ? { x: p.x, y: f.h - p.y } : null;
    };
  };

  it('knee angle follows the synthetic squat in both conventions', () => {
    for (const t of [0, 0.4, 1.5, 2.2]) {
      expect(evalAngle(ANGLE_BY_ID.get('l_knee')!, at(t, 'squat'), 'included')).toBeCloseTo(squatKneeIncluded(t), 6);
      expect(evalAngle(ANGLE_BY_ID.get('l_knee')!, at(t, 'squat'), 'anatomical')).toBeCloseTo(180 - squatKneeIncluded(t), 6);
    }
  });

  it('trunk lean and thigh segment angles are correct at the bottom of the squat', () => {
    const p = at(SYNTH.squatPeriod / 2, 'squat');
    expect(evalAngle(ANGLE_BY_ID.get('trunk_lean')!, p, 'anatomical')).toBeCloseTo(40, 0);
    // Thigh points from hip (behind, above) to knee: 80 deg from vertical -> 10 deg below horizontal.
    expect(evalAngle(ANGLE_BY_ID.get('l_thigh_seg')!, p, 'anatomical')).toBeCloseTo(-10, 6);
  });

  it('shoulder abduction peaks at the synthetic asymmetry', () => {
    const p = at(SYNTH.raisePeriod / 2, 'raise');
    // Arm-trunk angle is measured against the shoulder-hip line, which is ~8 deg off vertical in this model.
    const l = evalAngle(ANGLE_BY_ID.get('l_shoulder')!, p, 'anatomical');
    const r = evalAngle(ANGLE_BY_ID.get('r_shoulder')!, p, 'anatomical');
    expect(r - l).toBeCloseTo(SYNTH.raiseMaxRight - SYNTH.raiseMaxLeft, 6);
  });

  it('returns NaN when a landmark is not visible', () => {
    const f = syntheticFrame(0, 'squat');
    f.lm![L.l_ankle].v = 0.1;
    const p = (id: PointId) => getPoint(f.lm, id, 0.5);
    expect(Number.isNaN(evalAngle(ANGLE_BY_ID.get('l_knee')!, p, 'included'))).toBe(true);
  });
});
