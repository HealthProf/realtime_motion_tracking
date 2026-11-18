// Saving the student's work on this device (IndexedDB), with an in-memory fallback, and backup files.
import { fromB64, toB64 } from './crypto';
import type { AnalysisWork, ProjectWork, Snapshot, Work } from './types';

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

export class MemoryKV implements KV {
  private m = new Map<string, unknown>();
  async get<T>(key: string) { return this.m.get(key) as T | undefined; }
  async set(key: string, value: unknown) { this.m.set(key, value); }
  async del(key: string) { this.m.delete(key); }
}

const DB = 'motion-lab-course', STORE = 'kv';

export class IdbKV implements KV {
  private db: Promise<IDBDatabase>;
  constructor() {
    this.db = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  private async run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result as T);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  get<T>(key: string) { return this.run<T | undefined>('readonly', (s) => s.get(key)); }
  async set(key: string, value: unknown) { await this.run('readwrite', (s) => s.put(value, key)); }
  async del(key: string) { await this.run('readwrite', (s) => s.delete(key)); }
}

/** IndexedDB if it works here (it can be blocked in private windows), otherwise memory only. */
export async function openKV(): Promise<{ kv: KV; persistent: boolean }> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('no indexedDB');
    const kv = new IdbKV();
    await kv.set('probe', 1);
    return { kv, persistent: true };
  } catch {
    return { kv: new MemoryKV(), persistent: false };
  }
}

export const emptyWork = (): Work => ({ version: 1, student: '', projects: {} });

export function projectWork(w: Work, projectId: string): ProjectWork {
  return (w.projects[projectId] ??= { group: null, analyses: {} });
}

export function analysisWork(w: Work, projectId: string, analysisId: string): AnalysisWork {
  const p = projectWork(w, projectId);
  return (p.analyses[analysisId] ??= { snapshots: [] });
}

const workKey = (courseId: string) => `work:${courseId}`;
export const localVideoKey = (courseId: string, projectId: string, clip: number) => `video:${courseId}:${projectId}:${clip}`;

export async function loadWork(kv: KV, courseId: string): Promise<Work> {
  const w = await kv.get<Work>(workKey(courseId));
  return w?.version === 1 ? w : emptyWork();
}

/** Saves after a short pause, so a burst of edits is written once. */
export class Saver {
  private timer = 0;
  private pending: Promise<void> = Promise.resolve();
  constructor(private kv: KV, private courseId: string, private get: () => Work, private onSaved: (ok: boolean) => void, private delay = 600) {}
  schedule(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), this.delay);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    this.pending = this.pending.then(async () => {
      try { await this.kv.set(workKey(this.courseId), this.get()); this.onSaved(true); } catch { this.onSaved(false); }
    });
    return this.pending;
  }
}

// ---- Backup files -----------------------------------------------------------------------------

interface BackupImage { type: string; data: string }
type BackupSnapshot = Omit<Snapshot, 'image'> & { image: BackupImage };

export interface Backup {
  format: 'motion-lab-course-work';
  version: 1;
  courseId: string;
  savedAt: string;
  work: Omit<Work, 'projects'> & { projects: Record<string, Omit<ProjectWork, 'analyses'> & { analyses: Record<string, Omit<AnalysisWork, 'snapshots'> & { snapshots: BackupSnapshot[] }> }> };
}

/** Work as a JSON-safe object, with snapshot pictures embedded. Chosen video files are not included. */
export async function toBackup(work: Work, courseId: string): Promise<Backup> {
  const projects: Backup['work']['projects'] = {};
  for (const [pid, p] of Object.entries(work.projects)) {
    const analyses: Backup['work']['projects'][string]['analyses'] = {};
    for (const [aid, a] of Object.entries(p.analyses)) {
      const snapshots: BackupSnapshot[] = [];
      for (const s of a.snapshots) snapshots.push({ ...s, image: { type: s.image.type, data: toB64(new Uint8Array(await s.image.arrayBuffer())) } });
      analyses[aid] = { ...a, snapshots };
    }
    projects[pid] = { ...p, analyses };
  }
  return { format: 'motion-lab-course-work', version: 1, courseId, savedAt: new Date().toISOString(), work: { ...work, projects } };
}

export function fromBackup(b: Backup, courseId: string): Work {
  if (b?.format !== 'motion-lab-course-work' || b.version !== 1) throw new Error('That file is not a course work backup.');
  if (b.courseId !== courseId) throw new Error('That backup belongs to a different course.');
  const projects: Work['projects'] = {};
  for (const [pid, p] of Object.entries(b.work.projects)) {
    const analyses: Record<string, AnalysisWork> = {};
    for (const [aid, a] of Object.entries(p.analyses)) {
      analyses[aid] = { ...a, snapshots: a.snapshots.map((s) => ({ ...s, image: new Blob([fromB64(s.image.data)], { type: s.image.type }) })) };
    }
    projects[pid] = { ...p, analyses };
  }
  return { ...b.work, projects };
}
