import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeNpiCheckDigit, isValidNpi } from '../src/validators/npi.js';

const nineDigits = fc.stringMatching(/^[0-9]{9}$/);
const validNpi = nineDigits.map((n) => n + String(computeNpiCheckDigit(n)));

describe('npi', () => {
  it('accepts the known example', () => {
    expect(isValidNpi('1234567893')).toBe(true);
  });

  it('accepts every generated valid NPI', () => {
    fc.assert(fc.property(validNpi, (n) => isValidNpi(n)));
  });

  it('rejects any single-digit change', () => {
    fc.assert(
      fc.property(validNpi, fc.integer({ min: 0, max: 9 }), fc.integer({ min: 1, max: 9 }), (n, pos, delta) => {
        const old = Number(n[pos]);
        const changed = n.slice(0, pos) + String((old + delta) % 10) + n.slice(pos + 1);
        return !isValidNpi(changed);
      }),
    );
  });

  it('rejects strings that are not exactly 10 digits', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !/^\d{10}$/.test(s)),
        (s) => !isValidNpi(s),
      ),
    );
  });
});
