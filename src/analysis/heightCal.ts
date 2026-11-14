// Rough calibration from the subject's own standing height.
//
// The person stands upright where the movement will happen; the eye-to-heel distance in the picture is
// compared with eye height, taken as 93.6 % of stature (Drillis & Contini, 1966). Samples collected over
// a short window are checked before the scale is accepted, because a bent knee, a cropped head or a
// person still walking into place would silently give a wrong scale.
import { includedAngle } from '../kinematics/angles';
import { L } from '../pose/landmarks';
import type { Lm } from '../types';

/** Eye height as a fraction of stature (Drillis & Contini, 1966). */
export const EYE_HEIGHT_FRACTION = 0.936;

export interface HeightSpan {
  ok: boolean;
  /** Why the calibration was refused (when ok is false). */
  reason: string;
  /** Median eye and heel points (image pixels); the heel shares the eye's x so the span is vertical. */
  eye: { x: number; y: number };
  heel: { x: number; y: number };
  /** Vertical eye-to-heel distance in pixels. */
  px: number;
  /** Number of usable samples. */
  n: number;
}

const med = (v: number[]) => {
  const s = v.slice().sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Measures the standing eye-to-heel span from a short run of pose samples and checks that it can be
 * trusted. `w` and `h` are the frame size in pixels.
 */
export function standingHeightSpan(samples: (Lm[] | null)[], w: number, h: number, minVis: number): HeightSpan {
  const fail = (reason: string, n = 0): HeightSpan => ({ ok: false, reason, eye: { x: 0, y: 0 }, heel: { x: 0, y: 0 }, px: NaN, n });
  if (!samples.length) return fail('No frames were captured.');
  const need = [L.l_eye, L.r_eye, L.l_heel, L.r_heel];
  const good = samples.filter((lm): lm is Lm[] => !!lm && need.every((i) => lm[i].v >= minVis));
  if (good.length < Math.max(3, 0.6 * samples.length)) return fail('The eyes and both heels must be clearly visible. Check the lighting and that nothing hides the feet.', good.length);

  const eyeX = med(good.map((lm) => (lm[L.l_eye].x + lm[L.r_eye].x) / 2));
  const eyeY = med(good.map((lm) => (lm[L.l_eye].y + lm[L.r_eye].y) / 2));
  const heelY = med(good.map((lm) => (lm[L.l_heel].y + lm[L.r_heel].y) / 2));
  const spans = good.map((lm) => (lm[L.l_heel].y + lm[L.r_heel].y) / 2 - (lm[L.l_eye].y + lm[L.r_eye].y) / 2);
  const px = med(spans);
  if (!(px > 0.15 * h)) return fail('The person is too small in the picture (or not upright). Move closer, keeping the whole body in view.', good.length);

  // Whole body in frame: the top of the head is about 6.4 % of stature above the eyes.
  const headTop = eyeY - (px * (1 - EYE_HEIGHT_FRACTION)) / EYE_HEIGHT_FRACTION;
  if (headTop < 0 || heelY > h * 0.995) return fail('The whole body must be in the picture, with a little space above the head and below the feet. Step back.', good.length);
  const xs = good.flatMap((lm) => [lm[L.l_shoulder].x, lm[L.r_shoulder].x, lm[L.l_heel].x, lm[L.r_heel].x]);
  if (Math.min(...xs) < 0 || Math.max(...xs) > w) return fail('Part of the body is outside the picture. Move toward the centre.', good.length);

  // Standing still: the span must not be changing.
  const spread = med(spans.map((s) => Math.abs(s - px)));
  if (spread > 0.015 * px) return fail('Stand still until the countdown ends.', good.length);

  // Upright: straight knees and hips on every side that can be seen, and a vertical trunk.
  const mid = good[Math.floor(good.length / 2)];
  let sidesChecked = 0;
  for (const s of ['l', 'r'] as const) {
    const raw = [mid[L[`${s}_shoulder`]], mid[L[`${s}_hip`]], mid[L[`${s}_knee`]], mid[L[`${s}_ankle`]]];
    if (Math.min(...raw.map((p) => p.v)) < minVis) continue;
    // Planar angles: the model's depth estimate is deliberately left out.
    const [sh, hip, knee, ankle] = raw.map((p) => ({ x: p.x, y: p.y }));
    sidesChecked++;
    if (includedAngle(hip, knee, ankle) < 160) return fail('Stand tall with straight knees for the calibration.', good.length);
    if (includedAngle(sh, hip, knee) < 155) return fail('Stand tall with straight hips for the calibration (do not bend forward).', good.length);
  }
  if (!sidesChecked) return fail('The shoulders, hips, knees and ankles of at least one side must be visible.', good.length);
  const ms = { x: (mid[L.l_shoulder].x + mid[L.r_shoulder].x) / 2, y: (mid[L.l_shoulder].y + mid[L.r_shoulder].y) / 2 };
  const mh = { x: (mid[L.l_hip].x + mid[L.r_hip].x) / 2, y: (mid[L.l_hip].y + mid[L.r_hip].y) / 2 };
  const lean = Math.abs(Math.atan2(ms.x - mh.x, mh.y - ms.y)) * (180 / Math.PI);
  if (lean > 12) return fail('Stand upright: the trunk is leaning.', good.length);

  return { ok: true, reason: '', eye: { x: eyeX, y: eyeY }, heel: { x: eyeX, y: heelY }, px, n: good.length };
}
