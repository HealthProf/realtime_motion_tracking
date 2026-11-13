import { describe, expect, it } from 'vitest';
import { landmarksCsv, parseSession, processedCsv, sessionJson } from '../../src/capture/csv';
import { processTrial, type ProcessOptions } from '../../src/capture/process';
import { TrialRecorder, type TrialMeta } from '../../src/capture/trial';
import { calibrateFromLength } from '../../src/kinematics/calibration';
import { squatKneeIncluded, SYNTH, syntheticFrame, type SyntheticActivity } from '../../src/pose/synthetic';

const meta = (): TrialMeta => ({
  appVersion: 'test', startedAt: '2026-01-01T00:00:00Z', source: 'synthetic', cameraLabel: 'synthetic', nominalFps: 60,
  timestampSource: 'synthetic', model: 'synthetic', delegate: 'none', mirrored: false, width: SYNTH.width, height: SYNTH.height,
  // 1 m reference = pxPerMetre pixels; origin at the ground under the subject.
  calibration: calibrateFromLength({ x: 0, y: 0 }, { x: SYNTH.pxPerMetre, y: 0 }, 1, { x: SYNTH.width / 2, y: SYNTH.groundY }),
  bodyModel: 'average', preset: 'none', notes: '',
});

export function record(activity: SyntheticActivity, seconds: number, fps = 60, jitter = 0, noisePx = 0) {
  const rec = new TrialRecorder();
  rec.start(meta());
  let seed = 1;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 2;
  for (let i = 0; i <= seconds * fps; i++) {
    const t = 10 + i / fps + (i > 0 ? jitter * rand() : 0);
    const f = syntheticFrame(t - 10, activity);
    f.t = t;
    if (noisePx) for (const p of f.lm!) { p.x += noisePx * rand(); p.y += noisePx * rand(); }
    rec.add(f);
  }
  rec.mark('bottom');
  return rec.stop()!;
}

const opts: ProcessOptions = { cutoff: 6, angles: ['l_knee', 'l_thigh_seg', 'trunk_lean'], points: ['l_hip', 'com'], convention: 'anatomical', minVisibility: 0.5, bodyModel: 'average', maxGap: 0.25, include3d: true };

describe('trial processing', () => {
  it('recovers knee angle and its derivatives from a noisy, jittered squat, with error growing per derivative', () => {
    // +-0.5 px uniform keypoint noise and +-2 ms timestamp jitter at 60 Hz.
    const trial = record('squat', 6, 60, 0.002, 0.5);
    const w = (2 * Math.PI) / SYNTH.squatPeriod;
    const rmsFor = (cutoff: number) => {
      const p = processTrial(trial, { ...opts, cutoff });
      expect(p.fs).toBeCloseTo(60, 0);
      const ang = p.col.get('l_knee_deg')!, vel = p.col.get('l_knee_vel_deg_s')!, acc = p.col.get('l_knee_acc_deg_s2')!;
      let eA = 0, eV = 0, eAcc = 0, n = 0;
      for (let i = 30; i < p.t.length - 30; i++, n++) {
        const t = p.t[i];
        eA += (ang[i] - (180 - squatKneeIncluded(t))) ** 2;
        eV += (vel[i] - 50 * w * Math.sin(w * t)) ** 2;
        eAcc += (acc[i] - 50 * w * w * Math.cos(w * t)) ** 2;
      }
      return [eA, eV, eAcc].map((e) => Math.sqrt(e / n));
    };
    const peakV = 50 * w, peakA = 50 * w * w; // 105 deg/s, 219 deg/s^2
    const at6 = rmsFor(6), at3 = rmsFor(3);
    console.log('RMS error at 6 Hz:', at6.map((r) => r.toFixed(2)).join(', '), '| at 3 Hz:', at3.map((r) => r.toFixed(2)).join(', '));
    // Default 6 Hz cutoff: angle and velocity are good; acceleration is dominated by noise.
    expect(at6[0]).toBeLessThan(0.2);
    expect(at6[1]).toBeLessThan(0.05 * peakV);
    expect(at6[2]).toBeLessThan(0.8 * peakA);
    // A cutoff matched to this slow movement (0.33 Hz) makes acceleration usable.
    expect(at3[2]).toBeLessThan(0.2 * peakA);
    expect(at3[2]).toBeLessThan(at6[2] / 3);
  });

  it('converts to metres using the calibration and measures hip travel', () => {
    const p = processTrial(record('squat', 3, 60), opts);
    const y = p.col.get('l_hip_y_m')!;
    const top = 0.07 + 0.43 * Math.cos((5 * Math.PI) / 180) * 2, bottom = 0.07 + 0.43 * Math.cos((30 * Math.PI) / 180) + 0.43 * Math.cos((80 * Math.PI) / 180);
    expect(y[0]).toBeCloseTo(top, 2);
    expect(Math.min(...y)).toBeCloseTo(bottom, 2);
    expect(p.lengthUnit).toBe('m');
    expect(p.col.has('com_speed_m_s')).toBe(true);
    expect(p.col.has('l_thigh_seg_tangential_vel_m_s')).toBe(true);
    expect(p.col.has('l_knee_deg_3d_experimental')).toBe(true);
  });

  it('centre of mass shows free-fall acceleration during the flight of a jump', () => {
    const p = processTrial(record('jump', 3, 120), { ...opts, cutoff: 15 });
    const ay = p.col.get('com_ay_m_s2')!;
    // Mid-flight is at t = 0.8 + 0.25 s.
    const i = Math.round(1.05 * p.fs);
    expect(ay[i]).toBeGreaterThan(-9.81 * 1.1);
    expect(ay[i]).toBeLessThan(-9.81 * 0.9);
  });

  it('warns about uncalibrated data and clamps the cutoff', () => {
    const trial = record('squat', 2, 30);
    trial.meta.calibration = { scale: 1, unit: 'px', origin: { x: 0, y: SYNTH.height }, method: 'none' };
    const p = processTrial(trial, { ...opts, cutoff: 20 });
    expect(p.cutoff).toBeCloseTo(12, 1);
    expect(p.warnings.some((w) => w.includes('Not calibrated'))).toBe(true);
    expect(p.warnings.some((w) => w.includes('Cutoff reduced'))).toBe(true);
    expect(p.col.has('l_hip_x_px')).toBe(true);
  });

  it('leaves gaps empty when the person is lost', () => {
    const trial = record('squat', 3, 60);
    for (let i = 60; i < 100; i++) trial.frames[i].lm = null;
    const p = processTrial(trial, opts);
    expect(Number.isNaN(p.col.get('l_knee_deg')![80])).toBe(true);
    expect(Number.isFinite(p.col.get('l_knee_deg')![30])).toBe(true);
    expect(Number.isFinite(p.col.get('l_knee_deg')![150])).toBe(true);
  });
});

describe('export', () => {
  it('writes a CSV with metadata, header, marks and one row per sample', () => {
    const trial = record('squat', 2, 60);
    const p = processTrial(trial, opts);
    const lines = processedCsv(trial, p, opts).trim().split('\n');
    const data = lines.filter((l) => !l.startsWith('#'));
    expect(lines.some((l) => l.startsWith('# filter: zero-phase'))).toBe(true);
    expect(data[0].startsWith('time_s,mark,l_knee_deg_raw,l_knee_deg,')).toBe(true);
    expect(data.length).toBe(p.t.length + 1);
    expect(data[data.length - 1].split(',')[1]).toBe('bottom');
    expect(data[1].split(',').length).toBe(p.columns.length + 2);
    expect(processedCsv(trial, p, opts, false).startsWith('time_s')).toBe(true);
  });

  it('writes raw landmarks', () => {
    const trial = record('squat', 1, 30);
    const lines = landmarksCsv(trial).trim().split('\n').filter((l) => !l.startsWith('#'));
    expect(lines.length).toBe(trial.frames.length + 1);
    expect(lines[0].split(',').length).toBe(1 + 33 * 6);
  });

  it('session files round-trip to an identical CSV', () => {
    const trial = record('squat', 3, 60, 0.002, 0.7);
    const again = parseSession(sessionJson(trial));
    expect(processedCsv(again, processTrial(again, opts), opts)).toBe(processedCsv(trial, processTrial(trial, opts), opts));
    expect(() => parseSession('{"format":"other"}')).toThrow();
    expect(() => parseSession('nope')).toThrow();
  });
});
