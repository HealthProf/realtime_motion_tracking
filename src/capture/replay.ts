// Instant replay: a rolling buffer of the last few seconds (compressed frames plus pose data) that can
// be scrubbed with measurements intact, and promoted to a trial.
import type { LiveSample } from '../live';
import type { PoseFrame } from '../types';

export interface ReplayEntry {
  frame: PoseFrame;
  sample: LiveSample;
  /** JPEG of the video frame (already mirrored if the view is mirrored); null in demo mode or while encoding. */
  image: Blob | null;
}

export class ReplayBuffer {
  entries: ReplayEntry[] = [];
  private scratch = document.createElement('canvas');
  private pending = 0;

  constructor(public seconds: number, private maxWidth: number) {}

  clear(): void { this.entries = []; }

  get duration(): number {
    const e = this.entries;
    return e.length > 1 ? e[e.length - 1].frame.t - e[0].frame.t : 0;
  }

  /** Adds a frame. `source` is drawn (downscaled) and JPEG-encoded asynchronously; encoding is skipped if it falls behind. */
  push(frame: PoseFrame, sample: LiveSample, source: CanvasImageSource | null, mirror: boolean): void {
    const entry: ReplayEntry = { frame, sample, image: null };
    this.entries.push(entry);
    while (this.entries.length > 2 && frame.t - this.entries[0].frame.t > this.seconds) this.entries.shift();
    if (!source || this.pending >= 3) return;
    const scale = Math.min(1, this.maxWidth / frame.w);
    const cw = Math.round(frame.w * scale), ch = Math.round(frame.h * scale);
    if (this.scratch.width !== cw || this.scratch.height !== ch) { this.scratch.width = cw; this.scratch.height = ch; }
    const ctx = this.scratch.getContext('2d')!;
    ctx.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? cw : 0, 0);
    ctx.drawImage(source, 0, 0, cw, ch);
    this.pending++;
    this.scratch.toBlob((b) => { entry.image = b; this.pending--; }, 'image/jpeg', 0.7);
  }
}

/** Decodes replay images on demand, keeping only the most recent bitmap alive. */
export class ReplayPlayer {
  private bitmap: ImageBitmap | null = null;
  private forEntry: ReplayEntry | null = null;
  private token = 0;

  /** Resolves the background for an entry: falls back to the nearest earlier frame that has an image. */
  async image(entries: ReplayEntry[], index: number): Promise<ImageBitmap | null> {
    let i = index;
    while (i >= 0 && !entries[i].image) i--;
    if (i < 0) return null;
    const e = entries[i];
    if (this.forEntry === e) return this.bitmap;
    const my = ++this.token;
    const bmp = await createImageBitmap(e.image!);
    if (my !== this.token) { bmp.close(); return this.bitmap; }
    this.bitmap?.close();
    this.bitmap = bmp;
    this.forEntry = e;
    return bmp;
  }

  dispose(): void {
    this.bitmap?.close();
    this.bitmap = null;
    this.forEntry = null;
  }
}
