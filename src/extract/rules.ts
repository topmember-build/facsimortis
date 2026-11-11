import type { OcrResult } from '../ocr/types.js';
import { readTableValue } from './layout-table.js';
import { readTypedValue } from './layout-typed.js';
import { findLabels } from './labels.js';
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
  | 'layout-unclear';

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
}

export interface ExtractionDetails {
  result: ExtractionResult;
  details: FieldDetails[];
}

function missing(name: FieldName, flag: string): Field {
  return { name, value: null, wordIds: [], confidence: 0, flags: [flag], reviewed: false };
}

/**
 * Rule-based reader. Finds each label, reads the value beside it (table form) or below it (typed form).
 * A value is exactly the cited words' texts joined by single spaces. Nothing is
 * repaired, and nothing is guessed: a field that cannot be read is null and flagged.
 * Confidence is reported (lowest cited word), never used to decide anything here.
 */
export function extractWithDetails(ocr: OcrResult): ExtractionDetails {
  const findings = findLabels(ocr.words);
  const byId = new Map(ocr.words.map((w) => [w.id, w]));
  const structure = buildStructure(ocr, findings);
  const pageLayout = structure.layout;
  const onLabelLines = new Set(structure.fields.flatMap((f) => f.rightWordIds));
  const fields: Field[] = [];
  const details: FieldDetails[] = [];

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
    if (own === undefined || pageLayout === 'unknown' || conflict) {
      fields.push(missing(name, `The ${plain} could not be read clearly from the page. Please check it.`));
      details.push({ ...known, conflict, layout: null, reason: 'layout-unclear' });
      continue;
    }

    const layout: 'table' | 'typed' = pageLayout;
    const read =
      layout === 'table'
        ? readTableValue(ocr.words, label, findings, { bottom: own.bottom.limit, valueLeft: own.valueLeft })
        : readTypedValue(ocr.words, label, findings, { width: ocr.width, height: ocr.height }, {
            right: own.right.limit,
            bottom: own.bottom.limit,
            onLabelLines,
          });
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
      fields.push({
        name,
        value: cited.map((w) => w.text).join(' '),
        wordIds: cited.map((w) => w.id),
        confidence: Math.min(...cited.map((w) => w.confidence)),
        flags: [],
        reviewed: false,
      });
      details.push({ ...base, reason: 'read' });
    }
  }

  return { result: parseExtractionResult({ engine: 'rules', fields }), details };
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
