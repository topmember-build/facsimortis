import type { OcrWord } from '../ocr/types.js';
import { centreY } from './labels.js';
import { groupLines, centreX } from './layout-typed.js';
import { GAP_FACTOR } from './overflow.js';

/**
 * No silent drops (pure: no I/O, no side effects).
 *
 * After a field has been read, its VALUE REGION is worked out from the same
 * geometry the reader used:
 * - Horizontal: [xMin, xMax), the reader's own value column (table: right of the
 *   label column minus one median word height; typed: the typed reader's region).
 * - Vertical: from the top of the highest cited word to the bottom of the lowest
 *   cited word, and never at or below the field's bottom limit.
 *
 * An "uncited word in the region" is a non-empty OCR word whose centre lies in that
 * region and that is not a label word, not cited by this field and not cited by any
 * other field. Words outside every value region (headings, stamps, the header
 * line) are never looked at.
 *
 * What happens to uncited words (all or nothing, so a value is never half-repaired):
 * 1. INCLUDE. If every uncited word chains onto the cited run on the same text
 *    line, they are all added. "Chains on" means: its centre is within h/2 of a
 *    word already in the run (the neighbour rule groupLines uses, so skew is
 *    tolerated) and the gap between the two boxes is at most GAP_FACTOR * h (the
 *    overflow.ts rule for normal word spacing). The check repeats until nothing
 *    more joins. The final words are put in reading order with groupLines. Their
 *    text is kept exactly as OCR read it.
 * 2. FLAG. Otherwise (some uncited word sits behind a wide gap, or on another
 *    line) the value stays exactly as read and the caller adds a plain flag. We
 *    do not include part of a set: half a guess is worse than a flag.
 *
 * h is the page's median word height. Nothing here is page-specific.
 */

export interface ValueColumn {
  xMin: number;
  xMax: number;
  /** Words centred at or below this y are not part of the value. */
  bottom: number;
}

export interface UncitedResult {
  /** The field's word IDs after inclusion, in reading order (unchanged when nothing was included). */
  wordIds: string[];
  /** Uncited words that were added to the value. */
  includedIds: string[];
  /** Uncited words still left out; the field must be flagged when this is not empty. */
  uncitedIds: string[];
}

export function resolveUncited(
  words: readonly OcrWord[],
  cited: readonly OcrWord[],
  column: ValueColumn,
  excludedIds: ReadonlySet<string>,
  h: number,
): UncitedResult {
  const citedIds = new Set(cited.map((w) => w.id));
  const unchanged: UncitedResult = { wordIds: cited.map((w) => w.id), includedIds: [], uncitedIds: [] };
  if (cited.length === 0) return unchanged;

  const yMin = Math.min(...cited.map((w) => w.box[1]));
  const yMax = Math.max(...cited.map((w) => w.box[3]));
  const candidates = words.filter((w) => {
    if (w.text.trim() === '' || citedIds.has(w.id) || excludedIds.has(w.id)) return false;
    const cx = centreX(w);
    const cy = centreY(w.box);
    return cx >= column.xMin && cx < column.xMax && cy >= yMin && cy <= yMax && cy < column.bottom;
  });
  if (candidates.length === 0) return unchanged;

  const maxGap = GAP_FACTOR * h;
  const run: OcrWord[] = [...cited];
  const joined = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const word of candidates) {
      if (joined.has(word.id)) continue;
      const touches = run.some((r) => {
        const gap = Math.max(word.box[0] - r.box[2], r.box[0] - word.box[2]);
        return gap <= maxGap && Math.abs(centreY(word.box) - centreY(r.box)) <= h / 2;
      });
      if (touches) {
        run.push(word);
        joined.add(word.id);
        changed = true;
      }
    }
  }

  if (joined.size < candidates.length) {
    return { ...unchanged, uncitedIds: candidates.map((w) => w.id) };
  }
  const ordered = groupLines(run, h).flatMap((line) => line.words);
  return { wordIds: ordered.map((w) => w.id), includedIds: candidates.map((w) => w.id), uncitedIds: [] };
}
