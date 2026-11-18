// Course settings (from the encrypted pack) and the student's saved work.
import type { Shape } from './annotate/shapes';

export interface PromptDef {
  id: string;
  title: string;
  points?: number;
  /** The assignment's own wording of what to address. */
  detail?: string;
}

export interface AnalysisDef {
  id: string;
  title: string;
  /** 'snapshots': captured frames marked up one by one. 'compare': two clips side by side, synced. */
  kind: 'snapshots' | 'compare';
  /** Which clip of the chosen pair: 1 or 2. Ignored for 'compare', which uses both. */
  clip?: 1 | 2;
  /** Snapshots expected. Defaults to one per prompt. */
  snapshots?: number;
  drawing?: 'required' | 'optional';
  points?: number;
  /** Short instructions shown at the top of the analysis. */
  instructions?: string;
  prompts: PromptDef[];
}

export interface ProjectDef {
  id: string;
  title: string;
  /** Short code used in file names, e.g. "P1". */
  short?: string;
  instructions?: string;
  analyses: AnalysisDef[];
}

export interface VideoDef {
  id: string;
  title: string;
  /** Clips are offered in pairs: the same group (e.g. a sport) with clip 1 and clip 2. */
  group: string;
  clip: 1 | 2;
  /** Path of the encrypted file, relative to the course folder. */
  src: string;
  key: string;
  iv: string;
  mime: string;
  bytes: number;
  fps?: number;
}

export interface CourseConfig {
  version: 1;
  /** Stable id: student work is saved under it. Change it for a new semester to start fresh. */
  id: string;
  title: string;
  projects: ProjectDef[];
  videos: VideoDef[];
  labels?: { snapshot?: string; analysis?: string };
}

export interface Snapshot {
  id: string;
  name: string;
  promptId: string | null;
  videoId: string;
  /** Time in the clip, seconds. */
  time: number;
  image: Blob;
  width: number;
  height: number;
  shapes: Shape[];
}

export interface TimedShape {
  shape: Shape;
  /** On the synced timeline (clip 1 time), seconds. */
  start: number;
  end: number;
}

export interface CompareWork {
  /** Times in clip 1 and clip 2 that show the same moment; null until locked. */
  sync: { a: number; b: number } | null;
  /** Unlocked positions, so the student can come back to them. */
  posA: number;
  posB: number;
  items: TimedShape[];
}

export interface AnalysisWork {
  snapshots: Snapshot[];
  compare?: CompareWork;
}

export interface ProjectWork {
  /** The chosen pair of clips (VideoDef.group), or null. */
  group: string | null;
  analyses: Record<string, AnalysisWork>;
}

export interface Work {
  version: 1;
  student: string;
  projects: Record<string, ProjectWork>;
}
