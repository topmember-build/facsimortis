import { readFileSync, readdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createOcrAdapter } from '../src/ocr/default.js';
import { LocalOcrAdapter, TESSDATA_DIR } from '../src/ocr/local.js';
import { iou, matchWords } from '../src/ocr/match.js';
import type { TruthWord } from '../src/ocr/match.js';
import { OcrError } from '../src/ocr/types.js';
import type { OcrResult, OcrWord } from '../src/ocr/types.js';

interface Truth {
  words: TruthWord[];
  fields: Array<{ name: string; value: string; wordIds: string[] }>;
}

const image = readFileSync(new URL('../fixtures/faxes/L1/fax-0001.png', import.meta.url));
const truth = JSON.parse(
  readFileSync(new URL('../fixtures/faxes/L1/fax-0001.truth.json', import.meta.url), 'utf8'),
) as Truth;
const fieldWordIds = truth.fields.flatMap((f) => f.wordIds);

describe('LocalOcrAdapter on fax-0001', () => {
  const adapter = new LocalOcrAdapter();
  let result: OcrResult;
  let rootBefore: string[];
  let rootAfter: string[];
  let tessdataBefore: string[];
  let tessdataAfter: string[];
  const fetchSpy = vi.fn(() => {
    throw new Error('network is not allowed in this test');
  });

  beforeAll(async () => {
    rootBefore = readdirSync(process.cwd()).sort();
    tessdataBefore = readdirSync(TESSDATA_DIR).sort();
    // Note: this guards the main thread only. The Tesseract worker runs in its own thread
    // and is kept offline by the local langPath and cacheMethod "none".
    vi.stubGlobal('fetch', fetchSpy);
    try {
      result = await adapter.recognize(image);
    } finally {
      vi.unstubAllGlobals();
    }
    rootAfter = readdirSync(process.cwd()).sort();
    tessdataAfter = readdirSync(TESSDATA_DIR).sort();
  }, 120_000);

  afterAll(async () => {
    await adapter.close();
  });

  it('works offline and writes no files', () => {
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rootAfter).toEqual(rootBefore);
    expect(rootAfter).not.toContain('eng.traineddata');
    expect(tessdataAfter).toEqual(tessdataBefore);
  });

  it('returns the expected shape', () => {
    expect(result.width).toBe(1728);
    expect(result.height).toBe(2200);
    expect(result.engine).toBe('local');
    expect(result.words.length).toBeGreaterThan(0);
    result.words.forEach((w: OcrWord, i) => {
      expect(w.id).toBe(`o${String(i + 1).padStart(4, '0')}`);
      expect(w.text).toBe(w.text.trim());
      expect(w.text).not.toBe('');
      const [x0, y0, x1, y1] = w.box;
      expect(x0).toBeGreaterThanOrEqual(0);
      expect(y0).toBeGreaterThanOrEqual(0);
      expect(x1).toBeLessThanOrEqual(1728);
      expect(y1).toBeLessThanOrEqual(2200);
      expect(x0).toBeLessThanOrEqual(x1);
      expect(y0).toBeLessThanOrEqual(y1);
      expect(w.confidence).toBeGreaterThanOrEqual(0);
      expect(w.confidence).toBeLessThanOrEqual(1);
    });
  });

  // Measured with PSM 3 on fax-0001 (47 truth words, 17 field-value words), drawn with
  // the plain zero:
  //   all words:    40/47 text matched = 0.851, 42 boxes matched, mean IoU 0.62
  //   field values: 15/17 text matched = 0.882
  // Before the plain-zero override (Spleen's slashed zero, now saved as the trap fixture
  // fixtures/traps/ambiguous-chars) the same page scored 35/47 = 0.745 and 13/17 = 0.765,
  // because 0 was read as 8, 6 or 9.
  // Mean IoU is below 1 because OCR boxes hug the ink while truth boxes are padded
  // cells (about 3px at the sides, 7px above, 5px below). The 7 remaining misses are
  // short words whose tight box falls under IoU 0.5 (-, A, name:, of, Dr) and two
  // letter misreads (SYNTHETIC read as SUNTHETIC, Iris read as Tris).
  it('puts boxes in fax pixel coordinates', () => {
    const m = matchWords(result.words, truth.words, fieldWordIds);
    expect(m.boxMatched).toBeGreaterThanOrEqual(38);
    expect(m.meanIoU).toBeGreaterThanOrEqual(0.55);
    // Every text-matched word overlaps its truth box by at least half.
    const missed = new Set(m.mismatches.map((x) => x.truthId));
    for (const t of truth.words.filter((w) => !missed.has(w.id))) {
      const best = Math.max(...result.words.map((o) => iou(o.box, t.box)));
      expect(best).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('meets the text match floors', () => {
    const m = matchWords(result.words, truth.words, fieldWordIds);
    expect(m.textMatchRate).toBeGreaterThanOrEqual(0.8);
    expect(m.fieldValues.textMatchRate).toBeGreaterThanOrEqual(0.82);
  });
});

describe('LocalOcrAdapter errors', () => {
  it('rejects with a plain OcrError when the buffer is not an image', async () => {
    const adapter = new LocalOcrAdapter();
    try {
      const err = await adapter.recognize(Buffer.from('not an image')).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(OcrError);
      expect((err as OcrError).message).toBe('The page could not be read.');
      expect((err as OcrError).cause).toBeDefined();
    } finally {
      await adapter.close();
    }
  });
});

describe('createOcrAdapter with the bootstrap', () => {
  it('returns the local adapter for "local" and for unset', () => {
    expect(createOcrAdapter({ OCR_PROVIDER: 'local' })).toBeInstanceOf(LocalOcrAdapter);
    expect(createOcrAdapter({})).toBeInstanceOf(LocalOcrAdapter);
  });
});

describe('matchWords', () => {
  const truthWords: TruthWord[] = [
    { id: 'w1', text: 'Hello', box: [10, 10, 110, 40] },
    { id: 'w2', text: 'World', box: [10, 60, 110, 90] },
  ];
  const ocr = (text: string, box: [number, number, number, number], n: number): OcrWord => ({
    id: `o${n}`,
    text,
    box,
    confidence: 0.9,
  });

  it('gives rate 1 and IoU 1 for identical lists', () => {
    const m = matchWords(
      truthWords.map((t, i) => ocr(t.text, t.box, i)),
      truthWords,
      ['w1'],
    );
    expect(m.textMatchRate).toBe(1);
    expect(m.meanIoU).toBe(1);
    expect(m.mismatches).toEqual([]);
    expect(m.fieldValues.truthCount).toBe(1);
    expect(m.fieldValues.textMatchRate).toBe(1);
  });

  it('counts a shifted box below 0.5 IoU as unmatched', () => {
    const m = matchWords([ocr('Hello', [80, 10, 180, 40], 1)], [truthWords[0] as TruthWord]);
    expect(m.boxMatched).toBe(0);
    expect(m.textMatched).toBe(0);
    expect(m.mismatches[0]?.ocrText).toBe('Hello');
  });

  it('counts wrong text as box matched but not text matched', () => {
    const m = matchWords([ocr('Hellp', [10, 10, 110, 40], 1)], [truthWords[0] as TruthWord]);
    expect(m.boxMatched).toBe(1);
    expect(m.textMatched).toBe(0);
    expect(m.mismatches[0]).toMatchObject({ truthId: 'w1', truthText: 'Hello', ocrText: 'Hellp' });
  });

  it('reports a null OCR text when nothing overlaps', () => {
    const m = matchWords([], [truthWords[0] as TruthWord]);
    expect(m.mismatches[0]?.ocrText).toBeNull();
  });
});
