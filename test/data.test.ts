import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { REFERENCE_DATE, generateReferral } from '../src/generator/data.js';
import { createRng } from '../src/generator/prng.js';
import { isValidDob } from '../src/validators/dob.js';
import { isValidNpi } from '../src/validators/npi.js';

const gen = (seed: number, trap: 'bad-npi' | null = null) =>
  generateReferral(createRng(seed), { trap, referenceDate: REFERENCE_DATE });

describe('prng', () => {
  it('is deterministic and in range', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const a = createRng(seed);
        const b = createRng(seed);
        for (let i = 0; i < 20; i++) {
          const x = a.next();
          if (x !== b.next() || x < 0 || x >= 1) return false;
        }
        return true;
      }),
    );
  });
});

describe('generateReferral', () => {
  it('produces a valid NPI without a trap', () => {
    fc.assert(fc.property(fc.integer(), (seed) => isValidNpi(gen(seed).npi)));
  });

  it('produces an invalid NPI with the bad-npi trap', () => {
    fc.assert(fc.property(fc.integer(), (seed) => /^\d{10}$/.test(gen(seed, 'bad-npi').npi) && !isValidNpi(gen(seed, 'bad-npi').npi)));
  });

  it('produces a valid DOB within the last 100 years', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const { dob } = gen(seed);
        const year = Number(dob.slice(6));
        return isValidDob(dob, REFERENCE_DATE) && year >= 2026 - 100 && year <= 2026 - 18;
      }),
    );
  });

  it('is deterministic and well formed', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const a = gen(seed);
        expect(a).toEqual(gen(seed));
        expect(a.callbackPhone).toMatch(/^555-01\d{2}$/);
        expect(['routine', 'urgent', 'emergent']).toContain(a.urgency);
        for (const v of Object.values(a)) expect(v).toMatch(/^[\x20-\x7e]+$/);
      }),
    );
  });
});
