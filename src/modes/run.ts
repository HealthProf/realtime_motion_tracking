// Running gait analysis for a runner on a treadmill. The measurement set follows the 2D video
// framework of Souza (2016); that paper states that no injury cutoffs exist for these variables.
import { processTrial, type Processed } from '../capture/process';
import type { Trial } from '../capture/trial';
import { nearSide, sideName, type ModeInputs } from './bike';
import { at, coverage, findExtrema, stat } from './cycles';
import { ANGLE_BAND, CITATIONS, REFERENCES, row, withheld, type MetricRow, type ModeOption, type ModeReport } from './report';

const DEG = 180 / Math.PI;
const MIN_COVERAGE = 0.8;
const CAVEATS = [
  'Keypoints are model estimates. Published 2D joint-angle errors for this type of model are about 5 deg or more, and the foot keypoints are among the least certain.',
  'Foot contact and toe-off are detected from foot position relative to the pelvis, a method validated for walking (Zeni et al., 2008), not running. It is unvalidated on real runners in this tool.',
  'The source framework states that no cutoffs for abnormal running kinematics exist, and that changing running form in uninjured runners is not evidence-based. Treat the options as things to explore, not corrections.',
  'This tool cannot assess pain or injury.',
];

export type StrikeClass = 'rearfoot' | 'midfoot' | 'forefoot';
/** Foot-strike class from the foot-strike angle (Altman & Davis, 2012): RFS > 8 deg, FFS < -1.6 deg. */
export function strikeClass(fsa: number): StrikeClass {
  return fsa > 8 ? 'rearfoot' : fsa < -1.6 ? 'forefoot' : 'midfoot';
}

export interface GaitEvents {
  /** Fractional sample indices. contacts[k] pairs with toeOffs[k]. */
  contacts: number[];
  toeOffs: number[];
}

/**
 * Initial contact = furthest-forward position of the heel relative to the pelvis; toe-off = furthest-back
 * position of the toe relative to the pelvis (coordinate-based method adapted from Zeni et al., 2008).
 */
export function gaitEvents(heelFwd: ArrayLike<number>, toeFwd: ArrayLike<number>): GaitEvents {
  const span = (v: ArrayLike<number>) => { const f = Array.prototype.filter.call(v, Number.isFinite) as number[]; return f.length ? Math.max(...f) - Math.min(...f) : 0; };
  const ic = findExtrema(heelFwd, 0.3 * span(heelFwd)).maxima;
  const to = findExtrema(toeFwd, 0.3 * span(toeFwd)).minima;
  const contacts: number[] = [], toeOffs: number[] = [];
  for (let k = 0; k < ic.length; k++) {
    const next = ic[k + 1] ?? Infinity;
    const t = to.find((i) => i > ic[k] && i < next);
    if (t !== undefined) { contacts.push(ic[k]); toeOffs.push(t); }
  }
  return { contacts, toeOffs };
}

function base(trial: Trial, i: ModeInputs, angles: string[], points: string[]): Processed {
  return processTrial(trial, { cutoff: i.cutoff, angles, points: points as never, convention: 'anatomical', minVisibility: i.minVisibility, bodyModel: i.bodyModel, maxGap: 0.25, include3d: false });
}

export function runSideReport(trial: Trial, inp: ModeInputs): ModeReport {
  const s = nearSide(trial);
  const p = base(trial, inp, [`${s}_knee`, 'trunk_lean'], [`${s}_heel`, `${s}_toe`, `${s}_ankle`, `${s}_knee`, `${s}_hip`, 'mid_hip', 'com']);
  const u = p.lengthUnit, fs = p.fs;
  const c = (name: string) => p.col.get(name)!;
  const X = (pt: string) => c(`${pt}_x_${u}`), Y = (pt: string) => c(`${pt}_y_${u}`);
  const rows: MetricRow[] = [];
  const options: ModeOption[] = [];
  const caveats = [...CAVEATS];
  const report = (cycles: number): ModeReport => ({ mode: 'run', view: 'side', title: 'Running gait: side view', side: sideName(s), cycles, fs, rows, options, caveats });
  const lowCoverage = [`${s}_heel`, `${s}_toe`, `${s}_ankle`, `${s}_knee`, `${s}_hip`].some((pt) => coverage(p.col.get(`${pt}_x_${u}`)) < MIN_COVERAGE);
  if (lowCoverage) {
    rows.push(withheld('step_rate', 'Step rate', 'steps/min', `The ${sideName(s)} leg and foot were not tracked confidently for at least ${MIN_COVERAGE * 100} % of the trial.`));
    return report(0);
  }
  const heelX = X(`${s}_heel`), toeX = X(`${s}_toe`), heelY = Y(`${s}_heel`), toeY = Y(`${s}_toe`);
  const facing = Math.sign(stat(Array.from(toeX, (x, k) => x - heelX[k])).mean) || 1;
  // Events use unfiltered positions: low-pass filtering rounds off the sharp reversals at contact and
  // toe-off and lengthens the apparent contact time (about 30 ms in this tool's synthetic tests).
  const R = (pt: string) => c(`${pt}_x_${u}_raw`);
  const pel = R('mid_hip'), heelRaw = R(`${s}_heel`), toeRaw = R(`${s}_toe`);
  const ev = gaitEvents(Float64Array.from(heelRaw, (x, k) => (x - pel[k]) * facing), Float64Array.from(toeRaw, (x, k) => (x - pel[k]) * facing));
  const nStr = ev.contacts.length;
  if (nStr < 4) {
    rows.push(withheld('step_rate', 'Step rate', 'steps/min', 'Fewer than 4 strides were found. Record at least 15 seconds of steady treadmill running in a side view.'));
    return report(nStr);
  }
  if (fs < 50) caveats.push(`The frame rate was ${fs.toFixed(0)} Hz. One frame is ${(1000 / fs).toFixed(0)} ms, a large fraction of a ground contact, so timing values are coarse. Use 60 fps or more if the camera allows.`);
  if (nStr < 10) caveats.push(`Only ${nStr} strides were analysed. Twenty or more give a steadier average.`);

  const strideT = ev.contacts.slice(1).map((v, k) => (v - ev.contacts[k]) / fs).filter((t) => t > 0.3 && t < 1.5);
  const stride = stat(strideT);
  const stepRate = stat(strideT.map((t) => 120 / t));
  const contact = stat(ev.contacts.map((v, k) => (ev.toeOffs[k] - v) / fs));
  const res = 1000 / fs;
  rows.push(row('step_rate', 'Step rate', 'steps/min', stepRate, 0, { note: 'Twice the stride rate of the tracked leg (assumes left and right steps are alike).' }));
  rows.push(row('contact', 'Ground contact time', 'ms', { mean: contact.mean * 1000, sd: contact.sd * 1000, n: contact.n }, 0, { note: `Resolved to about +-${res.toFixed(0)} ms (one frame).` }));
  rows.push(row('duty', 'Duty factor (contact / stride)', '%', { mean: (100 * contact.mean) / stride.mean, sd: NaN, n: contact.n }, 0));
  rows.push(row('flight', 'Flight time per step (estimated)', 'ms', { mean: (stride.mean / 2 - contact.mean) * 1000, sd: NaN, n: contact.n }, 0, { note: 'Half the stride time minus contact time; assumes symmetry.' }));

  // Foot-strike angle: foot angle at contact minus the foot-flat angle at mid-stance.
  const footAng = Float64Array.from(heelX, (_, k) => Math.atan2(toeY[k] - heelY[k], (toeX[k] - heelX[k]) * facing) * DEG);
  const ankX = X(`${s}_ankle`), ankY = Y(`${s}_ankle`), kneeX = X(`${s}_knee`), kneeY = Y(`${s}_knee`), hipX = X(`${s}_hip`), hipY = Y(`${s}_hip`);
  const knee = c(`${s}_knee_deg`), com = p.col.get(`com_x_${u}`), comY = p.col.get(`com_y_${u}`);
  const leg = stat(Array.from(ankX, (_, k) => Math.hypot(hipX[k] - kneeX[k], hipY[k] - kneeY[k]) + Math.hypot(kneeX[k] - ankX[k], kneeY[k] - ankY[k]))).mean;
  const fsa: number[] = [], shank: number[] = [], kneeIc: number[] = [], kneePk: number[] = [], over: number[] = [], ahead: number[] = [], thighTo: number[] = [];
  ev.contacts.forEach((ic, k) => {
    const to = ev.toeOffs[k];
    let mid = (ic + to) / 2;
    for (let i = Math.ceil(ic); i < to; i++) if ((ankX[i] - hipX[i]) * facing <= 0) { mid = i; break; }
    fsa.push(at(footAng, ic) - at(footAng, mid));
    shank.push(Math.atan2((at(ankX, ic) - at(kneeX, ic)) * facing, at(kneeY, ic) - at(ankY, ic)) * DEG);
    kneeIc.push(at(knee, ic));
    let pk = -Infinity;
    // Mid-stance peak: search the first 60 % of stance so knee flexion for swing at toe-off is excluded.
    for (let i = Math.ceil(ic); i <= Math.floor(ic + 0.6 * (to - ic)); i++) if (Number.isFinite(knee[i])) pk = Math.max(pk, knee[i]);
    kneePk.push(pk);
    ahead.push((100 * (at(ankX, ic) - at(hipX, ic)) * facing) / leg);
    if (com) over.push((100 * (at(ankX, ic) - at(com, ic)) * facing) / leg);
    thighTo.push(Math.atan2(-(at(kneeX, to) - at(hipX, to)) * facing, at(hipY, to) - at(kneeY, to)) * DEG);
  });
  const sFsa = stat(fsa), sShank = stat(shank), sPk = stat(kneePk), sAhead = stat(ahead);
  const cls = strikeClass(sFsa.mean);
  rows.push(row('fsa', 'Foot-strike angle', 'deg', sFsa, 1, { note: `Classified as ${cls} strike (rearfoot above 8 deg, forefoot below -1.6 deg; thresholds from 9 midfoot strikes in 20 runners). Foot-flat is taken from mid-stance here, not from standing as in the source.` }));
  rows.push(row('shank', 'Shank angle at contact', 'deg', sShank, 1, { note: 'Positive = ankle ahead of the knee ("extended tibia"). The source describes vertical or flexed as preferable for impact-related injuries, without a cutoff.' }));
  rows.push(row('knee_ic', 'Knee flexion at contact', 'deg', stat(kneeIc)));
  rows.push(row('knee_peak', 'Peak knee flexion in stance', 'deg', sPk, 1, { ref: REFERENCES.runKneePeak, band: ANGLE_BAND }));
  rows.push(row('ankle_ahead', 'Ankle ahead of the hip at contact', '% of leg length', sAhead, 1, { note: 'Larger values indicate reaching (overstriding). The source uses a yes/no check of whether a vertical line from the ankle falls within the pelvis.' }));
  if (com && coverage(com) >= MIN_COVERAGE) rows.push(row('ankle_com', 'Ankle ahead of the centre of mass at contact', '% of leg length', stat(over), 1, { note: 'Centre of mass is a body-model estimate.' }));
  rows.push(row('thigh_to', 'Thigh behind vertical at toe-off', 'deg', stat(thighTo), 1, { note: 'A surrogate for hip extension in late stance. No target: the source says the optimal amount is unknown.' }));
  if (coverage(c('trunk_lean_deg')) >= MIN_COVERAGE) rows.push(row('trunk', 'Forward trunk lean', 'deg', stat(Array.from(c('trunk_lean_deg'), (v) => v * facing).filter(Number.isFinite)), 1));
  if (comY && coverage(comY) >= MIN_COVERAGE) {
    const osc: number[] = [];
    for (let k = 1; k < ev.contacts.length; k++) {
      const seg = Array.from(comY.slice(Math.ceil(ev.contacts[k - 1]), Math.floor(ev.contacts[k]) + 1)).filter(Number.isFinite);
      if (seg.length > 3) osc.push(Math.max(...seg) - Math.min(...seg));
    }
    const o = stat(osc);
    rows.push(u === 'm' ? row('osc', 'Vertical movement of the centre of mass', 'cm', { mean: o.mean * 100, sd: o.sd * 100, n: o.n }) : row('osc', 'Vertical movement of the centre of mass', '% of leg length', { mean: (100 * o.mean) / leg, sd: (100 * o.sd) / leg, n: o.n }, 1, { note: 'Calibrate to report centimetres.' }));
  }
  if (inp.speedKmh && inp.speedKmh > 0) rows.push(row('step_length', 'Step length (from the speed you entered)', 'm', { mean: (inp.speedKmh / 3.6) * (60 / stepRate.mean), sd: NaN, n: 1 }, 2));

  const reaching = sShank.mean > ANGLE_BAND && cls === 'rearfoot';
  if (reaching) options.push({
    text: 'Try a step rate 5 to 10 % higher than this trial at the same treadmill speed, then re-measure. Shorter, quicker steps usually bring the foot closer under the body.',
    because: `The shank was angled forward at contact (${sShank.mean.toFixed(0)} deg) with a heel-first landing (${sFsa.mean.toFixed(0)} deg) and the ankle ${sAhead.mean.toFixed(0)} % of leg length ahead of the hip: a pattern the source groups under overstriding. In the cited study a 5-10 % increase from the runner's own preferred rate reduced knee and hip loading. There is no universal target such as 180 steps/min.`,
    citation: CITATIONS.heiderscheit,
  });
  const kp = rows.find((r) => r.id === 'knee_peak')!;
  if (kp.status === 'low') options.push({ text: 'Peak knee flexion in stance was well below the typical value of about 45 deg. If the runner has knee pain or impact-related symptoms, this is worth discussing with a clinician; a slightly higher step rate is one thing they may trial.', because: `Peak stance knee flexion averaged ${sPk.mean.toFixed(0)} deg.`, citation: CITATIONS.souza });
  if (!options.length) options.push({ text: 'Nothing in this trial meets the tool\'s criteria for suggesting a change. That is not a finding that the gait is optimal: most variables here have no established cutoffs.', because: 'Stated so that absence of a flag is not read as approval.', citation: CITATIONS.souza });
  options.push({ text: 'Foot-strike pattern is reported for description only. The source finds limited evidence that any one pattern is more or less likely to cause injury.', because: `This runner was classified as ${cls} strike.`, citation: CITATIONS.souza });
  return report(nStr);
}

/** Back (or front) view: pelvic drop, step width, knee separation, trunk side lean. Descriptive. */
export function runBackReport(trial: Trial, inp: ModeInputs): ModeReport {
  const pts = ['l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_heel', 'r_heel', 'l_shoulder', 'r_shoulder'];
  const p = base(trial, inp, ['trunk_lean'], pts);
  const u = p.lengthUnit;
  const X = (pt: string) => p.col.get(`${pt}_x_${u}`)!, Y = (pt: string) => p.col.get(`${pt}_y_${u}`)!;
  const rows: MetricRow[] = [];
  const caveats = [CAVEATS[0], CAVEATS[2], CAVEATS[3], 'The source reports that 2D pelvic drop is reliable between sessions but agrees poorly with 3D measurement. Use it for left/right and before/after comparison only.', 'Keypoints are joint centres, so "knee separation" is centre to centre and does not show whether the knees touch.'];
  const rep = (cycles: number): ModeReport => ({ mode: 'run', view: 'front-back', title: 'Running gait: back or front view', side: 'both', cycles, fs: p.fs, rows, options: [{ text: 'Compare left with right, and compare before with after any change. Feet landing across the midline, or one hip dropping clearly more than the other, are the patterns the source framework suggests looking into.', because: 'No cutoffs exist for these variables.', citation: CITATIONS.souza }], caveats });
  if (pts.some((pt) => coverage(p.col.get(`${pt}_x_${u}`)) < MIN_COVERAGE)) {
    rows.push(withheld('pelvic_drop', 'Pelvic drop', 'deg', 'Hips, knees, heels or shoulders were not tracked confidently enough. Tight clothing and a full view from behind help.'));
    return rep(0);
  }
  const n = p.t.length;
  const hipW = stat(Array.from({ length: n }, (_, k) => Math.abs(X('l_hip')[k] - X('r_hip')[k]))).mean;
  const legLen = stat(Array.from({ length: n }, (_, k) => Math.abs(Y('l_hip')[k] - Y('l_heel')[k]))).mean;
  // Stance side: the foot that is clearly lower. Runs of at least 3 samples count as a stance phase.
  const stance: ('l' | 'r' | null)[] = Array.from({ length: n }, (_, k) => {
    const d = Y('l_heel')[k] - Y('r_heel')[k];
    return !Number.isFinite(d) ? null : d < -0.03 * legLen ? 'l' : d > 0.03 * legLen ? 'r' : null;
  });
  const drop: Record<'l' | 'r', number[]> = { l: [], r: [] }, footX: Record<'l' | 'r', number[]> = { l: [], r: [] };
  let k = 0;
  while (k < n) {
    const sd = stance[k];
    let e = k;
    while (e < n && stance[e] === sd) e++;
    if (sd && e - k >= 3) {
      const other = sd === 'l' ? 'r' : 'l';
      let peak = -Infinity, fx = 0;
      for (let i = k; i < e; i++) {
        // Positive when the swing-side hip is lower than the stance-side hip.
        peak = Math.max(peak, Math.atan2(Y(`${sd}_hip`)[i] - Y(`${other}_hip`)[i], Math.abs(X('l_hip')[i] - X('r_hip')[i])) * DEG);
        fx += X(`${sd}_heel`)[i] - (X('l_hip')[i] + X('r_hip')[i]) / 2;
      }
      drop[sd].push(peak);
      footX[sd].push(fx / (e - k));
    }
    k = Math.max(e, k + 1);
  }
  const steps = Math.min(drop.l.length, drop.r.length);
  if (steps < 3) {
    rows.push(withheld('pelvic_drop', 'Pelvic drop', 'deg', 'Fewer than 3 steps per side were found. Record at least 15 seconds of treadmill running from directly behind.'));
    return rep(steps);
  }
  const dl = stat(drop.l), dr = stat(drop.r);
  rows.push(row('drop_l', 'Pelvic drop during left stance (right hip lower)', 'deg', dl));
  rows.push(row('drop_r', 'Pelvic drop during right stance (left hip lower)', 'deg', dr));
  rows.push(row('drop_diff', 'Left-stance minus right-stance pelvic drop', 'deg', { mean: dl.mean - dr.mean, sd: NaN, n: 1 }));
  // Step width: separation of the feet in the direction that keeps each foot on its own side.
  const sideSign = Math.sign(stat(Array.from({ length: n }, (_, i) => X('l_hip')[i] - X('r_hip')[i])).mean) || 1;
  const width = ((stat(footX.l).mean - stat(footX.r).mean) * sideSign * 100) / hipW;
  rows.push(row('step_width', 'Step width (heel centres)', '% of hip width', { mean: width, sd: NaN, n: steps }, 0, { note: width <= 0 ? 'The feet land across the midline (cross-over).' : 'Positive = each foot lands on its own side of the midline.' }));
  const sep = Array.from({ length: n }, (_, i) => ((X('l_knee')[i] - X('r_knee')[i]) * sideSign * 100) / hipW).filter(Number.isFinite);
  rows.push(row('knee_sep', 'Smallest knee separation (centres)', '% of hip width', { mean: Math.min(...sep), sd: NaN, n: 1 }, 0));
  const lean = Array.from(p.col.get('trunk_lean_deg')!).filter(Number.isFinite);
  if (lean.length) rows.push(row('trunk_side', 'Trunk side-to-side lean range', 'deg', { mean: Math.max(...lean) - Math.min(...lean), sd: NaN, n: 1 }));
  return rep(steps);
}
