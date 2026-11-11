import type { Box, OcrResult, OcrWord } from '../ocr/types.js';
import { centreY, medianWordHeight } from './labels.js';
import type { findLabels } from './labels.js';
import type { FieldName } from './schema.js';

/**
 * Page structure (pure: no I/O, no page coordinates, no knowledge of which field
 * sits next to which; only the seven field names are known).
 *
 * Everything is derived from the OCR boxes and the label matches. Let h be the
 * median OCR word height on the page.
 *
 * USABLE LABELS
 * - A field is usable when its label was found exactly once and not merged.
 * - Otherwise it is listed in `unusable` with a reason: 'missing' (not found),
 *   'repeated' (found more than once) or 'merged' (value text stuck to the label).
 *   Unusable labels take no part in columns, layout or limits.
 *
 * COLUMNS
 * - Usable labels are sorted by left edge (x0). A label joins the current column
 *   when its x0 is within 2h of the previous label's x0, else it starts a new
 *   column. Columns run left to right; labels inside a column top to bottom.
 *   A column's `left` is its smallest label x0; its `labelRight` is its largest
 *   label right edge.
 *
 * SKEW
 * - Up to about 3 degrees is tolerated. Whether a word is "on a label's line" is
 *   decided from box centres: |dy| <= h/2 + 0.055 * |dx|, where dx is the
 *   horizontal distance between the centres (0.055 is just above tan 3 degrees).
 *   Column grouping uses a 2h tolerance on x0, which absorbs the sideways drift of
 *   a skewed page over the height of a form.
 *
 * EVIDENCE (counted, never turned into a value)
 * - Label words (of every match, usable or not) and empty words are ignored.
 * - rightWords: words that start at or right of the label's right edge, are on the
 *   label's line, and start left of the next column's left edge minus h/4
 *   (or anywhere to the page edge when there is no next column).
 * - belowWords: words that are below the label's line, start inside the label's
 *   column (x0 from column left - h up to, not including, the column's labelRight),
 *   and whose centre is above the top of the next usable label below in the column
 *   (or anywhere to the page bottom when there is none).
 * - hasRightWords / hasBelowWords are count > 0. rightWordIds lists the right words,
 *   so a reader can tell that a word belongs to some label's line.
 *
 * PAGE LAYOUT (decided from all usable labels together)
 * - A label votes 'table' when it has right words and no below words, and 'typed'
 *   when it has below words and no right words. Others do not vote.
 * - A "clear majority" is at least 3 usable labels and a vote count of at least
 *   two thirds of ALL usable labels. 'table' or 'typed' needs it; otherwise
 *   'unknown'. (Both cannot reach two thirds at once.)
 *
 * LIMITS (from every usable label)
 * - right.limit: the smallest label x0 of the next column to the right, else the
 *   page width.
 * - bottom.limit: the top (y0) of the next usable label below in the same column,
 *   else the page height.
 * - valueLeft: on a 'table' page, the column's labelRight (the value column starts
 *   right of the widest label); otherwise null.
 *
 * OPEN / CLOSED
 * - With no unusable label every side is 'closed'.
 * - With any unusable label, a side is 'open' when its limit is the page edge, or
 *   when it is farther than 1.5 times the typical spacing: the distance from the
 *   label's top to the bottom limit, or from the column's left to the right limit.
 *   Typical spacing is the lower median of the gaps between neighbouring usable
 *   labels on this page (top to top inside columns for bottom; left to left between
 *   columns for right). With no such gaps there is no typical spacing and the side
 *   is open. Open means: an unusable label's space could lie on this side, so
 *   a value there may run into it.
 */

export type LabelFindings = ReturnType<typeof findLabels>;
export type PageLayout = 'table' | 'typed' | 'unknown';
export type UnusableReason = 'missing' | 'repeated' | 'merged';
export type SideState = 'open' | 'closed';

export interface Side {
  limit: number;
  state: SideState;
}

export interface FieldStructure {
  field: FieldName;
  /** Index into `columns`. */
  column: number;
  /** Position inside the column, top = 0. */
  row: number;
  label: Box;
  rightWords: number;
  belowWords: number;
  /** IDs of the right words (the words on this label's line, right of it). */
  rightWordIds: string[];
  hasRightWords: boolean;
  hasBelowWords: boolean;
  right: Side;
  bottom: Side;
  valueLeft: number | null;
}

export interface ColumnStructure {
  left: number;
  labelRight: number;
  fields: FieldName[];
}

export interface PageStructure {
  layout: PageLayout;
  columns: ColumnStructure[];
  fields: FieldStructure[];
  unusable: { field: FieldName; reason: UnusableReason }[];
}

const COLUMN_TOLERANCE_IN_HEIGHTS = 2;
const SKEW_SLOPE = 0.055;
const OPEN_FACTOR = 1.5;
const MAJORITY = 2 / 3;
const MIN_LABELS_FOR_LAYOUT = 3;

interface Usable {
  field: FieldName;
  box: Box;
  column: number;
  row: number;
}

function lowerMedian(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

export function buildStructure(ocr: OcrResult, labels: LabelFindings): PageStructure {
  const h = medianWordHeight(ocr.words);
  const unusable: PageStructure['unusable'] = [];
  const picked: { field: FieldName; box: Box }[] = [];
  const labelIds = new Set<string>();

  for (const finding of labels) {
    for (const match of finding.matches) for (const id of match.wordIds) labelIds.add(id);
    const only = finding.matches[0];
    if (finding.count === 0 || only === undefined) unusable.push({ field: finding.field, reason: 'missing' });
    else if (finding.count > 1) unusable.push({ field: finding.field, reason: 'repeated' });
    else if (only.merged) unusable.push({ field: finding.field, reason: 'merged' });
    else picked.push({ field: finding.field, box: only.box });
  }

  // Columns: single-linkage on x0 within 2h.
  const byX = [...picked].sort((a, b) => a.box[0] - b.box[0]);
  const groups: { field: FieldName; box: Box }[][] = [];
  for (const item of byX) {
    const group = groups[groups.length - 1];
    const previous = group?.[group.length - 1];
    if (group !== undefined && previous !== undefined && item.box[0] - previous.box[0] <= COLUMN_TOLERANCE_IN_HEIGHTS * h) {
      group.push(item);
    } else {
      groups.push([item]);
    }
  }

  const usable: Usable[] = [];
  const columns: ColumnStructure[] = groups.map((group, column) => {
    const ordered = [...group].sort((a, b) => a.box[1] - b.box[1]);
    ordered.forEach((item, row) => usable.push({ field: item.field, box: item.box, column, row }));
    return {
      left: Math.min(...ordered.map((i) => i.box[0])),
      labelRight: Math.max(...ordered.map((i) => i.box[2])),
      fields: ordered.map((i) => i.field),
    };
  });
  // Columns are already left to right because groups come from the x0 sort.

  const content: OcrWord[] = ocr.words.filter((w) => !labelIds.has(w.id) && w.text.trim() !== '');

  const onLine = (word: OcrWord, box: Box): boolean => {
    const dx = Math.abs((word.box[0] + word.box[2]) / 2 - (box[0] + box[2]) / 2);
    return Math.abs(centreY(word.box) - centreY(box)) <= h / 2 + SKEW_SLOPE * dx;
  };

  const measured = usable.map((u) => {
    const col = columns[u.column];
    const nextCol = columns[u.column + 1];
    const below = usable.find((o) => o.column === u.column && o.row === u.row + 1);
    const col0 = col?.left ?? u.box[0];
    const colRight = col?.labelRight ?? u.box[2];
    const rightEdge = nextCol === undefined ? ocr.width : nextCol.left - h / 4;
    const bottomEdge = below === undefined ? ocr.height : below.box[1];

    let rightWords = 0;
    let belowWords = 0;
    const rightWordIds: string[] = [];
    for (const w of content) {
      const lined = onLine(w, u.box);
      if (lined) {
        if (w.box[0] >= u.box[2] && w.box[0] < rightEdge) {
          rightWords += 1;
          rightWordIds.push(w.id);
        }
      } else if (
        centreY(w.box) > centreY(u.box) &&
        w.box[0] >= col0 - h &&
        w.box[0] < colRight &&
        centreY(w.box) < bottomEdge
      ) {
        belowWords += 1;
      }
    }
    return { u, rightWords, belowWords, rightWordIds, nextCol, below };
  });

  // Layout from all usable labels together.
  let tableVotes = 0;
  let typedVotes = 0;
  for (const m of measured) {
    if (m.rightWords > 0 && m.belowWords === 0) tableVotes += 1;
    else if (m.belowWords > 0 && m.rightWords === 0) typedVotes += 1;
  }
  const needed = MAJORITY * measured.length;
  let layout: PageLayout = 'unknown';
  if (measured.length >= MIN_LABELS_FOR_LAYOUT) {
    if (tableVotes >= needed) layout = 'table';
    else if (typedVotes >= needed) layout = 'typed';
  }

  // Typical spacing from usable neighbours.
  const verticalGaps: number[] = [];
  for (const m of measured) if (m.below !== undefined) verticalGaps.push(m.below.box[1] - m.u.box[1]);
  const horizontalGaps: number[] = [];
  for (let i = 1; i < columns.length; i++) {
    horizontalGaps.push((columns[i]?.left ?? 0) - (columns[i - 1]?.left ?? 0));
  }
  const typicalV = lowerMedian(verticalGaps);
  const typicalH = lowerMedian(horizontalGaps);
  const anyUnusable = unusable.length > 0;

  const state = (fromPageEdge: boolean, distance: number, typical: number | undefined): SideState => {
    if (!anyUnusable) return 'closed';
    if (fromPageEdge || typical === undefined) return 'open';
    return distance > OPEN_FACTOR * typical ? 'open' : 'closed';
  };

  const fields: FieldStructure[] = measured.map((m) => {
    const col = columns[m.u.column];
    const left = col?.left ?? m.u.box[0];
    const rightLimit = m.nextCol === undefined ? ocr.width : m.nextCol.left;
    const bottomLimit = m.below === undefined ? ocr.height : m.below.box[1];
    return {
      field: m.u.field,
      column: m.u.column,
      row: m.u.row,
      label: m.u.box,
      rightWords: m.rightWords,
      belowWords: m.belowWords,
      rightWordIds: m.rightWordIds,
      hasRightWords: m.rightWords > 0,
      hasBelowWords: m.belowWords > 0,
      right: { limit: rightLimit, state: state(m.nextCol === undefined, rightLimit - left, typicalH) },
      bottom: { limit: bottomLimit, state: state(m.below === undefined, bottomLimit - m.u.box[1], typicalV) },
      valueLeft: layout === 'table' ? (col?.labelRight ?? m.u.box[2]) : null,
    };
  });

  return { layout, columns, fields, unusable };
}
