import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ExtractionError,
  ExtractionResultSchema,
  FIELD_ORDER,
  createExtractor,
  parseExtractionResult,
  registerRuleExtractor,
} from '../src/extract/index.js';
import type { ExtractionAdapter, ExtractionResult, Field } from '../src/extract/index.js';

function field(name: Field['name'], over: Partial<Field> = {}): Field {
  return {
    name,
    value: 'x',
    wordIds: ['o0001'],
    confidence: 0.9,
    flags: [],
    reviewed: false,
    ...over,
  };
}

function valid(): ExtractionResult {
  return { engine: 'test', fields: FIELD_ORDER.map((n) => field(n)) };
}

function withField(index: number, over: Partial<Field>): ExtractionResult {
  const r = valid();
  r.fields[index] = { ...r.fields[index]!, ...over };
  return r;
}

describe('ExtractionResultSchema', () => {
  it('parses a valid seven-field result', () => {
    const r = ExtractionResultSchema.parse(valid());
    expect(r.fields).toHaveLength(7);
    expect(r.fields.map((f) => f.name)).toEqual([...FIELD_ORDER]);
    expect(typeof r.fields[0]!.confidence).toBe('number');
  });

  it('accepts a null value that is flagged and has no words', () => {
    const r = withField(1, { value: null, wordIds: [], flags: ['The date of birth is missing.'] });
    expect(ExtractionResultSchema.safeParse(r).success).toBe(true);
  });

  const bad: Array<[string, () => unknown]> = [
    ['wrong field order', () => ({ engine: 'e', fields: [...valid().fields].reverse() })],
    ['missing field', () => ({ engine: 'e', fields: valid().fields.slice(1) })],
    [
      'duplicate field',
      () => {
        const f = valid().fields;
        f[6] = field('patientName');
        return { engine: 'e', fields: f };
      },
    ],
    ['eight fields', () => ({ engine: 'e', fields: [...valid().fields, field('dob')] })],
    ['confidence below 0', () => withField(0, { confidence: -0.01 })],
    ['confidence above 1', () => withField(0, { confidence: 1.01 })],
    ['unknown key on field', () => withField(0, { extra: 1 } as Partial<Field>)],
    ['unknown key on result', () => ({ ...valid(), extra: 1 })],
    ['empty engine', () => ({ ...valid(), engine: '' })],
    ['value with no wordIds', () => withField(0, { wordIds: [] })],
    ['null value with wordIds', () => withField(0, { value: null, flags: ['missing'] })],
    ['null value with no flags', () => withField(0, { value: null, wordIds: [] })],
    ['duplicate wordIds', () => withField(0, { wordIds: ['o0001', 'o0001'] })],
    ['empty-string value', () => withField(0, { value: '' })],
    ['whitespace-only value', () => withField(0, { value: '   ' })],
  ];
  it.each(bad)('rejects %s', (_label, make) => {
    expect(ExtractionResultSchema.safeParse(make()).success).toBe(false);
  });
});

describe('parseExtractionResult', () => {
  it('returns the parsed result', () => {
    expect(parseExtractionResult(valid())).toEqual(valid());
  });

  it('throws ExtractionError with a plain message and the Zod error as cause', () => {
    let caught: unknown;
    try {
      parseExtractionResult({ engine: 'e', fields: [] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ExtractionError);
    const err = caught as ExtractionError;
    expect(err.message).toBe('The fields could not be read.');
    expect((err.cause as { name?: string }).name).toBe('ZodError');
  });
});

describe('round trip property', () => {
  const idsArb = fc.uniqueArray(fc.stringMatching(/^o\d{4}$/), { minLength: 1, maxLength: 5 });
  const fieldArb = (name: Field['name']): fc.Arbitrary<Field> =>
    fc.oneof(
      fc.record({
        name: fc.constant(name),
        value: fc.string({ minLength: 1 }).filter((s) => s.trim() !== ''),
        wordIds: idsArb,
        confidence: fc.double({ min: 0, max: 1, noNaN: true }),
        flags: fc.array(fc.string(), { maxLength: 2 }),
        reviewed: fc.boolean(),
      }),
      fc.record({
        name: fc.constant(name),
        value: fc.constant(null),
        wordIds: fc.constant([] as string[]),
        confidence: fc.double({ min: 0, max: 1, noNaN: true }),
        flags: fc.array(fc.string(), { minLength: 1, maxLength: 2 }),
        reviewed: fc.boolean(),
      }),
    );
  const resultArb = fc.tuple(...FIELD_ORDER.map(fieldArb)).map(
    (fields): ExtractionResult => ({ engine: 'prop', fields }),
  );

  it('parses and survives a JSON round trip', () => {
    fc.assert(
      fc.property(resultArb, (x) => {
        const parsed = ExtractionResultSchema.parse(x);
        expect(parsed).toEqual(x);
        expect(ExtractionResultSchema.parse(JSON.parse(JSON.stringify(x)))).toEqual(x);
      }),
    );
  });
});

describe('createExtractor', () => {
  afterEach(() => registerRuleExtractor(undefined));

  const fake: ExtractionAdapter = {
    name: 'fake',
    extract: () => Promise.resolve(valid()),
  };

  it('throws "not available yet" for unset and "rules" with nothing registered', () => {
    expect(() => createExtractor({})).toThrow('The rule-based reader is not available yet.');
    expect(() => createExtractor({ EXTRACT_PROVIDER: 'rules' })).toThrow(ExtractionError);
  });

  it('returns the registered extractor', () => {
    registerRuleExtractor(() => fake);
    // Wrapped by the central citation check (0.6), so not the same object; name is unchanged.
    expect(createExtractor({}).name).toBe(fake.name);
    expect(createExtractor({ EXTRACT_PROVIDER: 'rules' }).name).toBe(fake.name);
    expect(createExtractor({ EXTRACT_PROVIDER: ' Rules ' }).name).toBe(fake.name);
  });

  it('does not leak registration between tests', () => {
    expect(() => createExtractor({})).toThrow('not available yet');
  });

  it('throws the not-set-up error for model and recorded', () => {
    for (const p of ['model', 'recorded']) {
      expect(() => createExtractor({ EXTRACT_PROVIDER: p })).toThrow(
        'The model reader is not set up yet. Use the rule-based reader.',
      );
    }
  });

  it('names the allowed values for an unknown provider', () => {
    expect(() => createExtractor({ EXTRACT_PROVIDER: 'magic' })).toThrow(
      /"rules".*"model".*"recorded"/,
    );
  });
});
