import type { Box } from '../generator/raster.js';

export type { Box };

/** One word read from the page. */
export interface OcrWord {
  /** Stable ID in reading order, "o0001", "o0002", ... Highlights use this only. */
  id: string;
  text: string;
  /** Pixel coordinates of the input image: [x0, y0, x1, y1], x1/y1 exclusive. */
  box: Box;
  /** 0..1 */
  confidence: number;
}

export interface OcrResult {
  words: OcrWord[];
  width: number;
  height: number;
  /** Which engine produced this result, e.g. "tesseract". */
  engine: string;
}

export interface OcrAdapter {
  readonly name: string;
  recognize(image: Buffer): Promise<OcrResult>;
  close?(): Promise<void>;
}

/** Message is for a front-desk reader. Technical detail goes in `cause`. */
export class OcrError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OcrError';
  }
}
