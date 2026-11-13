// One Euro filter (Casiez, Roussel & Vogel, CHI 2012): adaptive causal low-pass for live display.
// Low speed -> strong smoothing (less jitter); high speed -> light smoothing (less lag).

const alpha = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export interface OneEuroParams {
  minCutoff: number;
  beta: number;
  dCutoff: number;
}

export class OneEuro {
  private x = NaN;
  private dx = 0;
  private t = NaN;
  constructor(private p: OneEuroParams = { minCutoff: 1.5, beta: 0.05, dCutoff: 1 }) {}

  reset(): void {
    this.x = NaN;
    this.dx = 0;
    this.t = NaN;
  }

  /** Smoothed derivative from the most recent update (units per second). */
  get derivative(): number {
    return this.dx;
  }

  filter(value: number, t: number): number {
    if (!Number.isFinite(value)) return NaN;
    const dt = t - this.t;
    if (!Number.isFinite(this.x) || !(dt > 0) || dt > 0.5) {
      this.x = value;
      this.dx = 0;
      this.t = t;
      return value;
    }
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.p.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.p.minCutoff + this.p.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    this.t = t;
    return this.x;
  }
}
