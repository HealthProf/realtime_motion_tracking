// Fetches the pinned MediaPipe pose models and copies the WASM runtime into public/.
// These are served from our own origin so the app has no runtime CDN dependency.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MODELS = {
  lite: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
  full: '5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1',
  heavy: '64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b',
};
const url = (m) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${m}/float16/1/pose_landmarker_${m}.task`;
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

await mkdir(join(root, 'public/models'), { recursive: true });
for (const [name, expected] of Object.entries(MODELS)) {
  const dest = join(root, `public/models/pose_landmarker_${name}.task`);
  if (existsSync(dest) && sha(await readFile(dest)) === expected) {
    console.log(`model ${name}: ok (cached)`);
    continue;
  }
  const res = await fetch(url(name));
  if (!res.ok) throw new Error(`model ${name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha(buf) !== expected) throw new Error(`model ${name}: checksum mismatch`);
  await writeFile(dest, buf);
  console.log(`model ${name}: downloaded (${(buf.length / 1e6).toFixed(1)} MB)`);
}

const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDest = join(root, 'public/wasm');
await mkdir(wasmDest, { recursive: true });
for (const f of await readdir(wasmSrc)) await copyFile(join(wasmSrc, f), join(wasmDest, f));
console.log('wasm runtime: copied');
