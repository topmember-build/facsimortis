import type { SampleWord } from '../../src/samples/schema.js';

/** One source-ghost rectangle in IMAGE coordinates (pixels of the fax PNG). */
export interface GhostRect {
  /** The OCR word this rectangle covers. */
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The rectangles for a field's source ghost. Looked up by word ID only, in citation
 * order, one per cited ID. An ID that is not on the page draws nothing. No field, or a
 * field with no words, has no ghost.
 *
 * The OCR box is [x0, y0, x1, y1] with x1/y1 exclusive, so x = x0, y = y0,
 * width = x1 - x0 and height = y1 - y0.
 */
export function ghostRects(
  field: { readonly wordIds: readonly string[] } | null | undefined,
  words: readonly SampleWord[],
): GhostRect[] {
  if (!field) return [];
  const byId = new Map<string, SampleWord>();
  for (const word of words) {
    if (!byId.has(word.id)) byId.set(word.id, word);
  }
  const rects: GhostRect[] = [];
  for (const id of field.wordIds) {
    const word = byId.get(id);
    if (!word) continue;
    const [x0, y0, x1, y1] = word.box;
    rects.push({ id, x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) });
  }
  return rects;
}
