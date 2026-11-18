// The instructor's pack script (Node). Kept apart from the browser-typed tests: see tsconfig "exclude".
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openFile, openPack, type PackEnvelope } from '../../src/course/crypto';
import type { CourseConfig } from '../../src/course/types';

const FAST = 1000;

describe('pack script', () => {
  it('the pack script writes a pack that the app can open, with decryptable videos', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-')), src = join(dir, 'src'), out = join(dir, 'out');
    mkdirSync(src);
    const video = new Uint8Array(5000).map((_, i) => i % 256);
    writeFileSync(join(src, 'clip.mp4'), video);
    writeFileSync(join(src, 'course.json'), JSON.stringify({
      id: 'test', title: 'Test course', projects: [{ id: 'p1', title: 'P1', analyses: [] }],
      videos: [{ id: 'c1', title: 'Clip one', group: 'G', clip: 1, file: 'clip.mp4', fps: 30 }],
    }));
    execFileSync('node', ['scripts/pack-course.mjs', '--code', 'short', '--allow-short', '--src', src, '--out', out, '--iterations', String(FAST)], { stdio: 'pipe' });
    const env = JSON.parse(readFileSync(join(out, 'pack.json'), 'utf8')) as PackEnvelope;
    const cfg = await openPack<CourseConfig>(env, 'short');
    expect(cfg.title).toBe('Test course');
    expect(cfg.videos[0]).toMatchObject({ id: 'c1', src: 'v/c1.bin', mime: 'video/mp4', fps: 30 });
    expect((cfg.videos[0] as unknown as Record<string, unknown>).file).toBeUndefined();
    const bin = new Uint8Array(readFileSync(join(out, 'v', 'c1.bin')));
    expect(new Uint8Array(await openFile(bin, cfg.videos[0].key, cfg.videos[0].iv))).toEqual(video);
  });

  it('the pack script refuses a short code', () => {
    expect(() => execFileSync('node', ['scripts/pack-course.mjs', '--code', 'abc', '--src', 'nowhere'], { stdio: 'pipe' })).toThrow();
  });
});
