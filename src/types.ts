export interface Lm {
  x: number;
  y: number;
  z: number;
  /** Model visibility/confidence in [0, 1]. */
  v: number;
}

/** One pose observation. Image landmarks are in pixels of the source frame (x right, y down). */
export interface PoseFrame {
  /** Seconds on the source clock. Frame intervals are measured, never assumed. */
  t: number;
  w: number;
  h: number;
  /** 33 image landmarks in pixels, or null when no person was detected. */
  lm: Lm[] | null;
  /** 33 model-estimated 3D landmarks in metres (hip-centred, y down), or null. Experimental. */
  world: Lm[] | null;
}

export type ModelTier = 'lite' | 'full' | 'heavy';
export type TimestampSource = 'captureTime' | 'mediaTime' | 'callbackTime' | 'synthetic' | 'unknown';

declare global {
  const __APP_VERSION__: string;
}
