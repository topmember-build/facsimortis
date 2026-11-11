import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CloudOcrAdapter,
  OcrError,
  assignWordIds,
  clampBox,
  createOcrAdapter,
  normalizeConfidence,
  registerLocalAdapter,
} from '../src/ocr/index.js';
import type { Box, OcrAdapter } from '../src/ocr/index.js';

const word = (text: string, box: Box, confidence = 0.9) => ({ text, box, confidence });

describe('assignWordIds', () => {
  it('orders lines top to bottom and words left to right', () => {
    const out = assignWordIds([
      word('world', [100, 52, 150, 70]),
      word('second', [10, 100, 60, 118]),
      word('hello', [10, 50, 90, 68]),
    ]);
    expect(out.map((w) => w.text)).toEqual(['hello', 'world', 'second']);
    expect(out.map((w) => w.id)).toEqual(['o0001', 'o0002', 'o0003']);
  });

  it('drops words with empty text', () => {
    const out = assignWordIds([word('  ', [0, 0, 5, 5]), word('a', [10, 0, 15, 5])]);
    expect(out.map((w) => w.text)).toEqual(['a']);
  });

  it('gives sequential unique o-prefixed IDs and keeps every non-empty word once', () => {
    const wordArb = fc.record({
      text: fc.string({ maxLength: 6 }),
      box: fc
        .tuple(fc.nat(500), fc.nat(500), fc.integer({ min: 1, max: 50 }), fc.integer({ min: 1, max: 30 }))
        .map(([x, y, w, h]): Box => [x, y, x + w, y + h]),
      confidence: fc.double({ min: 0, max: 1, noNaN: true }),
    });
    fc.assert(
      fc.property(fc.array(wordArb, { maxLength: 40 }), (input) => {
        const out = assignWordIds(input);
        const expected = input.filter((w) => w.text.trim() !== '');
        expect(out.map((w) => w.id)).toEqual(
          out.map((_, i) => `o${String(i + 1).padStart(4, '0')}`),
        );
        expect(out).toHaveLength(expected.length);
        const key = (w: { text: string; box: Box }) => `${w.text}|${w.box.join(',')}`;
        expect(out.map(key).sort()).toEqual(expected.map(key).sort());
      }),
    );
  });
});

describe('clampBox and normalizeConfidence', () => {
  it('keeps boxes inside the page and ordered', () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.integer({ min: -500, max: 3000 }), fc.integer({ min: -500, max: 3000 }), fc.integer({ min: -500, max: 3000 }), fc.integer({ min: -500, max: 3000 })),
        (b) => {
          const [x0, y0, x1, y1] = clampBox(b, 1728, 2200);
          expect(x0).toBeGreaterThanOrEqual(0);
          expect(y0).toBeGreaterThanOrEqual(0);
          expect(x1).toBeLessThanOrEqual(1728);
          expect(y1).toBeLessThanOrEqual(2200);
          expect(x0).toBeLessThanOrEqual(x1);
          expect(y0).toBeLessThanOrEqual(y1);
        },
      ),
    );
  });

  it('maps 0..100 to 0..1 and clamps', () => {
    expect(normalizeConfidence(87, 100)).toBeCloseTo(0.87);
    expect(normalizeConfidence(0.4, 1)).toBe(0.4);
    expect(normalizeConfidence(150, 100)).toBe(1);
    expect(normalizeConfidence(-5, 100)).toBe(0);
    expect(normalizeConfidence(Number.NaN, 100)).toBe(0);
  });
});

describe('CloudOcrAdapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('rejects with a plain-language OcrError and makes no network call', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network call attempted');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const adapter: OcrAdapter = new CloudOcrAdapter({ apiKey: 'fake' });
    expect(adapter.name).toBe('cloud');
    const err: unknown = await adapter.recognize(Buffer.alloc(0)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OcrError);
    expect((err as OcrError).message).toBe('Cloud OCR is not set up in this demo. Use the local reader.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('createOcrAdapter', () => {
  afterEach(() => registerLocalAdapter(undefined));

  it('returns the cloud adapter for "cloud"', () => {
    expect(createOcrAdapter({ OCR_PROVIDER: 'cloud' })).toBeInstanceOf(CloudOcrAdapter);
  });

  it('throws an OcrError naming the allowed values for an unknown provider', () => {
    expect(() => createOcrAdapter({ OCR_PROVIDER: 'bogus' })).toThrow(OcrError);
    expect(() => createOcrAdapter({ OCR_PROVIDER: 'bogus' })).toThrow(/"local" and "cloud"/);
  });

  it('throws a clear OcrError for local or unset while no local adapter is registered', () => {
    expect(() => createOcrAdapter({ OCR_PROVIDER: 'local' })).toThrow(OcrError);
    expect(() => createOcrAdapter({})).toThrow(OcrError);
  });

  it('uses the registered local adapter for local or unset', () => {
    const fake: OcrAdapter = {
      name: 'fake-local',
      recognize: () => Promise.resolve({ words: [], width: 1, height: 1, engine: 'fake' }),
    };
    registerLocalAdapter(() => fake);
    expect(createOcrAdapter({ OCR_PROVIDER: 'local' })).toBe(fake);
    expect(createOcrAdapter({})).toBe(fake);
  });
});
