/** 1-bit page buffer (1 = black ink) and drawing primitives. */
import { CELL_H, CELL_W, getGlyph } from './font.js';
import type { BitmapFont } from './font.js';

export type Box = [x0: number, y0: number, x1: number, y1: number];

export interface WordBox {
  text: string;
  box: Box;
}

export class Page {
  readonly data: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height);
  }

  getPixel(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.data[y * this.width + x] ?? 0;
  }

  setPixel(x: number, y: number, v: 0 | 1 = 1): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.data[y * this.width + x] = v;
  }

  fillRect(x: number, y: number, w: number, h: number, v: 0 | 1 = 1): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.setPixel(xx, yy, v);
  }

  /** Rectangle outline with the given stroke thickness (drawn inward). */
  strokeRect(x: number, y: number, w: number, h: number, t = 1): void {
    this.fillRect(x, y, w, t);
    this.fillRect(x, y + h - t, w, t);
    this.fillRect(x, y, t, h);
    this.fillRect(x + w - t, y, t, h);
  }

  /** Bresenham line with square pen of size t. */
  drawLine(x0: number, y0: number, x1: number, y1: number, t = 1): void {
    const dx = Math.abs(x1 - x0);
    const sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0);
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      this.fillRect(x, y, t, t);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }
}

/**
 * Draw text with the top-left of the first cell at (x, y). Returns one box per
 * space-separated word. Boxes: x1/y1 exclusive, cell-aligned.
 */
export function drawText(
  page: Page,
  font: BitmapFont,
  text: string,
  x: number,
  y: number,
  scale = 1,
): WordBox[] {
  if (!Number.isInteger(scale) || scale < 1) throw new Error('scale must be a positive integer');
  const words: WordBox[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    const glyph = getGlyph(font, ch);
    const ox = x + i * CELL_W * scale;
    for (let r = 0; r < CELL_H; r++) {
      const row = glyph.rows[r] as Uint8Array;
      for (let c = 0; c < CELL_W; c++) {
        if (row[c] === 1) page.fillRect(ox + c * scale, y + r * scale, scale, scale);
      }
    }
  }
  let start = 0;
  for (const word of text.split(' ')) {
    if (word.length > 0) {
      const x0 = x + start * CELL_W * scale;
      words.push({ text: word, box: [x0, y, x0 + word.length * CELL_W * scale, y + CELL_H * scale] });
    }
    start += word.length + 1;
  }
  return words;
}
