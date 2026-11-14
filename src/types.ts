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
  /** Barbell position in weight lifting mode (image pixels), or null/undefined when not tracked. */
  bar?: BarObs | null;
}

/** One observation of the barbell end. */
export interface BarObs {
  x: number;
  y: number;
  /** Plate radius in pixels; 0 when the position was inferred from the hands. */
  r: number;
  /** 'plate': circle tracked in the picture. 'hands': estimated from the wrist keypoints. */
  src: 'plate' | 'hands';
}

export type ModelTier = 'lite' | 'full' | 'heavy';
export type TimestampSource = 'captureTime' | 'mediaTime' | 'callbackTime' | 'synthetic' | 'unknown';

declare global {
  const __APP_VERSION__: string;
}
