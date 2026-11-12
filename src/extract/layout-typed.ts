import type { OcrWord } from '../ocr/types.js';
import { centreY, medianWordHeight } from './labels.js';
import type { LabelFinding, LabelMatch } from './labels.js';
import { GAP_FACTOR, findOverflow } from './overflow.js';
import type { OverflowResult } from './overflow.js';

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
 * detectTypedOverflow (0.5.7) looks at the same rows WITHOUT the right cut, so a
 * value that runs on past its right limit can be seen and flagged instead of being
 * silently cut. It never changes what readTypedValue returns.
 *
 * Nothing here is page-specific: every size comes from the OCR words themselves.
 * Values are returned as word IDs. The text is never changed.
 */

export type TypedReadResult =
  | { kind: 'value'; wordIds: string[] }
  | { kind: 'empty' }
  | { kind: 'merged' };

export interface TypedLimits {
  right: number;
  bottom: number;
  onLabelLines?: ReadonlySet<string>;
}

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

interface TypedRegion {
  medianHeight: number;
  labelIds: Set<string>;
  xMin: number;
  xMax: number;
  yMin: number;
}

function typedRegion(
  words: readonly OcrWord[],
  label: LabelMatch,
  allLabels: readonly LabelFinding[],
  page: { width: number; height: number },
  limits: TypedLimits | undefined,
): TypedRegion {
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
  return {
    medianHeight,
    labelIds,
    xMin: label.box[0] - medianHeight,
    xMax,
    yMin: label.box[3] - 0.25 * medianHeight,
  };
}

/** Accept lines in reading order until a gap, a label line or the bottom limit. */
function takeLines(
  lines: readonly Line[],
  label: LabelMatch,
  region: TypedRegion,
  limits: TypedLimits | undefined,
): Line[] {
  const accepted: Line[] = [];
  let previousBottom = label.box[3];
  for (const line of lines) {
    const top = mean(line.words.map((w) => w.box[1]));
    if (top - previousBottom > MAX_GAP_IN_HEIGHTS * region.medianHeight) break;
    if (line.words.some((w) => region.labelIds.has(w.id))) break;
    // Bottom limit from the page structure: top of the next label below in this column.
    if (limits !== undefined && mean(line.words.map((w) => centreY(w.box))) >= limits.bottom) break;
    previousBottom = mean(line.words.map((w) => w.box[3]));
    accepted.push(line);
  }
  return accepted;
}

export function readTypedValue(
  words: readonly OcrWord[],
  label: LabelMatch,
  allLabels: readonly LabelFinding[],
  page: { width: number; height: number },
  limits?: TypedLimits,
): TypedReadResult {
  if (label.merged) return { kind: 'merged' };

  const region = typedRegion(words, label, allLabels, page, limits);
  const candidates = words.filter((w) => {
    if (w.text.trim() === '') return false;
    // A word that sits on some label's line (right of that label) belongs to that
    // label's box, not to this value, even when skew puts it under this value.
    if (limits?.onLabelLines?.has(w.id) === true) return false;
    const cx = centreX(w);
    return cx >= region.xMin && cx < region.xMax && centreY(w.box) > region.yMin;
  });

  const lines = takeLines(groupLines(candidates, region.medianHeight), label, region, limits);
  const taken = lines.flatMap((line) => [...line.words].sort((a, b) => centreX(a) - centreX(b)));

  if (taken.length === 0) return { kind: 'empty' };
  return { kind: 'value', wordIds: taken.map((w) => w.id) };
}

const NO_OVERFLOW: OverflowResult = { overflow: false, runIds: [], crossingIds: [] };

/**
 * Does this typed field's value run on past its right limit?
 *
 * Looks at the same rows as readTypedValue but with no right cut. Label words and
 * words on any label's line are left out entirely; with them gone, the gap and
 * bottom limits end the rows (a label line on the other column would otherwise end
 * the scan early on a skewed page). Only applies when the right limit is a real
 * limit (another column), not the page edge.
 *
 * A run must START at a word this field itself reads: one whose centre lies inside
 * the field's region (left of the reader's cut). Words past the cut stay in a row
 * only while they chain on from such a word with normal word spacing
 * (GAP_FACTOR * h); anything else is the next column's own value and is dropped
 * before findOverflow sees the row. Without this, the next column's value, which can
 * start a pixel left of that column's label edge after rounding or skew, would
 * itself look like a run crossing the limit and be blamed on this field.
 *
 * Each row is then followed to the right along the text line itself: a word is
 * added while it starts within GAP_FACTOR * h of the previous word and its centre
 * is within h/2 of the previous word's centre (the same neighbour rule groupLines
 * uses for skew). This matters on a skewed page, where a long line can climb above
 * the reader's start line on the right and would otherwise be lost before it
 * reaches the limit.
 */
export function detectTypedOverflow(
  words: readonly OcrWord[],
  label: LabelMatch,
  allLabels: readonly LabelFinding[],
  page: { width: number; height: number },
  limits: TypedLimits,
): OverflowResult {
  if (label.merged || limits.right >= page.width) return NO_OVERFLOW;

  const region = typedRegion(words, label, allLabels, page, limits);
  const candidates = words.filter((w) => {
    if (w.text.trim() === '') return false;
    if (region.labelIds.has(w.id)) return false;
    if (limits.onLabelLines?.has(w.id) === true) return false;
    return centreX(w) >= region.xMin && centreY(w.box) > region.yMin;
  });

  const lines = takeLines(groupLines(candidates, region.medianHeight), label, region, limits);
  const maxGap = GAP_FACTOR * region.medianHeight;
  // Words a row may follow on to: same exclusions as above, but no start line.
  const followable = words
    .filter((w) => {
      if (w.text.trim() === '') return false;
      if (region.labelIds.has(w.id)) return false;
      if (limits.onLabelLines?.has(w.id) === true) return false;
      return centreX(w) >= region.xMin;
    })
    .sort((a, b) => a.box[0] - b.box[0]);
  const follow = (row: OcrWord[]): OcrWord[] => {
    const out = [...row];
    const used = new Set(out.map((w) => w.id));
    let last = out[out.length - 1];
    while (last !== undefined) {
      const from: OcrWord = last;
      const next = followable.find(
        (w) =>
          !used.has(w.id) &&
          w.box[0] > from.box[0] &&
          w.box[0] - from.box[2] <= maxGap &&
          Math.abs(centreY(w.box) - centreY(from.box)) <= region.medianHeight / 2,
      );
      if (next === undefined) break;
      out.push(next);
      used.add(next.id);
      last = next;
    }
    return out;
  };
  const ownRows = lines.map((line) => {
    const sorted = [...line.words].sort((a, b) => a.box[0] - b.box[0]);
    const kept: OcrWord[] = [];
    let previous: OcrWord | undefined;
    for (const word of sorted) {
      const inside = centreX(word) < region.xMax;
      const chained = previous !== undefined && word.box[0] - previous.box[2] <= maxGap;
      if (inside || chained) {
        kept.push(word);
        previous = word;
      } else {
        previous = undefined;
      }
    }
    return follow(kept);
  });
  return findOverflow(ownRows, region.xMin, limits.right, region.medianHeight);
}