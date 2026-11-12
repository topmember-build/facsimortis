// Reads one fax (OCR), extracts the seven fields, and prints them with cited word IDs, confidence and flags.
import { existsSync, readFileSync } from 'node:fs';
import { createExtractor } from '../extract/default.js';
import { createOcrAdapter } from '../ocr/default.js';
import { OcrError } from '../ocr/types.js';
import type { OcrAdapter } from '../ocr/types.js';
import { formatExtractTable, parseExtractArgs } from './extract-format.js';

// .env is optional: the rule-based and recorded readers need none.
if (existsSync('.env')) process.loadEnvFile('.env');

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const parsed = parseExtractArgs(process.argv.slice(2));
if (!parsed.ok) fail(parsed.message);
const { path, json } = parsed.args;

let image: Buffer;
try {
  image = readFileSync(path);
} catch {
  fail(`Cannot read the fax file "${path}". Check the path and try again.`);
}

let adapter: OcrAdapter | undefined;
let failure: string | undefined;
try {
  adapter = createOcrAdapter();
  const started = performance.now();
  const ocr = await adapter.recognize(image);
  const result = await createExtractor().extract(ocr);
  const seconds = (performance.now() - started) / 1000;
  console.log(
    json ? JSON.stringify(result, null, 2) : formatExtractTable(result, { file: path, ocrEngine: ocr.engine, seconds }),
  );
} catch (err) {
  if (err instanceof OcrError) {
    failure = err.message;
    if (err.cause instanceof Error) failure += `\nDetail: ${err.cause.message}`;
  } else {
    failure = `The fax could not be read: ${err instanceof Error ? err.message : String(err)}`;
  }
} finally {
  await adapter?.close?.();
}
if (failure !== undefined) fail(failure);
