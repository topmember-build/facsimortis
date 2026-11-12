import { isValidNpi } from '../validators/npi.js';
import type { ExtractionResult, Field } from './schema.js';
import { parseExtractionResult } from './types.js';

/**
 * Central value checks that run after the citation check (0.8.1). Pure: no I/O.
 *
 * NPI rule (R4.1, R4.4): if the npi field has a value and isValidNpi says no, the
 * value is kept exactly as read (value, word IDs, confidence unchanged) and the
 * flag below is added once. A null NPI and every other field are left alone.
 * Nothing is repaired. Phone and DOB checks are not here; they belong to 1.1.
 *
 * Wording note: the message says "last digit" because that is the usual failure.
 * isValidNpi also fails on non-digit characters or the wrong length (a misread such
 * as "555~0151"). The exact wording is kept for now; 1.1 will refine validator messages.
 */
export const NPI_FLAG = 'The provider number looks wrong: the last digit does not match.';

export function checkNpi(result: ExtractionResult): { result: ExtractionResult; flagged: boolean } {
  let flagged = false;
  const fields = result.fields.map((field): Field => {
    if (field.name !== 'npi' || field.value === null) return field;
    if (isValidNpi(field.value)) return field;
    flagged = true;
    if (field.flags.includes(NPI_FLAG)) return field;
    return { ...field, flags: [...field.flags, NPI_FLAG] };
  });
  if (!flagged) return { result, flagged };
  return { result: parseExtractionResult({ ...result, fields }), flagged };
}
