import type { AlignGroup } from './align.js';
import type { TruthWord } from './match.js';

/**
 * Confidence analysis over aligned words. Pure, no I/O. Evaluation code only.
 * It reports what the data shows. It does not pick a production threshold.
 */

export type ItemStatus =
  | 'correct'
  | 'misread'
  | 'merged-correct'
  | 'merged-misread'
  | 'split-correct'
  | 'split-misread'
  | 'missing'
  | 'cross-field';

export interface ConfidenceItem {
  faxId: string;
  truthId: string;
  field: string | null;
  truthText: string;
  ocrText: string | null;
  status: ItemStatus;
  /** Min confidence of the group's OCR words; null when missing. */
  confidence: number | null;
}

export interface FieldRef {
  name: string;
  wordIds: string[];
}

export type FieldStatus = 'correct' | 'misread' | 'missing' | 'cross-field';

export interface FieldItem {
  faxId: string;
  field: string;
  status: FieldStatus;
  /** Non-correct word statuses, in word order. */
  problems: ItemStatus[];
  /** Min confidence over the field's word groups; null when no word was read. */
  confidence: number | null;
}

/** Anything the sweep can score. */
export interface Scorable {
  status: string;
  confidence: number | null;
}

export interface SweepRow {
  threshold: number;
  misreadsFlagged: number;
  misreadsTotal: number;
  correctWronglyFlagged: number;
  correctTotal: number;
}

export interface Separation {
  misreadCount: number;
  correctCount: number;
  /** Highest confidence among misreads that were read at all. */
  maxMisread: number | null;
  minCorrect: number | null;
  /** max misread < min correct. Null when either side is empty. */
  separates: boolean | null;
  /** minCorrect - maxMisread. Negative means the two overlap by that much. */
  gap: number | null;
  overlap: number | null;
  /** Correct items with confidence <= maxMisread. */
  correctAtOrBelowMaxMisread: number;
}

export function isCorrectStatus(status: string): boolean {
  return status === 'correct' || status.endsWith('-correct');
}

function statusOf(g: AlignGroup): ItemStatus {
  if (g.kind === 'missing') return 'missing';
  if (g.crossField) return 'cross-field';
  if (g.kind === 'merge') return g.correct ? 'merged-correct' : 'merged-misread';
  if (g.kind === 'split') return g.correct ? 'split-correct' : 'split-misread';
  return g.correct ? 'correct' : 'misread';
}

/**
 * One item per truth word. scope "field" keeps only field-value words (one item per
 * field a word belongs to); scope "all" keeps every truth word with its first field or null.
 */
export function buildItems(
  faxId: string,
  groups: AlignGroup[],
  truthWords: TruthWord[],
  fields: FieldRef[],
  scope: 'field' | 'all',
): ConfidenceItem[] {
  const groupOf = new Map<string, AlignGroup>();
  for (const g of groups) for (const id of g.truthIds) groupOf.set(id, g);
  const items: ConfidenceItem[] = [];
  for (const t of truthWords) {
    const g = groupOf.get(t.id);
    if (g === undefined) continue;
    const names = fields.filter((f) => f.wordIds.includes(t.id)).map((f) => f.name);
    const make = (field: string | null): ConfidenceItem => ({
      faxId,
      truthId: t.id,
      field,
      truthText: t.text,
      ocrText: g.ocrText,
      status: statusOf(g),
      confidence: g.confidence,
    });
    if (scope === 'all') items.push(make(names[0] ?? null));
    else for (const n of names) items.push(make(n));
  }
  return items;
}

/**
 * Field level: confidence is the min over the field's word groups. A field is correct
 * only if every word is correct and none is cross-field or missing.
 * Expects field-scope items from buildItems.
 */
export function buildFieldItems(items: ConfidenceItem[]): FieldItem[] {
  const byField = new Map<string, ConfidenceItem[]>();
  for (const it of items) {
    if (it.field === null) continue;
    const key = `${it.faxId}\u0000${it.field}`;
    const list = byField.get(key) ?? [];
    list.push(it);
    byField.set(key, list);
  }
  const out: FieldItem[] = [];
  for (const list of byField.values()) {
    const first = list[0] as ConfidenceItem;
    const problems = list.filter((i) => !isCorrectStatus(i.status)).map((i) => i.status);
    const confs = list.map((i) => i.confidence).filter((c): c is number => c !== null);
    let status: FieldStatus = 'correct';
    if (problems.includes('cross-field')) status = 'cross-field';
    else if (problems.includes('missing')) status = 'missing';
    else if (problems.length > 0) status = 'misread';
    out.push({
      faxId: first.faxId,
      field: first.field as string,
      status,
      problems,
      confidence: confs.length === 0 ? null : Math.min(...confs),
    });
  }
  return out;
}

/**
 * For each threshold t, an item is flagged when confidence < t. A missing item
 * (confidence null) is always flagged. "Misreads" are all items that are not correct
 * (misread, merged/split misread, cross-field, missing).
 */
export function sweep(items: Scorable[], thresholds: number[]): SweepRow[] {
  const bad = items.filter((i) => !isCorrectStatus(i.status));
  const good = items.filter((i) => isCorrectStatus(i.status));
  const flagged = (i: Scorable, t: number): boolean => i.confidence === null || i.confidence < t;
  return thresholds.map((t) => ({
    threshold: t,
    misreadsFlagged: bad.filter((i) => flagged(i, t)).length,
    misreadsTotal: bad.length,
    correctWronglyFlagged: good.filter((i) => flagged(i, t)).length,
    correctTotal: good.length,
  }));
}

/** Do misread and correct confidences separate? Missing items have no confidence and are left out. */
export function separation(items: Scorable[]): Separation {
  const bad = items
    .filter((i) => !isCorrectStatus(i.status))
    .map((i) => i.confidence)
    .filter((c): c is number => c !== null);
  const good = items
    .filter((i) => isCorrectStatus(i.status))
    .map((i) => i.confidence)
    .filter((c): c is number => c !== null);
  const maxMisread = bad.length === 0 ? null : Math.max(...bad);
  const minCorrect = good.length === 0 ? null : Math.min(...good);
  const gap = maxMisread === null || minCorrect === null ? null : minCorrect - maxMisread;
  return {
    misreadCount: bad.length,
    correctCount: good.length,
    maxMisread,
    minCorrect,
    separates: gap === null ? null : gap > 0,
    gap,
    overlap: gap === null ? null : Math.max(0, -gap),
    correctAtOrBelowMaxMisread: maxMisread === null ? 0 : good.filter((c) => c <= maxMisread).length,
  };
}
