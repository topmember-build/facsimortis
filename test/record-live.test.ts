import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RecordedResponseCache } from '../src/extract/recorded.js';
import { FIELD_ORDER } from '../src/extract/schema.js';
import { findFaxPngs, recordFax, redactKey } from '../src/scripts/record-live-lib.js';
import type { OcrResult } from '../src/ocr/types.js';

const ocr: OcrResult = {
  engine: 'test',
  width: 100,
  height: 100,
  words: [
    { id: 'o0001', text: 'Jasper', box: [0, 0, 10, 10], confidence: 0.9 },
    { id: 'o0002', text: 'Hartley', box: [12, 0, 22, 10], confidence: 0.8 },
  ],
} as OcrResult;

const goodReply = JSON.stringify({
  fields: FIELD_ORDER.map((name) =>
    name === 'patientName'
      ? { name, value: 'Jasper Hartley', wordIds: ['o0001', 'o0002'] }
      : { name, value: null, wordIds: [] },
  ),
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rec-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('recordFax', () => {
  it('makes one call and saves a usable reply', async () => {
    const cache = new RecordedResponseCache(dir);
    const out = await recordFax(ocr, async () => ({ model: 'm', text: goodReply }), cache);
    expect(out).toMatchObject({ calls: 1, saved: true });
    expect(out.result.fields.find((f) => f.name === 'patientName')?.value).toBe('Jasper Hartley');
    expect((await cache.get(ocr))?.text).toBe(goodReply);
  });

  it('saves nothing when both replies are unusable', async () => {
    const cache = new RecordedResponseCache(dir);
    const out = await recordFax(ocr, async () => ({ model: 'm', text: 'nope' }), cache);
    expect(out).toMatchObject({ calls: 2, saved: false });
    expect(out.result.fields.every((f) => f.value === null && f.flags.length > 0)).toBe(true);
    expect(await cache.get(ocr)).toBeUndefined();
  });

  it('saves the retry when only the first reply is unusable', async () => {
    const cache = new RecordedResponseCache(dir);
    let n = 0;
    const out = await recordFax(
      ocr,
      async () => ({ model: 'm', text: n++ === 0 ? '{}' : goodReply }),
      cache,
    );
    expect(out).toMatchObject({ calls: 2, saved: true });
    expect((await cache.get(ocr))?.text).toBe(goodReply);
  });
});

describe('redactKey', () => {
  it('hides the key wherever it appears', () => {
    expect(redactKey('bad abc123 and abc123', 'abc123')).toBe('bad [key hidden] and [key hidden]');
  });
  it('leaves text alone when there is no key', () => {
    expect(redactKey('hello', undefined)).toBe('hello');
    expect(redactKey('hello', '  ')).toBe('hello');
  });
});

describe('findFaxPngs', () => {
  it('finds the three fixture faxes, sorted', () => {
    const found = findFaxPngs('fixtures/faxes').map((p) => p.replaceAll('\\', '/'));
    expect(found).toEqual([
      'fixtures/faxes/L1/fax-0001.png',
      'fixtures/faxes/L2/fax-0002.png',
      'fixtures/faxes/L2/fax-0003.png',
    ]);
  });
});
