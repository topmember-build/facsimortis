import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { isValidDob } from '../src/validators/dob.js';

const TODAY = '2026-10-01';

describe('dob', () => {
  it('accepts ordinary dates and rejects bad ones', () => {
    expect(isValidDob('03/15/1980', TODAY)).toBe(true);
    expect(isValidDob('02/29/2000', TODAY)).toBe(true);
    expect(isValidDob('02/29/2001', TODAY)).toBe(false);
    expect(isValidDob('10/01/2026', TODAY)).toBe(true);
    expect(isValidDob('10/02/2026', TODAY)).toBe(false);
    expect(isValidDob('10/01/1906', TODAY)).toBe(true);
    expect(isValidDob('09/30/1906', TODAY)).toBe(false);
    expect(isValidDob('1980-03-15', TODAY)).toBe(false);
  });

  it('accepts a Date for today', () => {
    expect(isValidDob('03/15/1980', new Date(Date.UTC(2026, 9, 1)))).toBe(true);
  });

  it('rejects dates after today', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2027, max: 2200 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 28 }),
        (y, m, d) => !isValidDob(`${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${y}`, TODAY),
      ),
    );
  });

  it('rejects impossible calendar dates', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1950, max: 2020 }),
        fc.constantFrom('02/30', '02/31', '04/31', '06/31', '09/31', '11/31', '13/01', '00/10', '01/00', '01/32'),
        (y, md) => !isValidDob(`${md}/${y}`, TODAY),
      ),
    );
  });
});
