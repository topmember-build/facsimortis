import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isValidPhone } from '../src/validators/phone.js';

const digits = (n: number): fc.Arbitrary<string> => fc.stringMatching(new RegExp(`^\\d{${n}}$`));

const sevenDigit = fc.tuple(digits(3), digits(4)).map(([a, b]) => `${a}-${b}`);
const tenDigit = fc.tuple(digits(3), digits(3), digits(4)).map(([a, b, c]) => `${a}-${b}-${c}`);
const bracketed = fc.tuple(digits(3), digits(3), digits(4)).map(([a, b, c]) => `(${a}) ${b}-${c}`);
const anyValid = fc.oneof(sevenDigit, tenDigit, bracketed);

describe('isValidPhone', () => {
  it('accepts the fixture style and the usual US forms', () => {
    for (const ok of ['555-0147', '555-0193', '555-123-0147', '(555) 123-0147']) {
      expect(isValidPhone(ok)).toBe(true);
    }
  });

  it('rejects misreads and odd shapes', () => {
    for (const bad of ['555~0151', '', '5550147', '555 0147', '555-O147', '(555)123-0147', '555-123-01477', '+1 555-123-0147']) {
      expect(isValidPhone(bad)).toBe(false);
    }
  });

  it('property: every generated number in each accepted form passes', () => {
    fc.assert(fc.property(sevenDigit, (p) => isValidPhone(p)));
    fc.assert(fc.property(tenDigit, (p) => isValidPhone(p)));
    fc.assert(fc.property(bracketed, (p) => isValidPhone(p)));
  });

  it('property: replacing any digit with a non-digit fails', () => {
    const nonDigit = fc.constantFrom('~', 'O', 'l', 'x', ' ', '.', '-');
    fc.assert(
      fc.property(anyValid, fc.nat(), nonDigit, (phone, n, ch) => {
        const positions = [...phone].flatMap((c, i) => (/\d/.test(c) ? [i] : []));
        const at = positions[n % positions.length] as number;
        return !isValidPhone(phone.slice(0, at) + ch + phone.slice(at + 1));
      }),
    );
  });

  it('property: adding or removing a digit fails', () => {
    fc.assert(
      fc.property(anyValid, fc.nat(), fc.integer({ min: 0, max: 9 }), (phone, n, d) => {
        const positions = [...phone].flatMap((c, i) => (/\d/.test(c) ? [i] : []));
        const at = positions[n % positions.length] as number;
        const added = phone.slice(0, at) + String(d) + phone.slice(at);
        const removed = phone.slice(0, at) + phone.slice(at + 1);
        return !isValidPhone(added) && !isValidPhone(removed);
      }),
    );
  });
});
