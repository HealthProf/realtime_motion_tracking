// Synthetic trials for the summary tests: one per preset, deterministic so the committed examples can be checked.
import { processTrial, type ProcessOptions } from '../../src/capture/process';
import { buildSummary, summaryResultsFor, type Summary, type SummaryContext } from '../../src/capture/summary';
import { TrialRecorder, type Trial, type TrialMeta } from '../../src/capture/trial';
import { calibrateFromLength } from '../../src/kinematics/calibration';
import { ANGLE_BY_ID } from '../../src/measure/definitions';
import type { ModeInputs } from '../../src/modes/bike';
import { PRESET_BY_ID, PRESETS, resolvePreset } from '../../src/presets/presets';
import { SYNTH, syntheticBar, syntheticFrame, type SyntheticActivity } from '../../src/pose/synthetic';

export const PRESET_IDS = PRESETS.map((p) => p.id);

const ACTIVITY: Record<string, { activity: SyntheticActivity; seconds: number; fps: number }> = {
  free: { activity: 'squat', seconds: 4, fps: 60 },
  squat: { activity: 'squat', seconds: 6, fps: 60 },
  'sit-to-stand': { activity: 'squat', seconds: 6, fps: 60 },
  jump: { activity: 'jump', seconds: 4, fps: 60 },
  gait: { activity: 'run', seconds: 4, fps: 60 },
  reach: { activity: 'raise', seconds: 8, fps: 60 },
  bike: { activity: 'cycle', seconds: 12, fps: 60 },
  run: { activity: 'run', seconds: 12, fps: 120 },
  lift: { activity: 'lift', seconds: 2 * SYNTH.liftPeriod, fps: 60 },
};

const metaFor = (preset: string): TrialMeta => ({
  appVersion: 'test', startedAt: '2026-01-01T00:00:00Z', source: 'synthetic', cameraLabel: 'synthetic', nominalFps: ACTIVITY[preset].fps,
  timestampSource: 'synthetic', model: 'synthetic', delegate: 'none', mirrored: false, width: SYNTH.width, height: SYNTH.height,
  calibration: calibrateFromLength({ x: 0, y: 0 }, { x: SYNTH.pxPerMetre, y: 0 }, 1, { x: SYNTH.width / 2, y: SYNTH.groundY }),
  bodyModel: 'average', preset, notes: '',
  ...(preset === 'lift' ? { lift: { lift: 'squat', loadKg: 80, bodyMassKg: 78 } } : {}),
});

/** The plate centre in image pixels, as the plate tracker would report it. */
function barAt(t: number) {
  const b = syntheticBar(t);
  return { x: SYNTH.width / 2 + b.x * SYNTH.pxPerMetre, y: SYNTH.groundY - b.y * SYNTH.pxPerMetre, r: 0.225 * SYNTH.pxPerMetre, src: 'plate' as const };
}

export function fixtureTrial(preset: string): Trial {
  const { activity, seconds, fps } = ACTIVITY[preset];
  const rec = new TrialRecorder();
  rec.start(metaFor(preset));
  for (let i = 0; i <= seconds * fps; i++) {
    const f = syntheticFrame(i / fps, activity);
    f.t = 10 + i / fps;
    if (preset === 'lift') f.bar = barAt(i / fps);
    rec.add(f);
  }
  rec.mark('key moment');
  const trial = rec.stop()!;
  trial.id = `00000000-0000-4000-8000-${String(PRESET_IDS.indexOf(preset) + 1).padStart(12, '0')}`;
  return trial;
}

export function fixtureOptions(preset: string): ProcessOptions {
  const p = PRESET_BY_ID.get(preset)!;
  const r = resolvePreset(p, preset === 'reach' ? ['l', 'r'] : ['l']);
  return {
    cutoff: p.cutoff, angles: r.angles.filter((id) => ANGLE_BY_ID.has(id)), points: r.points, convention: 'anatomical', minVisibility: 0.5,
    bodyModel: 'average', maxGap: 0.25, include3d: false,
  };
}

export function fixtureInputs(preset: string, o: ProcessOptions): ModeInputs {
  return { cutoff: o.cutoff, minVisibility: o.minVisibility, bodyModel: o.bodyModel, ...(preset === 'bike' ? { inseamCm: 84, saddleCm: 74.5 } : {}), ...(preset === 'run' ? { speedKmh: 10 } : {}) };
}

export function fixtureSummary(preset: string, context: SummaryContext | null = null, trial: Trial = fixtureTrial(preset)): Summary {
  const opts = fixtureOptions(preset);
  const results = summaryResultsFor(trial, processTrial(trial, opts), opts, fixtureInputs(preset, opts), context);
  return buildSummary(trial, results);
}

export const EXAMPLE_CONTEXT: Record<string, SummaryContext | null> = {
  bike: { ref: 'swimcoach:bikefit:7c1d0e7a', subject: 'athlete-2', note: 'after raising saddle 5 mm' },
  lift: { ref: 'swimcoach:strength:3f9a', subject: 'athlete-2' },
};
