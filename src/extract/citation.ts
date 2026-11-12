import type { OcrResult } from '../ocr/types.js';
import { PLAIN_FIELD_NAMES } from './names.js';
import type { ExtractionResult, Field, FieldName } from './schema.js';
import { parseExtractionResult } from './types.js';

/**
 * Citation check (tech.md rule 3, R3.2). Pure: no I/O.
 *
 * Every non-null field must be backed by the page:
 *  (a) every cited word ID must exist in the OCR words, otherwise 'unknown-word';
 *  (b) the cited words' texts, in the order cited and joined with single spaces,
 *      must equal the value exactly, otherwise 'text-mismatch'.
 *
 * Exact equality is the "contain" test. Values are never repaired, so a value that
 * is a substring of the cited text, a corrected spelling, re-ordered words, or has
 * extra or missing whitespace is rejected. There is no normalisation of case,
 * punctuation or whitespace beyond the single-space join.
 *
 * The check compares the value with the cited OCR text only. It never looks at truth.
 * Null fields pass through unchanged. A rejected field becomes null with no words,
 * confidence 0 and a plain flag, so someone looks at it. It never throws for a mismatch.
 */
export type CitationRejection = {
  field: FieldName;
  reason: 'unknown-word' | 'text-mismatch';
  detail: string;
};

export function citationFlag(name: FieldName): string {
  return `The ${PLAIN_FIELD_NAMES[name]} did not match the words on the page, so it was left empty. Please check it.`;
}

function judge(field: Field, words: Map<string, string>): CitationRejection | undefined {
  const missing = field.wordIds.filter((id) => !words.has(id));
  if (missing.length > 0) {
    return { field: field.name, reason: 'unknown-word', detail: `Unknown word IDs: ${missing.join(', ')}` };
  }
  const cited = field.wordIds.map((id) => words.get(id) as string).join(' ');
  if (cited !== field.value) {
    return {
      field: field.name,
      reason: 'text-mismatch',
      detail: `Value ${JSON.stringify(field.value)} does not equal cited text ${JSON.stringify(cited)}`,
    };
  }
  return undefined;
}

export function checkCitations(
  result: ExtractionResult,
  ocr: OcrResult,
): { result: ExtractionResult; rejected: CitationRejection[] } {
  const words = new Map(ocr.words.map((w) => [w.id, w.text]));
  const rejected: CitationRejection[] = [];
  const fields = result.fields.map((field): Field => {
    if (field.value === null) return field;
    const problem = judge(field, words);
    if (problem === undefined) return field;
    rejected.push(problem);
    return {
      ...field,
      value: null,
      wordIds: [],
      confidence: 0,
      reviewed: false,
      flags: [...field.flags, citationFlag(field.name)],
    };
  });
  if (rejected.length === 0) return { result, rejected };
  return { result: parseExtractionResult({ ...result, fields }), rejected };
}
