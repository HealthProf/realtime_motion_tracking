// Frame-accurate helpers for video files, shared by the Motion Lab and the course app.
import { frameRate } from '../kinematics/series';

type RvfcVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number };

export const once = (el: EventTarget, type: string) => new Promise<void>((resolve) => el.addEventListener(type, () => resolve(), { once: true }));

/** True if the browser reports the timestamp of each presented frame. */
export const hasFrameCallback = (video: HTMLVideoElement) => !!(video as RvfcVideo).requestVideoFrameCallback;

/** Calls `cb` with the media time of the next frame the browser presents. */
export function onNextFrame(video: HTMLVideoElement, cb: (mediaTime: number) => void): void {
  const v = video as RvfcVideo;
  if (v.requestVideoFrameCallback) v.requestVideoFrameCallback((_, meta) => cb(meta.mediaTime));
  else requestAnimationFrame(() => cb(video.currentTime));
}

/** Frame rate of a file, measured from the timestamps of the frames it presents during a short play. */
export async function measureFileFps(video: HTMLVideoElement): Promise<number> {
  const v = video as RvfcVideo;
  if (!v.requestVideoFrameCallback) return NaN;
  const times: number[] = [];
  try { await video.play(); } catch { return NaN; }
  await new Promise<void>((resolve) => {
    const t0 = performance.now();
    const step = (_: number, meta: { mediaTime: number }) => {
      times.push(meta.mediaTime);
      if (times.length >= 45 || performance.now() - t0 > 1800 || video.ended) resolve(); else v.requestVideoFrameCallback!(step);
    };
    v.requestVideoFrameCallback!(step);
    setTimeout(resolve, 2600);
  });
  video.pause();
  return frameRate(times);
}

/**
 * Seeks to time t and resolves with the timestamp of the frame then showing. `tol` is how far (s) a
 * presented frame's own timestamp may be from t and still be the frame asked for: a frame notification
 * that arrives late from an earlier seek must not be mistaken for this one.
 */
export function seekFrame(video: HTMLVideoElement, t: number, tol = Infinity, fallback = t): Promise<number> {
  return new Promise((resolve) => {
    const v = video as RvfcVideo;
    let done = false;
    const finish = (time: number) => { if (!done) { done = true; clearTimeout(timer); resolve(time); } };
    const timer = setTimeout(() => finish(fallback), 5000);
    const onFrame = (_: number, meta: { mediaTime: number }) => {
      if (done) return;
      if (!video.seeking && Math.abs(meta.mediaTime - t) <= tol) finish(meta.mediaTime);
      else v.requestVideoFrameCallback!(onFrame);
    };
    const notifies = !!v.requestVideoFrameCallback;
    if (notifies) v.requestVideoFrameCallback!(onFrame);
    // Once the seek has completed the frame is available even if the browser sends no notification
    // (for example when it was already showing); the requested time is then the best timestamp.
    video.addEventListener('seeked', () => setTimeout(() => finish(fallback), notifies ? 350 : 0), { once: true });
    video.currentTime = t;
  });
}

/** Minutes, seconds and hundredths, e.g. 0:03.27. */
export const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
