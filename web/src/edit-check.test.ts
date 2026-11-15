import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DOB_FUTURE_FLAG,
  DOB_NOT_A_DATE_FLAG,
  DOB_TOO_OLD_FLAG,
  NPI_FLAG,
  PHONE_FLAG,
} from '../../src/validators/messages.js';
import { computeNpiCheckDigit } from '../../src/validators/npi.js';
import { editFlag } from './edit-check';
import { EMPTY_REVIEW, reviewReducer, standingFlags, unreviewedFlagged } from './review-state';
import type { Field } from '../../src/extract/schema.js';

const REF = '2026-10-01';

describe('editFlag', () => {
  it('flags a bad NPI with the central message and clears a good one', () => {
    expect(editFlag('npi', '1234567890', REF)).toBe(NPI_FLAG);
    expect(editFlag('npi', '1234567893', REF)).toBeNull();
  });

  it('maps each date problem to its own message, relative to the reference date', () => {
    expect(editFlag('dob', '10/02/2026', REF)).toBe(DOB_FUTURE_FLAG);
    expect(editFlag('dob', '10/01/2026', REF)).toBeNull();
    expect(editFlag('dob', '02/30/1980', REF)).toBe(DOB_NOT_A_DATE_FLAG);
    expect(editFlag('dob', '1980-01-02', REF)).toBe(DOB_NOT_A_DATE_FLAG);
    expect(editFlag('dob', '01/01/1890', REF)).toBe(DOB_TOO_OLD_FLAG);
    expect(editFlag('dob', '03/02/1985', REF)).toBeNull();
  });

  it('checks the phone format', () => {
    expect(editFlag('callbackPhone', '555~0152', REF)).toBe(PHONE_FLAG);
    expect(editFlag('callbackPhone', '555-0151', REF)).toBeNull();
  });

  it('does not check other fields', () => {
    for (const name of ['patientName', 'referringProvider', 'reason', 'urgency'] as const) {
      expect(editFlag(name, 'anything at all', REF)).toBeNull();
    }
  });

  it('accepts every NPI built with the check digit and rejects a wrong last digit', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\d{9}$/), fc.integer({ min: 1, max: 9 }), (first9, offset) => {
        const digit = computeNpiCheckDigit(first9);
        expect(editFlag('npi', `${first9}${digit}`, REF)).toBeNull();
        expect(editFlag('npi', `${first9}${(digit + offset) % 10}`, REF)).toBe(NPI_FLAG);
      }),
    );
  });
});

describe('standing flags after an edit', () => {
  const AT = '2025-01-02T03:04:05.000Z';
  const phone: Field = {
    name: 'callbackPhone',
    value: '555~0151',
    wordIds: ['w1'],
    confidence: 0.8,
    flags: [PHONE_FLAG],
    reviewed: false,
  };
  const name: Field = { name: 'patientName', value: 'A B', wordIds: ['w2'], confidence: 0.9, flags: [], reviewed: false };
  const edit = (field: Field, newValue: string, state = EMPTY_REVIEW) =>
    reviewReducer(state, { type: 'edit', field: field.name, originalValue: field.value, newValue, at: AT });

  it('keeps the flag for a bad edit and clears it for a good one', () => {
    expect(standingFlags(phone, EMPTY_REVIEW, REF)).toEqual([PHONE_FLAG]);
    expect(standingFlags(phone, edit(phone, '555~0152'), REF)).toEqual([PHONE_FLAG]);
    expect(standingFlags(phone, edit(phone, '555-0151'), REF)).toEqual([]);
  });

  it('stops flagging a bad edit once the reviewer accepts it, and the edit is kept', () => {
    const bad = edit(phone, '555~0152');
    const accepted = reviewReducer(bad, { type: 'accept', field: 'callbackPhone', originalValue: '555~0151', at: AT });
    expect(standingFlags(phone, accepted, REF)).toEqual([]);
    expect(accepted.actions.map((a) => a.action)).toEqual(['edited', 'accepted']);
    // Editing again after accepting asks for a new decision.
    expect(standingFlags(phone, edit(phone, '555~0153', accepted), REF)).toEqual([PHONE_FLAG]);
  });

  it('flags an unflagged field only when its edit is bad, and never flags a field without a check', () => {
    expect(unreviewedFlagged([phone, name], edit(name, 'C D'), REF).map((f) => f.name)).toEqual(['callbackPhone']);
    expect(unreviewedFlagged([name], edit(name, 'C D'), REF)).toEqual([]);
    const dob: Field = { ...name, name: 'dob', value: '03/02/1985' };
    expect(standingFlags(dob, EMPTY_REVIEW, REF)).toEqual([]);
    expect(standingFlags(dob, edit(dob, '10/02/2026'), REF)).toEqual([DOB_FUTURE_FLAG]);
  });
});
