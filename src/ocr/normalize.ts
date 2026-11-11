import type { Box, OcrWord } from './types.js';

/** Pure helpers. No I/O. */

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Drop empty words, put the rest in reading order (lines top to bottom, words
 * left to right) and give them IDs "o0001", "o0002", ...
 * Words share a line when their vertical centres are within half the median
 * word height.
 */
export function assignWordIds(words: Array<Omit<OcrWord, 'id'>>): OcrWord[] {
  const kept = words.filter((w) => w.text.trim() !== '');
  if (kept.length === 0) return [];

  const centreY = (w: Omit<OcrWord, 'id'>): number => (w.box[1] + w.box[3]) / 2;
  const tolerance = median(kept.map((w) => w.box[3] - w.box[1])) / 2;

  const byY = [...kept].sort((a, b) => centreY(a) - centreY(b) || a.box[0] - b.box[0]);
  const lines: Array<Array<Omit<OcrWord, 'id'>>> = [];
  let lineStart = Number.NaN;
  for (const w of byY) {
    const cy = centreY(w);
    const current = lines[lines.length - 1];
    if (current === undefined || cy - lineStart > tolerance) {
      lines.push([w]);
      lineStart = cy;
    } else {
      current.push(w);
    }
  }

  const ordered = lines.flatMap((line) => line.sort((a, b) => a.box[0] - b.box[0]));
  return ordered.map((w, i) => ({
    id: `o${String(i + 1).padStart(4, '0')}`,
    text: w.text,
    box: w.box,
    confidence: w.confidence,
  }));
}

/** Keep a box inside the page and ordered (x0 <= x1, y0 <= y1). */
export function clampBox(box: Box, width: number, height: number): Box {
  const cx = (v: number): number => Math.min(Math.max(v, 0), width);
  const cy = (v: number): number => Math.min(Math.max(v, 0), height);
  const [ax, ay, bx, by] = box;
  const x0 = cx(Math.min(ax, bx));
  const x1 = cx(Math.max(ax, bx));
  const y0 = cy(Math.min(ay, by));
  const y1 = cy(Math.max(ay, by));
  return [x0, y0, x1, y1];
}

/** Map a raw engine confidence (0..100 or 0..1) to 0..1. Non-finite becomes 0. */
export function normalizeConfidence(raw: number, scale: 100 | 1): number {
  if (!Number.isFinite(raw)) return 0;
  return Math.min(Math.max(raw / scale, 0), 1);
}
