import type { OcrResult } from '../ocr/types.js';
import { readTypedValue } from './layout-typed.js';
import { findLabels } from './labels.js';
import { FIELD_ORDER } from './schema.js';
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

export type FieldReason = 'read' | 'label-not-found' | 'label-repeated' | 'label-merged' | 'no-value';

export interface FieldDetails {
  field: FieldName;
  /** OCR word IDs of the label (empty when not found or found more than once). */
  labelWordIds: string[];
  /** Label needed the spelling tolerance or a two-word join. */
  fuzzy: boolean;
  /** How many times the label was found. */
  matchCount: number;
  reason: FieldReason;
}

export interface ExtractionDetails {
  result: ExtractionResult;
  details: FieldDetails[];
}

function missing(name: FieldName, flag: string): Field {
  return { name, value: null, wordIds: [], confidence: 0, flags: [flag], reviewed: false };
}

/**
 * Rule-based reader. Finds each label, reads the value below it (typed form).
 * A value is exactly the cited words' texts joined by single spaces. Nothing is
 * repaired, and nothing is guessed: a field that cannot be read is null and flagged.
 * Confidence is reported (lowest cited word), never used to decide anything here.
 */
export function extractWithDetails(ocr: OcrResult): ExtractionDetails {
  const findings = findLabels(ocr.words);
  const byId = new Map(ocr.words.map((w) => [w.id, w]));
  const fields: Field[] = [];
  const details: FieldDetails[] = [];

  for (const name of FIELD_ORDER) {
    const plain = PLAIN_FIELD_NAMES[name];
    const finding = findings.find((f) => f.field === name);
    const count = finding?.count ?? 0;
    const label = finding?.matches[0];

    if (label === undefined || finding === undefined) {
      fields.push(missing(name, `The ${plain} label was not found on the page.`));
      details.push({ field: name, labelWordIds: [], fuzzy: false, matchCount: 0, reason: 'label-not-found' });
      continue;
    }
    if (count > 1) {
      fields.push(missing(name, `The ${plain} appears more than once on the page. Please check it.`));
      details.push({ field: name, labelWordIds: [], fuzzy: false, matchCount: count, reason: 'label-repeated' });
      continue;
    }

    const read = readTypedValue(ocr.words, label, findings, { width: ocr.width, height: ocr.height });
    const base = { field: name, labelWordIds: label.wordIds, fuzzy: label.fuzzy, matchCount: count };

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
