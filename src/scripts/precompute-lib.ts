import { REFERENCE_DATE } from '../generator/data.js';
import type { ExtractionResult } from '../extract/schema.js';
import type { ExtractionAdapter } from '../extract/types.js';
import type { OcrResult } from '../ocr/types.js';
import {
  NO_SAVED_ANSWER_MESSAGE,
  SAMPLE_DATA_VERSION,
  SampleFaxSchema,
  SampleIndexSchema,
} from '../samples/schema.js';
import type { ReaderResult, SampleFax, SampleIndex } from '../samples/schema.js';

/** Where the site loads its data from. */
export const OUTPUT_DIR = 'web/public/samples';

/** Files the script owns in the output folder (it may delete stale ones). */
export const OWNED_FILE = /\.(png|json)$/;

/** Demo clock: first fax arrives at 09:00 on the reference date, then one every 7 minutes. */
export const FIRST_RECEIVED_MINUTES = 9 * 60;
export const RECEIVED_STEP_MINUTES = 7;

/** A demo value derived from the reference date and the fax's place in the order. Not read from any fax. */
export function receivedAt(index: number, referenceDate: string = REFERENCE_DATE): string {
  const total = FIRST_RECEIVED_MINUTES + index * RECEIVED_STEP_MINUTES;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${referenceDate}T${hh}:${mm}:00`;
}

/** JSON with sorted keys, 2-space indent, LF line ends and one trailing newline. */
export function serialize(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

export function okReader(result: ExtractionResult): ReaderResult {
  return { status: 'ok', engine: result.engine, fields: result.fields };
}

export function noSavedAnswer(): ReaderResult {
  return { status: 'no-saved-answer', message: NO_SAVED_ANSWER_MESSAGE };
}

export interface Readers {
  /** Rule-based reader, wrapped with the central checks. */
  rules: ExtractionAdapter;
  /** Saved-answer reader, wrapped with the central checks. */
  recorded: ExtractionAdapter;
  /** True when a saved model answer exists for these OCR words. */
  hasSavedAnswer: (ocr: OcrResult) => Promise<boolean>;
}

/** Runs both offline readers. A fax with no saved model answer gets the plain entry instead of an error. */
export async function readBoth(
  ocr: OcrResult,
  readers: Readers,
): Promise<{ model: ReaderResult; rules: ReaderResult }> {
  const rules = okReader(await readers.rules.extract(ocr));
  if (!(await readers.hasSavedAnswer(ocr))) return { model: noSavedAnswer(), rules };
  return { model: okReader(await readers.recorded.extract(ocr)), rules };
}

export interface FaxInput {
  /** File name without extension, e.g. "fax-0001". */
  id: string;
  /** Folder name under fixtures/faxes, e.g. "L1". */
  level: string;
  png: Uint8Array;
  ocr: OcrResult;
  model: ReaderResult;
  rules: ReaderResult;
}

export function buildFax(input: FaxInput): SampleFax {
  return SampleFaxSchema.parse({
    id: input.id,
    level: input.level,
    image: `${input.id}.png`,
    width: input.ocr.width,
    height: input.ocr.height,
    ocr: {
      engine: input.ocr.engine,
      words: input.ocr.words.map((w) => ({ id: w.id, text: w.text, box: w.box, confidence: w.confidence })),
    },
    readers: { model: input.model, rules: input.rules },
  });
}

export function buildIndex(
  faxes: Pick<FaxInput, 'id' | 'level'>[],
  referenceDate: string = REFERENCE_DATE,
): SampleIndex {
  return SampleIndexSchema.parse({
    version: SAMPLE_DATA_VERSION,
    referenceDate,
    faxes: faxes.map((f, i) => ({
      id: f.id,
      level: f.level,
      image: `${f.id}.png`,
      data: `${f.id}.json`,
      receivedAt: receivedAt(i, referenceDate),
    })),
  });
}

/** Every file the site loads: relative path -> bytes. The PNG is copied byte for byte. */
export function planOutputs(inputs: FaxInput[]): Map<string, Uint8Array> {
  const ids = new Set<string>();
  for (const f of inputs) {
    if (ids.has(f.id)) throw new Error(`Two faxes share the name ${f.id}.`);
    ids.add(f.id);
  }
  const text = (value: unknown): Uint8Array => Buffer.from(serialize(value), 'utf8');
  const files = new Map<string, Uint8Array>();
  files.set('index.json', text(buildIndex(inputs)));
  for (const f of inputs) {
    files.set(`${f.id}.png`, f.png);
    files.set(`${f.id}.json`, text(buildFax(f)));
  }
  return files;
}

export interface Comparison {
  missing: string[];
  changed: string[];
  extra: string[];
}

const same = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));

/** Compares what the script would write with what is on disk. Each list is sorted. */
export function compareOutputs(expected: Map<string, Uint8Array>, actual: Map<string, Uint8Array>): Comparison {
  const missing: string[] = [];
  const changed: string[] = [];
  for (const [path, bytes] of expected) {
    const have = actual.get(path);
    if (have === undefined) missing.push(path);
    else if (!same(have, bytes)) changed.push(path);
  }
  const extra = [...actual.keys()].filter((p) => !expected.has(p));
  return { missing: missing.sort(), changed: changed.sort(), extra: extra.sort() };
}

export function isUpToDate(c: Comparison): boolean {
  return c.missing.length === 0 && c.changed.length === 0 && c.extra.length === 0;
}

/** Plain message for the --check failure. */
export function describeDifferences(c: Comparison): string {
  const lines = [`The sample data in ${OUTPUT_DIR} is out of date. Run "npm run precompute" and commit the result.`];
  for (const p of c.missing) lines.push(`  missing: ${p}`);
  for (const p of c.changed) lines.push(`  changed: ${p}`);
  for (const p of c.extra) lines.push(`  extra:   ${p}`);
  return lines.join('\n');
}
