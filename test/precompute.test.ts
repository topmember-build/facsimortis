import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import '../src/extract/default.js';
import { createExtractor, withChecks } from '../src/extract/index.js';
import { ModelExtractor } from '../src/extract/model.js';
import { RecordedResponseCache } from '../src/extract/recorded.js';
import { FIELD_ORDER } from '../src/extract/schema.js';
import { REFERENCE_DATE } from '../src/generator/data.js';
import type { OcrResult } from '../src/ocr/types.js';
import {
  NO_SAVED_ANSWER_MESSAGE,
  ReaderResultSchema,
  SampleFaxSchema,
  SampleIndexSchema,
} from '../src/samples/schema.js';
import {
  buildFax,
  buildIndex,
  compareOutputs,
  describeDifferences,
  isUpToDate,
  planOutputs,
  readBoth,
  receivedAt,
  serialize,
} from '../src/scripts/precompute-lib.js';
import type { FaxInput, Readers } from '../src/scripts/precompute-lib.js';
import { isAnswerKeyPath, readInput } from '../src/scripts/read-guard.js';

const word = (n: number, text: string, x: number) => ({
  id: `o${String(n).padStart(4, '0')}`,
  text,
  box: [x, 10, x + 40, 30] as [number, number, number, number],
  confidence: 0.9,
});

const ocrOf = (names: string[]): OcrResult => ({
  words: names.map((t, i) => word(i + 1, t, 10 + i * 50)),
  width: 1728,
  height: 2200,
  engine: 'fake-ocr',
});

const dirs: string[] = [];
const tempDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'precompute-'));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function readersWith(dir: string): { readers: Readers; cache: RecordedResponseCache } {
  const cache = new RecordedResponseCache(dir);
  const recorded = withChecks(
    new ModelExtractor(async (ocr) => {
      const saved = await cache.get(ocr);
      if (saved === undefined) throw new Error('should not be called without a saved answer');
      return { model: saved.model, text: saved.text };
    }),
    { today: REFERENCE_DATE },
  );
  return {
    cache,
    readers: {
      rules: createExtractor({ EXTRACT_PROVIDER: 'rules' }, { today: REFERENCE_DATE }),
      recorded,
      hasSavedAnswer: async (ocr) => (await cache.get(ocr)) !== undefined,
    },
  };
}

const savedReply = JSON.stringify({
  fields: FIELD_ORDER.map((name) =>
    name === 'patientName'
      ? { name, value: 'Jane Doe', wordIds: ['o0003', 'o0004'] }
      : { name, value: null, wordIds: [] },
  ),
});

const ocrA = ocrOf(['Patient', 'Name:', 'Jane', 'Doe']);
const ocrB = ocrOf(['Something', 'else', 'entirely']);
const png = new Uint8Array([137, 80, 78, 71, 0, 255, 13, 10]);

async function inputFor(id: string, level: string, ocr: OcrResult, readers: Readers): Promise<FaxInput> {
  return { id, level, png, ocr, ...(await readBoth(ocr, readers)) };
}

describe('sample data schema', () => {
  it('accepts the real output shape', async () => {
    const { readers, cache } = readersWith(tempDir());
    await cache.put(ocrA, { model: 'test-model', text: savedReply });
    const input = await inputFor('fax-0001', 'L1', ocrA, readers);
    expect(SampleFaxSchema.safeParse(buildFax(input)).success).toBe(true);
    expect(SampleIndexSchema.safeParse(buildIndex([input])).success).toBe(true);
    expect(input.model.status).toBe('ok');
  });

  it('rejects bad shapes', async () => {
    const { readers } = readersWith(tempDir());
    const fax = buildFax(await inputFor('fax-0001', 'L1', ocrA, readers));
    const bad = (mutate: (f: Record<string, unknown>) => void): boolean => {
      const copy = JSON.parse(JSON.stringify(fax)) as Record<string, unknown>;
      mutate(copy);
      return SampleFaxSchema.safeParse(copy).success;
    };
    expect(bad((f) => (f['image'] = '../fax.png'))).toBe(false);
    expect(bad((f) => (f['extra'] = 1))).toBe(false);
    expect(bad((f) => (f['level'] = 'one'))).toBe(false);
    expect(bad(() => undefined)).toBe(true);
    // A reader that cites a word that is not on the page.
    const rules = (fax.readers.rules as { fields: Array<{ value: string | null; wordIds: string[] }> }).fields;
    expect(bad((f) => {
      const r = (f['readers'] as { rules: { fields: Array<{ value: string; wordIds: string[] }> } }).rules.fields[0]!;
      r.value = 'x';
      r.wordIds = ['o9999'];
    })).toBe(false);
    expect(rules.length).toBe(7);
    expect(ReaderResultSchema.safeParse({ status: 'ok', engine: 'x', fields: [] }).success).toBe(false);
    expect(ReaderResultSchema.safeParse({ status: 'no-saved-answer' }).success).toBe(false);
    expect(
      SampleIndexSchema.safeParse({ version: 1, faxes: [{ id: 'a', level: 'L1', image: 'a.png', data: 'a.json', receivedAt: 'noon' }] })
        .success,
    ).toBe(false);
  });
});

describe('deterministic output', () => {
  it('gives identical bytes for the same input, whatever the key order', async () => {
    const { readers, cache } = readersWith(tempDir());
    await cache.put(ocrA, { model: 'test-model', text: savedReply });
    const input = await inputFor('fax-0001', 'L1', ocrA, readers);
    const first = planOutputs([input]);
    const second = planOutputs([await inputFor('fax-0001', 'L1', ocrA, readers)]);
    expect([...first.keys()]).toEqual(['index.json', 'fax-0001.png', 'fax-0001.json']);
    expect(compareOutputs(first, second)).toEqual({ missing: [], changed: [], extra: [] });
    expect(Buffer.from(first.get('fax-0001.png')!).equals(Buffer.from(png))).toBe(true);
    const text = Buffer.from(first.get('fax-0001.json')!).toString('utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.includes('\r')).toBe(false);
  });

  it('serialize ignores key order', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string({ maxLength: 6 }), fc.integer(), { maxKeys: 8 }), (obj) => {
        const reversed = Object.fromEntries(Object.entries(obj).reverse());
        expect(serialize(reversed)).toBe(serialize(obj));
      }),
    );
  });

  it('received times are a fixed demo clock on the reference date', () => {
    expect(receivedAt(0)).toBe(`${REFERENCE_DATE}T09:00:00`);
    expect(receivedAt(2)).toBe(`${REFERENCE_DATE}T09:14:00`);
  });
});

describe('missing saved answer', () => {
  it('gives a plain entry for the model reader and still returns the rules result', async () => {
    const { readers, cache } = readersWith(tempDir());
    await cache.put(ocrA, { model: 'test-model', text: savedReply });
    const withAnswer = await readBoth(ocrA, readers);
    const without = await readBoth(ocrB, readers);
    expect(withAnswer.model.status).toBe('ok');
    expect(without.model).toEqual({ status: 'no-saved-answer', message: NO_SAVED_ANSWER_MESSAGE });
    expect(without.rules.status).toBe('ok');
    expect(without.rules).toEqual((await readBoth(ocrB, readers)).rules);
    expect(SampleFaxSchema.safeParse(buildFax({ id: 'fax-0009', level: 'L2', png, ocr: ocrB, ...without })).success).toBe(true);
  });
});

describe('no answer-key reads', () => {
  const files = [
    'src/scripts/precompute.ts',
    'src/scripts/precompute-lib.ts',
    'src/samples/schema.ts',
  ];

  it.each(files)('%s does not mention answer-key files', (file) => {
    expect(readFileSync(file, 'utf8')).not.toMatch(/truth/i);
  });

  it('the read guard refuses answer-key paths and reads the rest', () => {
    expect(isAnswerKeyPath('fixtures/faxes/L1/fax-0001.truth.json')).toBe(true);
    expect(() => readInput('fixtures/faxes/L1/fax-0001.truth.json')).toThrow(/answer-key/);
    expect(readInput('fixtures/faxes/L1/fax-0001.png').length).toBeGreaterThan(0);
  });

  it('every file the precompute script reads goes through the guard', () => {
    const source = readFileSync('src/scripts/precompute.ts', 'utf8');
    expect(source).not.toMatch(/readFileSync\(/);
  });
});

describe('--check comparison', () => {
  const bytes = (s: string): Uint8Array => Buffer.from(s);
  const expected = new Map([
    ['index.json', bytes('a')],
    ['fax-0001.json', bytes('b')],
    ['fax-0001.png', bytes('c')],
  ]);

  it('is clean when identical', () => {
    expect(isUpToDate(compareOutputs(expected, new Map(expected)))).toBe(true);
  });

  it('reports a changed, a missing and an extra file', () => {
    const actual = new Map(expected);
    actual.set('index.json', bytes('changed'));
    actual.delete('fax-0001.png');
    actual.set('old.json', bytes('x'));
    const diff = compareOutputs(expected, actual);
    expect(diff).toEqual({ missing: ['fax-0001.png'], changed: ['index.json'], extra: ['old.json'] });
    expect(isUpToDate(diff)).toBe(false);
    expect(describeDifferences(diff)).toContain('missing: fax-0001.png');
  });
});

describe('committed data', () => {
  it('has one data file and one image per index entry and validates', () => {
    const dir = 'web/public/samples';
    const index = SampleIndexSchema.parse(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')));
    const names = readdirSync(dir).sort();
    expect(names).toEqual(['index.json', ...index.faxes.flatMap((f) => [f.data, f.image])].sort());
    for (const f of index.faxes) SampleFaxSchema.parse(JSON.parse(readFileSync(join(dir, f.data), 'utf8')));
  });
});
