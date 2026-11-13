// Low-pass Butterworth filtering for kinematic data.
// Coefficients follow Winter, "Biomechanics and Motor Control of Human Movement" (4th ed., ch. 3).

export interface Biquad {
  a0: number;
  a1: number;
  a2: number;
  b1: number;
  b2: number;
}

/** Cutoff correction for a filter applied `passes` times (Winter eq. 3.10). 0.802 for a dual pass. */
export function passCorrection(passes: number): number {
  return Math.pow(Math.pow(2, 1 / passes) - 1, 0.25);
}

/** 2nd-order low-pass Butterworth coefficients. `passes` corrects the cutoff for repeated application. */
export function lowpassCoefficients(fc: number, fs: number, passes = 1): Biquad {
  if (!(fc > 0) || !(fs > 0)) throw new Error('cutoff and sample rate must be positive');
  if (fc >= fs / 2) throw new Error('cutoff must be below the Nyquist frequency');
  const wc = Math.tan((Math.PI * fc) / fs) / passCorrection(passes);
  const k1 = Math.SQRT2 * wc;
  const k2 = wc * wc;
  const a0 = k2 / (1 + k1 + k2);
  const k3 = (2 * a0) / k2;
  return { a0, a1: 2 * a0, a2: a0, b1: -2 * a0 + k3, b2: 1 - 2 * a0 - k3 };
}

/** Single causal pass. State is initialised to the first sample (unity DC gain), avoiding a start-up transient. */
export function filterForward(x: ArrayLike<number>, c: Biquad): Float64Array {
  const n = x.length;
  const y = new Float64Array(n);
  if (n === 0) return y;
  let x1 = x[0], x2 = x[0], y1 = x[0], y2 = x[0];
  for (let i = 0; i < n; i++) {
    const v = c.a0 * x[i] + c.a1 * x1 + c.a2 * x2 + c.b1 * y1 + c.b2 * y2;
    x2 = x1; x1 = x[i];
    y2 = y1; y1 = v;
    y[i] = v;
  }
  return y;
}

/**
 * Zero-phase (forward then reverse) low-pass filter: effectively 4th order with no phase lag.
 * `fc` is the desired final -3 dB cutoff. Ends are padded by odd reflection to limit edge transients.
 */
export function filtfilt(x: ArrayLike<number>, fc: number, fs: number): Float64Array {
  const n = x.length;
  if (n < 3) return Float64Array.from(x as ArrayLike<number>);
  const c = lowpassCoefficients(fc, fs, 2);
  const pad = Math.min(n - 1, Math.ceil((2 * fs) / fc));
  const ext = new Float64Array(n + 2 * pad);
  for (let i = 0; i < pad; i++) {
    ext[i] = 2 * x[0] - x[pad - i];
    ext[pad + n + i] = 2 * x[n - 1] - x[n - 2 - i];
  }
  for (let i = 0; i < n; i++) ext[pad + i] = x[i];
  const fwd = filterForward(ext, c);
  fwd.reverse();
  const back = filterForward(fwd, c);
  back.reverse();
  return back.slice(pad, pad + n);
}

/** Minimum run length (samples) we are willing to filter; shorter runs are returned as NaN. */
export const MIN_FILTER_RUN = 9;

/** Applies `filtfilt` independently to each contiguous run of finite samples. Gaps stay NaN. */
export function filtfiltGaps(x: ArrayLike<number>, fc: number, fs: number): Float64Array {
  const n = x.length;
  const out = new Float64Array(n).fill(NaN);
  let i = 0;
  while (i < n) {
    while (i < n && !Number.isFinite(x[i])) i++;
    const start = i;
    while (i < n && Number.isFinite(x[i])) i++;
    if (i - start >= MIN_FILTER_RUN) {
      out.set(filtfilt(Array.prototype.slice.call(x, start, i), fc, fs), start);
    }
  }
  return out;
}
