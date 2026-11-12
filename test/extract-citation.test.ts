import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { checkCitations } from '../src/extract/citation.js';
import { checkNpi } from '../src/extract/checks.js';
import { createExtractor } from '../src/extract/default.js';
import { FIELD_ORDER, registerRuleExtractor } from '../src/extract/index.js';
import type { ExtractionAdapter, ExtractionResult, Field } from '../src/extract/index.js';
import { RuleExtractor } from '../src/extract/rules.js';
import type { OcrResult, OcrWord } from '../src/ocr/types.js';

const FLAG = 'The patient name did not match the words on the page, so it was left empty. Please check it.';

function word(id: string, text: string): OcrWord {
  return { id, text, box: [0, 0, 10, 10], confidence: 0.9 };
}
function ocrOf(texts: string[]): OcrResult {
  return { words: texts.map((t, i) => word(`o${i + 1}`, t)), width: 100, height: 100, engine: 'test' };
}
function result(over: Partial<Field> = {}): ExtractionResult {
  return {
    engine: 'test',
    fields: FIELD_ORDER.map((name) =>
      name === 'patientName'
        ? { name, value: 'Pippa Ellery', wordIds: ['o1', 'o2'], confidence: 0.9, flags: [], reviewed: false, ...over }
        : { name, value: null, wordIds: [], confidence: 0, flags: ['missing'], reviewed: false },
    ),
  };
}
const page = ocrOf(['Pippa', 'Ellery', 'congestian']);

describe('checkCitations', () => {
  it('rejects an unknown word id', () => {
    const r = checkCitations(result({ wordIds: ['o1', 'o99'] }), page);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]).toMatchObject({ field: 'patientName', reason: 'unknown-word' });
    expect(r.result.fields[0]).toEqual({
      name: 'patientName', value: null, wordIds: [], confidence: 0, flags: [FLAG], reviewed: false,
    });
  });

  it('rejects a corrected spelling', () => {
    const r = checkCitations(result({ value: 'congestion', wordIds: ['o3'] }), page);
    expect(r.rejected[0]).toMatchObject({ field: 'patientName', reason: 'text-mismatch' });
    expect(r.result.fields[0]?.value).toBeNull();
  });

  it.each([
    ['substring', 'Pippa'],
    ['re-ordered', 'Ellery Pippa'],
    ['double space', 'Pippa  Ellery'],
  ])('rejects a %s value', (_n, value) => {
    const r = checkCitations(result({ value }), page);
    expect(r.rejected.map((x) => x.reason)).toEqual(['text-mismatch']);
  });

  it('passes an exact match untouched', () => {
    const input = result({ flags: ['kept'] });
    const r = checkCitations(input, page);
    expect(r.rejected).toEqual([]);
    expect(r.result).toEqual(input);
  });

  it('passes null fields through', () => {
    const input = result({ value: null, wordIds: [], flags: ['x'] });
    const r = checkCitations(input, page);
    expect(r.rejected).toEqual([]);
    expect(r.result).toEqual(input);
  });

  it('keeps existing flags when it rejects a field', () => {
    const r = checkCitations(result({ value: 'Nope', flags: ['earlier'] }), page);
    expect(r.result.fields[0]?.flags).toEqual(['earlier', FLAG]);
  });

  it('property: joined cited words never reject; any one-character change does', () => {
    const wordText = fc.stringMatching(/^[A-Za-z0-9/.,-]{1,8}$/);
    fc.assert(
      fc.property(
        fc.array(wordText, { minLength: 1, maxLength: 12 }),
        fc.nat(),
        fc.nat(),
        fc.constantFrom('#', '?', '~'),
        (texts, pick, at, ch) => {
          const ocr = ocrOf(texts);
          const ids = ocr.words.map((w) => w.id);
          const n = (pick % ids.length) + 1;
          const cited = ids.slice(0, n);
          const value = texts.slice(0, n).join(' ');
          expect(checkCitations(result({ value, wordIds: cited }), ocr).rejected).toEqual([]);
          const i = at % value.length;
          const changed = value.slice(0, i) + ch + value.slice(i + 1);
          const r = checkCitations(result({ value: changed, wordIds: cited }), ocr);
          expect(r.rejected.map((x) => x.field)).toEqual(['patientName']);
        },
      ),
    );
  });
});

describe('createExtractor applies the check centrally', () => {
  afterEach(() => registerRuleExtractor(() => new RuleExtractor()));

  it('rejects a wrong value, delegates close(), keeps the name', async () => {
    let closed = false;
    const fake: ExtractionAdapter = {
      name: 'fake',
      extract: async () => result({ value: 'Pippa Elery' }),
      close: async () => {
        closed = true;
      },
    };
    registerRuleExtractor(() => fake);
    const ex = createExtractor({});
    expect(ex.name).toBe('fake');
    const out = await ex.extract(page);
    expect(out.fields[0]?.value).toBeNull();
    expect(out.fields[0]?.flags).toEqual([FLAG]);
    await ex.close?.();
    expect(closed).toBe(true);
  });
});

describe('fixtures: RuleExtractor output is unchanged by the check', () => {
  interface Truth { words: Array<{ id: string; text: string; box: OcrWord['box'] }> }
  const fromTruth = (p: string): OcrResult => {
    const t = JSON.parse(readFileSync(p, 'utf8')) as Truth;
    return { words: t.words.map((w) => ({ ...w, confidence: 1 })), width: 1728, height: 2200, engine: 'truth' };
  };
  const cases: Array<[string, OcrResult]> = [
    ['fax-0001 truth', fromTruth('fixtures/faxes/L1/fax-0001.truth.json')],
    ['fax-0002 truth', fromTruth('fixtures/faxes/L2/fax-0002.truth.json')],
    ['fax-0003 truth', fromTruth('fixtures/faxes/L2/fax-0003.truth.json')],
    ['fax-0002 recorded OCR', JSON.parse(readFileSync('fixtures/ocr/fax-0002.ocr.json', 'utf8')) as OcrResult],
  ];
  it.each(cases)('%s', async (_n, ocr) => {
    const raw = await new RuleExtractor().extract(ocr);
    expect(checkCitations(raw, ocr).rejected).toEqual([]);
    // The NPI check (0.8.1) is also central now, so fax-0003's bad NPI gains its flag.
    // Only the citation check is under test here: nothing else may differ from raw.
    expect(await createExtractor({}).extract(ocr)).toEqual(checkNpi(raw).result);
  });
});
