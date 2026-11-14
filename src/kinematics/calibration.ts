// Mapping from image pixels to the analysis coordinate system (x right, y up).
import type { Vec2 } from './angles';

export interface Calibration {
  /** Length units per pixel. 1 when uncalibrated. */
  scale: number;
  unit: 'm' | 'px';
  /** Origin in image pixels (image y is down). */
  origin: Vec2;
  /** How the scale was obtained; recorded in exports. */
  method: 'none' | 'reference-length' | 'subject-height' | 'plate-diameter';
  /** Known length used for calibration, in metres. */
  referenceLength?: number;
}

export function defaultCalibration(imageHeight: number): Calibration {
  return { scale: 1, unit: 'px', origin: { x: 0, y: imageHeight }, method: 'none' };
}

/** Scale from two image points a known distance apart. The points must lie in the plane of motion. */
export function calibrateFromLength(p1: Vec2, p2: Vec2, metres: number, origin: Vec2, method: Calibration['method'] = 'reference-length'): Calibration {
  const px = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  if (!(px > 0) || !(metres > 0)) throw new Error('calibration needs two distinct points and a positive length');
  return { scale: metres / px, unit: 'm', origin, method, referenceLength: metres };
}

export function toAnalysis(c: Calibration, px: number, py: number): Vec2 {
  return { x: (px - c.origin.x) * c.scale, y: (c.origin.y - py) * c.scale };
}
