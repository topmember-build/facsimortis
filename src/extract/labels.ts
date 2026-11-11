import type { Box, OcrWord } from '../ocr/types.js';
import { FIELD_ORDER } from './schema.js';
import type { FieldName } from './schema.js';

/**
 * Label matching (pure: no I/O).
 *
 * Rules, in plain terms:
 * - A label is a short run of words, for example "Patient name:". We look for
 *   those words one after another in the OCR words, all on one line.
 * - "One line" means the vertical centres of neighbouring words are within half
 *   the median word height of each other. Neighbours are compared, not the first
 *   word, so a page that is skewed by a few degrees still counts as one line.
 * - Each label word is compared without regard to case, and the trailing colon
 *   is optional on either side.
 * - Label words that are 4 or more characters long, counting the colon as written
 *   in LABELS (so "NPI:" counts), may be one edit away (Levenshtein, colon
 *   removed). Shorter ones ("of", "for") must match exactly.
 * - A label word may also be matched by two adjacent OCR words whose joined text
 *   is within that tolerance ("Cal" + "tback" for "Callback"). Joined matches
 *   count as fuzzy. Only label words of 4 or more characters may be joined.
 * - If the LAST label word is followed directly by extra text in the same OCR
 *   word ("phone:555-0147"), the label is found but marked `merged`. The word is
 *   not split.
 *
 * The tolerance applies to label text only. Values are never matched or repaired.
 */

export const LABELS: Readonly<Record<FieldName, readonly string[]>> = {
  patientName: ['Patient', 'name:'],
  dob: ['Date', 'of', 'birth:'],
  referringProvider: ['Referring', 'provider:'],
  npi: ['Provider', 'NPI:'],
  reason: ['Reason', 'for', 'referral:'],
  urgency: ['Urgency:'],
  callbackPhone: ['Callback', 'phone:'],
};

export interface LabelMatch {
  /** OCR word IDs that make up the label, in reading order. */
  wordIds: string[];
  /** Union of the label words' boxes. */
  box: Box;
  /** True if any label word needed the edit tolerance or a two-word join. */
  fuzzy: boolean;
  /** True if the last label word has value text stuck to it. */
  merged: boolean;
}

export interface LabelFinding {
  field: FieldName;
  /** How many times the label was found on the page. */
  count: number;
  /** Every match, in reading order. */
  matches: LabelMatch[];
}

export function medianWordHeight(words: readonly OcrWord[]): number {
  const heights = words.map((w) => w.box[3] - w.box[1]).sort((a, b) => a - b);
  if (heights.length === 0) return 0;
  const mid = Math.floor(heights.length / 2);
  const upper = heights[mid] ?? 0;
  if (heights.length % 2 === 1) return upper;
  return ((heights[mid - 1] ?? upper) + upper) / 2;
}

export function centreY(box: Box): number {
  return (box[1] + box[3]) / 2;
}

export function unionBox(boxes: readonly Box[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b[0]);
    y0 = Math.min(y0, b[1]);
    x1 = Math.max(x1, b[2]);
    y1 = Math.max(y1, b[3]);
  }
  return [x0, y0, x1, y1];
}

export function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

function normalise(text: string): string {
  const lower = text.toLowerCase();
  return lower.endsWith(':') ? lower.slice(0, -1) : lower;
}

/** 'exact' ignores case and colon only. 'fuzzy' uses the one-edit tolerance. */
function compareWord(labelWord: string, text: string): 'exact' | 'fuzzy' | null {
  const want = normalise(labelWord);
  const got = normalise(text);
  if (got === want) return 'exact';
  if (labelWord.length >= 4 && levenshtein(got, want) <= 1) return 'fuzzy';
  return null;
}

/** "phone:555-0147" for the label word "phone:". Needs the colon and extra text. */
function isMergedWord(labelWord: string, text: string): boolean {
  if (!labelWord.endsWith(':')) return false;
  const lower = text.toLowerCase();
  const prefix = labelWord.toLowerCase();
  return lower.startsWith(prefix) && lower.length > prefix.length;
}

function sameLine(a: OcrWord, b: OcrWord, medianHeight: number): boolean {
  return Math.abs(centreY(a.box) - centreY(b.box)) <= medianHeight / 2;
}

function matchAt(
  words: readonly OcrWord[],
  start: number,
  label: readonly string[],
  medianHeight: number,
): { match: LabelMatch; used: number } | null {
  const ids: string[] = [];
  const boxes: Box[] = [];
  let fuzzy = false;
  let merged = false;
  let k = start;

  for (let j = 0; j < label.length; j++) {
    const labelWord = label[j] ?? '';
    const word = words[k];
    if (word === undefined) return null;
    const previous = words[k - 1];
    if (k > start && previous !== undefined && !sameLine(previous, word, medianHeight)) {
      return null;
    }

    const single = compareWord(labelWord, word.text);
    if (single !== null) {
      fuzzy = fuzzy || single === 'fuzzy';
      ids.push(word.id);
      boxes.push(word.box);
      k += 1;
      continue;
    }

    if (j === label.length - 1 && isMergedWord(labelWord, word.text)) {
      merged = true;
      ids.push(word.id);
      boxes.push(word.box);
      k += 1;
      continue;
    }

    const next = words[k + 1];
    if (
      next !== undefined &&
      labelWord.length >= 4 &&
      sameLine(word, next, medianHeight) &&
      compareWord(labelWord, word.text + next.text) !== null
    ) {
      fuzzy = true;
      ids.push(word.id, next.id);
      boxes.push(word.box, next.box);
      k += 2;
      continue;
    }
    return null;
  }

  return { match: { wordIds: ids, box: unionBox(boxes), fuzzy, merged }, used: k - start };
}

/** Find every label in the OCR words. Always returns one finding per field. */
export function findLabels(words: readonly OcrWord[]): LabelFinding[] {
  const medianHeight = medianWordHeight(words);
  return FIELD_ORDER.map((field) => {
    const label = LABELS[field];
    const matches: LabelMatch[] = [];
    let i = 0;
    while (i < words.length) {
      const found = matchAt(words, i, label, medianHeight);
      if (found === null) {
        i += 1;
      } else {
        matches.push(found.match);
        i += found.used;
      }
    }
    return { field, count: matches.length, matches };
  });
}
