import type { OcrResult, OcrWord } from '../ocr/types.js';
import { allLabelWordIds, readTableValue } from './layout-table.js';
import { detectTypedOverflow, readTypedValue, typedValueColumn } from './layout-typed.js';
import { findLabels, medianWordHeight } from './labels.js';
import { resolveUncited } from './uncited.js';
import type { ValueColumn } from './uncited.js';
import { FIELD_ORDER } from './schema.js';
import { buildStructure } from './structure.js';
import type { PageLayout } from './structure.js';
import type { ExtractionResult, Field, FieldName } from './schema.js';
import { parseExtractionResult } from './types.js';
import type { ExtractionAdapter } from './types.js';

/** Plain names used in messages for a front-desk reader. */
export const PLAIN_FIELD_NAMES: Readonly<Record<FieldName, string>> = {
  patientName: 'patient name',
  dob: 'date of birth',
  referringProvider: 'referring provider',
  npi: 'provider number (NPI)',
  reason: 'reason for referral',
  urgency: 'urgency',
  callbackPhone: 'callback phone',
};

export type FieldReason =
  | 'read'
  | 'label-not-found'
  | 'label-repeated'
  | 'label-merged'
  | 'no-value'
  | 'layout-unclear'
  | 'overflow';

export interface FieldDetails {
  field: FieldName;
  /** OCR word IDs of the label (empty when not found or found more than once). */
  labelWordIds: string[];
  /** Label needed the spelling tolerance or a two-word join. */
  fuzzy: boolean;
  /** How many times the label was found. */
  matchCount: number;
  reason: FieldReason;
  /** Layout of the reader actually used (null when the field was not read). */
  layout: 'table' | 'typed' | null;
  /** Layout decided for the whole page. */
  pageLayout: PageLayout;
  /** The field's own evidence disagreed with the page layout, so it was not read. */
  conflict: boolean;
  /** This field's value ran past its right limit into the next box (so it was not read). */
  overflow: boolean;
  /** The field whose value ran into this one, or null. */
  overflowFrom: FieldName | null;
  /** OCR words inside the value region that nobody cited and that were NOT added (the field is flagged). */
  uncitedWordIds: string[];
  /** OCR words inside the value region that nobody cited and that WERE added to the value. */
  includedWordIds: string[];
}

type BaseDetails = Omit<FieldDetails, 'overflow' | 'overflowFrom' | 'uncitedWordIds' | 'includedWordIds'>;

export interface ExtractionDetails {
  result: ExtractionResult;
  details: FieldDetails[];
}

function citedField(name: FieldName, cited: readonly OcrWord[], flags: string[]): Field {
  return {
    name,
    value: cited.map((w) => w.text).join(' '),
    wordIds: cited.map((w) => w.id),
    confidence: Math.min(...cited.map((w) => w.confidence)),
    flags,
    reviewed: false,
  };
}

function missing(name: FieldName, flag: string): Field {
  return { name, value: null, wordIds: [], confidence: 0, flags: [flag], reviewed: false };
}

/**
 * Rule-based reader. Finds each label, reads the value beside it (table form) or below it (typed form).
 * A value is exactly the cited words' texts joined by single spaces. Nothing is
 * repaired, and nothing is guessed: a field that cannot be read is null and flagged.
 * Confidence is reported (lowest cited word), never used to decide anything here.
 *
 * No silent drops (0.5.10, rule in uncited.ts): after every field is read, an OCR word
 * that sits inside a field's value region but is cited by no field is either added to
 * that field (when it chains on the same text line with normal word spacing) or the
 * field is flagged "Some words near the <field> were not read. Please check it."
 * Words are added all together or not at all, and their text is never changed.
 */
export function extractWithDetails(ocr: OcrResult): ExtractionDetails {
  const findings = findLabels(ocr.words);
  const byId = new Map(ocr.words.map((w) => [w.id, w]));
  const structure = buildStructure(ocr, findings);
  const pageLayout = structure.layout;
  const h = medianWordHeight(ocr.words);
  const onLabelLines = new Set(structure.fields.flatMap((f) => f.rightWordIds));
  const fields: Field[] = [];
  const details: BaseDetails[] = [];
  // Overflow runs found on this page, by the field whose value ran on (see below).
  const overflowRuns = new Map<FieldName, string[]>();
  // Fields that were read, with the words they cited and their value column.
  const reads: { index: number; cited: OcrWord[]; column: ValueColumn }[] = [];

  for (const name of FIELD_ORDER) {
    const plain = PLAIN_FIELD_NAMES[name];
    const finding = findings.find((f) => f.field === name);
    const count = finding?.count ?? 0;
    const label = finding?.matches[0];

    if (label === undefined || finding === undefined) {
      fields.push(missing(name, `The ${plain} label was not found on the page.`));
      details.push({ field: name, labelWordIds: [], fuzzy: false, matchCount: 0, reason: 'label-not-found', layout: null, pageLayout, conflict: false });
      continue;
    }
    if (count > 1) {
      fields.push(missing(name, `The ${plain} appears more than once on the page. Please check it.`));
      details.push({ field: name, labelWordIds: [], fuzzy: false, matchCount: count, reason: 'label-repeated', layout: null, pageLayout, conflict: false });
      continue;
    }

    const known = { field: name, labelWordIds: label.wordIds, fuzzy: label.fuzzy, matchCount: count, pageLayout };

    if (label.merged) {
      fields.push(missing(name, `The ${plain} runs into its label on the page. Please check it.`));
      details.push({ ...known, conflict: false, layout: null, reason: 'label-merged' });
      continue;
    }

    // One layout for the whole page (see structure.ts). The per-field choice is gone.
    // A field is NOT read, and gets a plain flag instead of a guess, when:
    // - the page layout is 'unknown' (no clear majority among the usable labels), or
    // - the field's own evidence conflicts with the page layout:
    //   * page is 'typed' and the field has words to the right of its label on the
    //     label's line (hasRightWords), even if it also has words below. This catches
    //     a long value that runs up to the label's line on a skewed page, and a stray
    //     word (speckle, stamp fragment) on the label's line.
    //   * page is 'table' and the field has words below its label in the label column
    //     (hasBelowWords). Brief said "and no right words"; that is widened here
    //     because a stray word in the label column otherwise cuts a wrapped value
    //     short without any flag. A table value wraps in the value column, which is
    //     not counted as "below".
    const own = structure.fields.find((f) => f.field === name);
    const conflict =
      own !== undefined &&
      ((pageLayout === 'typed' && own.hasRightWords) ||
        (pageLayout === 'table' && own.hasBelowWords));
    const page = { width: ocr.width, height: ocr.height };
    if (own === undefined || pageLayout === 'unknown' || conflict) {
      // A long typed value can both reach its label's line (a conflict) and run past
      // its right limit. The field stays null with the unclear flag, but its run is
      // still recorded so a neighbour that read the spilled words is flagged too.
      // The long line is what put words on this label's line, so only OTHER labels'
      // line words are left out here; this field's own are part of its run.
      if (own !== undefined && pageLayout === 'typed') {
        const ownRight = new Set(own.rightWordIds);
        const othersOnLabelLines = new Set([...onLabelLines].filter((id) => !ownRight.has(id)));
        const limits = { right: own.right.limit, bottom: own.bottom.limit, onLabelLines: othersOnLabelLines };
        const over = detectTypedOverflow(ocr.words, label, findings, page, limits);
        if (over.overflow) overflowRuns.set(name, over.runIds);
      }
      fields.push(missing(name, `The ${plain} could not be read clearly from the page. Please check it.`));
      details.push({ ...known, conflict, layout: null, reason: 'layout-unclear' });
      continue;
    }

    const layout: 'table' | 'typed' = pageLayout;
    const typedLimits = { right: own.right.limit, bottom: own.bottom.limit, onLabelLines };

    // Overflow (typed pages only). Before the right cut, look at the same rows with no
    // right limit (detectTypedOverflow in layout-typed.ts). If the value runs on past
    // its right limit with normal word spacing, it is not cut short and kept: the
    // field is null with a plain flag, and the run's word IDs are remembered so any
    // other field that cited one of them is flagged after the loop. Values are never
    // changed and no words are removed from any field.
    if (layout === 'typed') {
      const over = detectTypedOverflow(ocr.words, label, findings, page, typedLimits);
      if (over.overflow) {
        overflowRuns.set(name, over.runIds);
        fields.push(missing(name, `The ${plain} runs into the next box on the page. Please check it.`));
        details.push({ ...known, conflict: false, layout, reason: 'overflow' });
        continue;
      }
    }
    const read =
      layout === 'table'
        ? readTableValue(ocr.words, label, findings, { bottom: own.bottom.limit, valueLeft: own.valueLeft })
        : readTypedValue(ocr.words, label, findings, page, typedLimits);
    const base = { ...known, conflict: false, layout };

    if (read.kind === 'merged') {
      fields.push(missing(name, `The ${plain} runs into its label on the page. Please check it.`));
      details.push({ ...base, reason: 'label-merged' });
    } else if (read.kind === 'empty') {
      fields.push(missing(name, `The ${plain} label was found, but no value was next to it.`));
      details.push({ ...base, reason: 'no-value' });
    } else {
      const cited = read.wordIds.flatMap((id) => {
        const word = byId.get(id);
        return word === undefined ? [] : [word];
      });
      fields.push(citedField(name, cited, []));
      details.push({ ...base, reason: 'read' });
      const bottom = own.bottom.limit;
      const xMax = own.right.limit < page.width ? own.right.limit - 0.25 * h : page.width;
      const column =
        layout === 'typed'
          ? { ...typedValueColumn(ocr.words, label, findings, page, typedLimits), bottom }
          : {
              xMin: (own.valueLeft ?? Math.min(...cited.map((w) => w.box[0]))) - h,
              xMax,
              bottom,
            };
      reads.push({ index: fields.length - 1, cited, column });
    }
  }

  // No silent drops (see uncited.ts). Each read field is checked for OCR words inside
  // its value region that nobody cited. All of them chain on the same text line: they
  // are included. Otherwise the value stays as read and the field gets a plain flag.
  const claimed = new Set<string>([...allLabelWordIds(findings), ...reads.flatMap((r) => r.cited.map((w) => w.id))]);
  const uncitedByField = new Map<FieldName, { uncited: string[]; included: string[] }>();
  for (const read of reads) {
    const result = resolveUncited(ocr.words, read.cited, read.column, claimed, h);
    const field = fields[read.index];
    if (field === undefined) continue;
    uncitedByField.set(field.name, { uncited: result.uncitedIds, included: result.includedIds });
    if (result.includedIds.length > 0) {
      const all = result.wordIds.flatMap((id) => {
        const word = byId.get(id);
        return word === undefined ? [] : [word];
      });
      fields[read.index] = citedField(field.name, all, field.flags);
      for (const id of result.includedIds) claimed.add(id);
    } else if (result.uncitedIds.length > 0) {
      const plain = PLAIN_FIELD_NAMES[field.name];
      fields[read.index] = { ...field, flags: [...field.flags, `Some words near the ${plain} were not read. Please check it.`] };
    }
  }

  // Any OTHER field whose value cites a word from an overflow run is flagged. Its value
  // stays exactly as read; only a flag is added.
  const overflowFrom = new Map<FieldName, FieldName>();
  const flagged = fields.map((f) => {
    if (f.value === null) return f;
    for (const [source, runIds] of overflowRuns) {
      if (source === f.name) continue;
      if (f.wordIds.some((id) => runIds.includes(id))) {
        overflowFrom.set(f.name, source);
        const plain = PLAIN_FIELD_NAMES[f.name];
        return { ...f, flags: [...f.flags, `Words from a nearby box may have run into the ${plain}. Please check it.`] };
      }
    }
    return f;
  });
  const allDetails: FieldDetails[] = details.map((d) => ({
    ...d,
    overflow: overflowRuns.has(d.field),
    overflowFrom: overflowFrom.get(d.field) ?? null,
    uncitedWordIds: uncitedByField.get(d.field)?.uncited ?? [],
    includedWordIds: uncitedByField.get(d.field)?.included ?? [],
  }));

  return { result: parseExtractionResult({ engine: 'rules', fields: flagged }), details: allDetails };
}

export class RuleExtractor implements ExtractionAdapter {
  readonly name = 'rules';

  extract(ocr: OcrResult): Promise<ExtractionResult> {
    try {
      return Promise.resolve(extractWithDetails(ocr).result);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
