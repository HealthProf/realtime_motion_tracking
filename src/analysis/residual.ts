// Residual analysis for choosing a low-pass cutoff (Winter, Biomechanics and Motor Control of Human
// Movement, 4th ed., section 3.4.4.3).
import { filtfiltGaps } from '../kinematics/butterworth';

export interface ResidualAnalysis {
  cutoffs: number[];
  /** RMS difference between the raw and filtered signal at each cutoff. */
  residuals: number[];
  /** Intercept and slope of the line fitted to the high-cutoff (noise-only) region. */
  line: { intercept: number; slope: number };
  /** Cutoff at which the residual equals the noise intercept, or NaN if it cannot be determined. */
  suggested: number;
}

export function residualAnalysis(raw: ArrayLike<number>, fs: number, maxCutoff = Math.min(20, 0.4 * fs), step = 0.5): ResidualAnalysis {
  const cutoffs: number[] = [], residuals: number[] = [];
  for (let fc = 1; fc <= maxCutoff + 1e-9; fc += step) {
    const f = filtfiltGaps(raw, fc, fs);
    let s = 0, n = 0;
    for (let i = 0; i < f.length; i++) if (Number.isFinite(f[i])) { s += (raw[i] - f[i]) ** 2; n++; }
    if (!n) continue;
    cutoffs.push(fc);
    residuals.push(Math.sqrt(s / n));
  }
  const k = cutoffs.length;
  if (k < 6) return { cutoffs, residuals, line: { intercept: NaN, slope: NaN }, suggested: NaN };
  // Fit the upper half of the cutoff range, where the residual should be noise only.
  const from = Math.floor(k / 2);
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = from; i < k; i++) { sx += cutoffs[i]; sy += residuals[i]; sxx += cutoffs[i] ** 2; sxy += cutoffs[i] * residuals[i]; }
  const n = k - from;
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const intercept = (sy - slope * sx) / n;
  let suggested = NaN;
  for (let i = 1; i < k; i++) {
    if (residuals[i - 1] > intercept && residuals[i] <= intercept) {
      suggested = cutoffs[i - 1] + ((residuals[i - 1] - intercept) / (residuals[i - 1] - residuals[i])) * (cutoffs[i] - cutoffs[i - 1]);
      break;
    }
  }
  return { cutoffs, residuals, line: { intercept, slope }, suggested };
}
