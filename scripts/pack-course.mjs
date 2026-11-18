#!/usr/bin/env node
// Builds the encrypted course pack from a plaintext folder that is never committed.
//
//   COURSE_CODE="three random words" npm run pack
//   npm run pack -- --code "three random words" [--src course-src] [--out public/course]
//
// Reads <src>/course.json and the video files it names, then writes <out>/pack.json (the encrypted
// settings) and <out>/v/<id>.bin (each video encrypted with its own key). Old .bin files that are no
// longer in the settings are removed. Commit only the <out> folder.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { normaliseCode, PBKDF2_ITERATIONS, sealFile, sealPack } from '../src/course/crypto.ts';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const fail = (msg) => { console.error(`pack-course: ${msg}`); process.exit(1); };

const code = opt('code', process.env.COURSE_CODE);
const src = resolve(opt('src', 'course-src'));
const out = resolve(opt('out', 'public/course'));
const iterations = Number(opt('iterations', PBKDF2_ITERATIONS));
if (!code) fail('give the course code with --code "..." or the COURSE_CODE environment variable.');
if (normaliseCode(code).length < 12 && !args.includes('--allow-short')) fail('the code is shorter than 12 characters and could be guessed. Use several random words, or pass --allow-short for testing.');
if (!existsSync(join(src, 'course.json'))) fail(`${join(src, 'course.json')} not found. Copy course-src.example to course-src and edit it.`);

const cfg = JSON.parse(readFileSync(join(src, 'course.json'), 'utf8'));
for (const key of ['id', 'title', 'projects']) if (!cfg[key]) fail(`course.json needs "${key}".`);

const MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm' };

function probeFps(file) {
  try {
    const r = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim();
    const [n, d] = r.split('/').map(Number);
    return d ? n / d : n || undefined;
  } catch {
    return undefined;
  }
}

mkdirSync(join(out, 'v'), { recursive: true });
const videos = [];
for (const v of cfg.videos ?? []) {
  for (const key of ['id', 'title', 'group', 'clip', 'file']) if (v[key] === undefined) fail(`each video needs "${key}" (problem with ${JSON.stringify(v)}).`);
  if (!/^[a-z0-9_-]+$/i.test(v.id)) fail(`video id "${v.id}" may only use letters, digits, - and _.`);
  const file = join(src, v.file);
  if (!existsSync(file)) fail(`video file ${file} not found.`);
  const mime = v.mime ?? MIME[extname(file).toLowerCase()];
  if (!mime) fail(`unknown video type for ${v.file}: give "mime".`);
  const sealed = await sealFile(new Uint8Array(readFileSync(file)));
  writeFileSync(join(out, 'v', `${v.id}.bin`), sealed.data);
  const fps = v.fps ?? probeFps(file);
  const { file: _file, ...rest } = v;
  videos.push({ ...rest, src: `v/${v.id}.bin`, key: sealed.key, iv: sealed.iv, mime, bytes: sealed.data.length, ...(fps ? { fps: Math.round(fps * 1000) / 1000 } : {}) });
  console.log(`  ${v.id}: ${v.file} (${(sealed.data.length / 1e6).toFixed(1)} MB${fps ? `, ${fps.toFixed(2)} fps` : ''})`);
}
for (const f of readdirSync(join(out, 'v'))) if (f.endsWith('.bin') && !videos.some((v) => v.src === `v/${f}`)) rmSync(join(out, 'v', f));

const envelope = await sealPack({ ...cfg, version: 1, videos }, code, iterations);
writeFileSync(join(out, 'pack.json'), JSON.stringify(envelope));
console.log(`Wrote ${join(out, 'pack.json')} with ${cfg.projects.length} project(s) and ${videos.length} video(s).`);
