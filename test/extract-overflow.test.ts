import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GAP_FACTOR, findOverflow } from '../src/extract/overflow.js';
import type { OcrWord } from '../src/ocr/types.js';

const H = 20;
const LEFT = 100;
const LIMIT = 400;

function word(id: string, x0: number, x1: number, dy = 0, y = 100): OcrWord {
  return { id, text: id, box: [x0, y + dy, x1, y + dy + H], confidence: 0.9 };
}

describe('findOverflow', () => {
  it('reports nothing for a line inside the limit', () => {
    const line = [word('a', 100, 150), word('b', 160, 220)];
    expect(findOverflow([line], LEFT, LIMIT, H)).toEqual({
      overflow: false,
      runIds: [],
      crossingIds: [],
    });
  });

  it('reports the whole run when normal spacing carries it past the limit', () => {
    const line = [word('a', 100, 200), word('b', 210, 300), word('c', 310, 390), word('d', 400, 460), word('e', 470, 520)];
    const r = findOverflow([line], LEFT, LIMIT, H);
    expect(r.overflow).toBe(true);
    expect(r.runIds).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(r.crossingIds).toEqual(['d', 'e']);
  });

  it('ignores the next column after a wide gap', () => {
    const line = [word('a', 100, 200), word('b', 210, 300), word('x', 450, 520), word('y', 530, 600)];
    expect(findOverflow([line], LEFT, LIMIT, H).overflow).toBe(false);
  });

  it('reports only the line that crosses', () => {
    const l1 = [word('a', 100, 200), word('b', 210, 300)];
    const l2 = [word('c', 100, 250, 0, 140), word('d', 260, 380, 0, 140), word('e', 390, 470, 0, 140)];
    const r = findOverflow([l1, l2], LEFT, LIMIT, H);
    expect(r.runIds).toEqual(['c', 'd', 'e']);
    expect(r.crossingIds).toEqual(['e']);
  });

  it('counts a word that straddles the limit as crossing', () => {
    const line = [word('a', 100, 300), word('b', 310, 450)];
    const r = findOverflow([line], LEFT, LIMIT, H);
    expect(r.runIds).toEqual(['a', 'b']);
    expect(r.crossingIds).toEqual(['b']);
  });

  it('is not changed by small vertical skew', () => {
    const flat = [word('a', 100, 200), word('b', 210, 390), word('c', 400, 460)];
    const skewed = flat.map((w, i) => word(w.id, w.box[0], w.box[2], i * 3));
    expect(findOverflow([skewed], LEFT, LIMIT, H)).toEqual(findOverflow([flat], LEFT, LIMIT, H));
  });

  it('keeps runIds free of words after a wide gap, and crossingIds inside runIds', () => {
    const item = fc.record({ w: fc.integer({ min: 5, max: 120 }), gap: fc.integer({ min: 0, max: 60 }) });
    fc.assert(
      fc.property(fc.array(item, { minLength: 1, maxLength: 12 }), (items) => {
        let x = LEFT;
        const line: OcrWord[] = [];
        const gapBefore = new Map<string, number>();
        items.forEach((it, i) => {
          if (i > 0) x += it.gap;
          const id = `w${i}`;
          gapBefore.set(id, i === 0 ? 0 : it.gap);
          line.push(word(id, x, x + it.w));
          x += it.w;
        });
        const r = findOverflow([line], LEFT, LIMIT, H);
        const ids = new Set(r.runIds);
        for (const w of line) {
          const wide = (gapBefore.get(w.id) as number) > GAP_FACTOR * H;
          // A word at or past the limit after a wide gap is another column's value.
          if (wide && w.box[0] >= LIMIT) expect(ids.has(w.id)).toBe(false);
        }
        for (const id of r.crossingIds) expect(ids.has(id)).toBe(true);
      }),
      { numRuns: 50 },
    );
  });
});
