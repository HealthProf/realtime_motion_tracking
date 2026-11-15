import { describe, expect, it } from 'vitest';
import { cleanNumber, cleanText, describeContext, MAX_NOTE_CHARS, MAX_REF_CHARS, MAX_SUBJECT_CHARS, parseUrlParams } from '../../src/capture/urlParams';

describe('URL parameters', () => {
  it('reads every valid parameter, from a string or a URLSearchParams', () => {
    const qs = 'preset=bike&ref=swimcoach:bikefit:7c1d0e7a&subject=athlete-2&note=after%20raising%20saddle&lift=squat&load_kg=80.5&body_mass_kg=78&inseam_cm=84&saddle_cm=74.5';
    const want = {
      preset: 'bike', context: { ref: 'swimcoach:bikefit:7c1d0e7a', subject: 'athlete-2', note: 'after raising saddle' },
      lift: 'squat', loadKg: 80.5, bodyMassKg: 78, inseamCm: 84, saddleCm: 74.5,
    };
    expect(parseUrlParams(qs)).toEqual(want);
    expect(parseUrlParams(`?${qs}`)).toEqual(want);
    expect(parseUrlParams(new URLSearchParams(qs))).toEqual(want);
  });

  it('returns an empty object when nothing is given', () => {
    expect(parseUrlParams('')).toEqual({});
    expect(parseUrlParams('demo=squat&autostart=camera')).toEqual({});
  });

  it('ignores unknown presets and lifts, and accepts known ones in any case', () => {
    expect(parseUrlParams('preset=nonsense&lift=curl')).toEqual({});
    expect(parseUrlParams('preset=__proto__&lift=constructor')).toEqual({});
    expect(parseUrlParams('preset=Lift&lift=DEADLIFT')).toEqual({ preset: 'lift', lift: 'deadlift' });
    expect(parseUrlParams('preset=sit-to-stand').preset).toBe('sit-to-stand');
  });

  it('ignores strings over the length limit instead of cutting them', () => {
    const q = (k: string, n: number) => parseUrlParams(`${k}=${'a'.repeat(n)}`).context;
    expect(q('ref', MAX_REF_CHARS)?.ref).toHaveLength(MAX_REF_CHARS);
    expect(q('ref', MAX_REF_CHARS + 1)).toBeUndefined();
    expect(q('subject', MAX_SUBJECT_CHARS + 1)).toBeUndefined();
    expect(q('note', MAX_NOTE_CHARS)?.note).toHaveLength(MAX_NOTE_CHARS);
    expect(q('note', MAX_NOTE_CHARS + 1)).toBeUndefined();
    expect(parseUrlParams(`ref=ok&note=${'a'.repeat(MAX_NOTE_CHARS + 1)}`).context).toEqual({ ref: 'ok' });
  });

  it('strips control characters and trims', () => {
    expect(cleanText('a\u0000b\u001bc\u007fd\u0085e\u2028f\ng\th', 50)).toBe('abcdefgh');
    expect(cleanText('  padded  ', 50)).toBe('padded');
    expect(cleanText('\u0001\u0002', 50)).toBeUndefined();
    expect(cleanText(null, 50)).toBeUndefined();
    expect(parseUrlParams('ref=x%00y%0Az').context?.ref).toBe('xyz');
  });

  it('keeps markup as plain text for the page to show with textContent', () => {
    expect(parseUrlParams('note=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E').context?.note).toBe('<img src=x onerror=alert(1)>');
  });

  it('rejects numbers that are not plain, in-range decimals', () => {
    for (const bad of ['', 'abc', 'NaN', 'Infinity', '-5', '+5', '1e3', '0x10', '5 0', ' 5', '5.', '.5', '1,5', '0', '99999', '1000.5']) {
      expect(parseUrlParams(`load_kg=${encodeURIComponent(bad)}`).loadKg, `load_kg=${bad}`).toBeUndefined();
    }
    expect(parseUrlParams('load_kg=1000').loadKg).toBe(1000);
    expect(parseUrlParams('load_kg=1').loadKg).toBe(1);
  });

  it('enforces the same ranges as the page fields', () => {
    expect(parseUrlParams('body_mass_kg=19.9&inseam_cm=49.9&saddle_cm=110.1')).toEqual({});
    expect(parseUrlParams('body_mass_kg=250&inseam_cm=110&saddle_cm=50')).toEqual({ bodyMassKg: 250, inseamCm: 110, saddleCm: 50 });
    expect(cleanNumber(null, { min: 0, max: 1 })).toBeUndefined();
  });

  it('describes the context for display, in the order ref, subject, note', () => {
    expect(describeContext({ ref: 'r1', subject: 's1', note: 'n1' })).toBe('ref r1, subject s1, note n1');
    expect(describeContext({ subject: 's1' })).toBe('subject s1');
    expect(describeContext(null)).toBe('');
  });
});
