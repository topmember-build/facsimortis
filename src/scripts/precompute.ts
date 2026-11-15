// Precompute the sample data the static site loads. Offline: local OCR, the rule-based
// reader and the saved model answers. No network, no live model, no .env, and the
// answer-key files next to each fax are never read (see read-guard.ts).
//
//   npm run precompute              write web/public/samples/
//   npm run precompute -- --check   exit 1 if the committed data is out of date
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createExtractor } from '../extract/default.js';
import { RecordedResponseCache } from '../extract/recorded.js';
import { REFERENCE_DATE } from '../generator/data.js';
import { createOcrAdapter } from '../ocr/default.js';
import { OUTPUT_DIR, OWNED_FILE, compareOutputs, describeDifferences, isUpToDate, planOutputs, readBoth } from './precompute-lib.js';
import type { FaxInput } from './precompute-lib.js';
import { readInput } from './read-guard.js';

const FAXES_DIR = 'fixtures/faxes';

const args = process.argv.slice(2);
const check = args.length === 1 && args[0] === '--check';
if (args.length > 0 && !check) {
  console.error(`Unknown option: ${args.join(' ')}. The only option is --check.`);
  process.exit(2);
}

// Nothing here may reach the network. Block fetch and count attempts.
let networkAttempts = 0;
globalThis.fetch = (() => {
  networkAttempts++;
  return Promise.reject(new Error('Precompute blocks the network.'));
}) as typeof fetch;

const pngs: Array<{ level: string; id: string; path: string }> = [];
for (const level of readdirSync(FAXES_DIR).sort()) {
  for (const file of readdirSync(join(FAXES_DIR, level)).sort()) {
    if (file.endsWith('.png')) pngs.push({ level, id: file.slice(0, -4), path: join(FAXES_DIR, level, file) });
  }
}
if (pngs.length === 0) {
  console.error(`No faxes found in ${FAXES_DIR}.`);
  process.exit(1);
}

// Offline readers only, whatever the environment says. The date of birth check uses
// the generator's reference date as "today".
const cache = new RecordedResponseCache();
const readers = {
  rules: createExtractor({ EXTRACT_PROVIDER: 'rules' }, { today: REFERENCE_DATE }),
  recorded: createExtractor({ EXTRACT_PROVIDER: 'recorded' }, { today: REFERENCE_DATE }),
  hasSavedAnswer: async (ocr: Parameters<typeof cache.get>[0]) => (await cache.get(ocr)) !== undefined,
};

const ocrAdapter = createOcrAdapter({ OCR_PROVIDER: 'local' });
const inputs: FaxInput[] = [];
try {
  for (const p of pngs) {
    const png = readInput(p.path);
    const ocr = await ocrAdapter.recognize(png);
    const { model, rules } = await readBoth(ocr, readers);
    inputs.push({ id: p.id, level: p.level, png, ocr, model, rules });
  }
} finally {
  await ocrAdapter.close?.();
}

if (networkAttempts > 0) {
  console.error(`Precompute tried to use the network ${networkAttempts} times. Nothing was written.`);
  process.exit(1);
}

const expected = planOutputs(inputs);

function readOwnedFiles(): Map<string, Uint8Array> {
  const found = new Map<string, Uint8Array>();
  if (!existsSync(OUTPUT_DIR)) return found;
  for (const name of readdirSync(OUTPUT_DIR)) {
    if (OWNED_FILE.test(name)) found.set(name, readInput(join(OUTPUT_DIR, name)));
  }
  return found;
}

if (check) {
  const diff = compareOutputs(expected, readOwnedFiles());
  if (isUpToDate(diff)) {
    console.log(`The sample data in ${OUTPUT_DIR} is up to date (${expected.size} files).`);
  } else {
    console.error(describeDifferences(diff));
    process.exitCode = 1;
  }
} else {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const name of readdirSync(OUTPUT_DIR)) {
    if (OWNED_FILE.test(name) && !expected.has(name)) {
      rmSync(join(OUTPUT_DIR, name));
      console.log(`removed stale file: ${name}`);
    }
  }
  for (const [name, bytes] of expected) writeFileSync(join(OUTPUT_DIR, name), bytes);
  console.log(`Wrote ${expected.size} files to ${OUTPUT_DIR}.`);
}
