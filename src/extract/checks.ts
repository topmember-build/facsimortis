import { dobProblem } from '../validators/dob.js';
import type { DobProblem } from '../validators/dob.js';
import { isValidNpi } from '../validators/npi.js';
import { isValidPhone } from '../validators/phone.js';
import type { ExtractionResult, Field } from './schema.js';
import { parseExtractionResult } from './types.js';

/**
 * Central value checks that run after the citation check (0.8.1). Pure: no I/O.
 *
 * NPI rule (R4.1, R4.4): if the npi field has a value and isValidNpi says no, the
 * value is kept exactly as read (value, word IDs, confidence unchanged) and the
 * flag below is added once. A null NPI and every other field are left alone.
 * Nothing is repaired.
 *
 * DOB and callback phone follow the same pattern (R4.2, R4.3, R4.4): a non-null
 * value that fails its validator keeps its value, word IDs and confidence, and gets
 * one plain flag. Null fields are left alone.
 *
 * Wording note: the message says "last digit" because that is the usual failure.
 * isValidNpi also fails on non-digit characters or the wrong length. The NPI wording
 * is kept exactly as is.
 */
export const NPI_FLAG = 'The provider number looks wrong: the last digit does not match.';

export const DOB_NOT_A_DATE_FLAG = 'The date of birth does not look like a real date. Please check it.';
export const DOB_FUTURE_FLAG = 'The date of birth is in the future. Please check it.';
export const DOB_TOO_OLD_FLAG = 'The date of birth is more than 120 years ago. Please check it.';
export const PHONE_FLAG = 'The callback phone number is not in a usual format. Please check it.';

const DOB_FLAGS: Readonly<Record<DobProblem, string>> = {
  'not-a-date': DOB_NOT_A_DATE_FLAG,
  future: DOB_FUTURE_FLAG,
  'too-old': DOB_TOO_OLD_FLAG,
};

type CheckOutcome = { result: ExtractionResult; flagged: boolean };

/** Adds the flag text returned by `reason` to the named field when it has a bad value. */
function flagField(
  result: ExtractionResult,
  name: string,
  reason: (value: string) => string | null,
): CheckOutcome {
  let flagged = false;
  const fields = result.fields.map((field): Field => {
    if (field.name !== name || field.value === null) return field;
    const flag = reason(field.value);
    if (flag === null) return field;
    flagged = true;
    if (field.flags.includes(flag)) return field;
    return { ...field, flags: [...field.flags, flag] };
  });
  if (!flagged) return { result, flagged };
  return { result: parseExtractionResult({ ...result, fields }), flagged };
}

export function checkNpi(result: ExtractionResult): CheckOutcome {
  return flagField(result, 'npi', (v) => (isValidNpi(v) ? null : NPI_FLAG));
}

export function checkDob(result: ExtractionResult, today: Date | string): CheckOutcome {
  return flagField(result, 'dob', (v) => {
    const problem = dobProblem(v, today);
    return problem === null ? null : DOB_FLAGS[problem];
  });
}

export function checkPhone(result: ExtractionResult): CheckOutcome {
  return flagField(result, 'callbackPhone', (v) => (isValidPhone(v) ? null : PHONE_FLAG));
}
