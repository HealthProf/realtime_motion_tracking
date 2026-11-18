// Course pack encryption. The course settings are encrypted with AES-GCM-256 under a key derived from
// the course code (PBKDF2-SHA256); each video is encrypted under its own random key, kept inside the
// encrypted settings. Without the code nothing course-specific can be read.
//
// This file has no imports so that the Node pack script can load it directly.
// Limits: the code is shared by a whole class, so anyone who has it can open the pack. A short code can
// be guessed offline, so use at least 12 characters or several random words.

export const PBKDF2_ITERATIONS = 600_000;

export interface PackEnvelope {
  format: 'motion-lab-course-pack';
  version: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  iv: string;
  data: string;
}

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const randomBytes = (n: number): Uint8Array<ArrayBuffer> => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** Codes are compared after trimming, collapsing spaces and lower-casing, so typing them is forgiving. */
export const normaliseCode = (code: string) => code.trim().replace(/\s+/g, ' ').toLowerCase();

async function deriveKey(code: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', enc.encode(normaliseCode(code)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealPack(json: unknown, code: string, iterations = PBKDF2_ITERATIONS): Promise<PackEnvelope> {
  const salt = randomBytes(16), iv = randomBytes(12);
  const key = await deriveKey(code, salt, iterations);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(json))));
  return { format: 'motion-lab-course-pack', version: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toB64(salt) }, iv: toB64(iv), data: toB64(ct) };
}

export class WrongCodeError extends Error {
  constructor() { super('Code not recognised.'); }
}

/** Decrypts a pack. Throws WrongCodeError if the code is wrong (or the file was altered). */
export async function openPack<T>(env: PackEnvelope, code: string): Promise<T> {
  if (env?.format !== 'motion-lab-course-pack' || env.version !== 1) throw new Error('This course pack is not in a format this version of the app can read.');
  const key = await deriveKey(code, fromB64(env.kdf.salt), env.kdf.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) }, key, fromB64(env.data));
  } catch {
    throw new WrongCodeError();
  }
  return JSON.parse(dec.decode(plain)) as T;
}

/** Encrypts a file under a new random key. Returns the ciphertext and the key and nonce to store. */
export async function sealFile(bytes: Uint8Array<ArrayBuffer>): Promise<{ data: Uint8Array<ArrayBuffer>; key: string; iv: string }> {
  const raw = randomBytes(32), iv = randomBytes(12);
  const key = await subtle().importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const data = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return { data, key: toB64(raw), iv: toB64(iv) };
}

export async function openFile(data: ArrayBuffer | Uint8Array<ArrayBuffer>, keyB64: string, ivB64: string): Promise<ArrayBuffer> {
  const key = await subtle().importKey('raw', fromB64(keyB64), 'AES-GCM', false, ['decrypt']);
  return subtle().decrypt({ name: 'AES-GCM', iv: fromB64(ivB64) }, key, data);
}
