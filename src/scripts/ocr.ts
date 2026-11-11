// Reads one fax with the OCR adapter and prints words with boxes and confidence.
import { readFileSync } from 'node:fs';
import { createOcrAdapter } from '../ocr/default.js';
import { OcrError } from '../ocr/types.js';
import type { OcrAdapter } from '../ocr/types.js';
import { formatOcrTable, parseOcrArgs } from './ocr-format.js';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const parsed = parseOcrArgs(process.argv.slice(2));
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
  const result = await adapter.recognize(image);
  const seconds = (performance.now() - started) / 1000;
  console.log(json ? JSON.stringify(result, null, 2) : formatOcrTable(result, { file: path, seconds }));
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
