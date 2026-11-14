// Instant replay: a rolling buffer of the last few seconds (compressed frames plus pose data) that can
// be scrubbed with measurements intact, and promoted to a trial. The delayed view reads from the same buffer.
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
  /** Bytes of stored pictures. */
  bytes = 0;
  /** Width (pixels) of the most recently stored picture; 0 until one is stored. */
  storedWidth = 0;
  private scratch = document.createElement('canvas');
  private pending = 0;
  private generation = 0;
  private minImageInterval = 0;
  private lastImageT = -Infinity;
  private shrink = 1;
  private shrunkAt = -Infinity;

  /** `budgetBytes`: above this, new pictures are stored progressively smaller (down to half width). */
  constructor(public seconds: number, public maxWidth: number, private budgetBytes = Infinity) {}

  /** Changes the buffer length and picture size. `minImageInterval` (s) limits how often a picture is stored. */
  configure(seconds: number, maxWidth: number, minImageInterval = 0): void {
    if (maxWidth !== this.maxWidth) this.shrink = 1;
    this.seconds = seconds;
    this.maxWidth = maxWidth;
    this.minImageInterval = minImageInterval;
  }

  clear(): void {
    this.entries = [];
    this.bytes = 0;
    this.generation++;
    this.lastImageT = -Infinity;
  }

  get duration(): number {
    const e = this.entries;
    return e.length > 1 ? e[e.length - 1].frame.t - e[0].frame.t : 0;
  }

  /** Adds a frame. `source` is drawn (downscaled) and JPEG-encoded asynchronously; encoding is skipped if it falls behind. */
  push(frame: PoseFrame, sample: LiveSample, source: CanvasImageSource | null, mirror: boolean): void {
    const entry: ReplayEntry = { frame, sample, image: null };
    this.entries.push(entry);
    while (this.entries.length > 2 && frame.t - this.entries[0].frame.t > this.seconds) this.bytes -= this.entries.shift()!.image?.size ?? 0;
    if (!source || this.pending >= 3) return;
    if (frame.t < this.lastImageT) this.lastImageT = -Infinity;
    if (frame.t - this.lastImageT < this.minImageInterval) return;
    this.lastImageT = frame.t;
    if (this.bytes > this.budgetBytes && Math.abs(frame.t - this.shrunkAt) > 1) { this.shrink = Math.max(0.5, this.shrink * 0.9); this.shrunkAt = frame.t; }
    const scale = Math.min(1, (this.maxWidth * this.shrink) / frame.w);
    const cw = Math.round(frame.w * scale), ch = Math.round(frame.h * scale);
    if (this.scratch.width !== cw || this.scratch.height !== ch) { this.scratch.width = cw; this.scratch.height = ch; }
    const ctx = this.scratch.getContext('2d')!;
    ctx.setTransform(mirror ? -1 : 1, 0, 0, 1, mirror ? cw : 0, 0);
    ctx.drawImage(source, 0, 0, cw, ch);
    this.storedWidth = cw;
    this.pending++;
    const generation = this.generation;
    this.scratch.toBlob((b) => {
      this.pending--;
      if (!b || generation !== this.generation) return;
      entry.image = b;
      this.bytes += b.size;
    }, 'image/jpeg', 0.7);
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
