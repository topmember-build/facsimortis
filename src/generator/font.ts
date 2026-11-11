/** Spleen BDF parser. parseBdf is pure; loadSpleen isolates the file read. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CELL_W = 16;
export const CELL_H = 32;

export interface Glyph {
  /** CELL_H rows, each CELL_W entries of 0/1, already positioned on the baseline. */
  rows: Uint8Array[];
}

export interface BitmapFont {
  cellWidth: number;
  cellHeight: number;
  glyphs: Map<number, Glyph>;
}

export function parseBdf(text: string): BitmapFont {
  const lines = text.split(/\r?\n/);
  let ascent = 26;
  let fbbYOff = -6;
  const glyphs = new Map<number, Glyph>();

  let i = 0;
  while (i < lines.length) {
    const line = (lines[i] ?? '').trim();
    i++;
    if (line.startsWith('FONT_ASCENT ')) {
      ascent = Number(line.split(/\s+/)[1]);
    } else if (line.startsWith('FONTBOUNDINGBOX ')) {
      fbbYOff = Number(line.split(/\s+/)[4]);
    } else if (line.startsWith('STARTCHAR')) {
      let encoding = -1;
      let bw = 0;
      let bh = 0;
      let bx = 0;
      let by = 0;
      const bitmap: string[] = [];
      while (i < lines.length) {
        const l = (lines[i] ?? '').trim();
        i++;
        if (l.startsWith('ENCODING ')) encoding = Number(l.split(/\s+/)[1]);
        else if (l.startsWith('BBX ')) {
          const p = l.split(/\s+/).map(Number);
          bw = p[1] ?? 0;
          bh = p[2] ?? 0;
          bx = p[3] ?? 0;
          by = p[4] ?? 0;
        } else if (l === 'BITMAP') {
          while (i < lines.length && (lines[i] ?? '').trim() !== 'ENDCHAR') {
            bitmap.push((lines[i] ?? '').trim());
            i++;
          }
        } else if (l === 'ENDCHAR') break;
      }
      if (encoding < 0) continue;
      const rows: Uint8Array[] = Array.from({ length: CELL_H }, () => new Uint8Array(CELL_W));
      // Baseline row index within the cell: ascent from the top (fbbYOff + CELL_H == ascent here).
      const baseline = ascent;
      void fbbYOff;
      const top = baseline - (by + bh);
      for (let r = 0; r < bh; r++) {
        const hex = bitmap[r] ?? '';
        const bits = BigInt('0x' + (hex === '' ? '0' : hex));
        const totalBits = hex.length * 4;
        for (let c = 0; c < bw; c++) {
          const on = (bits >> BigInt(totalBits - 1 - c)) & 1n;
          const cy = top + r;
          const cx = bx + c;
          if (on === 1n && cy >= 0 && cy < CELL_H && cx >= 0 && cx < CELL_W) {
            (rows[cy] as Uint8Array)[cx] = 1;
          }
        }
      }
      glyphs.set(encoding, { rows });
    }
  }
  return { cellWidth: CELL_W, cellHeight: CELL_H, glyphs };
}

let cached: BitmapFont | undefined;

export function loadSpleen(): BitmapFont {
  if (!cached) {
    const path = fileURLToPath(new URL('../../assets/fonts/spleen-16x32.bdf', import.meta.url));
    cached = parseBdf(readFileSync(path, 'utf8'));
  }
  return cached;
}

export function getGlyph(font: BitmapFont, ch: string): Glyph {
  const code = ch.codePointAt(0) ?? -1;
  const g = font.glyphs.get(code);
  if (!g) throw new Error(`No glyph for character ${JSON.stringify(ch)} (U+${code.toString(16)})`);
  return g;
}
