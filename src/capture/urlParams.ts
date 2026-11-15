// Optional link parameters (?preset=bike&ref=...&saddle_cm=74.5). The values arrive from a link, so every
// one is validated here and anything unusable is ignored rather than guessed at.
import { LIFTS } from '../lift/metrics';
import { PRESET_BY_ID } from '../presets/presets';
import type { SummaryContext } from './summary';

export const MAX_REF_CHARS = 200;
export const MAX_SUBJECT_CHARS = 200;
export const MAX_NOTE_CHARS = 500;

export interface UrlParams {
  preset?: string;
  context?: SummaryContext;
  lift?: string;
  loadKg?: number;
  bodyMassKg?: number;
  inseamCm?: number;
  saddleCm?: number;
}

interface Range { min: number; max: number }

/** Same limits as the number fields in the page. */
const RANGES = {
  load_kg: { min: 1, max: 1000 },
  body_mass_kg: { min: 20, max: 250 },
  inseam_cm: { min: 50, max: 110 },
  saddle_cm: { min: 50, max: 110 },
} satisfies Record<string, Range>;

// C0 and C1 controls, DEL, and the Unicode line and paragraph separators.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const PLAIN_NUMBER = /^\d{1,7}(\.\d{1,6})?$/;

/** Control characters removed and the ends trimmed; empty or over-long text is ignored, not shortened. */
export function cleanText(raw: string | null, maxChars: number): string | undefined {
  if (raw === null) return undefined;
  const s = raw.replace(CONTROL, '').trim();
  return s && [...s].length <= maxChars ? s : undefined;
}

/** A plain decimal number within range. No sign, exponent, hex, spaces or empty text. */
export function cleanNumber(raw: string | null, range: Range): number | undefined {
  if (raw === null || !PLAIN_NUMBER.test(raw)) return undefined;
  const v = Number(raw);
  return v >= range.min && v <= range.max ? v : undefined;
}

function cleanId(raw: string | null, known: (id: string) => boolean): string | undefined {
  const id = raw?.trim().toLowerCase();
  return id && known(id) ? id : undefined;
}

function contextOf(q: URLSearchParams): SummaryContext | undefined {
  const ctx: SummaryContext = {};
  const ref = cleanText(q.get('ref'), MAX_REF_CHARS), subject = cleanText(q.get('subject'), MAX_SUBJECT_CHARS), note = cleanText(q.get('note'), MAX_NOTE_CHARS);
  if (ref !== undefined) ctx.ref = ref;
  if (subject !== undefined) ctx.subject = subject;
  if (note !== undefined) ctx.note = note;
  return Object.keys(ctx).length ? ctx : undefined;
}

/** Parses a query string (with or without the leading "?") or a URLSearchParams. Only valid values are returned. */
export function parseUrlParams(input: string | URLSearchParams): UrlParams {
  const q = typeof input === 'string' ? new URLSearchParams(input) : input;
  const out: UrlParams = {};
  const set = <K extends keyof UrlParams>(key: K, value: UrlParams[K] | undefined) => { if (value !== undefined) out[key] = value; };
  set('preset', cleanId(q.get('preset'), (id) => PRESET_BY_ID.has(id)));
  set('context', contextOf(q));
  set('lift', cleanId(q.get('lift'), (id) => LIFTS.some((l) => l.id === id)));
  set('loadKg', cleanNumber(q.get('load_kg'), RANGES.load_kg));
  set('bodyMassKg', cleanNumber(q.get('body_mass_kg'), RANGES.body_mass_kg));
  set('inseamCm', cleanNumber(q.get('inseam_cm'), RANGES.inseam_cm));
  set('saddleCm', cleanNumber(q.get('saddle_cm'), RANGES.saddle_cm));
  return out;
}

/** One line for the page, e.g. "ref swimcoach:bikefit:7c1d0e7a, subject athlete-2". Empty when there is no context. */
export function describeContext(ctx: SummaryContext | null | undefined): string {
  if (!ctx) return '';
  return [ctx.ref !== undefined && `ref ${ctx.ref}`, ctx.subject !== undefined && `subject ${ctx.subject}`, ctx.note !== undefined && `note ${ctx.note}`].filter(Boolean).join(', ');
}
