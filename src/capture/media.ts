// Screenshots, video recording and file downloads. Everything stays on the device.

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const textBlob = (text: string, type: string) => new Blob([text], { type });

export function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the screenshot.'))), 'image/png'));
}

export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const MIME_CANDIDATES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

export function pickVideoMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

/** Records the composited canvas (video plus overlays) to a local file. */
export class VideoRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  mime = pickVideoMime();

  get supported(): boolean { return !!this.mime && 'captureStream' in HTMLCanvasElement.prototype; }
  get active(): boolean { return this.rec?.state === 'recording'; }
  get extension(): string { return this.mime?.startsWith('video/mp4') ? 'mp4' : 'webm'; }

  start(canvas: HTMLCanvasElement, fps: number): void {
    if (!this.supported || this.active) return;
    this.stream = canvas.captureStream(Math.min(60, Math.max(15, Math.round(fps) || 30)));
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream, { mimeType: this.mime!, videoBitsPerSecond: 6_000_000 });
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start(1000);
  }

  stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const rec = this.rec;
      if (!rec || rec.state === 'inactive') return resolve(null);
      rec.onstop = () => {
        this.stream?.getTracks().forEach((t) => t.stop());
        resolve(new Blob(this.chunks, { type: this.mime!.split(';')[0] }));
      };
      rec.stop();
    });
  }
}
