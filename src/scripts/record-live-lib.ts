// Logic for the live-call script, kept apart from the CLI so it can be tested with no network.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { GeminiReply, GeminiRequest } from '../extract/gemini.js';
import { ModelExtractor, checkReply } from '../extract/model.js';
import type { RecordedResponseCache } from '../extract/recorded.js';
import type { ExtractionResult } from '../extract/schema.js';
import type { OcrResult } from '../ocr/types.js';

export type Generate = (request: GeminiRequest) => Promise<GeminiReply>;

export interface RecordOutcome {
  result: ExtractionResult;
  /** Live calls made for this fax (1, or 2 when the first reply was unusable). */
  calls: number;
  /** True when a usable reply was saved. */
  saved: boolean;
  /** Seconds spent inside each generate() call, in call order. Excludes OCR and checks. */
  modelSeconds: number[];
}

/**
 * Reads one fax with the live model and saves the usable reply under the hash of
 * its OCR words. An unusable reply is never saved, so the offline fallback only
 * ever holds answers that passed the same checks as a live run.
 */
export async function recordFax(
  ocr: OcrResult,
  generate: Generate,
  cache: RecordedResponseCache,
): Promise<RecordOutcome> {
  let calls = 0;
  let saved = false;
  const modelSeconds: number[] = [];
  const extractor = new ModelExtractor(async (page, request) => {
    calls++;
    const started = performance.now();
    let reply: GeminiReply;
    try {
      reply = await generate(request);
    } finally {
      modelSeconds.push((performance.now() - started) / 1000);
    }
    if (checkReply(reply.text, page).ok) {
      await cache.put(page, reply);
      saved = true;
    }
    return reply;
  });
  const result = await extractor.extract(ocr);
  return { result, calls, saved, modelSeconds };
}

/** One line with OCR time and model time, e.g. "OCR 2.1 s. Model 4.3 s (2 calls: 1.9 s, 2.4 s)." Pure. */
export function formatTimings(ocrSeconds: number, modelSeconds: readonly number[]): string {
  const s = (x: number): string => `${x.toFixed(1)} s`;
  const total = modelSeconds.reduce((a, b) => a + b, 0);
  const model =
    modelSeconds.length <= 1
      ? `Model ${s(total)}.`
      : `Model ${s(total)} (${modelSeconds.length} calls: ${modelSeconds.map(s).join(', ')}).`;
  return `OCR ${s(ocrSeconds)}. ${model}`;
}

/** Removes the key from any text before it is printed. Pure. */
export function redactKey(text: string, key: string | undefined): string {
  const k = key?.trim();
  return k ? text.split(k).join('[key hidden]') : text;
}

/** All fax PNGs under a folder, sorted, so one run covers every fixture. */
export function findFaxPngs(dir: string): string[] {
  const found: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.png')) found.push(full);
    }
  };
  walk(dir);
  return found.sort();
}
