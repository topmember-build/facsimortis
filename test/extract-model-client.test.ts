import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_EXTRACT_MODEL, GeminiClient, interactionText, thinkingLevelFrom } from '../src/extract/gemini.js';
import { RecordedResponseCache, ocrWordsKey } from '../src/extract/recorded.js';
import { ExtractionError } from '../src/extract/types.js';
import type { OcrResult } from '../src/ocr/types.js';

function ocrOf(texts: string[], confidence = 0.9): OcrResult {
  return {
    words: texts.map((t, i) => ({ id: `o${i + 1}`, text: t, box: [i, 0, i + 5, 10], confidence })),
    width: 100,
    height: 100,
    engine: 'test',
  };
}

const KEY = 'fake-test-key-123';
const reply = (text: string) => ({ steps: [{ type: 'model_output', content: [{ type: 'text', text }] }] });
const okResponse = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

// Guard: nothing in this file may reach the network.
beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('Network call attempted in a test.');
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ocrWordsKey', () => {
  it('is a 64-char hex hash, stable for the same words', () => {
    const key = ocrWordsKey(ocrOf(['a', 'b']));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(ocrWordsKey(ocrOf(['a', 'b']))).toBe(key);
  });

  it('ignores confidence but changes when a word changes', () => {
    expect(ocrWordsKey(ocrOf(['a', 'b'], 0.1))).toBe(ocrWordsKey(ocrOf(['a', 'b'], 0.9)));
    expect(ocrWordsKey(ocrOf(['a', 'b']))).not.toBe(ocrWordsKey(ocrOf(['a', 'c'])));
  });

  it('differs for different word lists', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { maxLength: 6 }),
        fc.array(fc.string({ minLength: 1 }), { maxLength: 6 }),
        (a, b) => {
          fc.pre(JSON.stringify(a) !== JSON.stringify(b));
          expect(ocrWordsKey(ocrOf(a))).not.toBe(ocrWordsKey(ocrOf(b)));
        },
      ),
    );
  });
});

describe('RecordedResponseCache', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'facsimortis-cache-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns undefined when nothing is recorded', async () => {
    expect(await new RecordedResponseCache(dir).get(ocrOf(['x']))).toBeUndefined();
  });

  it('round-trips a response under the hash of the words', async () => {
    const cache = new RecordedResponseCache(dir);
    const ocr = ocrOf(['Pippa', 'Ellery']);
    const saved = await cache.put(ocr, { model: 'm', text: '{"a":1}' });
    expect(saved.key).toBe(ocrWordsKey(ocr));
    expect(await cache.get(ocr)).toEqual(saved);
    expect(await cache.get(ocrOf(['Other']))).toBeUndefined();
  });

  it('rejects a damaged or mismatched file', async () => {
    const cache = new RecordedResponseCache(dir);
    const ocr = ocrOf(['x']);
    const key = ocrWordsKey(ocr);
    await writeFile(join(dir, `${key}.json`), '{not json');
    await expect(cache.get(ocr)).rejects.toBeInstanceOf(ExtractionError);
    await writeFile(join(dir, `${key}.json`), JSON.stringify({ key: 'f'.repeat(64), model: 'm', text: '' }));
    await expect(cache.get(ocr)).rejects.toBeInstanceOf(ExtractionError);
    await writeFile(join(dir, `${key}.json`), JSON.stringify({ key, model: 'm' }));
    await expect(cache.get(ocr)).rejects.toBeInstanceOf(ExtractionError);
  });
});

describe('GeminiClient', () => {
  const request = { prompt: 'p', schema: { type: 'object' } };

  it('makes no network call and needs no key until generate() runs', () => {
    expect(() => new GeminiClient({ env: {} })).not.toThrow();
  });

  it('fails without a key and does not call fetch', async () => {
    const fetchStub = vi.fn();
    const client = new GeminiClient({ env: {}, fetch: fetchStub });
    await expect(client.generate(request)).rejects.toThrow(/EXTRACT_API_KEY/);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('sends the documented request and uses the default model', async () => {
    const fetchStub = vi.fn().mockResolvedValue(okResponse(reply('{"ok":true}')));
    const client = new GeminiClient({ env: { EXTRACT_API_KEY: KEY }, fetch: fetchStub });
    const out = await client.generate(request);
    expect(out).toEqual({ model: DEFAULT_EXTRACT_MODEL, text: '{"ok":true}' });
    expect(DEFAULT_EXTRACT_MODEL).toBe('gemini-3.8-flash');

    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    expect(url).not.toContain(KEY);
    const headers = init.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe(KEY);
    expect(headers['Api-Revision']).toBe('2026-05-20');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'gemini-3.8-flash',
      input: 'p',
      store: false,
      response_format: { type: 'text', mime_type: 'application/json', schema: { type: 'object' } },
    });
  });

  it('uses EXTRACT_MODEL when set', async () => {
    const fetchStub = vi.fn().mockResolvedValue(okResponse(reply('x')));
    const client = new GeminiClient({
      env: { EXTRACT_API_KEY: KEY, EXTRACT_MODEL: 'gemini-3.6-flash' },
      fetch: fetchStub,
    });
    expect((await client.generate(request)).model).toBe('gemini-3.6-flash');
  });

  it('never puts the key in errors', async () => {
    const failures: Array<() => Promise<Response>> = [
      () => Promise.reject(new Error(`boom ${KEY}`)),
      () => Promise.resolve(new Response(`bad ${KEY}`, { status: 403 })),
      () => Promise.resolve(new Response(`not json ${KEY}`, { status: 200 })),
      () => Promise.resolve(okResponse({ nope: KEY })),
    ];
    for (const fail of failures) {
      const client = new GeminiClient({ env: { EXTRACT_API_KEY: KEY }, fetch: fail });
      const err = await client.generate(request).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ExtractionError);
      expect(String((err as Error).message)).not.toContain(KEY);
      expect(JSON.stringify((err as Error).cause ?? '', Object.getOwnPropertyNames(Object(err)))).not.toContain(KEY);
    }
  });

  it('never logs the key', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
    const client = new GeminiClient({
      env: { EXTRACT_API_KEY: KEY },
      fetch: () => Promise.resolve(okResponse(reply('x'))),
    });
    await client.generate(request);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('interactionText', () => {
  it('joins text from model_output steps and skips other steps', () => {
    expect(
      interactionText({
        steps: [
          { type: 'thought', signature: 's' },
          { type: 'model_output', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
        ],
      }),
    ).toBe('ab');
  });

  it('rejects wrong shapes and empty output', () => {
    expect(() => interactionText({})).toThrow(ExtractionError);
    expect(() => interactionText({ steps: 'x' })).toThrow(ExtractionError);
    expect(() => interactionText({ steps: [{ type: 'thought' }] })).toThrow(ExtractionError);
  });
});

describe('EXTRACT_THINKING_LEVEL', () => {
  const request = { prompt: 'p', schema: { type: 'object' } };
  const bodyOf = (stub: ReturnType<typeof vi.fn>): Record<string, unknown> =>
    JSON.parse((stub.mock.calls[0] as [string, RequestInit])[1].body as string) as Record<string, unknown>;

  it('reads low, medium and high in any case; unset or blank gives nothing', () => {
    expect(thinkingLevelFrom({ EXTRACT_THINKING_LEVEL: 'low' })).toBe('low');
    expect(thinkingLevelFrom({ EXTRACT_THINKING_LEVEL: ' Medium ' })).toBe('medium');
    expect(thinkingLevelFrom({ EXTRACT_THINKING_LEVEL: 'HIGH' })).toBe('high');
    expect(thinkingLevelFrom({})).toBeUndefined();
    expect(thinkingLevelFrom({ EXTRACT_THINKING_LEVEL: '  ' })).toBeUndefined();
  });

  it('rejects other values, including minimal, which this model does not support', () => {
    for (const v of ['minimal', 'xhigh', 'fast', '0']) {
      expect(() => thinkingLevelFrom({ EXTRACT_THINKING_LEVEL: v })).toThrow(ExtractionError);
    }
  });

  it('sends generation_config.thinking_level only when set', async () => {
    const set = vi.fn().mockResolvedValue(okResponse(reply('x')));
    await new GeminiClient({ env: { EXTRACT_API_KEY: KEY, EXTRACT_THINKING_LEVEL: 'low' }, fetch: set }).generate(request);
    expect(bodyOf(set)['generation_config']).toEqual({ thinking_level: 'low' });

    const blank = vi.fn().mockResolvedValue(okResponse(reply('x')));
    await new GeminiClient({ env: { EXTRACT_API_KEY: KEY, EXTRACT_THINKING_LEVEL: '' }, fetch: blank }).generate(request);
    expect(bodyOf(blank)).not.toHaveProperty('generation_config');
  });

  it('fails on a bad level before any network call', async () => {
    const stub = vi.fn();
    const client = new GeminiClient({ env: { EXTRACT_API_KEY: KEY, EXTRACT_THINKING_LEVEL: 'minimal' }, fetch: stub });
    await expect(client.generate(request)).rejects.toThrow(/EXTRACT_THINKING_LEVEL/);
    expect(stub).not.toHaveBeenCalled();
  });
});