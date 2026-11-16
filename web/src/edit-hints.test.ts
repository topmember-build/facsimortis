import { describe, expect, it } from 'vitest';
import { dobProblem } from '../../src/validators/dob.js';
import { isValidNpi } from '../../src/validators/npi.js';
import { isValidPhone } from '../../src/validators/phone.js';
import { FORMAT_HINTS, editLabel } from './edit-hints';

const REFERENCE_DATE = '2026-10-01';

describe('format hints', () => {
  it('only covers npi, dob, callbackPhone and urgency', () => {
    expect(Object.keys(FORMAT_HINTS).sort()).toEqual(['callbackPhone', 'dob', 'npi', 'urgency']);
  });

  it('writes every example into the hint text', () => {
    for (const hint of Object.values(FORMAT_HINTS)) {
      for (const example of hint!.examples) expect(hint!.text).toContain(example);
    }
  });

  it('gives examples that pass the matching validator', () => {
    for (const example of FORMAT_HINTS.npi!.examples) expect(isValidNpi(example)).toBe(true);
    for (const example of FORMAT_HINTS.dob!.examples) expect(dobProblem(example, REFERENCE_DATE)).toBeNull();
    expect(FORMAT_HINTS.callbackPhone!.examples).toHaveLength(3);
    for (const example of FORMAT_HINTS.callbackPhone!.examples) expect(isValidPhone(example)).toBe(true);
  });

  it('builds the label from the plain field name', () => {
    expect(editLabel('Callback phone')).toBe('New value for Callback phone');
  });
});
