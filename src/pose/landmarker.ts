// Thin wrapper around the MediaPipe Pose Landmarker. Assets are served from our own origin.
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Lm, ModelTier } from '../types';

const asset = (path: string) => new URL(path, document.baseURI).href;

export interface Detection {
  lm: Lm[] | null;
  world: Lm[] | null;
}

export class Landmarker {
  private task: PoseLandmarker | null = null;
  private lastTs = 0;
  delegate: 'GPU' | 'CPU' = 'GPU';

  constructor(readonly tier: ModelTier) {}

  async load(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(asset('wasm'));
    const create = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: asset(`models/pose_landmarker_${this.tier}.task`), delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    try {
      this.task = await create('GPU');
      this.delegate = 'GPU';
    } catch (err) {
      console.warn('GPU delegate unavailable, falling back to CPU', err);
      this.task = await create('CPU');
      this.delegate = 'CPU';
    }
  }

  /** Runs detection on the current video frame. Landmarks are returned in pixels of the frame. */
  detect(video: HTMLVideoElement, w: number, h: number): Detection {
    if (!this.task) return { lm: null, world: null };
    // The task requires strictly increasing timestamps (ms); these are not used for kinematics.
    const ts = Math.max(this.lastTs + 1, Math.round(performance.now()));
    this.lastTs = ts;
    const r = this.task.detectForVideo(video, ts);
    const img = r.landmarks?.[0];
    if (!img) return { lm: null, world: null };
    const lm = img.map((p) => ({ x: p.x * w, y: p.y * h, z: p.z * w, v: p.visibility ?? 0 }));
    const wl = r.worldLandmarks?.[0];
    const world = wl ? wl.map((p, i) => ({ x: p.x, y: p.y, z: p.z, v: img[i].visibility ?? 0 })) : null;
    return { lm, world };
  }

  close(): void {
    this.task?.close();
    this.task = null;
  }
}
