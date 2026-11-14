// Live-call script. YOU run this; it calls the Gemini API once per fax and saves the replies
// under fixtures/extract/ so the demo can run offline later. It never prints the key.
import { existsSync, readFileSync } from 'node:fs';
import { GeminiClient, thinkingLevelFrom } from '../extract/gemini.js';
import { RecordedResponseCache } from '../extract/recorded.js';
import { createOcrAdapter } from '../ocr/default.js';
import type { OcrAdapter } from '../ocr/types.js';
import { formatExtractTable } from './extract-format.js';
import { findFaxPngs, formatTimings, recordFax, redactKey } from './record-live-lib.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const key = process.env['EXTRACT_API_KEY'];
if (!key?.trim()) {
  console.error('EXTRACT_API_KEY is not set. Add it to .env (see .env.example) and run again.');
  process.exit(1);
}

let thinkingLevel: string | undefined;
try {
  thinkingLevel = thinkingLevelFrom(process.env);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const paths = process.argv.slice(2);
const faxes = paths.length > 0 ? paths : findFaxPngs('fixtures/faxes');
const client = new GeminiClient();
const cache = new RecordedResponseCache();
console.log(`Model: ${process.env['EXTRACT_MODEL']?.trim() || '(default)'}`);
console.log(`Thinking level: ${thinkingLevel ?? '(model default, not sent)'}`);
console.log(`Faxes: ${faxes.length}. One live call each (a second only if the first answer is unusable).`);

let adapter: OcrAdapter | undefined;
let failures = 0;
try {
  adapter = createOcrAdapter();
  for (const path of faxes) {
    try {
      const started = performance.now();
      const ocr = await adapter.recognize(readFileSync(path));
      const ocrSeconds = (performance.now() - started) / 1000;
      const outcome = await recordFax(ocr, (req) => client.generate(req), cache);
      const seconds = (performance.now() - started) / 1000;
      console.log('');
      console.log(formatExtractTable(outcome.result, { file: path, ocrEngine: ocr.engine, seconds }));
      console.log(formatTimings(ocrSeconds, outcome.modelSeconds));
      console.log(`Live calls: ${outcome.calls}. ${outcome.saved ? 'Answer saved.' : 'No usable answer, nothing saved.'}`);
      if (!outcome.saved) failures++;
    } catch (err) {
      failures++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\n${path}: ${redactKey(message, key)}`);
    }
  }
} finally {
  await adapter?.close?.();
}
if (failures > 0) {
  console.error(`\n${failures} of ${faxes.length} faxes were not saved.`);
  process.exit(1);
}
console.log(`\nSaved answers for ${faxes.length} faxes in fixtures/extract/.`);
