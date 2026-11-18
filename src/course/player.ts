// Playback controls: a reusable control bar, and a player for one clip with frame stepping.
import { clock, measureFileFps, once, seekFrame } from '../capture/videoFile';

export interface BarHandlers {
  toggle(): void;
  step(dir: -1 | 1): void;
  /** Called while dragging (fast) and on release (final). */
  seek(t: number, final: boolean): void;
  speed(rate: number): void;
}

export interface Bar {
  update(t: number, start: number, end: number, playing: boolean): void;
  setDisabled(on: boolean): void;
}

export function buildBar(root: HTMLElement, h: BarHandlers, label?: string): Bar {
  root.innerHTML = `${label ? `<span class="label">${label}</span>` : ''}
    <button type="button" data-a="prev" aria-label="Previous frame" title="Previous frame (left arrow)">&#9664;&#xFE0E;</button>
    <button type="button" data-a="play" class="play">Play</button>
    <button type="button" data-a="next" aria-label="Next frame" title="Next frame (right arrow)">&#9654;&#xFE0E;</button>
    <input type="range" min="0" max="1" step="0.001" value="0" aria-label="${label ? `${label} position` : 'Position'}">
    <span class="clock"></span>
    <select aria-label="Playback speed" title="Playback speed"><option value="0.25">0.25x</option><option value="0.5">0.5x</option><option value="1" selected>1x</option></select>`;
  const q = <T extends Element>(s: string) => root.querySelector<T & Element>(s)! as T;
  const play = q<HTMLButtonElement>('[data-a=play]'), range = q<HTMLInputElement>('input'), time = q<HTMLSpanElement>('.clock'), speed = q<HTMLSelectElement>('select');
  q<HTMLButtonElement>('[data-a=prev]').addEventListener('click', () => h.step(-1));
  q<HTMLButtonElement>('[data-a=next]').addEventListener('click', () => h.step(1));
  play.addEventListener('click', () => h.toggle());
  let dragging = false;
  range.addEventListener('input', () => { dragging = true; h.seek(Number(range.value), false); });
  range.addEventListener('change', () => { dragging = false; h.seek(Number(range.value), true); });
  speed.addEventListener('change', () => h.speed(Number(speed.value)));
  return {
    update(t, start, end, playing) {
      range.min = String(start);
      range.max = String(Math.max(start + 0.001, end));
      if (!dragging) range.value = String(t);
      time.textContent = `${clock(Math.max(0, t - start))} / ${clock(Math.max(0, end - start))}`;
      play.textContent = playing ? 'Pause' : 'Play';
    },
    setDisabled(on) { root.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select').forEach((el) => (el.disabled = on)); },
  };
}

/** Loads a URL into a video element and waits until a picture can be shown. */
export async function loadVideo(video: HTMLVideoElement, url: string): Promise<void> {
  if (video.src === url && video.readyState >= 2) return;
  video.pause();
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  await Promise.race([
    once(video, 'loadeddata'),
    once(video, 'error').then(() => { throw new Error('This browser cannot play that video. Clips saved on a phone as HEVC (.mov) often need converting to H.264 MP4 first.'); }),
  ]);
  if (!video.videoWidth) throw new Error('The file has no video picture this browser can show.');
}

/** Frame rate for stepping: known from the course pack, measured, or 30 as a last resort. */
export async function frameRateOf(video: HTMLVideoElement, known?: number): Promise<number> {
  if (known && known > 0) return known;
  const t = video.currentTime;
  const fps = await measureFileFps(video);
  await seekFrame(video, t);
  return Number.isFinite(fps) && fps > 1 ? fps : 30;
}

/** One clip with a control bar. */
export class ClipPlayer {
  fps = 30;
  private bar: Bar;
  private raf = 0;
  private busy = false;
  private pending = 0;

  constructor(readonly video: HTMLVideoElement, barRoot: HTMLElement, private onChange: () => void = () => undefined, label?: string) {
    this.bar = buildBar(barRoot, {
      toggle: () => this.toggle(),
      step: (d) => void this.step(d),
      seek: (t, final) => { if (final) void this.seek(t); else { this.video.currentTime = t; this.refresh(); } },
      speed: (r) => { this.video.playbackRate = r; },
    }, label);
    video.addEventListener('play', () => this.loop());
    video.addEventListener('pause', () => this.refresh());
    video.addEventListener('seeked', () => this.refresh());
    video.addEventListener('ended', () => this.refresh());
  }

  get time() { return this.video.currentTime; }
  get duration() { return this.video.duration || 0; }

  toggle(): void {
    if (this.video.paused) { if (this.video.ended) this.video.currentTime = 0; void this.video.play().catch(() => undefined); } else this.video.pause();
  }

  /** Steps whole frames. Clicks that arrive while a step is still loading are added, not dropped. */
  async step(dir: -1 | 1): Promise<void> {
    this.pending += dir;
    if (this.busy) return;
    this.busy = true;
    this.video.pause();
    try {
      while (this.pending !== 0) {
        const n = this.pending;
        this.pending = 0;
        // Frames are 1/fps apart; aim at the middle of the target frame so rounding cannot land on a neighbour.
        const f = Math.round(this.video.currentTime * this.fps - 0.5) + n;
        await seekFrame(this.video, Math.min(this.duration - 1e-3, Math.max(0, (f + 0.5) / this.fps)));
        this.refresh();
      }
    } finally {
      this.busy = false;
      this.refresh();
    }
  }

  async seek(t: number): Promise<void> {
    this.video.pause();
    await seekFrame(this.video, Math.min(this.duration - 1e-3, Math.max(0, t)));
    this.refresh();
  }

  refresh(): void {
    this.bar.update(this.video.currentTime, 0, this.duration, !this.video.paused);
    this.onChange();
  }

  setDisabled(on: boolean): void { this.bar.setDisabled(on); }

  private loop(): void {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      this.refresh();
      if (!this.video.paused && !this.video.ended) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
}

/** Draws a video into a box, keeping its shape (letterboxed). */
export function drawContained(ctx: CanvasRenderingContext2D, src: CanvasImageSource, sw: number, sh: number, x: number, y: number, w: number, h: number): void {
  if (!sw || !sh) return;
  const k = Math.min(w / sw, h / sh), dw = sw * k, dh = sh * k;
  ctx.drawImage(src, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}
