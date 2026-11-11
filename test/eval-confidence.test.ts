import { describe, expect, it } from 'vitest';
import { alignWords, crossField } from '../src/eval/align.js';
import { buildFieldItems, buildItems, separation, sweep } from '../src/eval/confidence.js';
import type { Scorable } from '../src/eval/confidence.js';
import type { Box, OcrWord } from '../src/ocr/types.js';

const s = (status: string, confidence: number | null): Scorable => ({ status, confidence });

const items: Scorable[] = [
  s('correct', 0.95),
  s('correct', 0.9),
  s('merged-correct', 0.8),
  s('misread', 0.7),
  s('misread', 0.88),
  s('merged-misread', 0.6),
  s('missing', null),
];

describe('sweep', () => {
  it('counts flagged misreads and wrongly flagged correct items at each threshold', () => {
    const rows = sweep(items, [0.5, 0.85, 0.99]);
    expect(rows[0]).toEqual({
      threshold: 0.5,
      misreadsFlagged: 1,
      misreadsTotal: 4,
      correctWronglyFlagged: 0,
      correctTotal: 3,
    });
    expect(rows[1]).toMatchObject({ misreadsFlagged: 3, correctWronglyFlagged: 1 });
    expect(rows[2]).toMatchObject({ misreadsFlagged: 4, correctWronglyFlagged: 3 });
  });

  it('always flags a missing item and flags only below the threshold', () => {
    const only = [s('missing', null), s('correct', 0.85)];
    expect(sweep(only, [0.01])[0]).toMatchObject({ misreadsFlagged: 1, correctWronglyFlagged: 0 });
    expect(sweep(only, [0.85])[0]).toMatchObject({ correctWronglyFlagged: 0 });
    expect(sweep(only, [0.86])[0]).toMatchObject({ correctWronglyFlagged: 1 });
  });
});

describe('separation', () => {
  it('separates when every misread is below every correct item', () => {
    const r = separation([s('misread', 0.6), s('misread', 0.7), s('correct', 0.8), s('correct', 0.95)]);
    expect(r).toMatchObject({ separates: true, maxMisread: 0.7, minCorrect: 0.8, overlap: 0, correctAtOrBelowMaxMisread: 0 });
    expect(r.gap).toBeCloseTo(0.1, 10);
  });

  it('reports the overlap and how many correct items sit at or below the top misread', () => {
    const r = separation(items);
    expect(r.separates).toBe(false);
    expect(r.maxMisread).toBe(0.88);
    expect(r.minCorrect).toBe(0.8);
    expect(r.overlap).toBeCloseTo(0.08, 10);
    expect(r.correctAtOrBelowMaxMisread).toBe(1);
    expect(r.misreadCount).toBe(3);
  });

  it('leaves missing items out and returns null when a side is empty', () => {
    expect(separation([s('missing', null), s('correct', 0.9)]).separates).toBeNull();
  });
});

describe('buildItems and buildFieldItems', () => {
  const box = (x: number): Box => [x, 100, x + 50, 130];
  const words = [
    { id: 'w1', text: 'Dr', box: box(100) },
    { id: 'w2', text: 'Linnea', box: box(160) },
    { id: 'w3', text: 'Ash', box: box(300) },
  ];
  const fields = [
    { name: 'provider', wordIds: ['w1', 'w2'] },
    { name: 'clinic', wordIds: ['w3'] },
  ];
  const o = (n: number, text: string, b: Box, confidence: number): OcrWord => ({
    id: `o000${n}`,
    text,
    box: b,
    confidence,
  });

  it('labels merged words, takes the min confidence per field and flags a field with any problem', () => {
    const r = alignWords(
      [o(1, 'Dr.Linnea', [100, 100, 210, 130], 0.87), o(2, 'Ash', box(300), 0.95)],
      words,
    );
    const groups = crossField(r.groups, { provider: ['w1', 'w2'], clinic: ['w3'] });
    const field = buildItems('f', groups, words, fields, 'field');
    expect(field.map((i) => i.status)).toEqual(['merged-misread', 'merged-misread', 'correct']);
    const rows = buildFieldItems(field);
    expect(rows).toEqual([
      { faxId: 'f', field: 'provider', status: 'misread', problems: ['merged-misread', 'merged-misread'], confidence: 0.87 },
      { faxId: 'f', field: 'clinic', status: 'correct', problems: [], confidence: 0.95 },
    ]);
  });

  it('marks a field with a missing word as missing and keeps all-word items without a field', () => {
    const r = alignWords([o(1, 'Dr', box(100), 0.9)], words);
    const groups = crossField(r.groups, {});
    expect(buildFieldItems(buildItems('f', groups, words, fields, 'field'))[0]).toMatchObject({
      field: 'provider',
      status: 'missing',
      confidence: 0.9,
    });
    const all = buildItems('f', groups, words, [{ name: 'clinic', wordIds: ['w3'] }], 'all');
    expect(all.map((i) => i.field)).toEqual([null, null, 'clinic']);
  });
});
