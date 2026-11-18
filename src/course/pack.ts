// Loading the encrypted course pack and its videos in the browser.
import { openFile, openPack, WrongCodeError, type PackEnvelope } from './crypto';
import type { CourseConfig, VideoDef } from './types';

export const PACK_URL = 'course/pack.json';
const CODE_KEY = 'motion-lab-course-code';

export class NoPackError extends Error {
  constructor() { super('No course pack is installed on this site yet. Ask your instructor.'); }
}

export async function fetchEnvelope(url = PACK_URL): Promise<PackEnvelope> {
  let res: Response;
  try { res = await fetch(url, { cache: 'no-cache' }); } catch { throw new Error('Could not reach the site to load the course. Check your connection and try again.'); }
  if (res.status === 404) throw new NoPackError();
  if (!res.ok) throw new Error(`Could not load the course (error ${res.status}).`);
  try { return (await res.json()) as PackEnvelope; } catch { throw new NoPackError(); }
}

export async function unlock(code: string, url = PACK_URL): Promise<CourseConfig> {
  const env = await fetchEnvelope(url);
  const cfg = await openPack<CourseConfig>(env, code);
  if (cfg.version !== 1 || !Array.isArray(cfg.projects)) throw new Error('The course pack is damaged or from a newer version of the app.');
  cfg.videos ??= [];
  return cfg;
}

export { WrongCodeError };

export function rememberedCode(): string | null {
  try { return localStorage.getItem(CODE_KEY); } catch { return null; }
}

export function rememberCode(code: string | null): void {
  try { if (code) localStorage.setItem(CODE_KEY, code); else localStorage.removeItem(CODE_KEY); } catch { /* storage blocked: the code is asked for each visit */ }
}

const videoUrls = new Map<string, Promise<string>>();

/** Downloads and decrypts a course video once per visit; resolves with an object URL. */
export function videoUrl(v: VideoDef, onProgress?: (fraction: number) => void, base = 'course/'): Promise<string> {
  let p = videoUrls.get(v.id);
  if (!p) {
    p = (async () => {
      const res = await fetch(base + v.src);
      if (!res.ok || !res.body) throw new Error(`Could not download "${v.title}" (error ${res.status}).`);
      const total = Number(res.headers.get('content-length')) || v.bytes || 0;
      const reader = res.body.getReader(), parts: Uint8Array[] = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        got += value.length;
        if (total) onProgress?.(Math.min(1, got / total));
      }
      const data = new Uint8Array(got);
      let o = 0;
      for (const part of parts) { data.set(part, o); o += part.length; }
      let plain: ArrayBuffer;
      try { plain = await openFile(data, v.key, v.iv); } catch { throw new Error(`"${v.title}" could not be decrypted. The course pack may be out of date: reload the page.`); }
      return URL.createObjectURL(new Blob([plain], { type: v.mime }));
    })();
    p.catch(() => videoUrls.delete(v.id));
    videoUrls.set(v.id, p);
  }
  return p;
}
