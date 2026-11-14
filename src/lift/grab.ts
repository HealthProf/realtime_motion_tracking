// Reads grey-level patches of the current video frame for the plate tracker, and draws the synthetic
// barbell scene used by the demo (so the demo exercises the real tracker).
import { toGray, type Grab } from './circle';

const scratch = document.createElement('canvas');
const sctx = scratch.getContext('2d', { willReadFrequently: true })!;

/**
 * Patch reader for a frame of size w x h shown mirrored or not. Coordinates are those of the picture
 * as displayed, i.e. the same as the pose landmarks.
 */
export function makeGrab(source: CanvasImageSource, mirror: boolean, w: number, h: number): Grab {
  return (x0, y0, x1, y1, step) => {
    const ax = Math.max(0, Math.floor(x0)), ay = Math.max(0, Math.floor(y0));
    const gw = Math.floor((Math.min(w, x1) - ax) / step), gh = Math.floor((Math.min(h, y1) - ay) / step);
    if (gw < 8 || gh < 8) return null;
    const sw = gw * step, sh = gh * step;
    if (scratch.width !== gw || scratch.height !== gh) { scratch.width = gw; scratch.height = gh; }
    sctx.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? gw : 0, 0);
    try {
      sctx.drawImage(source, mirror ? w - ax - sw : ax, ay, sw, sh, 0, 0, gw, gh);
      // Each grey pixel averages `step` image pixels, so its centre sits half a step in.
      return toGray(sctx.getImageData(0, 0, gw, gh).data, gw, gh, ax + (step - 1) / 2, ay + (step - 1) / 2, step);
    } catch {
      return null;
    }
  };
}

/** Backdrop of the barbell demo: floor, metre grid, a rack upright and the plate at (px, py) with radius r pixels. */
export function drawLiftScene(canvas: HTMLCanvasElement, w: number, h: number, groundY: number, px: number, py: number, r: number, spin: number): void {
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const c = canvas.getContext('2d')!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#0b1220';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(148,163,184,0.18)';
  c.lineWidth = 1;
  for (let x = (w / 2) % 150; x < w; x += 150) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
  for (let y = groundY; y > 0; y -= 150) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
  c.strokeStyle = 'rgba(248,250,252,0.6)';
  c.lineWidth = 2;
  c.beginPath(); c.moveTo(0, groundY); c.lineTo(w, groundY); c.stroke();
  // A wall clock: a round object that is NOT the plate, to show why the plate is confirmed by a tap.
  c.fillStyle = '#334155';
  c.strokeStyle = '#94a3b8';
  c.lineWidth = 3;
  c.beginPath(); c.arc(w * 0.84, h * 0.2, r * 0.55, 0, Math.PI * 2); c.fill(); c.stroke();
  // Plate: rim, coloured face, inner ring, hub and bar end, with a spoke so rotation is visible.
  c.fillStyle = '#1e293b';
  c.beginPath(); c.arc(px, py, r, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#e2e8f0';
  c.lineWidth = Math.max(2, r * 0.05);
  c.beginPath(); c.arc(px, py, r - c.lineWidth / 2, 0, Math.PI * 2); c.stroke();
  c.fillStyle = '#b91c1c';
  c.beginPath(); c.arc(px, py, r * 0.8, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#1e293b';
  c.beginPath(); c.arc(px, py, r * 0.42, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#cbd5e1';
  c.beginPath(); c.arc(px, py, r * 0.14, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#fecaca';
  c.lineWidth = Math.max(1.5, r * 0.04);
  c.beginPath(); c.moveTo(px + r * 0.46 * Math.cos(spin), py + r * 0.46 * Math.sin(spin)); c.lineTo(px + r * 0.76 * Math.cos(spin), py + r * 0.76 * Math.sin(spin)); c.stroke();
}
