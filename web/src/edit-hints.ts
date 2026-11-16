import type { FieldName } from '../../src/extract/schema.js';

export interface FormatHint {
  /** The sentence shown under the edit box. */
  text: string;
  /** Every example written in `text`. Each must pass the matching validator (see the test). */
  examples: readonly string[];
}

/**
 * Format hints for the edit box, only for fields with a known format. The phone examples are
 * exactly the three shapes isValidPhone accepts. Urgency is a hint only: it is not checked.
 * Fields not listed here (names, reason) get no hint.
 */
export const FORMAT_HINTS: Readonly<Partial<Record<FieldName, FormatHint>>> = {
  npi: { text: '10 digits, for example 1234567893', examples: ['1234567893'] },
  dob: { text: 'MM/DD/YYYY, for example 03/15/1980', examples: ['03/15/1980'] },
  callbackPhone: {
    text: 'For example 555-0147, 555-014-7000 or (555) 014-7000',
    examples: ['555-0147', '555-014-7000', '(555) 014-7000'],
  },
  urgency: { text: 'routine, urgent or emergent', examples: [] },
};

/** The label above the edit box, using the plain field name. */
export function editLabel(fieldLabel: string): string {
  return `New value for ${fieldLabel}`;
}
