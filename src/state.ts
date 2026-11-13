// Shared application state and small DOM helpers.
import type { BodyModel } from './analysis/com';
import { defaultCalibration, type Calibration } from './kinematics/calibration';
import type { Convention } from './measure/definitions';
import type { PointId } from './pose/landmarks';
import type { SideMode } from './presets/presets';
import type { Layers } from './render/overlay';
import type { ModelTier } from './types';

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

export const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

export const settings = {
  tier: (isMobile ? 'lite' : 'full') as ModelTier,
  mirror: true,
  fps: 60,
  convention: 'anatomical' as Convention,
  bodyModel: 'average' as BodyModel,
  minVisibility: 0.5,
  include3d: false,
  preset: 'free',
  side: 'auto' as SideMode,
  angles: [] as string[],
  points: [] as PointId[],
  cutoff: 6,
  maxGap: 0.25,
  /** Optional typed measurements for the bike and running modes. */
  inseamCm: NaN,
  saddleCm: NaN,
  speedKmh: NaN,
};

export const layers: Layers = {
  videoOpacity: 1, skeleton: true, labels: true, trails: true, com: true, axes: false,
  bones: false, bonesOpacity: 0.85, muscles: false, musclesOpacity: 0.6, highlight: null,
  systems: { organs: false, arteries: false, veins: false, nerves: false, ligaments: false, lymph: false, landmarks: false },
  systemsOpacity: 0.85, find: null,
};

export const cal: { current: Calibration } = { current: defaultCalibration(720) };

export function say(message: string): void {
  $('status-msg').textContent = message;
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export const f = (v: number, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : '–');
