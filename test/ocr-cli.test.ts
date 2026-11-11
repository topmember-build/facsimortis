import { describe, expect, it } from 'vitest';
import { DEFAULT_FAX, formatOcrTable, parseOcrArgs } from '../src/scripts/ocr-format.js';
import type { OcrResult } from '../src/ocr/types.js';

const result: OcrResult = {
  engine: 'tesseract',
  width: 800,
  height: 1000,
  words: [
    { id: 'o0001', text: 'Referral', box: [10, 20, 90, 40], confidence: 0.9 },
    { id: 'o0002', text: 'Maria', box: [100, 20, 150, 40], confidence: 0.755 },
  ],
};

describe('formatOcrTable', () => {
  const lines = formatOcrTable(result, { file: 'a.png', seconds: 0.456 }).split('\n');

  it('has a header with file, engine, size and word count', () => {
    expect(lines[0]).toBe('File: a.png  Engine: tesseract  Image: 800x1000  Words: 2');
  });

  it('prints one line per word with id, box, confidence and text', () => {
    expect(lines).toHaveLength(5);
    expect(lines[2]).toMatch(/^o0001\s+10,20,90,40\s+0\.90\s+Referral$/);
    expect(lines[3]).toMatch(/^o0002\s+100,20,150,40\s+0\.7[56]\s+Maria$/);
  });

  it('ends with elapsed seconds and mean confidence', () => {
    expect(lines[4]).toBe('OCR took 0.5 s. Mean confidence: 0.83');
  });

  it('handles an empty page', () => {
    const out = formatOcrTable({ ...result, words: [] }, { file: 'b.png', seconds: 1 });
    expect(out).toContain('Words: 0');
    expect(out).toContain('Mean confidence: n/a');
  });
});

describe('parseOcrArgs', () => {
  it('defaults to the first fixture', () => {
    expect(parseOcrArgs([])).toEqual({ ok: true, args: { path: DEFAULT_FAX, json: false } });
  });
  it('takes a positional path and --json', () => {
    expect(parseOcrArgs(['--json', 'x.png'])).toEqual({
      ok: true,
      args: { path: 'x.png', json: true },
    });
  });
  it('rejects unknown flags and extra paths', () => {
    expect(parseOcrArgs(['--bogus']).ok).toBe(false);
    expect(parseOcrArgs(['a.png', 'b.png']).ok).toBe(false);
  });
});
