import { describe, expect, it } from 'vitest';
import { detectJumps, G } from '../../src/analysis/jump';
import { detectReps, peakAbs, rangeOf, symmetryIndex } from '../../src/analysis/reps';
import { residualAnalysis } from '../../src/analysis/residual';
import { processTrial } from '../../src/capture/process';
import { bodyYaw, classifyView, coachChecks } from '../../src/coach/coach';
import { defaultCalibration } from '../../src/kinematics/calibration';
import { FpsMeter, LiveEngine } from '../../src/live';
import { L } from '../../src/pose/landmarks';
import { squatKneeIncluded, SYNTH, syntheticFrame } from '../../src/pose/synthetic';
import { record } from './trial.test';

const base = { convention: 'anatomical' as const, minVisibility: 0.5, bodyModel: 'average' as const, maxGap: 0.25, include3d: false };

describe('rep detection', () => {
  it('counts squats and reports range of motion, duration and peak velocity', () => {
    const p = processTrial(record('squat', 9.2, 60, 0.001, 0.5), { ...base, cutoff: 6, angles: ['l_knee'], points: [] });
    const reps = detectReps(p.col.get('l_knee_deg')!, p.col.get('l_knee_vel_deg_s')!, p.fs);
    expect(reps.length).toBe(3);
    for (const r of reps) {
      expect(r.rom).toBeGreaterThan(95);
      expect(r.rom).toBeLessThan(101);
      expect(r.duration).toBeGreaterThan(2);
      expect(r.duration).toBeLessThan(3.1);
      expect(r.peakVelocity).toBeGreaterThan(95);
      expect(r.peakVelocity).toBeLessThan(120);
    }
  });

  it('handles excursions below the baseline and ignores noise', () => {
    const v = Float64Array.from({ length: 600 }, (_, i) => 170 - 60 * Math.max(0, Math.sin((2 * Math.PI * i) / 200)) + 0.5 * Math.sin(i));
    expect(detectReps(v, new Float64Array(600), 60).length).toBe(3);
    const flat = Float64Array.from({ length: 300 }, (_, i) => 10 + 0.5 * Math.sin(i));
    expect(detectReps(flat, new Float64Array(300), 60, 10).length).toBe(0);
  });

  it('computes symmetry index and summary statistics', () => {
    expect(symmetryIndex(100, 100)).toBe(0);
    expect(symmetryIndex(110, 90)).toBeCloseTo(20);
    expect(Number.isNaN(symmetryIndex(NaN, 1))).toBe(true);
    expect(rangeOf([NaN, 2, 5, -1]).rom).toBe(6);
    expect(peakAbs([1, -7, NaN, 3])).toBe(7);
  });

  it('detects the shoulder asymmetry in the frontal demo', () => {
    const p = processTrial(record('raise', 8, 60), { ...base, cutoff: 6, angles: ['l_shoulder', 'r_shoulder'], points: [] });
    const si = symmetryIndex(rangeOf(p.col.get('l_shoulder_deg')!).rom, rangeOf(p.col.get('r_shoulder_deg')!).rom);
    expect(si).toBeCloseTo((100 * (140 - 160)) / 150, 0);
  });
});

describe('jump analysis', () => {
  const jump = (fps: number) => {
    const p = processTrial(record('jump', 3, fps), { ...base, cutoff: 10, angles: [], points: ['l_toe', 'com'] });
    return detectJumps(p.t, p.col.get('l_toe_y_m_raw')!, 0.02, p.col.get('com_y_m')!, true);
  };

  it('recovers flight time and height at 120 Hz', () => {
    const j = jump(120);
    expect(j.length).toBe(1);
    // A 2 cm threshold removes ~8 ms at each end of a 0.5 s flight.
    expect(j[0].flightTime).toBeGreaterThan(SYNTH.jumpFlight - 0.03);
    expect(j[0].flightTime).toBeLessThan(SYNTH.jumpFlight + 0.005);
    expect(j[0].heightFlight).toBeCloseTo((G * SYNTH.jumpFlight ** 2) / 8, 1);
    expect(j[0].takeoff).toBeCloseTo(0.8, 1);
  });

  it('reports coarser resolution at 30 Hz and stays within it', () => {
    const j = jump(30);
    expect(j.length).toBe(1);
    expect(j[0].heightResolution).toBeGreaterThan(0.03);
    expect(Math.abs(j[0].heightFlight - (G * SYNTH.jumpFlight ** 2) / 8)).toBeLessThan(2 * j[0].heightResolution);
    expect(j[0].heightCom).toBeGreaterThan(0.15);
  });

  it('ignores trials without a jump', () => {
    const p = processTrial(record('squat', 3, 60, 0, 0.5), { ...base, cutoff: 6, angles: [], points: ['l_toe'] });
    expect(detectJumps(p.t, p.col.get('l_toe_y_m_raw')!, 0.02).length).toBe(0);
  });
});

describe('residual analysis', () => {
  it('residual falls with cutoff and suggests a cutoff between signal and Nyquist', () => {
    const fs = 60;
    let seed = 3;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 2;
    const raw = Float64Array.from({ length: 600 }, (_, i) => 50 * Math.sin((2 * Math.PI * 1 * i) / fs) + 10 * Math.sin((2 * Math.PI * 3 * i) / fs) + rand());
    const r = residualAnalysis(raw, fs);
    expect(r.residuals[0]).toBeGreaterThan(r.residuals[r.residuals.length - 1]);
    expect(r.suggested).toBeGreaterThan(3);
    expect(r.suggested).toBeLessThan(12);
  });
});

describe('setup coach', () => {
  const input = (activity: 'squat' | 'raise', over = {}) => {
    const f = syntheticFrame(0, activity);
    return { lm: f.lm, world: f.world, w: f.w, h: f.h, fps: 30, expectedView: null, tiltDeg: null, ...over };
  };
  const status = (checks: ReturnType<typeof coachChecks>, id: string) => checks.find((c) => c.id === id)?.status;

  it('classifies frontal and sagittal views from 3D landmarks', () => {
    expect(classifyView(bodyYaw(syntheticFrame(0, 'raise').world))).toBe('frontal');
    expect(classifyView(bodyYaw(syntheticFrame(0, 'squat').world))).toBe('sagittal');
    expect(classifyView(45)).toBe('oblique');
    expect(classifyView(NaN)).toBe('unknown');
  });

  it('passes a good setup and flags problems', () => {
    const good = coachChecks(input('raise'));
    expect(good.filter((c) => c.status === 'fail').length).toBe(0);
    expect(status(coachChecks(input('raise', { lm: null })), 'person')).toBe('fail');
    expect(status(coachChecks(input('raise', { fps: 12 })), 'fps')).toBe('fail');
    expect(status(coachChecks(input('raise', { expectedView: 'sagittal' })), 'plane')).toBe('warn');
    expect(status(coachChecks(input('raise', { tiltDeg: 12 })), 'level')).toBe('fail');
    const cut = input('raise');
    cut.lm![L.l_ankle].y = cut.h + 5;
    expect(status(coachChecks(cut), 'frame')).toBe('fail');
    const oblique = input('raise');
    oblique.world![L.l_shoulder].z = 0.19; oblique.world![L.r_shoulder].z = -0.19;
    oblique.world![L.l_hip].z = 0.12; oblique.world![L.r_hip].z = -0.12;
    expect(status(coachChecks(oblique), 'plane')).toBe('fail');
  });
});

describe('live engine', () => {
  it('tracks the knee angle with small lag and estimates velocity', () => {
    const live = new LiveEngine();
    const s = { angles: ['l_knee'], points: ['l_hip' as const], convention: 'anatomical' as const, minVisibility: 0.5, bodyModel: 'average' as const, calibration: defaultCalibration(SYNTH.height), include3d: true };
    const meter = new FpsMeter();
    let maxErr = 0, sample;
    for (let i = 0; i < 180; i++) {
      const t = i / 60;
      meter.add(t);
      sample = live.process(syntheticFrame(t, 'squat'), s);
      if (i > 30) maxErr = Math.max(maxErr, Math.abs(sample.angles.get('l_knee')!.value - (180 - squatKneeIncluded(t))));
    }
    expect(maxErr).toBeLessThan(8);
    expect(meter.fps).toBeCloseTo(60, 5);
    expect(sample!.com).not.toBeNull();
    expect(Number.isFinite(sample!.points.get('l_hip')!.speed)).toBe(true);
    expect(Number.isFinite(sample!.angles.get('l_knee')!.value3d)).toBe(true);
    const lost = live.process({ t: 3.1, w: 1, h: 1, lm: null, world: null }, s);
    expect(lost.angles.size).toBe(0);
  });
});
