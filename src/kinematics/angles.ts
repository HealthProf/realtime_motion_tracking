// Planar and 3D angle computations. All results are in degrees.

export interface Vec2 {
  x: number;
  y: number;
}
export interface Vec3 extends Vec2 {
  z: number;
}

const DEG = 180 / Math.PI;

/** Included angle (0..180) at vertex b between rays b->a and b->c. Works in 2D or 3D (z optional). */
export function includedAngle(a: Vec2 & { z?: number }, b: Vec2 & { z?: number }, c: Vec2 & { z?: number }): number {
  const ux = a.x - b.x, uy = a.y - b.y, uz = (a.z ?? 0) - (b.z ?? 0);
  const vx = c.x - b.x, vy = c.y - b.y, vz = (c.z ?? 0) - (b.z ?? 0);
  const dot = ux * vx + uy * vy + uz * vz;
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  const cross = Math.hypot(cx, cy, cz);
  if (cross === 0 && dot === 0) return NaN;
  return Math.atan2(cross, dot) * DEG;
}

/**
 * Orientation of the segment from -> to, in a y-up frame.
 * 'horizontal': counter-clockwise from +x, range (-180, 180].
 * 'vertical': deviation from straight up, positive toward +x, range (-180, 180].
 */
export function segmentAngle(from: Vec2, to: Vec2, ref: 'horizontal' | 'vertical'): number {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (dx === 0 && dy === 0) return NaN;
  return ref === 'horizontal' ? Math.atan2(dy, dx) * DEG : Math.atan2(dx, dy) * DEG;
}

/** Removes 360-degree jumps from a sampled angle so it can be differentiated. NaN samples are passed through. */
export function unwrapDegrees(a: ArrayLike<number>): Float64Array {
  const out = Float64Array.from(a as ArrayLike<number>);
  let prev = NaN;
  let offset = 0;
  for (let i = 0; i < out.length; i++) {
    if (!Number.isFinite(out[i])) continue;
    if (Number.isFinite(prev)) {
      const d = out[i] - prev;
      if (d > 180) offset -= 360;
      else if (d < -180) offset += 360;
    }
    prev = out[i];
    out[i] += offset;
  }
  return out;
}
