import type { FieldName } from './schema.js';

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
