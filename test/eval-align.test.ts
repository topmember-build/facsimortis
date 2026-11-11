import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { alignReport, alignWords, crossField, ioMin } from '../src/eval/align.js';
import { iou } from '../src/eval/match.js';
import type { TruthWord } from '../src/eval/match.js';
import type { Box, OcrWord } from '../src/ocr/types.js';

const truth = (id: string, text: string, box: Box): TruthWord => ({ id, text, box });
const ocr = (n: number, text: string, box: Box, confidence = 0.9): OcrWord => ({
  id: `o${String(n).padStart(4, '0')}`,
  text,
  box,
  confidence,
});

describe('ioMin', () => {
  it('is 1 for a box inside another, 0 without overlap', () => {
    expect(ioMin([10, 10, 20, 20], [0, 0, 100, 100])).toBe(1);
    expect(ioMin([0, 0, 10, 10], [20, 20, 30, 30])).toBe(0);
  });

  it('divides by the smaller area', () => {
    expect(ioMin([0, 0, 10, 10], [5, 0, 25, 10])).toBe(0.5);
  });

  it('matches a small ink-tight box inside a padded truth cell while IoU stays below 0.5', () => {
    const cell: Box = [100, 100, 140, 140];
    const ink: Box = [108, 112, 124, 130];
    expect(ioMin(ink, cell)).toBeCloseTo(1, 10);
    expect(iou(ink, cell)).toBeLessThan(0.5);
    const { groups } = alignWords([ocr(1, 'A', ink)], [truth('w1', 'A', cell)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'single', correct: true, truthIds: ['w1'], ocrIds: ['o0001'] });
  });
});

describe('alignWords', () => {
  const dr = truth('w1', 'Dr', [100, 100, 160, 130]);
  const linnea = truth('w2', 'Linnea', [170, 100, 230, 130]);

  it('builds a merge group from one OCR word over two adjacent truth words', () => {
    const { groups, extraOcrIds } = alignWords([ocr(1, 'DrLinnea', [100, 100, 230, 130], 0.8)], [dr, linnea]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      kind: 'merge',
      truthIds: ['w1', 'w2'],
      ocrIds: ['o0001'],
      correct: true,
      confidence: 0.8,
    });
    expect(extraOcrIds).toEqual([]);
  });

  it('treats a missing space as correct and a changed punctuation mark as a misread', () => {
    const merged = alignWords([ocr(1, 'DrLinnea', [100, 100, 230, 130])], [dr, linnea]);
    const dotted = alignWords([ocr(1, 'Dr.Linnea', [100, 100, 230, 130])], [dr, linnea]);
    expect(merged.groups[0]?.correct).toBe(true);
    expect(dotted.groups[0]?.correct).toBe(false);
    expect(dotted.groups[0]?.kind).toBe('merge');
  });

  it('keeps case: a different case is a misread', () => {
    const r = alignWords([ocr(1, 'dr', [100, 100, 160, 130])], [dr]);
    expect(r.groups[0]?.correct).toBe(false);
  });

  it('does not merge words on different lines', () => {
    const below = truth('w2', 'Linnea', [100, 200, 160, 230]);
    const { groups } = alignWords([ocr(1, 'DrLinnea', [100, 100, 160, 230])], [dr, below]);
    expect(groups.map((g) => g.kind).sort()).toEqual(['missing', 'single']);
  });

  it('builds a split group when two OCR words lie inside one truth word', () => {
    const t = truth('w1', 'Hartley', [100, 100, 300, 130]);
    const { groups, extraOcrIds } = alignWords(
      [ocr(1, 'Hart', [100, 100, 190, 130], 0.7), ocr(2, 'ley', [200, 100, 300, 130], 0.9)],
      [t],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      kind: 'split',
      truthIds: ['w1'],
      ocrIds: ['o0001', 'o0002'],
      correct: true,
      confidence: 0.7,
    });
    expect(extraOcrIds).toEqual([]);
  });

  it('reports missing truth words and extra OCR words', () => {
    const { groups, extraOcrIds } = alignWords(
      [ocr(1, 'Dr', [100, 100, 160, 130]), ocr(2, 'noise', [600, 600, 650, 620])],
      [dr, linnea],
    );
    expect(groups.map((g) => g.kind)).toEqual(['single', 'missing']);
    expect(groups[1]).toMatchObject({ correct: false, confidence: null, ocrText: null, ocrIds: [] });
    expect(extraOcrIds).toEqual(['o0002']);
  });
});

describe('crossField and alignReport', () => {
  const label = truth('w1', 'Name:', [10, 100, 70, 130]);
  const first = truth('w2', 'Jasper', [80, 100, 140, 130]);
  const last = truth('w3', 'Hartley', [150, 100, 210, 130]);
  const words = [label, first, last];

  it('marks a merge that mixes a label with a field value, but not one inside a field', () => {
    const mixed = alignWords([ocr(1, 'Name:Jasper', [10, 100, 140, 130]), ocr(2, 'Hartley', last.box)], words);
    const fields = { patientName: ['w2', 'w3'] };
    const marked = crossField(mixed.groups, fields);
    expect(marked[0]).toMatchObject({ kind: 'merge', crossField: true, correct: true });

    const inside = alignWords([ocr(1, 'Name:', label.box), ocr(2, 'JasperHartley', [80, 100, 210, 130])], words);
    expect(crossField(inside.groups, fields).map((g) => g.crossField)).toEqual([false, false]);
  });

  it('marks a merge across two fields and never counts it as correct', () => {
    const r = alignWords([ocr(1, 'Name:', label.box), ocr(2, 'JasperHartley', [80, 100, 210, 130])], words);
    const groups = crossField(r.groups, { a: ['w2'], b: ['w3'] });
    expect(groups[1]?.crossField).toBe(true);
    const rep = alignReport({ ...r, groups }, words, ['w2', 'w3']);
    expect(rep.fieldValues).toMatchObject({ correct: 0, total: 2 });
    expect(rep.all).toMatchObject({ correct: 1, total: 3 });
    expect(rep.counts).toMatchObject({ single: 1, merge: 1, crossField: 1, missing: 0, extra: 0 });
  });

  it('gives each truth word the result of its group', () => {
    const r = alignWords([ocr(1, 'Name:', label.box), ocr(2, 'Jasper', first.box)], words);
    const rep = alignReport(r, words, ['w2', 'w3']);
    expect(rep.all).toMatchObject({ correct: 2, total: 3 });
    expect(rep.fieldValues).toMatchObject({ correct: 1, total: 2 });
    expect(rep.counts.missing).toBe(1);
  });
});

describe('alignWords properties', () => {
  /** **Validates: Requirements 2.1** */
  it('one OCR word over two adjacent same-line truth words is always one merge group', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 20, max: 100 }),
        fc.integer({ min: 20, max: 100 }),
        fc.integer({ min: 5, max: 30 }),
        fc.integer({ min: 15, max: 40 }),
        (x, y, w1, w2, gap, h) => {
          const a = truth('w1', 'ab', [x, y, x + w1, y + h]);
          const b = truth('w2', 'cd', [x + w1 + gap, y, x + w1 + gap + w2, y + h]);
          const o = ocr(1, 'abcd', [x, y, x + w1 + gap + w2, y + h]);
          const { groups, extraOcrIds } = alignWords([o], [a, b]);
          expect(groups).toHaveLength(1);
          expect(groups[0]).toMatchObject({ kind: 'merge', truthIds: ['w1', 'w2'], correct: true });
          expect(extraOcrIds).toEqual([]);
        },
      ),
    );
  });

  /** **Validates: Requirements 2.1** */
  it('an OCR box inset by up to 8 px inside a truth box is matched', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 40, max: 200 }),
        fc.integer({ min: 25, max: 60 }),
        fc.tuple(
          fc.integer({ min: 0, max: 8 }),
          fc.integer({ min: 0, max: 8 }),
          fc.integer({ min: 0, max: 8 }),
          fc.integer({ min: 0, max: 8 }),
        ),
        (x, y, w, h, [l, t, r, b]) => {
          const cell: Box = [x, y, x + w, y + h];
          const ink: Box = [x + l, y + t, x + w - r, y + h - b];
          expect(ioMin(ink, cell)).toBeGreaterThanOrEqual(0.5);
          const { groups } = alignWords([ocr(1, 'word', ink)], [truth('w1', 'word', cell)]);
          expect(groups).toHaveLength(1);
          expect(groups[0]).toMatchObject({ kind: 'single', correct: true });
        },
      ),
    );
  });
});
