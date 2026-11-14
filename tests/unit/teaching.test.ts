import { describe, expect, it } from 'vitest';
import { alignFacing, bodyFrame, facingPlane, FrameSmoother, frameFromView, headingAngle, planeBasis } from '../../src/analysis/bodyFrame';
import { centreOfMass, segmentCentres } from '../../src/analysis/com';
import { EYE_HEIGHT_FRACTION, standingHeightSpan } from '../../src/analysis/heightCal';
import { baseOfSupport, G, resistingGroup, staticMoment } from '../../src/analysis/statics';
import { L } from '../../src/pose/landmarks';
import { SYNTH, syntheticFrame } from '../../src/pose/synthetic';
import type { Lm } from '../../src/types';

const standing = () => syntheticFrame(0, 'squat'); // t = 0: upright
const squatting = () => syntheticFrame(SYNTH.squatPeriod / 2, 'squat');

describe('standing-height calibration', () => {
  it('measures the eye-to-heel span of an upright person', () => {
    const f = standing();
    const r = standingHeightSpan(Array(15).fill(f.lm), f.w, f.h, 0.5);
    expect(r.ok).toBe(true);
    const eyeY = (f.lm![L.l_eye].y + f.lm![L.r_eye].y) / 2, heelY = (f.lm![L.l_heel].y + f.lm![L.r_heel].y) / 2;
    expect(r.px).toBeCloseTo(heelY - eyeY, 6);
    // Scale from a known stature reproduces the synthetic 300 px per metre.
    const stature = (r.px / SYNTH.pxPerMetre) / EYE_HEIGHT_FRACTION;
    expect((EYE_HEIGHT_FRACTION * stature) / r.px).toBeCloseTo(1 / SYNTH.pxPerMetre, 9);
  });
  it('refuses a squatting person', () => {
    const f = squatting();
    const r = standingHeightSpan(Array(15).fill(f.lm), f.w, f.h, 0.5);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/straight|upright|tall/i);
  });
  it('refuses when the head is cut off, the feet are hidden, or the person is moving', () => {
    const f = standing();
    const up = f.lm!.map((p) => ({ ...p, y: p.y - 200 }));
    expect(standingHeightSpan(Array(10).fill(up), f.w, f.h, 0.5).reason).toMatch(/whole body/);
    const hidden = f.lm!.map((p, i) => (i === L.l_heel ? { ...p, v: 0.1 } : p));
    expect(standingHeightSpan(Array(10).fill(hidden), f.w, f.h, 0.5).reason).toMatch(/heels/);
    const moving = Array.from({ length: 10 }, (_, k) => f.lm!.map((p, i) => (i === L.l_eye || i === L.r_eye ? { ...p, y: p.y + (k % 2) * 30 } : p)));
    expect(standingHeightSpan(moving, f.w, f.h, 0.5).reason).toMatch(/still/);
    expect(standingHeightSpan([null, null, null], f.w, f.h, 0.5).ok).toBe(false);
  });
});

describe('body frame and planes', () => {
  const world = (leftX: number, leftZ: number): Lm[] => {
    const w: Lm[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, v: 1 }));
    w[L.l_shoulder] = { x: leftX, y: -0.5, z: leftZ, v: 1 }; w[L.r_shoulder] = { x: -leftX, y: -0.5, z: -leftZ, v: 1 };
    w[L.l_hip] = { x: leftX * 0.6, y: 0, z: leftZ * 0.6, v: 1 }; w[L.r_hip] = { x: -leftX * 0.6, y: 0, z: -leftZ * 0.6, v: 1 };
    return w;
  };
  it('faces the camera when the left side is on image right', () => {
    const f = bodyFrame(world(0.2, 0), false, 'heading')!;
    expect(f.ml.x).toBeCloseTo(1);
    expect(f.up.y).toBeCloseTo(-1);
    expect(f.ap.z).toBeCloseTo(-1); // toward the camera
    expect(headingAngle(f)).toBeCloseTo(0);
    expect(facingPlane(f).plane).toBe('frontal');
  });
  it('keeps the front of the body toward the camera in a mirrored (selfie) view', () => {
    const f = bodyFrame(world(-0.2, 0), true, 'heading')!;
    expect(f.ap.z).toBeCloseTo(-1);
  });
  it('recognises a side view and a 45 degree view', () => {
    const side = bodyFrame(world(0, -0.2), false, 'heading')!;
    expect(headingAngle(side)).toBeCloseTo(90);
    expect(facingPlane(side).plane).toBe('sagittal');
    expect(Math.abs(side.ap.x)).toBeCloseTo(1);
    const oblique = bodyFrame(world(0.2, -0.2), false, 'heading')!;
    expect(headingAngle(oblique)).toBeCloseTo(45);
    expect(facingPlane(oblique).offDeg).toBeCloseTo(45);
  });
  it('produces orthonormal axes, and each plane normal is its axis of rotation', () => {
    const f = bodyFrame(world(0.15, -0.1), false, 'trunk')!;
    const dot = (a: any, b: any) => a.x * b.x + a.y * b.y + a.z * b.z;
    for (const v of [f.ml, f.ap, f.up]) expect(dot(v, v)).toBeCloseTo(1);
    expect(dot(f.ml, f.ap)).toBeCloseTo(0); expect(dot(f.ml, f.up)).toBeCloseTo(0); expect(dot(f.ap, f.up)).toBeCloseTo(0);
    for (const p of ['sagittal', 'frontal', 'transverse'] as const) {
      const b = planeBasis(f, p);
      expect(dot(b.normal, b.u)).toBeCloseTo(0); expect(dot(b.normal, b.v)).toBeCloseTo(0);
    }
    expect(planeBasis(f, 'sagittal').normal).toBe(f.ml);
    expect(planeBasis(f, 'transverse').normal).toBe(f.up);
  });
  it('tilts with the trunk only in trunk mode', () => {
    const w = world(0.2, 0);
    for (const n of [L.l_shoulder, L.r_shoulder]) w[n].z -= 0.5; // leaning toward the camera
    expect(bodyFrame(w, false, 'heading')!.up.z).toBeCloseTo(0);
    expect(bodyFrame(w, false, 'trunk')!.up.z).toBeLessThan(-0.5);
  });
  it('snaps to square-on near a cardinal view and follows an oblique one', () => {
    const sm = new FrameSmoother();
    let f = null;
    for (let i = 0; i < 60; i++) f = sm.update(bodyFrame(world(0.2, -0.02), false, 'heading'), i / 30, false);
    expect(headingAngle(f!)).toBeCloseTo(0, 5);
    const sm2 = new FrameSmoother();
    for (let i = 0; i < 90; i++) f = sm2.update(bodyFrame(world(0.2, -0.2), false, 'heading'), i / 30, false);
    expect(headingAngle(f!)).toBeGreaterThan(40);
  });
  it('falls back to the 2D view', () => {
    const f = frameFromView('lateral', 1, true, false);
    expect(f.ap.x).toBeCloseTo(1);
    expect(facingPlane(f).plane).toBe('sagittal');
    expect(frameFromView('lateral', -1, true, true).ap.x).toBeCloseTo(-1);
    expect(frameFromView('anterior', 1, true, false).ap.z).toBeCloseTo(-1);
  });
  it('the synthetic side-view demo is seen in the sagittal plane', () => {
    expect(facingPlane(bodyFrame(standing().world, false, 'heading')!).plane).toBe('sagittal');
    const f = bodyFrame(standing().world, false, 'heading')!;
    expect(f.ap.x).toBeCloseTo(1, 1); // faces image right
    // If the depth sign were wrong, the picture's facing direction corrects it; a front view is left alone.
    const flipped = alignFacing(f, -1);
    expect(flipped.ap.x).toBeCloseTo(-1, 1);
    expect(flipped.ml.z).toBeCloseTo(-f.ml.z, 9);
    expect(alignFacing(f, 1)).toBe(f);
    const front = frameFromView('anterior', 1, true, false);
    expect(alignFacing(front, -1)).toBe(front);
  });
});

describe('static moments', () => {
  it('segment masses add up to the whole body and reproduce the centre of mass', () => {
    const lm = squatting().lm!;
    const segs = segmentCentres(lm, 'average', 0.5);
    const total = segs.reduce((s, g) => s + g.mass, 0);
    expect(total).toBeCloseTo(100, 0);
    const com = centreOfMass(lm, 'average', 0.5)!.com;
    expect(segs.reduce((s, g) => s + g.mass * g.x, 0) / total).toBeCloseTo(com.x, 6);
    expect(segs.reduce((s, g) => s + g.mass * g.y, 0) / total).toBeCloseTo(com.y, 6);
  });
  it('moment = weight x horizontal distance, in SI units', () => {
    const lm = squatting().lm!;
    const m = staticMoment({ lm, joint: 'knees', side: 'l', bodyModel: 'average', minVisibility: 0.5, bodyMassKg: 70, scale: 1 / SYNTH.pxPerMetre })!;
    expect(m.weightN).toBeCloseTo((m.massPct / 100) * 70 * G, 6);
    expect(m.armM).toBeCloseTo((m.com.x - lm[L.l_knee].x) / SYNTH.pxPerMetre, 9);
    expect(m.momentNm).toBeCloseTo(m.weightN * m.armM, 9);
    // Head, arms, trunk and both thighs.
    expect(m.massPct).toBeGreaterThan(80);
    expect(m.massPct).toBeLessThan(92);
  });
  it('in a deep squat the weight falls behind the knees and in front of the hips', () => {
    const lm = squatting().lm!;
    const base = { lm, side: 'l' as const, bodyModel: 'average' as const, minVisibility: 0.5, bodyMassKg: 70, scale: 1 / SYNTH.pxPerMetre };
    const knee = staticMoment({ ...base, joint: 'knees' })!, hip = staticMoment({ ...base, joint: 'hips' })!;
    expect(knee.armPx).toBeLessThan(0); // subject faces image right
    expect(resistingGroup('knees', knee.armPx, 1)!.muscles).toMatch(/quadriceps/);
    expect(hip.armPx).toBeGreaterThan(0);
    expect(resistingGroup('hips', hip.armPx, 1)!.muscles).toMatch(/hip extensors/);
    expect(resistingGroup('hips', hip.armPx, -1)!.muscles).toMatch(/hip flexors/);
    expect(resistingGroup('elbow', 5, 1)).toBeNull();
  });
  it('adds a hand-held load at the right place and shares it between the arms', () => {
    const lm = standing().lm!;
    const base = { lm, side: 'l' as const, bodyModel: 'average' as const, minVisibility: 0.5, bodyMassKg: 70, scale: 1 / SYNTH.pxPerMetre };
    const load = { kg: 20, x: lm[L.l_hip].x + 150, y: lm[L.l_hip].y };
    const a = staticMoment({ ...base, joint: 'hips' })!, b = staticMoment({ ...base, joint: 'hips', load })!;
    expect(b.massKg).toBeCloseTo(a.massKg + 20, 9);
    expect(b.momentNm - a.momentNm).toBeCloseTo(20 * G * 0.5, 6); // 20 kg held 0.5 m in front of the hips
    const e = staticMoment({ ...base, joint: 'elbow' })!, e2 = staticMoment({ ...base, joint: 'elbow', load })!;
    expect(e2.massKg).toBeCloseTo(e.massKg + 10, 9);
  });
  it('needs body mass and reports no SI moment without calibration', () => {
    const lm = standing().lm!;
    expect(staticMoment({ lm, joint: 'hips', side: 'l', bodyModel: 'average', minVisibility: 0.5, bodyMassKg: NaN, scale: 1 })).toBeNull();
    expect(staticMoment({ lm, joint: 'hips', side: 'l', bodyModel: 'average', minVisibility: 0.5, bodyMassKg: 70, scale: NaN })!.momentNm).toBeNaN();
  });
  it('finds the base of support and the stability margin', () => {
    const lm = standing().lm!;
    const com = centreOfMass(lm, 'average', 0.5)!.com;
    const s = baseOfSupport(lm, com.x, 0.5)!;
    expect(s.x0).toBeCloseTo(Math.min(lm[L.l_heel].x, lm[L.r_heel].x), 6);
    expect(s.x1).toBeCloseTo(Math.max(lm[L.l_toe].x, lm[L.r_toe].x), 6);
    expect(s.margin).toBeGreaterThan(0);
    expect(baseOfSupport(lm, s.x1 + 50, 0.5)!.margin).toBeCloseTo(-50, 6);
    // A lifted foot does not count.
    const lifted = lm.map((p, i) => (i === L.r_heel || i === L.r_toe ? { ...p, y: p.y - 120, x: p.x + 300 } : p));
    expect(baseOfSupport(lifted, com.x, 0.5)!.x1).toBeCloseTo(lm[L.l_toe].x, 6);
  });
});
