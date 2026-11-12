import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { OcrResult } from '../ocr/types.js';
import { ExtractionError } from './types.js';

/** Where recorded model responses live by default. */
export const DEFAULT_RECORDED_DIR = fileURLToPath(
  new URL('../../fixtures/extract/', import.meta.url),
);

/**
 * Stable key for a page: SHA-256 of the OCR words (id, text, box).
 * Same words give the same key; any changed word gives a new one.
 * Confidence and engine name are left out so the key tracks what the model sees.
 */
export function ocrWordsKey(ocr: OcrResult): string {
  const canonical = JSON.stringify(ocr.words.map((w) => [w.id, w.text, w.box]));
  return createHash('sha256').update(canonical).digest('hex');
}

const KEY_PATTERN = /^[0-9a-f]{64}$/;

/** One recorded reply: the raw text the model returned, parsed later (0.7.2). */
export const RecordedResponseSchema = z.strictObject({
  key: z.string().regex(KEY_PATTERN),
  model: z.string().min(1),
  text: z.string(),
});
export type RecordedResponse = z.infer<typeof RecordedResponseSchema>;

/** File-per-key store of model responses, so the demo runs offline. */
export class RecordedResponseCache {
  readonly #dir: string;

  constructor(dir: string = DEFAULT_RECORDED_DIR) {
    this.#dir = dir;
  }

  #path(key: string): string {
    return join(this.#dir, `${key}.json`);
  }

  /** Returns undefined when nothing is recorded for these words. */
  async get(ocr: OcrResult): Promise<RecordedResponse | undefined> {
    const key = ocrWordsKey(ocr);
    let raw: string;
    try {
      raw = await readFile(this.#path(key), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new ExtractionError('The saved answer could not be read.', { cause: err });
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      throw new ExtractionError('The saved answer is damaged.', { cause: err });
    }
    const parsed = RecordedResponseSchema.safeParse(json);
    if (!parsed.success || parsed.data.key !== key) {
      throw new ExtractionError('The saved answer is damaged.', {
        cause: parsed.success ? new Error('Key mismatch.') : parsed.error,
      });
    }
    return parsed.data;
  }

  /** Writes the response under the hash of the OCR words. */
  async put(ocr: OcrResult, response: { model: string; text: string }): Promise<RecordedResponse> {
    const record = RecordedResponseSchema.parse({
      key: ocrWordsKey(ocr),
      model: response.model,
      text: response.text,
    });
    await mkdir(this.#dir, { recursive: true });
    await writeFile(this.#path(record.key), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    return record;
  }
}
