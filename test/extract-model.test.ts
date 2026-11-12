import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MODEL_REPLY_JSON_SCHEMA,
  ModelExtractor,
  NEEDS_REVIEW_FLAG,
  buildPrompt,
  checkReply,
} from '../src/extract/model.js';
import type { ModelSource } from '../src/extract/model.js';
import { RecordedResponseCache } from '../src/extract/recorded.js';
import { FIELD_ORDER } from '../src/extract/schema.js';
import type { OcrResult } from '../src/ocr/types.js';

const TEXTS = ['Pippa', 'Ellery', '1985-03-02', 'Dr', 'Moss', '1234567893', 'Cough', 'urgent', '555-0100'];
const ocr: OcrResult = {
  words: TEXTS.map((t, i) => ({ id: `o${i + 1}`, text: t, box: [i, 0, i + 5, 10], confidence: 0.9 - i * 0.01 })),
  width: 100,
  height: 100,
  engine: 'test',
};

type Entry = { value: string | null; wordIds: string[] };
const GOOD: Record<string, Entry> = {
  patientName: { value: 'Pippa Ellery', wordIds: ['o1', 'o2'] },
  dob: { value: '1985-03-02', wordIds: ['o3'] },
  referringProvider: { value: 'Dr Moss', wordIds: ['o4', 'o5'] },
  npi: { value: '1234567893', wordIds: ['o6'] },
  reason: { value: 'Cough', wordIds: ['o7'] },
  urgency: { value: null, wordIds: [] },
  callbackPhone: { value: '555-0100', wordIds: ['o9'] },
};
const reply = (over: Record<string, Entry> = {}, extra: object = {}) =>
  JSON.stringify({
    fields: FIELD_ORDER.map((name) => ({ name, ...(over[name] ?? GOOD[name]) })),
    ...extra,
  });

/** A source that plays back recorded texts in order, counting calls. */
function scripted(texts: string[]) {
  let calls = 0;
  const source: ModelSource = () => {
    const text = texts[Math.min(calls, texts.length - 1)] as string;
    calls++;
    return Promise.resolve({ model: 'rec-model', text });
  };
  return { source, calls: () => calls };
}

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('Network call attempted in a test.');
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('prompt and schema', () => {
  it('asks for word IDs and exact text, lists the words, never asks for coordinates', () => {
    const p = buildPrompt(ocr);
    expect(p).toMatch(/exactly as read/);
    expect(p).toMatch(/Never correct/);
    expect(p).toMatch(/Do not return coordinates/);
    expect(p).toContain('o6\t"1234567893"');
    expect(JSON.stringify(MODEL_REPLY_JSON_SCHEMA)).not.toMatch(/box|coord|x0|bbox/i);
  });
});

describe('checkReply', () => {
  it('accepts a good reply', () => {
    expect(checkReply(reply(), ocr).ok).toBe(true);
  });

  it.each([
    ['not JSON', 'nope'],
    ['extra key', reply({}, { box: [1, 2, 3, 4] })],
    ['missing field', JSON.stringify({ fields: [] })],
    ['unknown word', reply({ dob: { value: '1985-03-02', wordIds: ['o99'] } })],
    ['corrected value', reply({ npi: { value: '1234567890', wordIds: ['o6'] } })],
    ['value without words', reply({ dob: { value: '1985-03-02', wordIds: [] } })],
    ['null with words', reply({ dob: { value: null, wordIds: ['o3'] } })],
    ['repeated word', reply({ dob: { value: '1985-03-02 1985-03-02', wordIds: ['o3', 'o3'] } })],
  ])('rejects %s', (_n, text) => {
    expect(checkReply(text, ocr).ok).toBe(false);
  });

  it('rejects any value that differs from its cited words', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (v) => {
        fc.pre(v !== '1234567893');
        const text = reply({ npi: { value: v, wordIds: ['o6'] } });
        expect(checkReply(text, ocr).ok).toBe(false);
      }),
    );
  });
});

describe('ModelExtractor', () => {
  it('turns a valid recorded reply into cited fields; absent field is null and flagged', async () => {
    const { source, calls } = scripted([reply()]);
    const result = await new ModelExtractor(source).extract(ocr);
    expect(calls()).toBe(1);
    expect(result.engine).toBe('model:rec-model');
    const npi = result.fields.find((f) => f.name === 'npi');
    expect(npi).toMatchObject({ value: '1234567893', wordIds: ['o6'], flags: [] });
    expect(npi?.confidence).toBeCloseTo(0.85);
    const urgency = result.fields.find((f) => f.name === 'urgency');
    expect(urgency?.value).toBeNull();
    expect(urgency?.flags[0]).toMatch(/not found on the page/);
  });

  it('retries once on invalid output and uses the second answer', async () => {
    const { source, calls } = scripted(['garbage', reply()]);
    const result = await new ModelExtractor(source).extract(ocr);
    expect(calls()).toBe(2);
    expect(result.fields.find((f) => f.name === 'dob')?.value).toBe('1985-03-02');
  });

  it('goes to needs-review after two invalid answers: every field null and flagged', async () => {
    const bad = reply({ npi: { value: '1234567890', wordIds: ['o6'] } });
    const { source, calls } = scripted([bad, 'garbage', reply()]);
    const result = await new ModelExtractor(source).extract(ocr);
    expect(calls()).toBe(2);
    expect(result.fields).toHaveLength(7);
    for (const f of result.fields) {
      expect(f.value).toBeNull();
      expect(f.wordIds).toEqual([]);
      expect(f.flags).toEqual([NEEDS_REVIEW_FLAG]);
    }
  });

  it('works from the recorded-response cache with no network', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fax-model-'));
    try {
      const cache = new RecordedResponseCache(dir);
      await cache.put(ocr, { model: 'rec-model', text: reply() });
      const source: ModelSource = async (o) => {
        const hit = await cache.get(o);
        if (!hit) throw new Error('nothing recorded');
        return hit;
      };
      const result = await new ModelExtractor(source).extract(ocr);
      expect(result.fields.find((f) => f.name === 'callbackPhone')?.value).toBe('555-0100');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
