import type { OcrWord } from '../ocr/types.js';
import { centreY, medianWordHeight } from './labels.js';
import type { LabelFinding, LabelMatch } from './labels.js';
import { centreX, groupLines, mean } from './layout-typed.js';
import type { TypedReadResult } from './layout-typed.js';

/**
 * Table-form reader (pure: no I/O).
 *
 * In a table form the label sits in the left column and its value in the right
 * column, starting on the label's own row. A long value wraps onto more lines in
 * the value column. All sizes come from OCR boxes, nothing is page-specific.
 *
 * - First line: words on the label's line (neighbouring words within half a
 *   median word height vertically, so a skewed page still gives a whole line)
 *   that start to the right of the label's right edge and are not label words.
 * - Wrapped lines: the lines below. A line belongs to the value while all of its
 *   words start at or right of (first value word's left edge - one median word
 *   height). Reading stops at a line with a word left of that limit (the label
 *   column), at a line that contains any label word, at a vertical gap larger
 *   than 1.5 median word heights, or when the words run out.
 *
 * Values are word IDs in reading order. The text is never changed.
 */

export type TableReadResult = TypedReadResult;

const MAX_GAP_IN_HEIGHTS = 1.5;
const SAME_ROW_IN_HEIGHTS = 2;

export function allLabelWordIds(allLabels: readonly LabelFinding[]): Set<string> {
  const ids = new Set<string>();
  for (const finding of allLabels) {
    for (const match of finding.matches) for (const id of match.wordIds) ids.add(id);
  }
  return ids;
}

export function allMatches(allLabels: readonly LabelFinding[]): LabelMatch[] {
  return allLabels.flatMap((f) => f.matches);
}

/** Non-label words to the right of the label on the label's own line, left to right. */
export function firstLineValueWords(
  words: readonly OcrWord[],
  label: LabelMatch,
  labelIds: ReadonlySet<string>,
  otherLabels: readonly LabelMatch[],
): OcrWord[] {
  const medianHeight = medianWordHeight(words);
  const byId = new Map(words.map((w) => [w.id, w]));
  const lastId = label.wordIds[label.wordIds.length - 1];
  const last = lastId === undefined ? undefined : byId.get(lastId);
  const labelCentre = last === undefined ? centreY(label.box) : centreY(last.box);

  // Another label to the right on about the same row starts the other column.
  let xMax = Infinity;
  for (const other of otherLabels) {
    if (other.wordIds[0] === label.wordIds[0]) continue;
    if (other.box[0] >= label.box[2] && Math.abs(centreY(other.box) - labelCentre) <= SAME_ROW_IN_HEIGHTS * medianHeight) {
      xMax = Math.min(xMax, other.box[0] - 0.25 * medianHeight);
    }
  }

  const right = words
    .filter((w) => !labelIds.has(w.id) && w.text.trim() !== '' && w.box[0] >= label.box[2] && w.box[0] < xMax)
    .sort((a, b) => a.box[0] - b.box[0]);

  // First hop: the closest word vertically, within half a median height of the label's last word.
  let start: OcrWord | undefined;
  let bestDistance = Infinity;
  for (const word of right) {
    const distance = Math.abs(centreY(word.box) - labelCentre);
    if (distance <= medianHeight / 2 && distance < bestDistance) {
      start = word;
      bestDistance = distance;
    }
  }
  if (start === undefined) return [];

  // Then follow neighbours to the right: each next word within half a median height.
  const line: OcrWord[] = [start];
  let previousCentre = centreY(start.box);
  for (const word of right) {
    if (word.box[0] <= start.box[0]) continue;
    if (Math.abs(centreY(word.box) - previousCentre) <= medianHeight / 2) {
      line.push(word);
      previousCentre = centreY(word.box);
    }
  }
  return line;
}

export function readTableValue(
  words: readonly OcrWord[],
  label: LabelMatch,
  allLabels: readonly LabelFinding[],
): TableReadResult {
  if (label.merged) return { kind: 'merged' };

  const medianHeight = medianWordHeight(words);
  const labelIds = allLabelWordIds(allLabels);
  const first = firstLineValueWords(words, label, labelIds, allMatches(allLabels));
  const firstWord = first[0];
  if (firstWord === undefined) return { kind: 'empty' };

  const taken: OcrWord[] = [...first];
  // The label itself is part of the first line, not a line below it (a skewed page can put it lower).
  const firstIds = new Set([...first.map((w) => w.id), ...label.wordIds]);
  const xLimit = firstWord.box[0] - medianHeight;
  let previousBottom = mean(first.map((w) => w.box[3]));
  const yMin = previousBottom - 0.25 * medianHeight;

  const below = words.filter(
    (w) => !firstIds.has(w.id) && w.text.trim() !== '' && centreY(w.box) > yMin,
  );
  for (const line of groupLines(below, medianHeight)) {
    const top = mean(line.words.map((w) => w.box[1]));
    if (top - previousBottom > MAX_GAP_IN_HEIGHTS * medianHeight) break;
    if (line.words.some((w) => labelIds.has(w.id))) break;
    if (line.words.some((w) => w.box[0] < xLimit)) break;
    previousBottom = mean(line.words.map((w) => w.box[3]));
    taken.push(...[...line.words].sort((a, b) => centreX(a) - centreX(b)));
  }

  return { kind: 'value', wordIds: taken.map((w) => w.id) };
}
