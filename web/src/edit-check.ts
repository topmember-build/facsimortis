import type { FieldName } from '../../src/extract/schema.js';
import { dobProblem, type DobProblem } from '../../src/validators/dob.js';
import {
  DOB_FUTURE_FLAG,
  DOB_NOT_A_DATE_FLAG,
  DOB_TOO_OLD_FLAG,
  NPI_FLAG,
  PHONE_FLAG,
} from '../../src/validators/messages.js';
import { isValidNpi } from '../../src/validators/npi.js';
import { isValidPhone } from '../../src/validators/phone.js';

const DOB_MESSAGES: Readonly<Record<DobProblem, string>> = {
  'not-a-date': DOB_NOT_A_DATE_FLAG,
  future: DOB_FUTURE_FLAG,
  'too-old': DOB_TOO_OLD_FLAG,
};

/**
 * Checks a value the reviewer typed with the same pure validators the central checks
 * use. Returns the plain flag message when the value is bad, or null when it is fine
 * or the field has no check. `referenceDate` (YYYY-MM-DD) is "today" for the date of
 * birth; it comes from the sample index, never from the browser clock.
 */
export function editFlag(name: FieldName, value: string, referenceDate: string): string | null {
  switch (name) {
    case 'npi':
      return isValidNpi(value) ? null : NPI_FLAG;
    case 'dob': {
      const problem = dobProblem(value, referenceDate);
      return problem === null ? null : DOB_MESSAGES[problem];
    }
    case 'callbackPhone':
      return isValidPhone(value) ? null : PHONE_FLAG;
    default:
      return null;
  }
}
