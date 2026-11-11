import { fileURLToPath } from 'node:url';
import Tesseract from 'tesseract.js';
import { decodePng } from '../generator/png.js';
import { assignWordIds, clampBox, normalizeConfidence } from './normalize.js';
import { OcrError } from './types.js';
import type { OcrAdapter, OcrResult, OcrWord } from './types.js';

/**
 * Local reader built on Tesseract.js. Works offline:
 * - the language file comes from assets/tessdata (resolved from this file, not cwd)
 * - cacheMethod "none" means nothing is read from or written to a cache
 * - the worker and wasm core load from node_modules (the Node default)
 *
 * Box convention: Tesseract's bbox is { x0, y0, x1, y1 } where x1/y1 are the
 * right/bottom edges (left + width), so they are already exclusive and match
 * our OcrWord.box with no adjustment.
 */

/** Absolute path of assets/tessdata, independent of the working directory. */
export const TESSDATA_DIR = fileURLToPath(new URL('../../assets/tessdata', import.meta.url));

/** Tesseract page segmentation modes used here (values from the installed typings). */
export type PageSegMode = '3' | '6' | '11';

export interface LocalOcrOptions {
  /** Page segmentation mode. Default "3" (auto layout), see DEFAULT_PSM. */
  psm?: PageSegMode;
}

/**
 * Measured on fax-0001 (47 words, 17 field-value words), exact-text matches:
 *   PSM 3  (auto layout):  35/47 all, 13/17 field values, 42 boxes matched
 *   PSM 6  (single block): 34/47 all, 14/17 field values, drops the heading words
 *   PSM 11 (sparse text):  34/47 all, 13/17 field values
 * PSM 3 has the best overall rate and keeps every word on the page, so it is the default.
 */
export const DEFAULT_PSM: PageSegMode = '3';

// tesseract.js is CommonJS with `export =`; under NodeNext the default import is the namespace.
type TessWorker = Tesseract.Worker;

/** OEM.LSTM_ONLY. The typings declare OEM as a non-const enum, so use the numeric value. */
const OEM_LSTM_ONLY = 1 as unknown as Tesseract.OEM;

export class LocalOcrAdapter implements OcrAdapter {
  readonly name = 'local';
  private readonly psm: PageSegMode;
  private workerPromise: Promise<TessWorker> | undefined;

  constructor(options: LocalOcrOptions = {}) {
    this.psm = options.psm ?? DEFAULT_PSM;
  }

  private getWorker(): Promise<TessWorker> {
    if (this.workerPromise === undefined) {
      const created = (async (): Promise<TessWorker> => {
        const worker = await Tesseract.createWorker('eng', OEM_LSTM_ONLY, {
          langPath: TESSDATA_DIR,
          gzip: false,
          cacheMethod: 'none',
        });
        try {
          await worker.setParameters({
            tessedit_pageseg_mode: this.psm as unknown as Tesseract.PSM,
          });
        } catch (err) {
          await worker.terminate().catch(() => undefined);
          throw err;
        }
        return worker;
      })();
      // If creation fails, allow a later call to try again.
      created.catch(() => {
        this.workerPromise = undefined;
      });
      this.workerPromise = created;
    }
    return this.workerPromise;
  }

  async recognize(image: Buffer): Promise<OcrResult> {
    let size: { width: number; height: number };
    try {
      const { width, height } = decodePng(image);
      size = { width, height };
    } catch (cause) {
      throw new OcrError('The page could not be read.', { cause });
    }

    try {
      const worker = await this.getWorker();
      const { data } = await worker.recognize(image, {}, { blocks: true });
      const raw: Array<Omit<OcrWord, 'id'>> = [];
      for (const block of data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            for (const word of line.words) {
              raw.push({
                text: word.text.trim(),
                box: clampBox(
                  [word.bbox.x0, word.bbox.y0, word.bbox.x1, word.bbox.y1],
                  size.width,
                  size.height,
                ),
                confidence: normalizeConfidence(word.confidence, 100),
              });
            }
          }
        }
      }
      return {
        words: assignWordIds(raw),
        width: size.width,
        height: size.height,
        engine: this.name,
      };
    } catch (cause) {
      if (cause instanceof OcrError) throw cause;
      throw new OcrError('The page could not be read.', { cause });
    }
  }

  async close(): Promise<void> {
    const pending = this.workerPromise;
    this.workerPromise = undefined;
    if (pending === undefined) return;
    try {
      const worker = await pending;
      await worker.terminate();
    } catch {
      // Nothing to clean up if the worker never started.
    }
  }
}
