import { describe, expect, it } from 'vitest';
import { DEFAULT_FAX, formatExtractTable, parseExtractArgs } from '../src/scripts/extract-format.js';
import { FIELD_ORDER } from '../src/extract/schema.js';
import type { ExtractionResult } from '../src/extract/schema.js';

const result: ExtractionResult = {
  engine: 'rules',
  fields: FIELD_ORDER.map((name) => {
    if (name === 'patientName') {
      return { name, value: 'Jasper Hartley', wordIds: ['o0018', 'o0019'], confidence: 0.9, flags: [], reviewed: false };
    }
    if (name === 'dob') {
      return {
        name,
        value: '09/06/1938',
        wordIds: ['o0023'],
        confidence: 0.755,
        flags: ['First flag.', 'Second flag.'],
        reviewed: false,
      };
    }
    return {
      name,
      value: null,
      wordIds: [],
      confidence: 0,
      flags: ['The value could not be read. Please check it.'],
      reviewed: false,
    };
  }),
};

describe('parseExtractArgs', () => {
  it('defaults to the first fax and no json', () => {
    expect(parseExtractArgs([])).toEqual({ ok: true, args: { path: DEFAULT_FAX, json: false } });
  });

  it('accepts a path and --json', () => {
    expect(parseExtractArgs(['--json', 'a.png'])).toEqual({ ok: true, args: { path: 'a.png', json: true } });
  });

  it('rejects unknown options and extra paths with plain messages', () => {
    const bad = parseExtractArgs(['--bogus']);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain('npm run extract');
    const two = parseExtractArgs(['a.png', 'b.png']);
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.message).toMatch(/one fax at a time/);
  });
});

describe('formatExtractTable', () => {
  const lines = formatExtractTable(result, { file: 'a.png', ocrEngine: 'tesseract', seconds: 0.456 }).split('\n');

  it('has a header with file, OCR engine and extraction engine', () => {
    expect(lines.slice(0, 3)).toEqual(['File: a.png', 'OCR engine: tesseract', 'Extraction engine: rules']);
  });

  it('prints a row with plain name, value, two-decimal confidence and word IDs', () => {
    expect(lines.some((l) => /^patient name\s+Jasper Hartley\s+0\.90\s+o0018,o0019$/.test(l))).toBe(true);
  });

  it('prints (empty), 0.00 and - for a missing value', () => {
    expect(lines.some((l) => /^urgency\s+\(empty\)\s+0\.00\s+-$/.test(l))).toBe(true);
  });

  it('puts each flag on its own indented line under its row', () => {
    const i = lines.findIndex((l) => l.startsWith('date of birth'));
    expect(lines[i]).toMatch(/0\.7[56]\s+o0023$/);
    expect(lines[i + 1]).toBe('    Flag: First flag.');
    expect(lines[i + 2]).toBe('    Flag: Second flag.');
    expect(lines[i + 3]).toMatch(/^referring provider/);
  });

  it('ends with the time and the flagged count', () => {
    expect(lines.at(-2)).toBe('OCR and extraction took 0.5 s.');
    expect(lines.at(-1)).toBe('6 of 7 fields flagged');
  });
});
