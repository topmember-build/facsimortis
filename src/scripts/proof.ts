// Gate proof: runs every fixture fax end to end (OCR, extraction, checks) and judges
// the hard gate. Uses the default offline readers and ignores .env, so it works from a
// clean clone. This is the only place that reads truth files.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createExtractor } from '../extract/default.js';
import { createOcrAdapter } from '../ocr/default.js';
import { proveFax, tally } from './proof-core.js';
import type { FaxProof, TruthField } from './proof-core.js';

const ROOT = 'fixtures/faxes';

interface Truth {
  id: string;
  trap: string | null;
  fields: TruthField[];
}

const show = (v: string | null): string => (v === null ? '(empty)' : `"${v}"`);

const pngs: string[] = [];
for (const level of readdirSync(ROOT).sort()) {
  for (const file of readdirSync(join(ROOT, level)).sort()) {
    if (file.endsWith('.png')) pngs.push(join(ROOT, level, file));
  }
}

// Offline readers only, whatever the environment says.
const ocrAdapter = createOcrAdapter({ OCR_PROVIDER: 'local' });
const extractor = createExtractor({ EXTRACT_PROVIDER: 'rules' });
const proofs: FaxProof[] = [];
const gateFailures: string[] = [];

if (pngs.length < 3) gateFailures.push(`Expected three fixture faxes, found ${pngs.length}.`);

try {
  for (const png of pngs) {
    const truth = JSON.parse(readFileSync(png.replace(/\.png$/, '.truth.json'), 'utf8')) as Truth;
    const ocr = await ocrAdapter.recognize(readFileSync(png));
    const result = await extractor.extract(ocr);
    const proof = proveFax(truth.id, truth.trap, truth.fields, result, ocr);
    proofs.push(proof);
    gateFailures.push(...proof.gateFailures);

    console.log(`\n${truth.id}  (${png})  trap: ${truth.trap ?? 'none'}  ocr: ${ocr.engine}  reader: ${extractor.name}`);
    for (const f of proof.fields) {
      console.log(`  ${f.name}: ${f.gateFailures.length === 0 ? 'PASS' : 'FAIL'}  [${f.tier}]`);
      console.log(`    value:    ${show(f.value)}`);
      console.log(`    expected: ${show(f.expected)}`);
      console.log(`    cited:    ${f.wordIds.length === 0 ? '(none)' : `${f.wordIds.join(' ')} = "${f.citedText}"`}`);
      for (const flag of f.flags) console.log(`    flag:     ${flag}`);
      for (const g of f.gateFailures) console.log(`    GATE:     ${g}`);
    }
  }
} finally {
  await ocrAdapter.close?.();
}

const t = tally(proofs);
console.log('\nMeasured (reported, not pass or fail)');
console.log(`  fields:                    ${t.total}`);
console.log(`  exact matches:             ${t.exact} of ${t.total}`);
console.log(`  empty and flagged:         ${t.nullFlagged}`);
console.log(`  wrong but flagged:         ${t.flaggedMisreads}`);
console.log(`  unflagged misreads:        ${t.unflaggedMisreads.length}${t.unflaggedMisreads.length > 0 ? `  (${t.unflaggedMisreads.join(', ')})` : ''}`);
console.log(`  correct but flagged:       ${t.correctButFlagged.length}${t.correctButFlagged.length > 0 ? `  (${t.correctButFlagged.join(', ')})` : ''}`);

console.log('\nHard gate');
if (gateFailures.length === 0) {
  console.log('  PASS');
} else {
  for (const g of gateFailures) console.log(`  FAIL: ${g}`);
  process.exitCode = 1;
}
