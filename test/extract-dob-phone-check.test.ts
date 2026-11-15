import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DOB_FUTURE_FLAG,
  DOB_NOT_A_DATE_FLAG,
  DOB_TOO_OLD_FLAG,
  NPI_FLAG,
  PHONE_FLAG,
  checkDob,
  checkPhone,
} from '../src/extract/checks.js';
import { FIELD_ORDER, createExtractor, registerRuleExtractor, withChecks } from '../src/extract/index.js';
import type { ExtractionAdapter, ExtractionResult, Field } from '../src/extract/index.js';
import { RuleExtractor } from '../src/extract/rules.js';
import type { OcrResult } from '../src/ocr/types.js';

const TODAY = '2026-10-01';

function resultWith(over: Record<string, Partial<Field>>): ExtractionResult {
  return {
    engine: 'test',
    fields: FIELD_ORDER.map((name): Field => ({
      name,
      value: null,
      wordIds: [],
      confidence: 0,
      flags: ['missing'],
      reviewed: false,
      ...over[name],
    })),
  };
}
const get = (r: ExtractionResult, name: string): Field => r.fields.find((f) => f.name === name) as Field;

describe('flag texts', () => {
  it('are plain sentences', () => {
    expect(DOB_NOT_A_DATE_FLAG).toBe('The date of birth does not look like a real date. Please check it.');
    expect(DOB_FUTURE_FLAG).toBe('The date of birth is in the future. Please check it.');
    expect(DOB_TOO_OLD_FLAG).toBe('The date of birth is more than 120 years ago. Please check it.');
    expect(PHONE_FLAG).toBe('The callback phone number is not in a usual format. Please check it.');
  });
});

describe('checkDob', () => {
  const dob = (value: string | null, extra: Partial<Field> = {}): ExtractionResult =>
    resultWith({ dob: { value, wordIds: value === null ? [] : ['o1'], confidence: 0.7, flags: [], ...extra } });

  it('leaves a good date alone', () => {
    const input = dob('09/06/1938');
    const out = checkDob(input, TODAY);
    expect(out.flagged).toBe(false);
    expect(out.result).toEqual(input);
  });

  it.each([
    ['02/30/1980', DOB_NOT_A_DATE_FLAG],
    ['1980-03-15', DOB_NOT_A_DATE_FLAG],
    ['10/02/2026', DOB_FUTURE_FLAG],
    ['09/30/1906', DOB_TOO_OLD_FLAG],
  ])('flags %s and keeps the value, words and confidence', (value, flag) => {
    const out = checkDob(dob(value, { flags: ['earlier'] }), TODAY);
    expect(out.flagged).toBe(true);
    expect(get(out.result, 'dob')).toEqual({
      name: 'dob', value, wordIds: ['o1'], confidence: 0.7, flags: ['earlier', flag], reviewed: false,
    });
  });

  it('leaves a null date untouched and does not duplicate the flag', () => {
    const empty = dob(null);
    expect(checkDob(empty, TODAY).result).toEqual(empty);
    const once = checkDob(dob('10/02/2026'), TODAY).result;
    expect(get(checkDob(once, TODAY).result, 'dob').flags).toEqual([DOB_FUTURE_FLAG]);
  });

  it('only touches the dob field', () => {
    const input = dob('10/02/2026');
    const out = checkDob(input, TODAY).result;
    expect(out.fields.filter((f) => f.name !== 'dob')).toEqual(input.fields.filter((f) => f.name !== 'dob'));
  });
});

describe('checkPhone', () => {
  const phone = (value: string | null, extra: Partial<Field> = {}): ExtractionResult =>
    resultWith({ callbackPhone: { value, wordIds: value === null ? [] : ['o1'], confidence: 0.6, flags: [], ...extra } });

  it('leaves usual formats alone', () => {
    for (const ok of ['555-0147', '555-123-0147', '(555) 123-0147']) {
      const input = phone(ok);
      const out = checkPhone(input);
      expect(out.flagged).toBe(false);
      expect(out.result).toEqual(input);
    }
  });

  it('flags a misread and keeps value, words and confidence', () => {
    const out = checkPhone(phone('555~0151', { flags: ['earlier'] }));
    expect(out.flagged).toBe(true);
    expect(get(out.result, 'callbackPhone')).toEqual({
      name: 'callbackPhone', value: '555~0151', wordIds: ['o1'], confidence: 0.6, flags: ['earlier', PHONE_FLAG], reviewed: false,
    });
  });

  it('leaves a null phone untouched and does not duplicate the flag', () => {
    const empty = phone(null);
    expect(checkPhone(empty).result).toEqual(empty);
    const once = checkPhone(phone('5550147')).result;
    expect(get(checkPhone(once).result, 'callbackPhone').flags).toEqual([PHONE_FLAG]);
  });

  it('property: a value with a "~" in it is always flagged and never changed', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\d{3}~\d{4}$/), (value) => {
        const f = get(checkPhone(phone(value)).result, 'callbackPhone');
        return f.value === value && f.flags.length === 1 && f.flags[0] === PHONE_FLAG;
      }),
    );
  });
});

describe('withChecks wiring', () => {
  afterEach(() => registerRuleExtractor(() => new RuleExtractor()));

  const page: OcrResult = {
    words: [
      { id: 'o1', text: '1234567890', box: [0, 0, 10, 10], confidence: 0.9 },
      { id: 'o2', text: '10/02/2026', box: [0, 0, 10, 10], confidence: 0.9 },
      { id: 'o3', text: '555~0151', box: [0, 0, 10, 10], confidence: 0.9 },
    ],
    width: 100,
    height: 100,
    engine: 'test',
  };
  const answer = (): ExtractionResult =>
    resultWith({
      npi: { value: '1234567890', wordIds: ['o1'], confidence: 0.9, flags: [] },
      dob: { value: '10/02/2026', wordIds: ['o2'], confidence: 0.9, flags: [] },
      callbackPhone: { value: '555~0151', wordIds: ['o3'], confidence: 0.9, flags: [] },
    });
  const fake: ExtractionAdapter = { name: 'fake', extract: async () => answer() };

  it('runs the NPI, DOB and phone checks on any adapter', async () => {
    const out = await withChecks(fake, { today: TODAY }).extract(page);
    expect(get(out, 'npi').flags).toEqual([NPI_FLAG]);
    expect(get(out, 'dob').flags).toEqual([DOB_FUTURE_FLAG]);
    expect(get(out, 'callbackPhone').flags).toEqual([PHONE_FLAG]);
    expect(get(out, 'dob').value).toBe('10/02/2026');
  });

  it('uses the injected today, and the current date when none is given', async () => {
    const early = await withChecks(fake, { today: '2020-01-01' }).extract(page);
    expect(get(early, 'dob').flags).toEqual([DOB_FUTURE_FLAG]);
    const later = await withChecks(fake, { today: '2030-01-01' }).extract(page);
    expect(get(later, 'dob').flags).toEqual([]);
    const now = await withChecks(fake).extract(page);
    expect(get(now, 'dob').flags).toHaveLength(Number(new Date() < new Date('2026-10-02T00:00:00Z')));
  });

  it('createExtractor passes options to the rules reader and still works with env only', async () => {
    registerRuleExtractor(() => fake);
    const withDate = await createExtractor({}, { today: TODAY }).extract(page);
    expect(get(withDate, 'dob').flags).toEqual([DOB_FUTURE_FLAG]);
    const envOnly = await createExtractor({}).extract(page);
    expect(get(envOnly, 'callbackPhone').flags).toEqual([PHONE_FLAG]);
  });

  it('gives the rule reader the DOB check', async () => {
    const ocr = JSON.parse(readFileSync('fixtures/ocr/fax-0002.ocr.json', 'utf8')) as OcrResult;
    const out = await withChecks(new RuleExtractor(), { today: '1960-01-01' }).extract(ocr);
    expect(get(out, 'dob').value).toBe('01/02/1965');
    expect(get(out, 'dob').flags).toEqual([DOB_FUTURE_FLAG]);
  });

  it('createExtractor gives the recorded reader the DOB check (saved answer, no network)', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error('network blocked'))) as typeof fetch;
    try {
      const ocr = JSON.parse(readFileSync('fixtures/ocr/fax-0002.ocr.json', 'utf8')) as OcrResult;
      const normal = await createExtractor({ EXTRACT_PROVIDER: 'recorded' }, { today: TODAY }).extract(ocr);
      expect(get(normal, 'dob').value).toBe('01/02/1965');
      expect(get(normal, 'dob').flags).toEqual([]);
      // Same saved answer, but "today" is before the birth date: the date is in the future.
      const early = await createExtractor({ EXTRACT_PROVIDER: 'recorded' }, { today: '1960-01-01' }).extract(ocr);
      expect(get(early, 'dob').value).toBe('01/02/1965');
      expect(get(early, 'dob').flags).toEqual([DOB_FUTURE_FLAG]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
