// Camera access and frame-accurate timing.
import type { TimestampSource } from '../types';

export interface CameraInfo {
  deviceId: string;
  label: string;
}

export async function listCameras(): Promise<CameraInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'videoinput').map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

export interface CameraOptions {
  deviceId?: string;
  facingMode?: 'user' | 'environment';
  /** Ideal frame rate. Higher rates improve velocity/acceleration estimates when the camera supports them. */
  frameRate: number;
  height: number;
}

export interface OpenCamera {
  stream: MediaStream;
  width: number;
  height: number;
  /** Frame rate reported by the track settings (nominal; actual intervals are measured per frame). */
  nominalFps: number;
  facingMode: string;
  label: string;
}

export async function openCamera(video: HTMLVideoElement, o: CameraOptions): Promise<OpenCamera> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not provide camera access (a secure https connection is required).');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      ...(o.deviceId ? { deviceId: { exact: o.deviceId } } : { facingMode: o.facingMode ?? 'user' }),
      height: { ideal: o.height },
      frameRate: { ideal: o.frameRate },
    },
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  const track = stream.getVideoTracks()[0];
  const s = track.getSettings();
  return {
    stream,
    width: video.videoWidth,
    height: video.videoHeight,
    nominalFps: s.frameRate ?? NaN,
    facingMode: s.facingMode ?? '',
    label: track.label,
  };
}

export function closeCamera(video: HTMLVideoElement): void {
  const stream = video.srcObject as MediaStream | null;
  stream?.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}

type VideoFrameMeta = { mediaTime: number; captureTime?: number; expectedDisplayTime: number };
type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: VideoFrameMeta) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

/**
 * Calls `onFrame(tSeconds)` once per new video frame. Prefers per-frame capture timestamps
 * (requestVideoFrameCallback); falls back to callback time when the browser lacks it.
 * The chosen timestamp source is fixed for the life of the loop and reported for export metadata.
 */
export function startFrameLoop(video: HTMLVideoElement, onFrame: (t: number) => void): { stop: () => void; source: () => TimestampSource } {
  const v = video as RvfcVideo;
  let running = true;
  let source: TimestampSource = 'unknown';
  let id = 0;
  if (v.requestVideoFrameCallback) {
    const step = (now: number, meta: VideoFrameMeta) => {
      if (!running) return;
      if (source === 'unknown') source = meta.captureTime !== undefined ? 'captureTime' : meta.mediaTime > 0 ? 'mediaTime' : 'callbackTime';
      const t = source === 'captureTime' ? (meta.captureTime ?? now) / 1000 : source === 'mediaTime' ? meta.mediaTime : now / 1000;
      onFrame(t);
      id = v.requestVideoFrameCallback!(step);
    };
    id = v.requestVideoFrameCallback(step);
    return { stop: () => { running = false; v.cancelVideoFrameCallback?.(id); }, source: () => source };
  }
  source = 'callbackTime';
  let last = -1;
  const step = (now: number) => {
    if (!running) return;
    if (video.currentTime !== last) {
      last = video.currentTime;
      onFrame(now / 1000);
    }
    id = requestAnimationFrame(step);
  };
  id = requestAnimationFrame(step);
  return { stop: () => { running = false; cancelAnimationFrame(id); }, source: () => source };
}
