// Minimal canvas line chart (no dependencies). Handles NaN gaps, auto-scaling, and theme colours.

export interface Series {
  label: string;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  color: string;
  dashed?: boolean;
  width?: number;
}

export interface ChartOptions {
  xLabel?: string;
  yLabel?: string;
  /** Fixed x-range; otherwise derived from the data. */
  xRange?: [number, number];
  /** Vertical marker lines (e.g. key moments, rep boundaries). */
  markers?: { x: number; label?: string; color?: string }[];
  /** Horizontal reference lines. */
  hLines?: { y: number; label?: string; color?: string }[];
}

export const PALETTE = ['#f59e0b', '#22d3ee', '#a78bfa', '#4ade80', '#fb7185', '#facc15', '#60a5fa', '#f472b6'];

const niceStep = (range: number, target: number) => {
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
};
const fmt = (v: number, step: number) => (step >= 1 ? v.toFixed(0) : step >= 0.1 ? v.toFixed(1) : step >= 0.01 ? v.toFixed(2) : v.toPrecision(2));

export function drawChart(canvas: HTMLCanvasElement, series: Series[], o: ChartOptions = {}): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = canvas.clientWidth || 600, ch = canvas.clientHeight || 180;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = getComputedStyle(canvas);
  const fg = css.getPropertyValue('--chart-fg').trim() || '#cbd5e1';
  const grid = css.getPropertyValue('--chart-grid').trim() || 'rgba(148,163,184,0.25)';
  ctx.clearRect(0, 0, cw, ch);
  ctx.font = '11px system-ui, sans-serif';

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of series) {
    for (let i = 0; i < s.x.length; i++) {
      if (!Number.isFinite(s.x[i]) || !Number.isFinite(s.y[i])) continue;
      if (o.xRange && (s.x[i] < o.xRange[0] || s.x[i] > o.xRange[1])) continue;
      x0 = Math.min(x0, s.x[i]); x1 = Math.max(x1, s.x[i]);
      y0 = Math.min(y0, s.y[i]); y1 = Math.max(y1, s.y[i]);
    }
  }
  for (const h of o.hLines ?? []) { y0 = Math.min(y0, h.y); y1 = Math.max(y1, h.y); }
  if (o.xRange) [x0, x1] = o.xRange;
  const m = { l: 46, r: 10, t: 8, b: o.xLabel ? 30 : 20 };
  const pw = cw - m.l - m.r, ph = ch - m.t - m.b;
  if (!Number.isFinite(y0) || !Number.isFinite(x0)) {
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.fillText('No data yet', cw / 2, ch / 2);
    return;
  }
  if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
  if (x1 - x0 < 1e-9) x1 = x0 + 1;
  const pad = 0.06 * (y1 - y0);
  y0 -= pad; y1 += pad;
  const X = (x: number) => m.l + ((x - x0) / (x1 - x0)) * pw;
  const Y = (y: number) => m.t + (1 - (y - y0) / (y1 - y0)) * ph;

  ctx.strokeStyle = grid;
  ctx.fillStyle = fg;
  ctx.lineWidth = 1;
  const ys = niceStep(y1 - y0, 4);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = Math.ceil(y0 / ys) * ys; v <= y1; v += ys) {
    ctx.beginPath(); ctx.moveTo(m.l, Y(v)); ctx.lineTo(cw - m.r, Y(v)); ctx.stroke();
    ctx.fillText(fmt(Math.abs(v) < ys * 1e-6 ? 0 : v, ys), m.l - 5, Y(v));
  }
  const xs = niceStep(x1 - x0, Math.max(3, Math.floor(pw / 80)));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let v = Math.ceil(x0 / xs) * xs; v <= x1; v += xs) {
    ctx.beginPath(); ctx.moveTo(X(v), m.t); ctx.lineTo(X(v), m.t + ph); ctx.stroke();
    ctx.fillText(fmt(v, xs), X(v), m.t + ph + 4);
  }
  if (o.xLabel) ctx.fillText(o.xLabel, m.l + pw / 2, ch - 13);
  if (o.yLabel) {
    ctx.save();
    ctx.translate(11, m.t + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'middle';
    ctx.fillText(o.yLabel, 0, 0);
    ctx.restore();
  }
  if (y0 < 0 && y1 > 0) {
    ctx.strokeStyle = fg;
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.moveTo(m.l, Y(0)); ctx.lineTo(cw - m.r, Y(0)); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(m.l, m.t, pw, ph);
  ctx.clip();
  for (const h of o.hLines ?? []) {
    ctx.strokeStyle = h.color ?? fg;
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(m.l, Y(h.y)); ctx.lineTo(cw - m.r, Y(h.y)); ctx.stroke();
    ctx.setLineDash([]);
    if (h.label) { ctx.fillStyle = h.color ?? fg; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(h.label, cw - m.r - 4, Y(h.y) - 2); }
  }
  for (const mk of o.markers ?? []) {
    ctx.strokeStyle = mk.color ?? fg;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(X(mk.x), m.t); ctx.lineTo(X(mk.x), m.t + ph); ctx.stroke();
    ctx.setLineDash([]);
    if (mk.label) { ctx.fillStyle = mk.color ?? fg; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(mk.label, X(mk.x) + 3, m.t + 2); }
  }
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width ?? 1.75;
    ctx.setLineDash(s.dashed ? [5, 4] : []);
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < s.x.length; i++) {
      if (!Number.isFinite(s.x[i]) || !Number.isFinite(s.y[i])) { pen = false; continue; }
      if (pen) ctx.lineTo(X(s.x[i]), Y(s.y[i]));
      else ctx.moveTo(X(s.x[i]), Y(s.y[i]));
      pen = true;
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.setLineDash([]);
}

/** Text legend rendered as HTML next to a chart (keeps colour from being the only cue). */
export function legendHtml(series: Series[]): string {
  return series.map((s) => `<span class="legend-item"><span class="swatch${s.dashed ? ' dashed' : ''}" style="--c:${s.color}"></span>${s.label}</span>`).join('');
}
