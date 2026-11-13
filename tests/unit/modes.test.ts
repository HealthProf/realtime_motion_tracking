import { describe, expect, it } from 'vitest';
import { TrialRecorder, type Trial } from '../../src/capture/trial';
import { bikeFrontReport, bikeSideReport, type ModeInputs } from '../../src/modes/bike';
import { findExtrema, fitCircle, stat, upCrossings } from '../../src/modes/cycles';
import { ANGLE_BAND, classify, REFERENCES, reportCsv } from '../../src/modes/report';
import { gaitEvents, runBackReport, runSideReport, strikeClass } from '../../src/modes/run';
import { L } from '../../src/pose/landmarks';
import { cycleKneeFlexion, runHip, runLeg, SYNTH, syntheticFrame } from '../../src/pose/synthetic';
import { record } from './trial.test';

const inp: ModeInputs = { cutoff: 8, minVisibility: 0.5, bodyModel: 'average' };
const get = (r: ReturnType<typeof bikeSideReport>, id: string) => r.rows.find((x) => x.id === id)!;

describe('cycle helpers', () => {
  it('finds alternating extrema and ignores ripple', () => {
    const v = Float64Array.from({ length: 400 }, (_, i) => 50 * Math.sin((2 * Math.PI * i) / 100) + 2 * Math.sin(i));
    const e = findExtrema(v, 20);
    expect(e.maxima.length).toBe(4);
    expect(e.minima.length).toBe(4);
    expect(Math.abs(e.maxima[0] - 25)).toBeLessThan(4);
  });
  it('fits a circle and finds crossings', () => {
    const x = [], y = [];
    for (let i = 0; i < 60; i++) { x.push(3 + 2 * Math.cos(i / 5)); y.push(-1 + 2 * Math.sin(i / 5)); }
    const c = fitCircle(x, y);
    expect(c.cx).toBeCloseTo(3, 6); expect(c.cy).toBeCloseTo(-1, 6); expect(c.r).toBeCloseTo(2, 6);
    expect(upCrossings([-1, 1, 2, -2, 0.5], 0)).toEqual([0.5, 3.8]);
    expect(stat([1, 2, 3, NaN]).mean).toBe(2);
  });
});

describe('report classification', () => {
  it('uses the uncertainty band to separate borderline from out of range', () => {
    const ref = REFERENCES.bikeKneeBdc;
    expect(classify(35, ref, ANGLE_BAND)).toBe('in');
    expect(classify(27, ref, ANGLE_BAND)).toBe('borderline-low');
    expect(classify(43, ref, ANGLE_BAND)).toBe('borderline-high');
    expect(classify(22, ref, ANGLE_BAND)).toBe('low');
    expect(classify(50, ref, ANGLE_BAND)).toBe('high');
    expect(classify(NaN, ref, ANGLE_BAND)).toBe('withheld');
    expect(classify(60, REFERENCES.runKneePeak, ANGLE_BAND)).toBe('in');
  });
});

describe('bike fit, side view', () => {
  const truthBdc = cycleKneeFlexion(180);
  let truthMin = Infinity, truthMax = -Infinity;
  for (let d = 0; d < 360; d += 0.25) { truthMin = Math.min(truthMin, cycleKneeFlexion(d)); truthMax = Math.max(truthMax, cycleKneeFlexion(d)); }

  it('recovers cadence and knee angles of the synthetic rider', () => {
    const r = bikeSideReport(record('cycle', 12, 60, 0.001, 0.5), inp);
    expect(r.side).toBe('left');
    expect(r.cycles).toBeGreaterThanOrEqual(15);
    expect(get(r, 'cadence').mean).toBeCloseTo(SYNTH.cycleCadence, 0);
    expect(Math.abs(get(r, 'knee_bdc').mean - truthBdc)).toBeLessThan(1.5);
    expect(Math.abs(get(r, 'knee_min').mean - truthMin)).toBeLessThan(1.5);
    expect(Math.abs(get(r, 'knee_max').mean - truthMax)).toBeLessThan(1.5);
    expect(get(r, 'trunk').mean).toBeCloseTo(45, 0);
    expect(get(r, 'knee_bdc').status).toBe(classify(truthBdc, REFERENCES.bikeKneeBdc, ANGLE_BAND));
    expect(r.options.length).toBeGreaterThan(0);
    expect(reportCsv(r)).toContain('10.1519/JSC.0b013e318245c09d');
  });

  it('suggests raising a low saddle and lowering a high one', () => {
    const shifted = (dy: number) => {
      const t = record('cycle', 10, 60);
      // Move the foot keypoints only: equivalent to changing saddle height relative to the pedals.
      for (const f of t.frames) for (const n of ['l_knee', 'l_ankle', 'l_heel', 'l_toe'] as const) f.lm![L[n]].y += dy * (n === 'l_knee' ? 0.5 : 1);
      return bikeSideReport(t, inp);
    };
    const low = shifted(-45), high = shifted(40);
    expect(get(low, 'knee_bdc').mean).toBeGreaterThan(get(high, 'knee_bdc').mean);
    expect(low.options[0].text).toMatch(/saddle may be low/);
    expect(high.options[0].text).toMatch(/saddle may be high|close to the edge/);
  });

  it('withholds results when the leg is not tracked or too few revolutions exist', () => {
    const hidden = record('cycle', 8, 60);
    for (const f of hidden.frames) { f.lm![L.l_knee].v = 0.1; f.lm![L.r_knee].v = 0.1; }
    expect(get(bikeSideReport(hidden, inp), 'knee_bdc').status).toBe('withheld');
    expect(get(bikeSideReport(record('cycle', 1.2, 60), inp), 'knee_bdc').status).toBe('withheld');
  });

  it('reports the saddle-height cross-check from typed measurements', () => {
    const r = bikeSideReport(record('cycle', 8, 60), { ...inp, inseamCm: 80, saddleCm: 88 });
    expect(get(r, 'saddle').mean).toBeCloseTo(110, 5);
    expect(get(r, 'saddle').status).toBe('high');
  });
});

describe('running gait, side view', () => {
  it('detects contact and toe-off of the synthetic runner within one frame', () => {
    const fs = 120, n = 6 * fs;
    const heel = new Float64Array(n), toe = new Float64Array(n);
    for (let i = 0; i < n; i++) { const g = runLeg(i / fs, runHip(i / fs)); heel[i] = g.heel.x; toe[i] = g.toe.x; }
    const ev = gaitEvents(heel, toe);
    expect(ev.contacts.length).toBeGreaterThanOrEqual(7);
    for (let k = 0; k < ev.contacts.length; k++) {
      const tc = ev.contacts[k] / fs, phase = tc - Math.round(tc / SYNTH.runStride) * SYNTH.runStride;
      expect(Math.abs(phase)).toBeLessThanOrEqual(1.5 / fs);
      expect(Math.abs((ev.toeOffs[k] - ev.contacts[k]) / fs - SYNTH.runContact)).toBeLessThanOrEqual(2 / fs);
    }
  });

  it('recovers step rate, contact time and foot-strike angle', () => {
    const r = runSideReport(record('run', 12, 120, 0.0005, 0.3), { ...inp, cutoff: 12, speedKmh: 9 });
    expect(r.cycles).toBeGreaterThanOrEqual(14);
    expect(get(r, 'step_rate').mean).toBeCloseTo(120 / SYNTH.runStride, 0);
    expect(Math.abs(get(r, 'contact').mean - SYNTH.runContact * 1000)).toBeLessThan(20);
    // Filtering rounds off the instant of contact, so the strike angle is underestimated slightly.
    expect(get(r, 'fsa').mean).toBeGreaterThan(SYNTH.runStrikeAngle - 4);
    expect(get(r, 'fsa').mean).toBeLessThan(SYNTH.runStrikeAngle + 2);
    expect(get(r, 'fsa').note).toMatch(/rearfoot/);
    expect(get(r, 'knee_peak').mean).toBeGreaterThan(40);
    expect(get(r, 'knee_peak').mean).toBeLessThan(52);
    expect(get(r, 'step_length').mean).toBeCloseTo((9 / 3.6) * (SYNTH.runStride / 2), 1);
    expect(get(r, 'osc').unit).toBe('cm');
    expect(get(r, 'osc').mean).toBeGreaterThan(3);
    expect(get(r, 'osc').mean).toBeLessThan(9);
    expect(r.caveats.join(' ')).toMatch(/not evidence-based/);
  });

  it('warns about coarse timing at 30 Hz and withholds on too few strides', () => {
    expect(runSideReport(record('run', 10, 30), inp).caveats.join(' ')).toMatch(/frame rate was 30/);
    expect(get(runSideReport(record('run', 1.5, 60), inp), 'step_rate').status).toBe('withheld');
  });

  it('classifies foot strike by the published thresholds', () => {
    expect(strikeClass(12)).toBe('rearfoot');
    expect(strikeClass(3)).toBe('midfoot');
    expect(strikeClass(-5)).toBe('forefoot');
  });
});

/** Minimal frontal-plane trial built by hand: pelvis tilts and feet alternate. */
function frontal(kind: 'run' | 'bike', dropL = 6, dropR = 2): Trial {
  const rec = new TrialRecorder();
  const m = record('raise', 0.1).meta;
  rec.start(m);
  const fps = 60, T = 0.7;
  for (let i = 0; i < 8 * fps; i++) {
    const t = i / fps, f = syntheticFrame(0, 'raise');
    f.t = t;
    const lm = f.lm!, ph = Math.sin((2 * Math.PI * t) / T);
    const px = SYNTH.pxPerMetre;
    if (kind === 'run') {
      // Left stance when ph > 0: left heel down, right heel lifted, right hip drops by dropL degrees.
      lm[L.l_heel].y -= ph < 0 ? 0.2 * px * -ph : 0;
      lm[L.r_heel].y -= ph > 0 ? 0.2 * px * ph : 0;
      const w = Math.abs(lm[L.l_hip].x - lm[L.r_hip].x);
      const tilt = ph > 0 ? Math.tan((dropL * Math.PI) / 180) * ph : Math.tan((dropR * Math.PI) / 180) * ph;
      lm[L.r_hip].y += (w * tilt) / 2;
      lm[L.l_hip].y -= (w * tilt) / 2;
    } else {
      lm[L.l_knee].y -= 0.15 * px * (1 + ph); lm[L.r_knee].y -= 0.15 * px * (1 - ph);
      lm[L.l_knee].x += 0.05 * px * Math.cos((2 * Math.PI * t) / T);
      lm[L.r_knee].x += 0.01 * px * Math.cos((2 * Math.PI * t) / T);
    }
    rec.add(f);
  }
  return rec.stop()!;
}

describe('front and back views', () => {
  it('measures pelvic drop per side and step width', () => {
    const r = runBackReport(frontal('run'), inp);
    expect(get(r, 'drop_l').mean).toBeCloseTo(6, 0);
    expect(get(r, 'drop_r').mean).toBeCloseTo(2, 0);
    expect(get(r, 'drop_diff').mean).toBeCloseTo(4, 0);
    expect(get(r, 'step_width').mean).toBeGreaterThan(50);
    expect(r.caveats.join(' ')).toMatch(/agrees poorly with 3D/);
  });
  it('measures knee travel asymmetry on the bike', () => {
    const r = bikeFrontReport(frontal('bike'), inp);
    expect(get(r, 'l_knee_travel').mean).toBeGreaterThan(3 * get(r, 'r_knee_travel').mean);
    expect(get(r, 'knee_travel_diff').mean).toBeGreaterThan(0);
  });
});
