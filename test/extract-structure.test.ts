import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findLabels } from '../src/extract/labels.js';
import { FIELD_ORDER } from '../src/extract/schema.js';
import type { FieldName } from '../src/extract/schema.js';
import { buildStructure } from '../src/extract/structure.js';
import type { PageStructure } from '../src/extract/structure.js';
import type { OcrResult } from '../src/ocr/types.js';
import { build, line, tableSpecs, typedSpecs } from './page-helpers.js';
import type { Spec } from './page-helpers.js';

const root = join(import.meta.dirname, '..');

interface TruthFile {
  page: { width: number; height: number };
  fields: { name: FieldName; wordIds: string[] }[];
  words: { id: string; text: string; box: [number, number, number, number] }[];
}

function load(level: string, id: string) {
  const truth = JSON.parse(readFileSync(join(root, 'fixtures', 'faxes', level, `${id}.truth.json`), 'utf8')) as TruthFile;
  const ocr: OcrResult = {
    words: truth.words.map((w) => ({ id: w.id, text: w.text, box: w.box, confidence: 1 })),
    width: truth.page.width,
    height: truth.page.height,
    engine: 'truth',
  };
  return { truth, ocr };
}

function structureOf(ocr: OcrResult): PageStructure {
  return buildStructure(ocr, findLabels(ocr.words));
}

const fixtures = [
  { level: 'L1', id: 'fax-0001', layout: 'typed', columns: 2 },
  { level: 'L2', id: 'fax-0002', layout: 'table', columns: 1 },
  { level: 'L2', id: 'fax-0003', layout: 'typed', columns: 2 },
] as const;

describe.each(fixtures)('structure of fixture $id', ({ level, id, layout, columns }) => {
  const { truth, ocr } = load(level, id);
  const s = structureOf(ocr);
  const boxes = new Map(truth.words.map((w) => [w.id, w.box]));

  it('finds the layout and columns', () => {
    expect(s.unusable).toEqual([]);
    expect(s.layout).toBe(layout);
    expect(s.columns).toHaveLength(columns);
    expect(s.fields).toHaveLength(7);
  });

  it('has limits that contain every value word, and no open side', () => {
    for (const f of s.fields) {
      const value = truth.fields.find((t) => t.name === f.field);
      for (const wid of value?.wordIds ?? []) {
        const box = boxes.get(wid)!;
        expect(box[2], `${f.field} right`).toBeLessThanOrEqual(f.right.limit);
        expect(box[3], `${f.field} bottom`).toBeLessThanOrEqual(f.bottom.limit);
        if (f.valueLeft !== null) expect(box[0], `${f.field} valueLeft`).toBeGreaterThanOrEqual(f.valueLeft);
      }
      expect(f.right.state).toBe('closed');
      expect(f.bottom.state).toBe('closed');
    }
  });
});

describe('a label removed from a fixture', () => {
  const { ocr } = load('L1', 'fax-0001');
  const full = structureOf(ocr);
  const target = full.fields.find((f) => f.field === 'referringProvider')!;
  const labelIds = new Set(findLabels(ocr.words).find((l) => l.field === 'referringProvider')!.matches[0]!.wordIds);
  const cut: OcrResult = { ...ocr, words: ocr.words.filter((w) => !labelIds.has(w.id)) };
  const s = structureOf(cut);

  it('is listed unusable as missing', () => {
    expect(s.unusable).toEqual([{ field: 'referringProvider', reason: 'missing' }]);
  });

  it('opens the bottom of the field above and keeps others closed', () => {
    const above = s.fields.find((f) => f.column === target.column && f.row === target.row - 1)!;
    expect(above.bottom.state).toBe('open');
    // The field below the gap is bounded by another usable label and stays closed.
    const other = s.fields.find((f) => f.field === 'reason')!;
    expect(other.bottom.limit).toBeLessThan(cut.height);
    expect(other.bottom.state).toBe('closed');
  });
});

describe('repeated and merged labels', () => {
  const value = Object.fromEntries(FIELD_ORDER.map((n) => [n, [['x1']]])) as Record<FieldName, string[][]>;

  it('lists a repeated label as unusable', () => {
    const extra: Spec[] = line(['Urgency:'], 130, 900);
    const s = structureOf(build(typedSpecs({ value, extra })));
    expect(s.unusable).toEqual([{ field: 'urgency', reason: 'repeated' }]);
  });

  it('lists a merged label as unusable', () => {
    const label: Partial<Record<FieldName, string[]>> = { callbackPhone: ['Callback', 'phone:555-0147'] };
    const s = structureOf(build(typedSpecs({ value, label })));
    expect(s.unusable).toEqual([{ field: 'callbackPhone', reason: 'merged' }]);
  });
});

describe('skewed hand-made pages', () => {
  const value = Object.fromEntries(FIELD_ORDER.map((n) => [n, [['Some', 'value']]])) as Record<FieldName, string[][]>;
  const pages = { typed: typedSpecs({ value }), table: tableSpecs({ value }) };

  it.each([
    ['typed', 2],
    ['table', 1],
  ] as const)('%s page keeps layout and columns at +3 and -3 degrees', (kind, columns) => {
    const flat = structureOf(build(pages[kind], 0));
    expect(flat.layout).toBe(kind);
    expect(flat.columns).toHaveLength(columns);
    for (const deg of [3, -3]) {
      const s = structureOf(build(pages[kind], deg));
      expect(s.layout).toBe(kind);
      expect(s.columns.map((c) => c.fields)).toEqual(flat.columns.map((c) => c.fields));
      expect(s.unusable).toEqual([]);
    }
  });
});

describe('mixed evidence', () => {
  it('gives unknown when half the labels have words right and half below', () => {
    const specs: Spec[] = [];
    FIELD_ORDER.forEach((name, row) => {
      const y = 300 + 100 * row;
      const label = { patientName: ['Patient', 'name:'], dob: ['Date', 'of', 'birth:'], referringProvider: ['Referring', 'provider:'], npi: ['Provider', 'NPI:'], reason: ['Reason', 'for', 'referral:'], urgency: ['Urgency:'], callbackPhone: ['Callback', 'phone:'] }[name];
      specs.push(...line(label, 130, y));
      if (row % 2 === 0) specs.push(...line(['Some', 'value'], 460, y));
      else specs.push(...line(['Some', 'value'], 130, y + 40));
    });
    const s = structureOf(build(specs));
    expect(s.unusable).toEqual([]);
    expect(s.layout).toBe('unknown');
  });
});
