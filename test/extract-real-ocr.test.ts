import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractWithDetails } from '../src/extract/rules.js';
import { resolveUncited } from '../src/extract/uncited.js';
import type { OcrResult, OcrWord } from '../src/ocr/types.js';

/**
 * Regression test built from the recorded REAL local OCR output of the synthetic
 * fax-0002 (fixtures/ocr/fax-0002.ocr.json, see SOURCE.md there). No OCR runs here.
 *
 * The page is a table form skewed 0.73 degrees. The referring-provider value row is
 * o0026..o0030 = "Dr.Linnea Ashgrove, Willowbrook Family Clinic". Before 0.5.10 the
 * table reader started at the word closest to the label (o0029) and only followed
 * words to its right, so it returned "Family Clinic" with no flag.
 *
 * What the no-silent-drops rule produces now: the field is FLAGGED, not widened.
 * o0026..o0028 are uncited words inside the value region, but the gap between
 * "Ashgrove," (o0027, right edge 875) and "Willowbrook" (o0028, left edge 900) is 25 px,
 * wider than one median word height (22 px, GAP_FACTOR = 1). The words do not chain
 * on, so the rule keeps the value as read and adds the plain flag.
 *
 * Every field on this page after the change:
 *   patientName        "Pippa Ellery"   [o0020 o0021]  no flag  (correct)
 *   dob                "01/02/1965"     [o0025]        no flag  (correct)
 *   referringProvider  "Family Clinic"  [o0029 o0030]  FLAGGED "Some words near the referring provider were not read..."
 *   npi                null             -              FLAGGED "could not be read clearly"  (known, task 1.9)
 *   reason             null             -              FLAGGED "label was not found"        (known, task 1.9)
 *   urgency            "emergent"       [o0044]        no flag  (correct)
 *   callbackPhone      "555-0193"       [o0047]        no flag  (correct)
 */
const ocr = JSON.parse(readFileSync('fixtures/ocr/fax-0002.ocr.json', 'utf8')) as OcrResult;

describe('fax-0002 recorded real OCR', () => {
  const { result, details } = extractWithDetails(ocr);
  const field = (name: string) => {
    const f = result.fields.find((x) => x.name === name);
    if (f === undefined) throw new Error(`no field ${name}`);
    return f;
  };

  it('never returns the referring provider as an unflagged "Family Clinic"', () => {
    const f = field('referringProvider');
    const full = 'Dr.Linnea Ashgrove, Willowbrook Family Clinic';
    const isFull = f.value === full && f.wordIds.join(',') === 'o0026,o0027,o0028,o0029,o0030';
    expect(isFull || f.flags.length > 0).toBe(true);
    // The rule flags it (the 25 px gap before "Willowbrook" is too wide to chain on).
    expect(f.flags).toEqual(['Some words near the referring provider were not read. Please check it.']);
    const d = details.find((x) => x.field === 'referringProvider');
    expect(d?.uncitedWordIds).toEqual(['o0026', 'o0027', 'o0028']);
    expect(d?.includedWordIds).toEqual([]);
  });

  it('has no wrong value without a flag', () => {
    const expected: Record<string, string | null> = {
      patientName: 'Pippa Ellery',
      dob: '01/02/1965',
      urgency: 'emergent',
      callbackPhone: '555-0193',
    };
    for (const f of result.fields) {
      if (f.flags.length > 0) continue;
      expect(f.value).toBe(expected[f.name]);
    }
  });

  it('keeps the known out-of-scope outcomes null and flagged (task 1.9 will change these)', () => {
    const npi = field('npi');
    expect(npi.value).toBeNull();
    expect(npi.flags.join(' ')).toContain('could not be read clearly');
    const reason = field('reason');
    expect(reason.value).toBeNull();
    expect(reason.flags.join(' ')).toContain('label was not found');
  });
});

describe('resolveUncited (include vs flag)', () => {
  const word = (id: string, text: string, x0: number, x1: number): OcrWord => ({
    id,
    text,
    box: [x0, 100, x1, 120],
    confidence: 0.9,
  });
  const column = { xMin: 0, xMax: 1000, bottom: 500 };

  it('includes an uncited word that chains on with normal spacing, keeping its text', () => {
    const words = [word('a', 'Dr.Linnea', 100, 200), word('b', 'Clinic', 210, 300)];
    const r = resolveUncited(words, [words[1] as OcrWord], column, new Set(['b']), 20);
    expect(r.wordIds).toEqual(['a', 'b']);
    expect(r.includedIds).toEqual(['a']);
    expect(r.uncitedIds).toEqual([]);
  });

  it('flags and leaves the value alone when an uncited word is behind a wide gap', () => {
    const words = [word('a', 'Dr.Linnea', 100, 200), word('b', 'Clinic', 260, 350)];
    const r = resolveUncited(words, [words[1] as OcrWord], column, new Set(['b']), 20);
    expect(r.wordIds).toEqual(['b']);
    expect(r.includedIds).toEqual([]);
    expect(r.uncitedIds).toEqual(['a']);
  });

  it('ignores words cited by another field', () => {
    const words = [word('a', 'x', 100, 200), word('b', 'Clinic', 210, 300)];
    const r = resolveUncited(words, [words[1] as OcrWord], column, new Set(['a', 'b']), 20);
    expect(r.wordIds).toEqual(['b']);
    expect(r.uncitedIds).toEqual([]);
  });
});
