// Bike fit analysis for a rider on a stationary trainer.
import { processTrial, type Processed } from '../capture/process';
import type { Trial } from '../capture/trial';
import { L } from '../pose/landmarks';
import { at, coverage, findExtrema, fitCircle, stat, upCrossings } from './cycles';
import { ANGLE_BAND, CITATIONS, REFERENCES, row, withheld, type MetricRow, type ModeOption, type ModeReport } from './report';

export interface ModeInputs {
  cutoff: number;
  minVisibility: number;
  bodyModel: 'male' | 'female' | 'average';
  /** Bike: inseam and saddle height (bottom bracket centre to saddle top), cm. Optional. */
  inseamCm?: number;
  saddleCm?: number;
  /** Run: treadmill speed, km/h. Optional. */
  speedKmh?: number;
}

/** Side nearer the camera, from mean keypoint confidence of the leg. */
export function nearSide(trial: Trial): 'l' | 'r' {
  let l = 0, r = 0;
  for (const f of trial.frames) {
    if (!f.lm) continue;
    l += f.lm[L.l_hip].v + f.lm[L.l_knee].v + f.lm[L.l_ankle].v;
    r += f.lm[L.r_hip].v + f.lm[L.r_knee].v + f.lm[L.r_ankle].v;
  }
  return l >= r ? 'l' : 'r';
}

export const sideName = (s: 'l' | 'r') => (s === 'l' ? 'left' : 'right');
const MIN_COVERAGE = 0.8;
const COMMON_CAVEATS = [
  'Keypoints are model estimates. Published 2D joint-angle errors for this type of model are about 5 deg or more, and averaging cycles does not remove a consistent offset.',
  'This tool has not been validated against a professional fitting or gait-analysis system. It cannot assess pain or injury.',
];

function base(trial: Trial, i: ModeInputs, angles: string[], points: string[]): Processed {
  return processTrial(trial, { cutoff: i.cutoff, angles, points: points as never, convention: 'anatomical', minVisibility: i.minVisibility, bodyModel: i.bodyModel, maxGap: 0.25, include3d: false });
}

export function bikeSideReport(trial: Trial, inp: ModeInputs): ModeReport {
  const s = nearSide(trial);
  const p = base(trial, inp, [`${s}_knee`, `${s}_hip`, `${s}_ankle`, `${s}_elbow`, `${s}_shoulder`, 'trunk_lean'], [`${s}_toe`, `${s}_hip`, `${s}_knee`, `${s}_heel`]);
  const u = p.lengthUnit;
  const c = (name: string) => p.col.get(name)!;
  const knee = c(`${s}_knee_deg`), tx = c(`${s}_toe_x_${u}`), ty = c(`${s}_toe_y_${u}`);
  const rows: MetricRow[] = [];
  const options: ModeOption[] = [];
  const caveats = [...COMMON_CAVEATS];
  const report = (cycles: number): ModeReport => ({ mode: 'bike', view: 'side', title: 'Bike fit: side view', side: sideName(s), cycles, fs: p.fs, rows, options, caveats });

  if (coverage(knee) < MIN_COVERAGE || coverage(tx) < MIN_COVERAGE) {
    rows.push(withheld('knee_bdc', 'Knee flexion at the bottom of the stroke', 'deg', `The ${sideName(s)} hip, knee, ankle or foot was not tracked confidently for at least ${MIN_COVERAGE * 100} % of the trial. Check lighting, clothing contrast and that the bike does not hide the leg.`));
    return report(0);
  }

  // Pedal circle from the toe keypoint (the nearest keypoint to the pedal axle).
  const circle = fitCircle(tx, ty);
  const facing = Math.sign(stat(Array.from(tx, (x, k) => x - c(`${s}_heel_x_${u}`)[k])).mean) || 1;
  // Crank angle: 0 at the top, increasing in the pedalling direction, so 180 is bottom dead centre.
  const below = Float64Array.from(tx, (_, k) => circle.cy - ty[k]);
  const fwd = Float64Array.from(tx, (x) => (x - circle.cx) * facing);
  // Bottom dead centre: the foot passes under the pedal-circle centre moving backward.
  const bdc = upCrossings(Float64Array.from(fwd, (v, k) => (below[k] > 0 ? -v : NaN)), 0);
  const ext = findExtrema(knee, 15);
  const cycles = Math.min(bdc.length, ext.maxima.length);
  if (cycles < 3 || !(circle.r > 0) || circle.rms > 0.25 * circle.r) {
    rows.push(withheld('knee_bdc', 'Knee flexion at the bottom of the stroke', 'deg', 'Fewer than 3 clean pedal revolutions were found. Record at least 15 seconds of steady pedalling in a side view.'));
    return report(cycles);
  }
  const periods = bdc.slice(1).map((b, k) => (b - bdc[k]) / p.fs);
  const cadence = stat(periods.map((t) => 60 / t));
  const kneeBdc = stat(bdc.map((i) => at(knee, i)));
  const kneeMin = stat(ext.minima.map((i) => knee[i]));
  const kneeMax = stat(ext.maxima.map((i) => knee[i]));
  if (cycles < 10) caveats.push(`Only ${cycles} pedal revolutions were analysed. Twenty or more give a steadier average.`);

  rows.push(row('cadence', 'Cadence', 'rev/min', cadence, 0));
  rows.push(row('knee_bdc', 'Knee flexion at the bottom of the stroke', 'deg', kneeBdc, 1, { ref: REFERENCES.bikeKneeBdc, band: ANGLE_BAND }));
  rows.push(row('knee_min', 'Smallest knee flexion in the stroke', 'deg', kneeMin, 1, { note: 'Usually occurs just before the bottom of the stroke.' }));
  rows.push(row('knee_max', 'Largest knee flexion (top of the stroke)', 'deg', kneeMax, 1));

  const perCycle = (series: ArrayLike<number>, f: (seg: number[]) => number) => {
    const out: number[] = [];
    for (let k = 1; k < bdc.length; k++) {
      const seg = Array.prototype.slice.call(series, Math.ceil(bdc[k - 1]), Math.floor(bdc[k]) + 1).filter(Number.isFinite) as number[];
      if (seg.length > 3) out.push(f(seg));
    }
    return stat(out);
  };
  const range = (seg: number[]) => Math.max(...seg) - Math.min(...seg);
  const mean = (seg: number[]) => seg.reduce((a, b) => a + b, 0) / seg.length;
  const need = (name: string, id: string, label: string, unit: string, make: () => MetricRow) => rows.push(coverage(p.col.get(name)) >= MIN_COVERAGE ? make() : withheld(id, label, unit, 'Not tracked confidently enough in this trial.'));

  need(`${s}_hip_deg`, 'hip_closed', 'Most closed hip (largest trunk-thigh flexion)', 'deg', () => row('hip_closed', 'Most closed hip (largest trunk-thigh flexion)', 'deg', perCycle(c(`${s}_hip_deg`), (g) => Math.max(...g))));
  need(`${s}_ankle_deg`, 'ankle_range', 'Ankle movement through the stroke', 'deg', () => row('ankle_range', 'Ankle movement through the stroke', 'deg', perCycle(c(`${s}_ankle_deg`), range)));
  need('trunk_lean_deg', 'trunk', 'Trunk angle above horizontal', 'deg', () => row('trunk', 'Trunk angle above horizontal', 'deg', perCycle(c('trunk_lean_deg'), (g) => 90 - Math.abs(mean(g))), 1, { note: 'Mid-hip to mid-shoulder line. Lower is a more aggressive position.' }));
  need(`${s}_shoulder_deg`, 'shoulder', 'Arm-trunk angle', 'deg', () => row('shoulder', 'Arm-trunk angle', 'deg', perCycle(c(`${s}_shoulder_deg`), mean)));
  need(`${s}_elbow_deg`, 'elbow', 'Elbow flexion', 'deg', () => row('elbow', 'Elbow flexion', 'deg', perCycle(c(`${s}_elbow_deg`), mean)));

  const thigh = stat(Array.from(knee, (_, k) => Math.hypot(c(`${s}_hip_x_${u}`)[k] - c(`${s}_knee_x_${u}`)[k], c(`${s}_hip_y_${u}`)[k] - c(`${s}_knee_y_${u}`)[k]))).mean;
  const rock = perCycle(c(`${s}_hip_y_${u}`), range);
  rows.push(row('hip_rock', 'Vertical hip movement per revolution', '% of thigh length', { mean: (100 * rock.mean) / thigh, sd: (100 * rock.sd) / thigh, n: rock.n }, 1, { note: 'Includes keypoint jitter. Compare between trials rather than reading the absolute value.' }));

  // Knee position relative to the foot with the crank forward (descriptive only).
  const forward = upCrossings(Float64Array.from(below, (v, k) => (fwd[k] > 0 ? v : NaN)), 0);
  const kops = stat(forward.map((i) => ((at(c(`${s}_knee_x_${u}`), i) - at(tx, i)) * facing * 100) / thigh));
  rows.push(row('kops', 'Knee ahead of the forefoot, crank forward', '% of thigh length', kops, 1, { note: 'Descriptive only: "knee over pedal spindle" is a convention with weak evidence as a fit target.' }));

  if (inp.inseamCm && inp.saddleCm) {
    rows.push(row('saddle', 'Saddle height you entered', '% of inseam', { mean: (100 * inp.saddleCm) / inp.inseamCm, sd: NaN, n: 1 }, 1, { ref: REFERENCES.saddleInseam, band: 0, note: 'From your tape measurements, not from the camera.' }));
  }

  const k = rows.find((r) => r.id === 'knee_bdc')!;
  const why = `Knee flexion at the bottom of the stroke averaged ${kneeBdc.mean.toFixed(0)} deg (reference 30-40 deg, assumed uncertainty +-${ANGLE_BAND} deg).`;
  if (k.status === 'high') options.push({ text: 'The saddle may be low. Raise it a few millimetres at a time, ride for a few minutes to settle, and re-measure.', because: why, citation: CITATIONS.ferrer });
  else if (k.status === 'low') options.push({ text: 'The saddle may be high. Lower it a few millimetres at a time and re-measure. Hips rocking side to side or reaching for the pedals would support this.', because: why, citation: CITATIONS.ferrer });
  else if (k.status.startsWith('borderline')) options.push({ text: 'The knee angle is close to the edge of the reference range, within this tool\'s uncertainty. Confirm with a goniometer on the rider at the bottom of the stroke before changing the saddle.', because: why, citation: CITATIONS.ferrer });
  else options.push({ text: 'No saddle-height change is suggested by the knee angle. If the rider is uncomfortable, look at other contact points; this tool cannot assess them.', because: why, citation: CITATIONS.ferrer });
  options.push({ text: 'Trunk, arm, elbow and hip angles are reported without targets: suitable values depend on discipline (road, time trial, mountain), flexibility and comfort, and I found no single sourced range to compare against.', because: 'Stated so that absence of a flag is not read as approval.' });
  caveats.push('The reference range comes from well-trained male road cyclists; it may not transfer to other riders or bike types.');
  return report(cycles);
}

/** Front view: side-to-side knee travel relative to the hip-ankle line. Descriptive. */
export function bikeFrontReport(trial: Trial, inp: ModeInputs): ModeReport {
  const pts = ['l_hip', 'l_knee', 'l_ankle', 'r_hip', 'r_knee', 'r_ankle'];
  const p = base(trial, inp, [], pts);
  const u = p.lengthUnit;
  const rows: MetricRow[] = [];
  const travel: Partial<Record<'l' | 'r', number>> = {};
  let cycles = 0;
  for (const s of ['l', 'r'] as const) {
    const g = (n: string) => p.col.get(`${s}_${n}_${u}`)!;
    const label = `${s === 'l' ? 'Left' : 'Right'} knee side-to-side travel`;
    if ([`${s}_hip_x_${u}`, `${s}_knee_x_${u}`, `${s}_ankle_x_${u}`].some((n) => coverage(p.col.get(n)) < MIN_COVERAGE)) { rows.push(withheld(`${s}_knee_travel`, label, '% of leg length', 'Not tracked confidently enough in this trial.')); continue; }
    const dev = new Float64Array(p.t.length);
    let leg = 0, m = 0;
    for (let k = 0; k < dev.length; k++) {
      const hx = g('hip_x')[k], hy = g('hip_y')[k], ax = g('ankle_x')[k], ay = g('ankle_y')[k];
      const len = Math.hypot(ax - hx, ay - hy);
      // Signed perpendicular distance of the knee from the hip-ankle line.
      dev[k] = ((g('knee_x')[k] - hx) * (ay - hy) - (g('knee_y')[k] - hy) * (ax - hx)) / len;
      const l2 = Math.hypot(g('knee_x')[k] - hx, g('knee_y')[k] - hy) + Math.hypot(ax - g('knee_x')[k], ay - g('knee_y')[k]);
      if (Number.isFinite(l2)) { leg += l2; m++; }
    }
    leg /= m || 1;
    const ky = g('knee_y');
    const ex = findExtrema(ky, 0.25 * (Math.max(...Array.from(ky).filter(Number.isFinite)) - Math.min(...Array.from(ky).filter(Number.isFinite))));
    const per: number[] = [];
    for (let k = 1; k < ex.maxima.length; k++) {
      const seg = Array.from(dev.slice(ex.maxima[k - 1], ex.maxima[k] + 1)).filter(Number.isFinite);
      if (seg.length > 3) per.push((100 * (Math.max(...seg) - Math.min(...seg))) / leg);
    }
    cycles = Math.max(cycles, per.length);
    const st = stat(per);
    travel[s] = st.mean;
    rows.push(per.length >= 3 ? row(`${s}_knee_travel`, label, '% of leg length', st) : withheld(`${s}_knee_travel`, label, '% of leg length', 'Fewer than 3 pedal revolutions found.'));
  }
  const options: ModeOption[] = [];
  if (travel.l !== undefined && travel.r !== undefined && Number.isFinite(travel.l) && Number.isFinite(travel.r)) {
    rows.push(row('knee_travel_diff', 'Left minus right knee travel', '% of leg length', { mean: travel.l - travel.r, sd: NaN, n: 1 }));
    options.push({ text: 'Compare the two knees and compare before and after an adjustment. A knee that swings much more than the other is worth a closer look by a fitter (cleat position, saddle height and leg-length difference are common things to check).', because: 'There is no sourced normal range for knee travel in this tool, so only side-to-side and before/after comparisons are meaningful.' });
  }
  return { mode: 'bike', view: 'front-back', title: 'Bike fit: front view', side: 'both', cycles, fs: p.fs, rows, options, caveats: [...COMMON_CAVEATS, 'In a front view the knee moves toward and away from the camera, which the planar measurement cannot see.'] };
}
