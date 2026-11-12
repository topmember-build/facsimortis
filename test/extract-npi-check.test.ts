import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { NPI_FLAG, checkNpi } from '../src/extract/checks.js';
import { createExtractor } from '../src/extract/default.js';
import { FIELD_ORDER, registerRuleExtractor } from '../src/extract/index.js';
import type { ExtractionAdapter, ExtractionResult, Field } from '../src/extract/index.js';
import { RuleExtractor } from '../src/extract/rules.js';
import type { OcrResult } from '../src/ocr/types.js';
import { computeNpiCheckDigit, isValidNpi } from '../src/validators/npi.js';

const FLAG = 'The provider number looks wrong: the last digit does not match.';

function withDigit(first9: string): string {
  return first9 + String(computeNpiCheckDigit(first9));
}

function resultWith(npi: Partial<Field> | null): ExtractionResult {
  return {
    engine: 'test',
    fields: FIELD_ORDER.map((name): Field => {
      if (name === 'npi' && npi !== null) {
        return { name, value: '1234567893', wordIds: ['o1'], confidence: 0.8, flags: [], reviewed: false, ...npi };
      }
      if (name === 'patientName') {
        return { name, value: 'Pippa Ellery', wordIds: ['o2', 'o3'], confidence: 0.9, flags: ['kept'], reviewed: false };
      }
      return { name, value: null, wordIds: [], confidence: 0, flags: ['missing'], reviewed: false };
    }),
  };
}
const npiOf = (r: ExtractionResult): Field => r.fields.find((f) => f.name === 'npi') as Field;

describe('checkNpi', () => {
  it('uses the exact flag text', () => {
    expect(NPI_FLAG).toBe(FLAG);
  });

  it('passes a valid NPI with no new flag', () => {
    const input = resultWith({ value: withDigit('123456789') });
    const out = checkNpi(input);
    expect(out.flagged).toBe(false);
    expect(out.result).toEqual(input);
  });

  it('flags a wrong check digit and keeps value, words and confidence', () => {
    const good = withDigit('123456789');
    const bad = good.slice(0, 9) + String((Number(good[9]) + 1) % 10);
    const input = resultWith({ value: bad, wordIds: ['o1'], confidence: 0.77, flags: ['earlier'] });
    const out = checkNpi(input);
    expect(out.flagged).toBe(true);
    expect(npiOf(out.result)).toEqual({
      name: 'npi', value: bad, wordIds: ['o1'], confidence: 0.77, flags: ['earlier', FLAG], reviewed: false,
    });
    expect(out.result.fields.filter((f) => f.name !== 'npi')).toEqual(input.fields.filter((f) => f.name !== 'npi'));
  });

  it.each(['555~0151', '12345', 'ABCDEFGHIJ', '12345678901'])('flags the non-valid value %s', (value) => {
    const out = checkNpi(resultWith({ value }));
    expect(npiOf(out.result).value).toBe(value);
    expect(npiOf(out.result).flags).toEqual([FLAG]);
  });

  it('leaves a null NPI unchanged', () => {
    const input = resultWith(null);
    const out = checkNpi(input);
    expect(out.flagged).toBe(false);
    expect(out.result).toEqual(input);
  });

  it('does not add the flag twice', () => {
    const once = checkNpi(resultWith({ value: '1234567890' }));
    const twice = checkNpi(once.result);
    expect(npiOf(twice.result).flags).toEqual([FLAG]);
  });

  it('property: valid NPIs are never flagged', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\d{9}$/), (first9) => {
        const out = checkNpi(resultWith({ value: withDigit(first9) }));
        expect(out.flagged).toBe(false);
        expect(npiOf(out.result).flags).toEqual([]);
      }),
    );
  });

  it('property: any single-digit change to a valid NPI is flagged', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\d{9}$/), fc.nat(9), fc.integer({ min: 1, max: 9 }), (first9, pos, delta) => {
        const good = withDigit(first9);
        const changed = good.slice(0, pos) + String((Number(good[pos]) + delta) % 10) + good.slice(pos + 1);
        expect(isValidNpi(changed)).toBe(false);
        const out = checkNpi(resultWith({ value: changed }));
        expect(npiOf(out.result).flags).toEqual([FLAG]);
        expect(npiOf(out.result).value).toBe(changed);
      }),
    );
  });
});

describe('createExtractor applies the NPI check centrally', () => {
  afterEach(() => registerRuleExtractor(() => new RuleExtractor()));
  const page: OcrResult = {
    words: [
      { id: 'o1', text: '1234567890', box: [0, 0, 10, 10], confidence: 0.9 },
      { id: 'o2', text: 'Pippa', box: [0, 0, 10, 10], confidence: 0.9 },
      { id: 'o3', text: 'Ellery', box: [0, 0, 10, 10], confidence: 0.9 },
    ],
    width: 100,
    height: 100,
    engine: 'test',
  };

  it('flags an invalid NPI from a fake adapter', async () => {
    const fake: ExtractionAdapter = { name: 'fake', extract: async () => resultWith({ value: '1234567890' }) };
    registerRuleExtractor(() => fake);
    const out = await createExtractor({}).extract(page);
    expect(npiOf(out).value).toBe('1234567890');
    expect(npiOf(out).flags).toEqual([FLAG]);
  });

  it('leaves a citation-rejected NPI null without the NPI flag', async () => {
    const fake: ExtractionAdapter = { name: 'fake', extract: async () => resultWith({ value: '1234567891' }) };
    registerRuleExtractor(() => fake);
    const out = await createExtractor({}).extract(page);
    expect(npiOf(out).value).toBeNull();
    expect(npiOf(out).flags).not.toContain(FLAG);
    expect(npiOf(out).flags).toHaveLength(1);
  });
});

describe('fixtures (truth words) through createExtractor', () => {
  interface Truth { words: Array<{ id: string; text: string; box: OcrResult['words'][number]['box'] }> }
  const fromTruth = (p: string): OcrResult => {
    const t = JSON.parse(readFileSync(p, 'utf8')) as Truth;
    return { words: t.words.map((w) => ({ ...w, confidence: 1 })), width: 1728, height: 2200, engine: 'truth' };
  };

  it('flags fax-0003 NPI 6720988041 with exactly the message', async () => {
    const out = await createExtractor({}).extract(fromTruth('fixtures/faxes/L2/fax-0003.truth.json'));
    expect(npiOf(out).value).toBe('6720988041');
    expect(npiOf(out).flags).toEqual([FLAG]);
  });

  it.each([
    'fixtures/faxes/L1/fax-0001.truth.json',
    'fixtures/faxes/L2/fax-0002.truth.json',
  ])('does not flag the NPI of %s and changes nothing else', async (path) => {
    const ocr = fromTruth(path);
    const raw = await new RuleExtractor().extract(ocr);
    const out = await createExtractor({}).extract(ocr);
    expect(npiOf(out).flags).not.toContain(FLAG);
    expect(out).toEqual(raw);
  });
});
