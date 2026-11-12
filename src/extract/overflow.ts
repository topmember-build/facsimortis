import type { OcrWord } from '../ocr/types.js';

/**
 * Overflow detection for typed fields (pure: no I/O, no side effects).
 *
 * A long value in a left-column field can run across the field's right limit.
 * This function only DETECTS such runs. It changes nothing and flags nothing.
 *
 * Rule, per line (words sorted left to right):
 * - A run starts at a word whose left edge (x0) is at or right of `fieldLeft`
 *   and left of `rightLimit`.
 * - The run continues to the next word while the gap from this word's right
 *   edge (x1) to the next word's left edge (x0) is at most GAP_FACTOR * h.
 * - The line overflows when its run holds a word with x1 > rightLimit.
 * - A word that starts at or beyond `rightLimit` after a wider gap is not part
 *   of the run: it is the next column's own value.
 *
 * Result:
 * - runIds: every word of every overflowing run, in reading order.
 * - crossingIds: the words of those runs that lie at least partly beyond
 *   `rightLimit` (x1 > rightLimit).
 *
 * All sizes come from the OCR boxes: `h` is the page's median word height.
 * Only x positions are used, so a few pixels of vertical skew change nothing.
 */

/**
 * Largest gap, in word heights, that still counts as normal word spacing.
 *
 * A space is a fraction of a character width. Character width in typed text is
 * roughly 0.5 to 0.6 of the line height, so a space is well under one word
 * height; OCR boxes that are a little loose add a pixel or two. A column gap
 * is the margin between two fields, which is several word heights wide. One
 * word height sits between the two: above any normal space, below a column gap.
 */
export const GAP_FACTOR = 1;

export interface OverflowResult {
  overflow: boolean;
  runIds: string[];
  crossingIds: string[];
}

export function findOverflow(
  lines: readonly (readonly OcrWord[])[],
  fieldLeft: number,
  rightLimit: number,
  h: number,
): OverflowResult {
  const maxGap = GAP_FACTOR * h;
  const runIds: string[] = [];
  const crossingIds: string[] = [];

  for (const line of lines) {
    let i = 0;
    while (i < line.length) {
      const start = line[i] as OcrWord;
      if (start.box[0] < fieldLeft || start.box[0] >= rightLimit) {
        i += 1;
        continue;
      }
      let end = i;
      while (end + 1 < line.length) {
        const here = line[end] as OcrWord;
        const next = line[end + 1] as OcrWord;
        if (next.box[0] - here.box[2] > maxGap) break;
        end += 1;
      }
      const run = line.slice(i, end + 1);
      const crossing = run.filter((w) => w.box[2] > rightLimit);
      if (crossing.length > 0) {
        runIds.push(...run.map((w) => w.id));
        crossingIds.push(...crossing.map((w) => w.id));
      }
      i = end + 1;
    }
  }

  return { overflow: runIds.length > 0, runIds, crossingIds };
}
