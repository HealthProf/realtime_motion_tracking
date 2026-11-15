import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { parseSession, sessionJson } from '../../src/capture/csv';
import { processTrial } from '../../src/capture/process';
import { analysisKind, buildSummary, num, summaryJson, summaryResultsFor, SUMMARY_FORMAT, type Summary, type SummaryResults } from '../../src/capture/summary';
import { newTrialId } from '../../src/capture/trial';
import { withheld } from '../../src/modes/report';
import { EXAMPLE_CONTEXT, fixtureInputs, fixtureOptions, fixtureSummary, fixtureTrial, PRESET_IDS } from './summaryFixtures';

const SCHEMA_URL = new URL('../../schema/summary.v1.schema.json', import.meta.url);
const EXAMPLES_URL = new URL('../../schema/examples/', import.meta.url);
const schema = JSON.parse(readFileSync(SCHEMA_URL, 'utf8'));

/** The same schema with extra properties forbidden everywhere, so the code cannot emit a field the schema does not describe. */
function strict(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strict);
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) out[k] = k === 'properties' ? Object.fromEntries(Object.entries(v as object).map(([n, s]) => [n, strict(s)])) : strict(v);
  if (out.type === 'object' && 'properties' in out) out.additionalProperties = false;
  return out;
}

const make = (s: object) => addFormats(new Ajv2020({ allErrors: true, strict: false })).compile(s);
const validate = make(schema), validateStrict = make(strict(schema) as object);
const errors = (v: typeof validate) => JSON.stringify(v.errors, null, 1);

const results = (preset: string, context = null as SummaryResults['context']) => {
  const trial = fixtureTrial(preset), opts = fixtureOptions(preset);
  return { trial, res: summaryResultsFor(trial, processTrial(trial, opts), opts, fixtureInputs(preset, opts), context) };
};

const filled = (s: Summary) => (['report', 'reps', 'lift', 'jump'] as const).filter((k) => s[k] !== null);

describe('value rules', () => {
  it('turns NaN, infinities and undefined into null and keeps real numbers', () => {
    expect(num(NaN)).toBeNull();
    expect(num(Infinity)).toBeNull();
    expect(num(-Infinity)).toBeNull();
    expect(num(undefined)).toBeNull();
    expect(num(0)).toBe(0);
    expect(num(1 / 3)).toBe(0.3333333);
  });

  it('writes a withheld metric row (mean NaN) as null', () => {
    const { trial, res } = results('bike');
    res.report!.rows[0] = withheld('knee_bdc', 'Knee flexion at the bottom of the stroke', 'deg', 'Fewer than 3 clean pedal revolutions were found.');
    const row = buildSummary(trial, res).report!.rows[0];
    expect(row).toMatchObject({ id: 'knee_bdc', mean: null, sd: null, n: 0, band: null, status: 'withheld', ref: null, note: 'Fewer than 3 clean pedal revolutions were found.' });
    expect(JSON.stringify(row)).not.toMatch(/NaN/);
  });

  it('turns NaN inside nested lift, rep and jump values into null', () => {
    const lift = results('lift');
    lift.res.lift!.reps[0].loweringTime = NaN;
    lift.res.lift!.reps[0].systemWork = Infinity;
    const lr = buildSummary(lift.trial, lift.res).lift!.reps[0];
    expect(lr.lowering_time_s).toBeNull();
    expect(lr.system_work_j).toBeNull();
    expect(lr.mean_velocity_ms).not.toBeNull();
    const reps = results('squat');
    reps.res.reps!.symmetryPct = NaN;
    reps.res.reps!.reps[0].peakVelocity = NaN;
    expect(buildSummary(reps.trial, reps.res).reps!.items[0].peak_velocity).toBeNull();
    const jump = results('jump');
    jump.res.jump!.jumps[0].heightCom = NaN;
    expect(buildSummary(jump.trial, jump.res).jump!.jumps[0].height_com_m).toBeNull();
  });

  it('survives a JSON round trip unchanged, with no NaN or undefined leaking through', () => {
    for (const id of PRESET_IDS) {
      const s = fixtureSummary(id, EXAMPLE_CONTEXT[id] ?? null);
      expect(JSON.parse(JSON.stringify(s))).toEqual(s);
      expect(JSON.stringify(s)).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
});

describe('times in seconds', () => {
  it('converts repetition row indices to seconds from the start of the trial', () => {
    const { trial, res } = results('squat');
    const items = buildSummary(trial, res).reps!.items;
    expect(items.length).toBeGreaterThanOrEqual(2);
    const p = res.processed;
    items.forEach((it, i) => {
      const r = res.reps!.reps[i];
      expect(it.start_s).toBeCloseTo(p.t[r.start], 5);
      expect(it.end_s).toBeCloseTo(p.t[r.end], 5);
      expect(it.start_s! <= it.peak_s! && it.peak_s! <= it.end_s!).toBe(true);
      expect(it.start_s).toBeCloseTo(r.start / p.fs, 2);
    });
    expect(items[1].start_s!).toBeGreaterThan(items[0].end_s! - 0.5);
    expect(items[items.length - 1].end_s!).toBeLessThanOrEqual(trial.frames[trial.frames.length - 1].t + 1e-6);
  });

  it('converts lift repetition row indices to seconds and reports durations consistent with them', () => {
    const { trial, res } = results('lift');
    const reps = buildSummary(trial, res).lift!.reps;
    expect(reps).toHaveLength(2);
    reps.forEach((r, i) => {
      expect(r.start_s).toBeCloseTo(res.processed.t[res.lift!.reps[i].start], 5);
      expect(r.end_s! - r.start_s!).toBeCloseTo(r.duration_s!, 1);
    });
  });

  it('uses the recorded timestamps, not index over nominal fps, when frames are irregular', () => {
    const trial = fixtureTrial('squat');
    trial.frames.forEach((f) => { f.t *= 1.25; });
    const opts = fixtureOptions('squat');
    const res = summaryResultsFor(trial, processTrial(trial, opts), opts, fixtureInputs('squat', opts), null);
    const s = buildSummary(trial, res);
    expect(s.duration_s).toBeCloseTo(trial.frames[trial.frames.length - 1].t, 2);
    const second = res.reps!.reps[1];
    expect(s.reps!.items[1].start_s).toBeCloseTo(res.processed.t[second.start], 5);
    expect(s.reps!.items[1].start_s).not.toBeCloseTo(second.start / trial.meta.nominalFps, 1);
  });

  it('reports jump times as seconds and heights in metres', () => {
    const j = fixtureSummary('jump').jump!.jumps[0];
    expect(j.landing_s! - j.takeoff_s!).toBeCloseTo(j.flight_time_s!, 4);
    expect(j.height_flight_m).toBeCloseTo((9.81 * j.flight_time_s! ** 2) / 8, 3);
  });
});

describe('which block is filled', () => {
  const expected: Record<string, string[]> = {
    free: [], squat: ['reps'], 'sit-to-stand': ['reps'], gait: ['reps'], reach: ['reps'], jump: ['jump'], bike: ['report'], run: ['report'], lift: ['lift'],
  };
  for (const id of PRESET_IDS) {
    it(`${id}: ${expected[id].join(', ') || 'none'} filled, the rest null`, () => {
      expect(filled(fixtureSummary(id))).toEqual(expected[id]);
    });
  }

  it('picks the kind from the preset analysis list', () => {
    expect(analysisKind('bike')).toBe('bike');
    expect(analysisKind('reach')).toBe('reps');
    expect(analysisKind('free')).toBeNull();
    expect(analysisKind('no-such-preset')).toBeNull();
  });

  it('leaves everything null and says why when the analysis cannot be produced', () => {
    const trial = fixtureTrial('lift');
    trial.frames.forEach((f) => { delete f.bar; });
    const opts = fixtureOptions('lift');
    const s = buildSummary(trial, summaryResultsFor(trial, processTrial(trial, opts), opts, fixtureInputs('lift', opts), null));
    expect(filled(s)).toEqual([]);
    expect(s.capture.warnings.join(' ')).toMatch(/bar was not located/);
  });
});

describe('content', () => {
  it('has the format header, preset, app version and ISO time', () => {
    const s = fixtureSummary('bike');
    expect(s).toMatchObject({ format: SUMMARY_FORMAT, version: 1, preset: 'bike', app_version: __APP_VERSION__, recorded_at: '2026-01-01T00:00:00.000Z' });
    expect(s.duration_s).toBeCloseTo(12, 1);
  });

  it('maps report rows by id with unit, reference and band', () => {
    const rows = fixtureSummary('bike').report!.rows;
    const bdc = rows.find((r) => r.id === 'knee_bdc')!;
    expect(bdc).toMatchObject({ unit: 'deg', band: 5, ref: { id: 'bikeKneeBdc', low: 30, high: 40, doi: '10.1519/JSC.0b013e318245c09d' } });
    expect(bdc.ref!.citation).toMatch(/Ferrer-Roca/);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(rows.find((r) => r.id === 'cadence')!.ref).toBeNull();
  });

  it('copies the typed inputs, and lift settings, into the summary', () => {
    expect(fixtureSummary('bike').inputs).toEqual({ inseam_cm: 84, saddle_cm: 74.5, speed_kmh: null });
    expect(fixtureSummary('run').inputs.speed_kmh).toBe(10);
    expect(fixtureSummary('lift').lift).toMatchObject({ lift: 'squat', load_kg: 80, body_mass_kg: 78 });
  });

  it('reports the bar source of each lift rep: plate, hands, or unknown', () => {
    const trial = fixtureTrial('lift');
    expect(fixtureSummary('lift', null, trial).lift!.reps.map((r) => r.bar_source)).toEqual(['plate', 'plate']);
    trial.frames.forEach((f) => { if (f.bar) f.bar.src = 'hands'; });
    expect(fixtureSummary('lift', null, trial).lift!.reps.map((r) => r.bar_source)).toEqual(['hands', 'hands']);
  });

  it('gives a symmetry index for a frontal two-sided preset and null otherwise', () => {
    expect(fixtureSummary('reach').reps!.symmetry_index_pct).toBeCloseTo(-13.3, 0);
    expect(fixtureSummary('squat').reps!.symmetry_index_pct).toBeNull();
  });

  it('copies context through unchanged, and is null without one', () => {
    const ctx = { ref: 'swimcoach:bikefit:7c1d0e7a', subject: 'athlete-2', note: 'after raising saddle 5 mm <b>&</b> "quotes"' };
    const s = fixtureSummary('bike', ctx);
    expect(s.context).toEqual(ctx);
    expect(s.context).not.toBe(ctx);
    expect(fixtureSummary('bike', { ref: 'only-ref' }).context).toEqual({ ref: 'only-ref' });
    expect(fixtureSummary('bike').context).toBeNull();
  });

  it('holds no landmarks, world points, frames or video', () => {
    const banned = new Set(['lm', 'world', 'frames', 'landmarks', 'video', 'bar']);
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { expect(banned.has(k)).toBe(false); walk(x); }
    };
    for (const id of PRESET_IDS) {
      const text = summaryJson(fixtureTrial(id), results(id).res);
      walk(JSON.parse(text));
      expect(text.length).toBeLessThan(20000);
    }
  });
});

describe('trial id and the session format', () => {
  it('is the same on every summary of one trial, and differs between trials', () => {
    const { trial, res } = results('squat');
    const a = buildSummary(trial, res), b = buildSummary(trial, res);
    expect(a.trial_id).toBe(trial.id);
    expect(b.trial_id).toBe(a.trial_id);
    expect(a.trial_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newTrialId()).not.toBe(newTrialId());
  });

  it('keeps the session file format unchanged: no id is written, and a loaded trial gets a new one in memory', () => {
    const trial = fixtureTrial('squat');
    const text = sessionJson(trial);
    const doc = JSON.parse(text);
    expect(Object.keys(doc)).toEqual(['format', 'version', 'meta', 'marks', 'frames']);
    expect(text).not.toContain(trial.id);
    const again = parseSession(text);
    expect(again.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(again.id).not.toBe(trial.id);
    expect(sessionJson(again)).toBe(text);
    expect(buildSummary(again, results('squat').res).trial_id).toBe(again.id);
  });
});

describe('schema', () => {
  const files = readdirSync(EXAMPLES_URL).filter((f) => f.endsWith('.json')).sort();

  it('has one example per preset', () => {
    expect(files).toEqual(PRESET_IDS.map((id) => `${id}.json`).sort());
  });

  for (const id of PRESET_IDS) {
    it(`example ${id}.json is valid`, () => {
      const doc = JSON.parse(readFileSync(new URL(`${id}.json`, EXAMPLES_URL), 'utf8'));
      expect(validate(doc), errors(validate)).toBe(true);
      expect(validateStrict(doc), errors(validateStrict)).toBe(true);
      expect(doc.preset).toBe(id);
    });

    it(`example ${id}.json matches what the code produces now`, () => {
      const doc = JSON.parse(readFileSync(new URL(`${id}.json`, EXAMPLES_URL), 'utf8'));
      const fresh = JSON.parse(summaryJson(fixtureTrial(id), results(id, EXAMPLE_CONTEXT[id] ?? null).res));
      expect({ ...doc, app_version: '' }).toEqual({ ...fresh, app_version: '' });
    });

    it(`a freshly generated ${id} summary is valid, with no field the schema does not describe`, () => {
      const s = fixtureSummary(id, EXAMPLE_CONTEXT[id] ?? null);
      expect(validateStrict(s), errors(validateStrict)).toBe(true);
    });
  }

  it('rejects documents that break the rules', () => {
    const good = fixtureSummary('bike');
    const bad = (patch: object) => validate({ ...JSON.parse(JSON.stringify(good)), ...patch });
    expect(bad({})).toBe(true);
    expect(bad({ version: 2 })).toBe(false);
    expect(bad({ format: 'other' })).toBe(false);
    expect(bad({ trial_id: 'not-a-uuid' })).toBe(false);
    expect(bad({ reps: { joint: 'knee', side: null, unit: 'deg', velocity_unit: 'deg/s', items: [], symmetry_index_pct: null } })).toBe(false);
    expect(bad({ report: null })).toBe(true);
    expect(bad({ capture: { ...good.capture, view: 'diagonal' } })).toBe(false);
  });

  it('allows fields it does not know, as the stability promise requires', () => {
    expect(validate({ ...fixtureSummary('squat'), added_later: { x: 1 } })).toBe(true);
  });
});

if (process.env.WRITE_EXAMPLES) {
  describe('write examples', () => {
    it('regenerates schema/examples from the synthetic trials', () => {
      mkdirSync(EXAMPLES_URL, { recursive: true });
      for (const id of PRESET_IDS) writeFileSync(new URL(`${id}.json`, EXAMPLES_URL), summaryJson(fixtureTrial(id), results(id, EXAMPLE_CONTEXT[id] ?? null).res));
    });
  });
}
