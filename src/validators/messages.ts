/**
 * Plain flag messages for the value validators. Pure constants: no imports, no I/O.
 * The central checks (src/extract/checks.ts) and the review screen both use these, so a
 * bad value gets the same words wherever it is found.
 *
 * Wording note: the NPI message says "last digit" because that is the usual failure.
 * isValidNpi also fails on non-digit characters or the wrong length. The NPI wording
 * is kept exactly as is.
 */
export const NPI_FLAG = 'The provider number looks wrong: the last digit does not match.';

export const DOB_NOT_A_DATE_FLAG = 'The date of birth does not look like a real date. Please check it.';
export const DOB_FUTURE_FLAG = 'The date of birth is in the future. Please check it.';
export const DOB_TOO_OLD_FLAG = 'The date of birth is more than 120 years ago. Please check it.';
export const PHONE_FLAG = 'The callback phone number is not in a usual format. Please check it.';
