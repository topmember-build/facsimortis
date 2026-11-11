import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractWithDetails } from '../src/extract/rules.js';
import { FIELD_ORDER } from '../src/extract/schema.js';
import type { FieldName } from '../src/extract/schema.js';
import type { Box, OcrResult } from '../src/ocr/types.js';
import { build, line, tableSpecs } from './page-helpers.js';

const VALUES: Record<FieldName, string[][]> = {
  patientName: [['Jasper', 'Hartley']],
  dob: [['09/06/1938']],
  referringProvider: [['Dr', 'Iris', 'Ellery,', 'Maple'], ['Hollow', 'Practice']],
  npi: [['8428731565']],
  reason: [['ENT', 'evaluation,', 'recurring', 'sinus', 'congestion']],
  urgency: [['routine']],
  callbackPhone: [['555-0147']],
};

const EXPECTED: Record<FieldName, string> = {
  patientName: 'Jasper Hartley',
  dob: '09/06/1938',
  referringProvider: 'Dr Iris Ellery, Maple Hollow Practice',
  npi: '8428731565',
  reason: 'ENT evaluation, recurring sinus congestion',
  urgency: 'routine',
  callbackPhone: '555-0147',
};

function page(value = VALUES, rotate = 0, extra: Parameters<typeof tableSpecs>[0]['extra'] = []): OcrResult {
  return build(tableSpecs({ value, extra }), rotate);
}

function idsOf(ocr: OcrResult, ...texts: string[]): string[] {
  return texts.map((t) => {
    const w = ocr.words.find((x) => x.text === t);
    if (!w) throw new Error(`no word ${t}`);
    return w.id;
  });
}

function fieldOf(ocr: OcrResult, name: FieldName) {
  const f = extractWithDetails(ocr).result.fields.find((x) => x.name === name);
  if (!f) throw new Error(`no field ${name}`);
  return f;
}

describe('table-form layout on a hand-made page', () => {
  it('reads all seven fields exactly, wraps included, with min confidence', () => {
    const ocr = page();
    const hartley = ocr.words.find((w) => w.text === 'Hartley');
    if (hartley) hartley.confidence = 0.42;
    const { result, details } = extractWithDetails(ocr);
    expect(result.fields.map((f) => f.name)).toEqual([...FIELD_ORDER]);
    for (const name of FIELD_ORDER) {
      expect(fieldOf(ocr, name).value).toBe(EXPECTED[name]);
      expect(fieldOf(ocr, name).flags).toEqual([]);
      expect(details.find((d) => d.field === name)?.layout).toBe('table');
    }
    expect(fieldOf(ocr, 'patientName')).toMatchObject({
      wordIds: idsOf(ocr, 'Jasper', 'Hartley'),
      confidence: 0.42,
    });
    expect(fieldOf(ocr, 'referringProvider').wordIds).toEqual(
      idsOf(ocr, 'Dr', 'Iris', 'Ellery,', 'Maple', 'Hollow', 'Practice'),
    );
    expect(fieldOf(ocr, 'urgency').confidence).toBe(0.9);
  });

  it('never pulls the next row label into a value', () => {
    const ocr = page();
    for (const name of FIELD_ORDER) {
      const f = fieldOf(ocr, name);
      expect(f.value).not.toMatch(/:/);
    }
  });

  it('returns misreads verbatim', () => {
    const ocr = page({
      ...VALUES,
      referringProvider: [['Dr.Linnea']],
      reason: [['-headaches']],
      callbackPhone: [['555~0151']],
    });
    expect(fieldOf(ocr, 'referringProvider')).toMatchObject({ value: 'Dr.Linnea', wordIds: idsOf(ocr, 'Dr.Linnea') });
    expect(fieldOf(ocr, 'reason').value).toBe('-headaches');
    expect(fieldOf(ocr, 'callbackPhone').value).toBe('555~0151');
  });

  it.each([3, -3])('reads all seven fields when rotated %i degrees', (deg) => {
    const ocr = page(VALUES, deg);
    for (const name of FIELD_ORDER) expect(fieldOf(ocr, name).value).toBe(EXPECTED[name]);
  });

  it('a merged label and value is not split', () => {
    const ocr = build(
      tableSpecs({
        value: { ...VALUES, callbackPhone: [] },
        label: { callbackPhone: ['Callback'] },
        extra: line(['phone:555-0193'], 130 + 8 * 14 + 14, 300 + 100 * 6),
      }),
    );
    expect(fieldOf(ocr, 'callbackPhone')).toMatchObject({
      value: null,
      wordIds: [],
      confidence: 0,
      flags: ['The callback phone runs into its label on the page. Please check it.'],
    });
  });

  it('a label with nothing beside it gives the no-value flag', () => {
    const ocr = page({ ...VALUES, urgency: [] });
    expect(fieldOf(ocr, 'urgency')).toMatchObject({
      value: null,
      wordIds: [],
      flags: ['The urgency label was found, but no value was next to it.'],
    });
  });
});

interface Truth {
  fields: { name: FieldName; value: string; wordIds: string[] }[];
  words: { id: string; text: string; box: Box }[];
}

describe('truth-words layout (table form)', () => {
  it('reads every field of fax-0002 exactly, ignoring the RECEIVED stamp', () => {
    const truth = JSON.parse(readFileSync('fixtures/faxes/L2/fax-0002.truth.json', 'utf8')) as Truth;
    const ocr: OcrResult = {
      words: truth.words.map((w) => ({ id: w.id, text: w.text, box: w.box, confidence: 1 })),
      width: 1728,
      height: 2200,
      engine: 'truth',
    };
    const { details } = extractWithDetails(ocr);
    for (const t of truth.fields) {
      const f = fieldOf(ocr, t.name);
      expect(f.value).toBe(t.value);
      expect(f.wordIds).toEqual(t.wordIds);
      expect(details.find((d) => d.field === t.name)?.layout).toBe('table');
    }
  });
});
