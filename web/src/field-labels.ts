import type { FieldName } from '../../src/extract/schema.js';

/** Field names for a front-desk reader, as shown in the field list. */
export const FIELD_LABELS: Readonly<Record<FieldName, string>> = {
  patientName: 'Patient name',
  dob: 'Date of birth',
  referringProvider: 'Referring provider',
  npi: 'Provider number (NPI)',
  reason: 'Reason for referral',
  urgency: 'Urgency',
  callbackPhone: 'Callback phone',
};

export const NOT_FOUND_TEXT = 'Not found on the page';
