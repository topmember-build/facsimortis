import { OcrError } from './types.js';
import type { OcrAdapter, OcrResult } from './types.js';

/** Stub for a cloud OCR service. Makes no network call. */
export class CloudOcrAdapter implements OcrAdapter {
  readonly name = 'cloud';
  readonly #apiKey: string | undefined;

  constructor(options: { apiKey?: string } = {}) {
    this.#apiKey = options.apiKey;
  }

  recognize(): Promise<OcrResult> {
    return Promise.reject(
      new OcrError('Cloud OCR is not set up in this demo. Use the local reader.', {
        cause: new Error(
          this.#apiKey ? 'Cloud OCR adapter is a stub.' : 'Cloud OCR adapter is a stub; no API key set.',
        ),
      }),
    );
  }
}
