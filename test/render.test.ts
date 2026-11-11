import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { crc32 as zcrc32 } from 'node:zlib';
import { loadSpleen } from '../src/generator/font.js';
import { Page, drawText } from '../src/generator/raster.js';
import { decodePng, encodePng, readPngText } from '../src/generator/png.js';

const font = loadSpleen();

function ink(rows: Uint8Array[]): number {
  return rows.reduce((n, r) => n + r.reduce((a, b) => a + b, 0), 0);
}

describe('font', () => {
  it('has glyphs for ASCII 32..126 in a 16x32 cell', () => {
    for (let c = 32; c <= 126; c++) {
      const g = font.glyphs.get(c);
      expect(g, `glyph ${c}`).toBeDefined();
      expect(g?.rows.length).toBe(32);
      expect(g?.rows.every((r) => r.length === 16)).toBe(true);
    }
    expect(ink(font.glyphs.get(65)?.rows ?? [])).toBeGreaterThan(0);
    expect(ink(font.glyphs.get(32)?.rows ?? [])).toBe(0);
  });

  it('throws on unknown characters', () => {
    const page = new Page(100, 100);
    expect(() => drawText(page, font, '\u{1F600}', 0, 0)).toThrow(/No glyph/);
  });
});

describe('drawText', () => {
  it('returns exact word boxes at scale 1 and 2', () => {
    const p = new Page(400, 200);
    expect(drawText(p, font, 'AB CDE', 10, 20)).toEqual([
      { text: 'AB', box: [10, 20, 42, 52] },
      { text: 'CDE', box: [58, 20, 106, 52] },
    ]);
    expect(drawText(p, font, 'AB CDE', 10, 80, 2)).toEqual([
      { text: 'AB', box: [10, 80, 74, 144] },
      { text: 'CDE', box: [106, 80, 202, 144] },
    ]);
  });

  it('draws ink only inside the returned boxes', () => {
    const p = new Page(300, 100);
    const boxes = drawText(p, font, 'Hi Bob', 5, 5, 1);
    for (let y = 0; y < p.height; y++) {
      for (let x = 0; x < p.width; x++) {
        if (p.getPixel(x, y) === 1) {
          expect(boxes.some(({ box: [x0, y0, x1, y1] }) => x >= x0 && x < x1 && y >= y0 && y < y1)).toBe(true);
        }
      }
    }
  });

  it('boxes stay in bounds with correct widths (property)', () => {
    const word = fc.stringMatching(/^[!-~]{1,6}$/);
    fc.assert(
      fc.property(
        fc.array(word, { minLength: 1, maxLength: 3 }),
        fc.integer({ min: 1, max: 2 }),
        fc.nat({ max: 100 }),
        fc.nat({ max: 36 }),
        (ws, scale, dx, dy) => {
        const text = ws.join(' ');
        const p = new Page(1000, 100);
        const x = Math.min(dx, p.width - text.length * 16 * scale);
        const y = Math.min(dy, p.height - 32 * scale);
        const boxes = drawText(p, font, text, x, y, scale);
        expect(boxes.map((b) => b.text)).toEqual(ws);
        for (const { text: t, box } of boxes) {
          expect(box[0]).toBeGreaterThanOrEqual(0);
          expect(box[1]).toBeGreaterThanOrEqual(0);
          expect(box[2]).toBeLessThanOrEqual(p.width);
          expect(box[3]).toBeLessThanOrEqual(p.height);
          expect(box[2] - box[0]).toBe(t.length * 16 * scale);
        }
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe('png', () => {
  function plainPage(): Page {
    const p = new Page(1728, 2200);
    drawText(p, font, 'REFERRAL FORM', 100, 100, 2);
    drawText(p, font, 'Patient: Jane Example', 100, 250);
    drawText(p, font, 'Reason: knee pain', 100, 300);
    p.strokeRect(90, 240, 600, 120, 2);
    p.drawLine(90, 400, 700, 420, 2);
    return p;
  }

  it('encodes a 1728x2200 black/white page with SYNTHETIC tag', () => {
    const buf = encodePng(plainPage());
    const img = decodePng(buf);
    expect(img.width).toBe(1728);
    expect(img.height).toBe(2200);
    let black = 0;
    let other = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      const v = img.data[i];
      if (v === 0) black++;
      else if (v !== 255) other++;
    }
    expect(other).toBe(0);
    expect(black).toBeGreaterThan(0);
    const text = readPngText(buf);
    expect(text['Synthetic']).toBe('true');
    expect(text['Comment']).toMatch(/SYNTHETIC/);
  });

  it('is deterministic', () => {
    expect(encodePng(plainPage()).equals(encodePng(plainPage()))).toBe(true);
  });

  it('writes valid CRCs on every chunk', () => {
    const buf = encodePng(plainPage());
    let pos = 8;
    while (pos < buf.length) {
      const len = buf.readUInt32BE(pos);
      const body = buf.subarray(pos + 4, pos + 8 + len);
      expect(buf.readUInt32BE(pos + 8 + len)).toBe(zcrc32(body));
      pos += 12 + len;
    }
  });
});
