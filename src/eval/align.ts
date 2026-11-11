import type { Box, OcrWord } from '../ocr/types.js';
import { iou } from './match.js';
import type { TruthWord } from './match.js';

/**
 * Many-to-one word alignment between OCR words and truth words. Pure, no I/O.
 * Evaluation code only: the app never imports it (see eslint.config.js).
 *
 * Rules
 * 1. Each truth word goes to the OCR word with the highest ioMin (intersection over the
 *    smaller box) of at least `minContain`. Ties: higher IoU, then lower OCR id.
 * 2. MERGE: one OCR word holding two or more truth words that sit next to each other in
 *    the truth list and on the same line (vertical centres within half the smaller word
 *    height) becomes one group { merge, truthIds[], ocrIds[1] }.
 * 3. SPLIT: a truth word that two or more OCR words lie mostly inside (intersection over
 *    the OCR box >= minContain) becomes one group { split, truthIds[1], ocrIds[2+] }.
 *    OCR words already assigned to a different truth word are not used.
 * 4. Merge vs split on the same truth word: the interpretation with the larger total
 *    intersection area wins. A tie goes to the merge. If the split wins, the truth word
 *    leaves the merge run; the OCR word stays with the longest remaining run.
 * 5. One OCR word that holds several separate runs keeps the run with the larger
 *    intersection area (ties: the earlier run). The other truth words are missing.
 * 6. Everything else is { single } or { missing }. Unused OCR words are "extra".
 * 7. Text check: OCR texts joined equal truth texts joined once whitespace is removed.
 *    Case and punctuation are kept.
 */

export type GroupKind = 'single' | 'merge' | 'split' | 'missing';

export interface AlignGroup {
  kind: GroupKind;
  truthIds: string[];
  ocrIds: string[];
  truthText: string;
  /** OCR texts joined with a space, or null when missing. */
  ocrText: string | null;
  /** Text check passed (whitespace-insensitive). Ignores crossField. */
  correct: boolean;
  /** Min confidence of the OCR words, null when missing. */
  confidence: number | null;
  /** IoU of the OCR box(es) against the truth box(es), 0 when missing. */
  bestIou: number;
  /** Set by crossField(). Never counted as correct. */
  crossField: boolean;
}

export interface AlignResult {
  groups: AlignGroup[];
  extraOcrIds: string[];
}

export interface AlignOptions {
  minContain?: number;
}

export interface RateSummary {
  total: number;
  correct: number;
  rate: number;
}

export interface AlignReport {
  all: RateSummary;
  fieldValues: RateSummary;
  counts: {
    single: number;
    merge: number;
    split: number;
    missing: number;
    extra: number;
    crossField: number;
  };
  /** Mean bestIou over groups that are not missing (0 when none). */
  meanIoU: number;
}

const EPS = 1e-9;

function area(b: Box): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

function inter(a: Box, b: Box): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return w <= 0 || h <= 0 ? 0 : w * h;
}

function union(boxes: Box[]): Box {
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

/** Intersection area over the smaller box area. 0 when there is no overlap. */
export function ioMin(a: Box, b: Box): number {
  const m = Math.min(area(a), area(b));
  return m <= 0 ? 0 : inter(a, b) / m;
}

const strip = (s: string): string => s.replace(/\s+/g, '');

function sameLine(a: Box, b: Box): boolean {
  const cyA = (a[1] + a[3]) / 2;
  const cyB = (b[1] + b[3]) / 2;
  const h = Math.min(a[3] - a[1], b[3] - b[1]);
  return Math.abs(cyA - cyB) <= h / 2;
}

/** Split sorted truth indices into runs of adjacent indices on the same line. */
function runsOf(indices: number[], truth: TruthWord[]): number[][] {
  const runs: number[][] = [];
  for (const i of indices) {
    const run = runs[runs.length - 1];
    const prev = run?.[run.length - 1];
    const prevWord = prev === undefined ? undefined : truth[prev];
    const word = truth[i];
    if (
      run !== undefined &&
      prev !== undefined &&
      prevWord !== undefined &&
      word !== undefined &&
      i === prev + 1 &&
      sameLine(prevWord.box, word.box)
    ) {
      run.push(i);
    } else {
      runs.push([i]);
    }
  }
  return runs;
}

export function alignWords(
  ocrWords: OcrWord[],
  truthWords: TruthWord[],
  options: AlignOptions = {},
): AlignResult {
  const minContain = options.minContain ?? 0.5;
  const ocrById = new Map(ocrWords.map((o) => [o.id, o]));

  // Rule 1: assign each truth word to its best-contained OCR word.
  const assigned: Array<OcrWord | undefined> = truthWords.map((t) => {
    let best: OcrWord | undefined;
    let bestMin = 0;
    let bestIou = 0;
    for (const o of ocrWords) {
      const m = ioMin(o.box, t.box);
      if (m < minContain) continue;
      const v = iou(o.box, t.box);
      const better =
        best === undefined ||
        m > bestMin + EPS ||
        (Math.abs(m - bestMin) <= EPS && (v > bestIou + EPS || (Math.abs(v - bestIou) <= EPS && o.id < best.id)));
      if (better) {
        best = o;
        bestMin = m;
        bestIou = v;
      }
    }
    return best;
  });

  const truthOf = new Map<string, number[]>();
  assigned.forEach((o, i) => {
    if (o === undefined) return;
    const list = truthOf.get(o.id) ?? [];
    list.push(i);
    truthOf.set(o.id, list);
  });

  // Rule 3: split candidates, in truth order, each OCR word used once.
  const splitUsed = new Set<string>();
  const splits = new Map<number, OcrWord[]>();
  const runCoverage = (ocr: OcrWord, run: number[]): number =>
    run.reduce((sum, i) => sum + inter(ocr.box, (truthWords[i] as TruthWord).box), 0);
  truthWords.forEach((t, i) => {
    const parts = ocrWords.filter((o) => {
      if (splitUsed.has(o.id)) return false;
      const a = area(o.box);
      if (a <= 0 || inter(o.box, t.box) / a < minContain) return false;
      const holders = truthOf.get(o.id) ?? [];
      return holders.every((j) => j === i);
    });
    if (parts.length < 2) return;
    // Rule 4: compare against the merge run that holds this truth word, if any.
    const holder = assigned[i];
    if (holder !== undefined) {
      const run = runsOf(truthOf.get(holder.id) ?? [], truthWords).find((r) => r.includes(i));
      if (run !== undefined && run.length >= 2) {
        const mergeCov = runCoverage(holder, run);
        const splitCov = parts.reduce((sum, o) => sum + inter(o.box, t.box), 0);
        if (mergeCov >= splitCov) return;
      }
    }
    parts.forEach((o) => splitUsed.add(o.id));
    splits.set(i, parts);
  });

  const groupAt = new Map<number, AlignGroup>();
  const usedOcr = new Set<string>();

  const make = (kind: GroupKind, truthIdx: number[], ocrs: OcrWord[]): AlignGroup => {
    const ts = truthIdx.map((i) => truthWords[i] as TruthWord);
    const truthText = ts.map((t) => t.text).join(' ');
    if (ocrs.length === 0) {
      return {
        kind: 'missing',
        truthIds: ts.map((t) => t.id),
        ocrIds: [],
        truthText,
        ocrText: null,
        correct: false,
        confidence: null,
        bestIou: 0,
        crossField: false,
      };
    }
    const ocrText = ocrs.map((o) => o.text).join(' ');
    return {
      kind,
      truthIds: ts.map((t) => t.id),
      ocrIds: ocrs.map((o) => o.id),
      truthText,
      ocrText,
      correct: strip(ocrText) === strip(truthText),
      confidence: Math.min(...ocrs.map((o) => o.confidence)),
      bestIou: iou(union(ocrs.map((o) => o.box)), union(ts.map((t) => t.box))),
      crossField: false,
    };
  };

  for (const [i, parts] of splits) {
    groupAt.set(i, make('split', [i], [...parts].sort((a, b) => (a.id < b.id ? -1 : 1))));
    parts.forEach((o) => usedOcr.add(o.id));
  }

  // Rules 2 and 5: merges and singles from the remaining assignments.
  for (const o of ocrWords) {
    if (usedOcr.has(o.id)) continue;
    const mine = (truthOf.get(o.id) ?? []).filter((i) => !splits.has(i));
    if (mine.length === 0) continue;
    const runs = runsOf(mine, truthWords);
    let keep = runs[0] as number[];
    for (const r of runs) if (runCoverage(o, r) > runCoverage(o, keep) + EPS) keep = r;
    groupAt.set(keep[0] as number, make(keep.length >= 2 ? 'merge' : 'single', keep, [o]));
    usedOcr.add(o.id);
    // Truth words of the dropped runs fall through to missing below.
  }

  // Merge members after the first are covered by the merge group.
  const covered = new Set<number>();
  const groups: AlignGroup[] = [];
  for (let i = 0; i < truthWords.length; i += 1) {
    if (covered.has(i)) continue;
    const g = groupAt.get(i);
    if (g === undefined) {
      groups.push(make('missing', [i], []));
      continue;
    }
    if (g.kind === 'merge') {
      g.truthIds.forEach((id) => covered.add(truthWords.findIndex((t) => t.id === id)));
    }
    groups.push(g);
  }

  const inGroups = new Set(groups.flatMap((g) => g.ocrIds));
  const extraOcrIds = ocrWords.filter((o) => !inGroups.has(o.id) && ocrById.has(o.id)).map((o) => o.id);
  return { groups, extraOcrIds };
}

/**
 * Mark merge groups that cross fields. `fieldWordIds` maps a field name to its truth
 * word ids. A merge is cross-field when its truth words do not all share one field, or
 * when it mixes field-value words with non-field words (label, heading).
 * Returns new groups; the input is not changed.
 */
export function crossField(
  groups: AlignGroup[],
  fieldWordIds: Record<string, string[]>,
): AlignGroup[] {
  const fieldsOf = new Map<string, Set<string>>();
  for (const [name, ids] of Object.entries(fieldWordIds)) {
    for (const id of ids) {
      const set = fieldsOf.get(id) ?? new Set<string>();
      set.add(name);
      fieldsOf.set(id, set);
    }
  }
  return groups.map((g) => {
    if (g.kind !== 'merge') return { ...g, crossField: false };
    const sets = g.truthIds.map((id) => fieldsOf.get(id) ?? new Set<string>());
    const anyField = sets.some((s) => s.size > 0);
    if (!anyField) return { ...g, crossField: false };
    const first = sets[0] ?? new Set<string>();
    const shared = [...first].some((name) => sets.every((s) => s.has(name)));
    return { ...g, crossField: !shared };
  });
}

function summary(correct: number, total: number): RateSummary {
  return { total, correct, rate: total === 0 ? 0 : correct / total };
}

/**
 * Per-truth-word rates. Each truth word takes the result of its group. A cross-field
 * group is never counted as correct.
 */
export function alignReport(
  result: AlignResult,
  truthWords: TruthWord[],
  fieldWordIds: Iterable<string>,
): AlignReport {
  const fieldIds = new Set(fieldWordIds);
  const ok = new Map<string, boolean>();
  for (const g of result.groups) {
    for (const id of g.truthIds) ok.set(id, g.correct && !g.crossField);
  }
  const count = (words: TruthWord[]): RateSummary =>
    summary(words.filter((t) => ok.get(t.id) === true).length, words.length);

  const counts = { single: 0, merge: 0, split: 0, missing: 0, extra: result.extraOcrIds.length, crossField: 0 };
  let iouSum = 0;
  let matched = 0;
  for (const g of result.groups) {
    counts[g.kind] += 1;
    if (g.crossField) counts.crossField += 1;
    if (g.kind !== 'missing') {
      iouSum += g.bestIou;
      matched += 1;
    }
  }
  return {
    all: count(truthWords),
    fieldValues: count(truthWords.filter((t) => fieldIds.has(t.id))),
    counts,
    meanIoU: matched === 0 ? 0 : iouSum / matched,
  };
}
