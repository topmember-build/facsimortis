/**
 * Pure callback phone check. Accepted shapes, written exactly like this:
 *   NNN-NNNN, NNN-NNN-NNNN, (NNN) NNN-NNNN
 * Anything else fails. Nothing is normalised or repaired.
 */
const PHONE_FORMS: readonly RegExp[] = [
  /^\d{3}-\d{4}$/,
  /^\d{3}-\d{3}-\d{4}$/,
  /^\(\d{3}\) \d{3}-\d{4}$/,
];

export function isValidPhone(text: string): boolean {
  return PHONE_FORMS.some((form) => form.test(text));
}
