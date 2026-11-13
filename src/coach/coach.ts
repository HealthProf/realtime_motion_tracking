// Camera setup coach: live checks on the things that most affect planar measurement validity.
import { L } from '../pose/landmarks';
import type { Lm } from '../types';

export type View = 'frontal' | 'sagittal' | 'oblique' | 'unknown';
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'na';

export interface Check {
  id: 'person' | 'frame' | 'distance' | 'plane' | 'tracking' | 'fps' | 'level';
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface CoachInput {
  lm: Lm[] | null;
  world: Lm[] | null;
  w: number;
  h: number;
  fps: number;
  /** View the current activity expects, or null if any single plane will do. */
  expectedView: 'frontal' | 'sagittal' | null;
  /** Camera roll/pitch away from level in degrees (phones/tablets), or null when no sensor is available. */
  tiltDeg: number | null;
}

/**
 * Rotation of the shoulder and hip lines out of the image plane, from the model's estimated 3D landmarks.
 * 0 deg: subject square to the camera (frontal). 90 deg: side-on (sagittal).
 */
export function bodyYaw(world: Lm[] | null): number {
  if (!world) return NaN;
  const yaw = (a: Lm, b: Lm) => (Math.atan2(Math.abs(a.z - b.z), Math.abs(a.x - b.x)) * 180) / Math.PI;
  return (yaw(world[L.l_shoulder], world[L.r_shoulder]) + yaw(world[L.l_hip], world[L.r_hip])) / 2;
}

export function classifyView(yawDeg: number): View {
  if (!Number.isFinite(yawDeg)) return 'unknown';
  if (yawDeg <= 25) return 'frontal';
  if (yawDeg >= 65) return 'sagittal';
  return 'oblique';
}

const KEY = ['nose', 'l_shoulder', 'r_shoulder', 'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_ankle', 'r_ankle'] as const;

export function coachChecks(i: CoachInput): Check[] {
  const checks: Check[] = [];
  const add = (id: Check['id'], label: string, status: CheckStatus, detail: string) => checks.push({ id, label, status, detail });
  if (!i.lm) {
    add('person', 'Person detected', 'fail', 'No one is being tracked. Step into view so your whole body is visible.');
    return checks;
  }
  add('person', 'Person detected', 'pass', 'Tracking one person.');

  const xs = i.lm.map((p) => p.x), ys = i.lm.map((p) => p.y);
  const m = 0.02;
  const cut = Math.min(...xs) < m * i.w || Math.max(...xs) > (1 - m) * i.w || Math.min(...ys) < m * i.h || Math.max(...ys) > (1 - m) * i.h;
  add('frame', 'Whole body in frame', cut ? 'fail' : 'pass', cut ? 'Part of the body is at or beyond the edge of the picture. Move back or re-aim the camera.' : 'Head to feet are inside the picture.');

  const span = (Math.max(...ys) - Math.min(...ys)) / i.h;
  if (span < 0.45) add('distance', 'Subject size', 'warn', `The body fills only ${Math.round(span * 100)} % of the picture height. Move closer: more pixels per segment means less angle error.`);
  else if (span > 0.92) add('distance', 'Subject size', 'warn', 'Very close to the edges. Leave room for the movement (for example the top of a jump).');
  else add('distance', 'Subject size', 'pass', `The body fills ${Math.round(span * 100)} % of the picture height.`);

  const yaw = bodyYaw(i.world);
  const view = classifyView(yaw);
  if (view === 'unknown') add('plane', 'Movement plane', 'na', 'Body orientation could not be estimated.');
  else if (view === 'oblique') add('plane', 'Movement plane', 'fail', `The body is turned about ${Math.round(yaw)}° from square-on. Planar angles are distorted in oblique views: turn to face the camera or stand side-on.`);
  else if (i.expectedView && view !== i.expectedView) add('plane', 'Movement plane', 'warn', `This looks like a ${view} view, but the selected activity is normally measured in a ${i.expectedView} view.`);
  else add('plane', 'Movement plane', 'pass', `${view === 'frontal' ? 'Frontal' : 'Sagittal (side)'} view. Keep the movement in this plane. (Estimated from the model's 3D output.)`);

  const vis = KEY.reduce((s, k) => s + i.lm![L[k]].v, 0) / KEY.length;
  add('tracking', 'Tracking confidence', vis >= 0.8 ? 'pass' : vis >= 0.6 ? 'warn' : 'fail',
    vis >= 0.8 ? `Mean landmark confidence ${vis.toFixed(2)}.` : `Mean landmark confidence ${vis.toFixed(2)}. Improve lighting, use a plain background, and wear fitted clothing that contrasts with it.`);

  if (Number.isFinite(i.fps)) {
    add('fps', 'Frame rate', i.fps >= 27 ? 'pass' : i.fps >= 20 ? 'warn' : 'fail',
      i.fps >= 27 ? `${i.fps.toFixed(0)} frames per second.` : `${i.fps.toFixed(0)} frames per second. Add light (cameras slow down in dim rooms), close other apps, or choose the Lite model.`);
  }

  if (i.tiltDeg === null) add('level', 'Camera level', 'na', 'No tilt sensor on this device. Check by eye that the camera is level and at about hip height.');
  else add('level', 'Camera level', i.tiltDeg <= 3 ? 'pass' : i.tiltDeg <= 8 ? 'warn' : 'fail', `Camera is ${i.tiltDeg.toFixed(0)}° from level. A tilted camera rotates the vertical and horizontal axes of every measurement.`);
  return checks;
}

/**
 * How far the device camera is from level, from DeviceOrientation angles (degrees).
 * Combines pitch (camera axis above/below horizontal) and roll (rotation about the camera axis,
 * measured from the nearest portrait/landscape orientation) and returns the larger of the two.
 */
export function tiltFromOrientation(beta: number, gamma: number): number {
  const b = (beta * Math.PI) / 180, g = (gamma * Math.PI) / 180;
  // Gravity direction in device coordinates (x right, y up the screen, z out of the screen).
  const gx = Math.cos(b) * Math.sin(g), gy = -Math.sin(b), gz = -Math.cos(b) * Math.cos(g);
  const pitch = (Math.asin(Math.min(1, Math.abs(gz))) * 180) / Math.PI;
  const rollRaw = (Math.atan2(gx, -gy) * 180) / Math.PI;
  const roll = Math.abs(rollRaw - Math.round(rollRaw / 90) * 90);
  return Math.max(pitch, Math.hypot(gx, gy) < 0.2 ? 0 : roll);
}
