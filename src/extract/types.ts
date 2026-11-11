import type { OcrResult } from '../ocr/types.js';
import { ExtractionResultSchema } from './schema.js';
import type { ExtractionResult } from './schema.js';

export interface ExtractionAdapter {
  readonly name: string;
  extract(ocr: OcrResult): Promise<ExtractionResult>;
  close?(): Promise<void>;
}

/** Message is for a front-desk reader. Technical detail goes in `cause`. */
export class ExtractionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ExtractionError';
  }
}

/** Adapters call this before returning, so bad output never leaves them. */
export function parseExtractionResult(input: unknown): ExtractionResult {
  const parsed = ExtractionResultSchema.safeParse(input);
  if (!parsed.success) {
    throw new ExtractionError('The fields could not be read.', { cause: parsed.error });
  }
  return parsed.data;
}
