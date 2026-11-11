import type { OcrWord } from '../ocr/types.js';
import { centreY, medianWordHeight } from './labels.js';
import type { LabelFinding, LabelMatch } from './labels.js';

/**
 * Typed-form reader (pure: no I/O).
 *
 * In a typed form each box has its label at the top and the value on the line or
 * lines below it. For a label we build a region from OCR boxes only:
 * - Horizontal: from one median word height left of the label's left edge, to
 *   just before the left edge of the nearest OTHER label that sits to the right
 *   on about the same row (the other column). With no such label, the page width.
 * - Vertical: starts just below the label's box.
 * Words whose centre falls in the region are grouped into lines. Lines are built
 * by comparing neighbouring words, so a skewed page still gives whole lines.
 * Reading stops at the first line that contains a label word, at a vertical gap
 * larger than 1.5 median word heights, or at the end of the words.
 *
 * When the page structure supplies limits, the right limit (next column's left
 * edge) also bounds the region and the bottom limit (top of the next label below
 * in the same column) ends reading at the first line centred at or below it.
 * Whichever comes first wins. Words the structure placed on any label's line
 * (onLabelLines) are never taken as value words.
 *
 * Nothing here is page-specific: every size comes from the OCR words themselves.
 * Values are returned as word IDs. The text is never changed.
 */

export type TypedReadResult =
  | { kind: 'value'; wordIds: string[] }
  | { kind: 'empty' }
  | { kind: 'merged' };

const MAX_GAP_IN_HEIGHTS = 1.5;
const SAME_ROW_IN_HEIGHTS = 2;

export interface Line {
  words: OcrWord[];
}

export function centreX(w: OcrWord): number {
  return (w.box[0] + w.box[2]) / 2;
}

export function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function groupLines(candidates: readonly OcrWord[], medianHeight: number): Line[] {
  const lines: Line[] = [];
  const sorted = [...candidates].sort((a, b) => centreX(a) - centreX(b));
  for (const word of sorted) {
    let best: Line | undefined;
    let bestDistance = Infinity;
    for (const line of lines) {
      const last = line.words[line.words.length - 1];
      if (last === undefined) continue;
      const distance = Math.abs(centreY(word.box) - centreY(last.box));
      if (distance <= medianHeight / 2 && distance < bestDistance) {
        best = line;
        bestDistance = distance;
      }
    }
    if (best === undefined) lines.push({ words: [word] });
    else best.words.push(word);
  }
  return lines.sort(
    (a, b) => mean(a.words.map((w) => centreY(w.box))) - mean(b.words.map((w) => centreY(w.box))),
  );
}

export function readTypedValue(
  words: readonly OcrWord[],
  label: LabelMatch,
  allLabels: readonly LabelFinding[],
  page: { width: number; height: number },
  limits?: { right: number; bottom: number; onLabelLines?: ReadonlySet<string> },
): TypedReadResult {
  if (label.merged) return { kind: 'merged' };

  const medianHeight = medianWordHeight(words);
  const labelIds = new Set<string>();
  const otherMatches: LabelMatch[] = [];
  for (const finding of allLabels) {
    for (const match of finding.matches) {
      for (const id of match.wordIds) labelIds.add(id);
      if (match.wordIds[0] !== label.wordIds[0]) otherMatches.push(match);
    }
  }

  const labelCentre = centreY(label.box);
  const rightNeighbours = otherMatches.filter(
    (m) =>
      m.box[0] >= label.box[2] &&
      Math.abs(centreY(m.box) - labelCentre) <= SAME_ROW_IN_HEIGHTS * medianHeight,
  );
  const nearestOnRow =
    rightNeighbours.length > 0
      ? Math.min(...rightNeighbours.map((m) => m.box[0])) - 0.25 * medianHeight
      : page.width;
  // The page structure's right limit (left edge of the next column) applies as well;
  // the smaller of the two wins. The page edge is not a limit and is left alone.
  const xMax =
    limits !== undefined && limits.right < page.width
      ? Math.min(nearestOnRow, limits.right - 0.25 * medianHeight)
      : nearestOnRow;
  const xMin = label.box[0] - medianHeight;
  const yMin = label.box[3] - 0.25 * medianHeight;

  const candidates = words.filter((w) => {
    if (w.text.trim() === '') return false;
    // A word that sits on some label's line (right of that label) belongs to that
    // label's box, not to this value, even when skew puts it under this value.
    if (limits?.onLabelLines?.has(w.id) === true) return false;
    const cx = centreX(w);
    return cx >= xMin && cx < xMax && centreY(w.box) > yMin;
  });

  const lines = groupLines(candidates, medianHeight);
  const taken: OcrWord[] = [];
  let previousBottom = label.box[3];
  for (const line of lines) {
    const top = mean(line.words.map((w) => w.box[1]));
    if (top - previousBottom > MAX_GAP_IN_HEIGHTS * medianHeight) break;
    if (line.words.some((w) => labelIds.has(w.id))) break;
    // Bottom limit from the page structure: top of the next label below in this column.
    if (limits !== undefined && mean(line.words.map((w) => centreY(w.box))) >= limits.bottom) break;
    previousBottom = mean(line.words.map((w) => w.box[3]));
    taken.push(...[...line.words].sort((a, b) => centreX(a) - centreX(b)));
  }

  if (taken.length === 0) return { kind: 'empty' };
  return { kind: 'value', wordIds: taken.map((w) => w.id) };
}
