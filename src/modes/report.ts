// Mode reports: measurements compared against published reference ranges, with the uncertainty
// of this tool stated, and adjustments offered as options to try and re-measure.
import type { Stat } from './cycles';

export interface Reference {
  id: string;
  low: number | null;
  high: number | null;
  unit: string;
  /** What the range is and the conditions under which it was reported. */
  basis: string;
  citation: string;
  doi: string;
}

/** Every range here was checked against the cited source (abstract or full text) before inclusion. */
export const REFERENCES = {
  bikeKneeBdc: {
    id: 'bikeKneeBdc', low: 30, high: 40, unit: 'deg',
    basis: 'Knee flexion measured dynamically (2D video) while pedalling; well-trained male road cyclists.',
    citation: 'Ferrer-Roca et al. (2012) J Strength Cond Res 26(11):3025-9', doi: '10.1519/JSC.0b013e318245c09d',
  },
  saddleInseam: {
    id: 'saddleInseam', low: 106, high: 109, unit: '% of inseam',
    basis: 'Conventional saddle-height guideline. The same study found it often fails to produce a 30-40 deg knee angle.',
    citation: 'Ferrer-Roca et al. (2012) J Strength Cond Res 26(11):3025-9', doi: '10.1519/JSC.0b013e318245c09d',
  },
  runKneePeak: {
    id: 'runKneePeak', low: 40, high: null, unit: 'deg',
    basis: 'Typical peak stance knee flexion approaches about 45 deg; under 40 deg has been associated with some patellofemoral pain subgroups. The source states that no injury cutoffs exist.',
    citation: 'Souza (2016) Phys Med Rehabil Clin N Am 27(1):217-36', doi: '10.1016/j.pmr.2015.08.006',
  },
} satisfies Record<string, Reference>;

export const CITATIONS = {
  altman: { citation: 'Altman & Davis (2012) Gait Posture 35(2):298-300', doi: '10.1016/j.gaitpost.2011.09.104' },
  souza: { citation: 'Souza (2016) Phys Med Rehabil Clin N Am 27(1):217-36', doi: '10.1016/j.pmr.2015.08.006' },
  heiderscheit: { citation: 'Heiderscheit et al. (2011) Med Sci Sports Exerc 43(2):296-302', doi: '10.1249/MSS.0b013e3181ebedf4' },
  zeni: { citation: 'Zeni et al. (2008) Gait Posture 27(4):710-4', doi: '10.1016/j.gaitpost.2007.07.007' },
  ferrer: { citation: REFERENCES.bikeKneeBdc.citation, doi: REFERENCES.bikeKneeBdc.doi },
};

export type Status = 'in' | 'borderline-low' | 'borderline-high' | 'low' | 'high' | 'none' | 'withheld';

export interface MetricRow {
  id: string;
  label: string;
  unit: string;
  mean: number;
  sd: number;
  n: number;
  digits: number;
  /** Assumed measurement uncertainty of this tool for the metric (same unit), if a range is compared. */
  band?: number;
  ref?: Reference;
  status: Status;
  note?: string;
}

export interface ModeOption {
  text: string;
  because: string;
  citation?: { citation: string; doi: string };
}

export interface ModeReport {
  mode: 'bike' | 'run';
  view: 'side' | 'front-back';
  title: string;
  side: string;
  cycles: number;
  fs: number;
  rows: MetricRow[];
  options: ModeOption[];
  caveats: string[];
}

/**
 * Published 2D errors for this family of pose models are roughly 5 deg or more for joint angles, so a
 * value is only called out of range when it is beyond the limit by more than this band.
 */
export const ANGLE_BAND = 5;

export function classify(value: number, ref: Reference, band: number): Status {
  if (!Number.isFinite(value)) return 'withheld';
  if (ref.low !== null && value < ref.low) return value < ref.low - band ? 'low' : 'borderline-low';
  if (ref.high !== null && value > ref.high) return value > ref.high + band ? 'high' : 'borderline-high';
  return 'in';
}

export const STATUS_TEXT: Record<Status, string> = {
  in: 'within range', 'borderline-low': 'borderline (just below)', 'borderline-high': 'borderline (just above)',
  low: 'below range', high: 'above range', none: 'no reference range', withheld: 'not reported',
};

export function row(id: string, label: string, unit: string, s: Stat, digits = 1, extra: Partial<MetricRow> = {}): MetricRow {
  const r: MetricRow = { id, label, unit, mean: s.mean, sd: s.sd, n: s.n, digits, status: 'none', ...extra };
  if (!Number.isFinite(r.mean)) r.status = 'withheld';
  else if (r.ref) r.status = classify(r.mean, r.ref, r.band ?? 0);
  return r;
}

export const withheld = (id: string, label: string, unit: string, why: string): MetricRow => ({ id, label, unit, mean: NaN, sd: NaN, n: 0, digits: 1, status: 'withheld', note: why });

const n = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d) : '');
const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function reportCsv(r: ModeReport): string {
  const lines = [
    `# ${r.title}`,
    `# cycles analysed: ${r.cycles}; sample rate: ${n(r.fs, 1)} Hz; side: ${r.side}`,
    ...r.caveats.map((c) => `# ${c}`),
    'metric,mean,sd,n,unit,assumed_uncertainty,reference_low,reference_high,status,reference,doi,note',
    ...r.rows.map((m) => [q(m.label), n(m.mean, m.digits + 1), n(m.sd, m.digits + 1), m.n, q(m.unit), m.band ?? '', m.ref?.low ?? '', m.ref?.high ?? '', STATUS_TEXT[m.status], q(m.ref?.citation ?? ''), m.ref?.doi ?? '', q(m.note ?? '')].join(',')),
    '',
    'option_to_try,because,reference,doi',
    ...r.options.map((o) => [q(o.text), q(o.because), q(o.citation?.citation ?? ''), o.citation?.doi ?? ''].join(',')),
  ];
  return lines.join('\n') + '\n';
}
