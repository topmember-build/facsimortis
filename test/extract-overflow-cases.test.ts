import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { extractWithDetails, PLAIN_FIELD_NAMES } from '../src/extract/rules.js';
import { FIELD_ORDER } from '../src/extract/schema.js';
import type { FieldName } from '../src/extract/schema.js';
import type { Box, OcrResult } from '../src/ocr/types.js';
import { build, typedSpecs } from './page-helpers.js';

const BASE: Record<FieldName, string[][]> = {
  patientName: [['Jasper', 'Hartley']],
  dob: [['09/06/1938']],
  referringProvider: [['Dr', 'Iris']],
  npi: [['8428731565']],
  reason: [['ENT', 'evaluation']],
  urgency: [['routine']],
  callbackPhone: [['555-0147']],
};

const TARGETS: FieldName[] = ['patientName', 'referringProvider', 'reason', 'callbackPhone'];
const LENGTHS = [9, 10, 11, 12];
const ROTATIONS = [0, 3, -3];
const CYCLE = ['Maplewood', 'clinic', 'north', 'annex', 'wing'];
const INTERNAL = ['overflow', 'column', 'limit', 'region', 'OCR'];

const overflowFlag = (f: FieldName): string => `The ${PLAIN_FIELD_NAMES[f]} runs into the next box on the page. Please check it.`;
const neighbourFlag = (f: FieldName): string =>
  `Words from a nearby box may have run into the ${PLAIN_FIELD_NAMES[f]}. Please check it.`;

function longWords(n: number): string[] {
  return Array.from({ length: n }, (_, i) => CYCLE[i % CYCLE.length] ?? 'x');
}

interface Row {
  field: FieldName;
  n: number;
  rot: number;
  longOutcome: 'overflow' | 'layout-unclear' | 'other';
  neighbour: FieldName | null;
  wronglyFlagged: number;
}

const rows: Row[] = [];
const fixtureCounts: { path: string; flags: number }[] = [];

interface Case {
  field: FieldName;
  n: number;
  rot: number;
}
const CASES: Case[] = TARGETS.flatMap((field) => LENGTHS.flatMap((n) => ROTATIONS.map((rot) => ({ field, n, rot }))));

describe('case A extended: long typed values of 9 to 12 words', () => {
  it('has 48 cases', () => {
    expect(CASES).toHaveLength(48);
  });

  it.each(CASES)('$field, $n words, $rot degrees: never wrong and unflagged', ({ field, n, rot }) => {
    const words = longWords(n);
    const value: Record<FieldName, string[][]> = { ...BASE, [field]: [words] };
    const expected = (name: FieldName): string => value[name].map((l) => l.join(' ')).join(' ');
    const ocr = build(typedSpecs({ value }), rot);
    const byId = new Map(ocr.words.map((w) => [w.id, w.text]));
    const { result, details } = extractWithDetails(ocr);

    let wronglyFlagged = 0;
    let neighbour: FieldName | null = null;
    let longOutcome: Row['longOutcome'] = 'other';

    for (const name of FIELD_ORDER) {
      const f = result.fields.find((x) => x.name === name);
      const d = details.find((x) => x.field === name);
      if (f === undefined || d === undefined) throw new Error(`missing ${name}`);
      const ctx = `${name} in ${field}/${n}/${rot}: ${JSON.stringify({ value: f.value, flags: f.flags })}`;

      // No repair: a value is exactly its cited words joined by single spaces.
      if (f.value !== null) {
        expect(f.value, ctx).toBe(f.wordIds.map((id) => byId.get(id)).join(' '));
      }
      // Exact and unflagged, or flagged. Never wrong and unflagged.
      const exact = f.value === expected(name);
      if (!(exact && f.flags.length === 0)) {
        expect(f.flags.length, ctx).toBeGreaterThan(0);
      }

      for (const flag of f.flags) {
        for (const word of INTERNAL) expect(flag.toLowerCase(), ctx).not.toContain(word.toLowerCase());
      }

      if (name === field) {
        expect(f.value === null && f.flags.length > 0 ? 'flagged' : 'unflagged', ctx).toBe('flagged');
        if (d.reason === 'overflow') {
          longOutcome = 'overflow';
          expect(f.flags, ctx).toContain(overflowFlag(name));
        } else if (d.reason === 'layout-unclear') {
          longOutcome = 'layout-unclear';
        }
        if (d.reason === 'overflow') expect(f.flags, ctx).toEqual([overflowFlag(name)]);
      } else {
        if (d.overflowFrom !== null) {
          expect(f.flags, ctx).toContain(neighbourFlag(name));
          expect(d.overflowFrom, ctx).toBe(field);
          neighbour = name;
        }
        if (exact && f.flags.length > 0) wronglyFlagged += 1;
      }
    }
    rows.push({ field, n, rot, longOutcome, neighbour, wronglyFlagged });
  });

  it('is not vacuous', () => {
    expect(rows).toHaveLength(48);
    expect(rows.some((r) => r.longOutcome === 'overflow')).toBe(true);
    expect(rows.some((r) => r.neighbour !== null)).toBe(true);
    expect(rows.some((r) => r.neighbour !== null && r.rot === 0)).toBe(true);
  });
});

interface Truth {
  fields: { name: FieldName; value: string; wordIds: string[] }[];
  words: { id: string; text: string; box: Box }[];
}

function loadTruth(path: string): { truth: Truth; ocr: OcrResult } {
  const truth = JSON.parse(readFileSync(path, 'utf8')) as Truth;
  const ocr: OcrResult = {
    words: truth.words.map((w) => ({ id: w.id, text: w.text, box: w.box, confidence: 1 })),
    width: 1728,
    height: 2200,
    engine: 'truth',
  };
  return { truth, ocr };
}

describe('fixtures raise no overflow flags', () => {
  it.each([
    'fixtures/faxes/L1/fax-0001.truth.json',
    'fixtures/faxes/L2/fax-0002.truth.json',
    'fixtures/faxes/L2/fax-0003.truth.json',
  ])('%s', (path) => {
    const { truth, ocr } = loadTruth(path);
    const { result, details } = extractWithDetails(ocr);
    const total = result.fields.reduce((sum, f) => sum + f.flags.length, 0);
    fixtureCounts.push({ path, flags: total });
    expect(total).toBe(0);
    for (const t of truth.fields) {
      const f = result.fields.find((x) => x.name === t.name);
      expect(f?.value).toBe(t.value);
      expect(f?.wordIds).toEqual(t.wordIds);
    }
    for (const d of details) {
      expect(d.overflow).toBe(false);
      expect(d.overflowFrom).toBeNull();
    }
  });
});

afterAll(() => {
  const lines = ['field\tn\trot\tlong\tneighbour\twrongly-flagged'];
  for (const r of rows) lines.push(`${r.field}\t${r.n}\t${r.rot}\t${r.longOutcome}\t${r.neighbour ?? '-'}\t${r.wronglyFlagged}`);
  const count = (o: Row['longOutcome']): number => rows.filter((r) => r.longOutcome === o).length;
  lines.push(
    `TOTAL overflow=${count('overflow')} layout-unclear=${count('layout-unclear')} other=${count('other')} ` +
      `neighbourFlags=${rows.filter((r) => r.neighbour !== null).length} ` +
      `correctWronglyFlagged=${rows.reduce((s, r) => s + r.wronglyFlagged, 0)}`,
  );
  for (const f of fixtureCounts) lines.push(`fixture ${f.path} flags=${f.flags}`);
  console.log(lines.join('\n'));
});
