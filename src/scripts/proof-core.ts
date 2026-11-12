// Pure judging for `npm run proof`. No I/O. The proof script reads the truth files
// and passes them in; nothing under src/ extraction code ever sees truth.
import type { OcrResult } from '../ocr/types.js';
import type { ExtractionResult, Field } from '../extract/schema.js';

export interface TruthField {
  name: string;
  value: string | null;
}

export interface FieldProof {
  name: string;
  value: string | null;
  expected: string | null;
  wordIds: string[];
  citedText: string;
  flags: string[];
  /** Hard-gate problems for this field. Empty means the field passes. */
  gateFailures: string[];
  /** Measured tier, reported but never pass or fail. */
  tier: 'exact' | 'null-flagged' | 'unflagged-misread' | 'flagged-misread';
  /** Value equals the expected value but carries a flag. */
  correctButFlagged: boolean;
}

export interface FaxProof {
  fax: string;
  trap: string | null;
  fields: FieldProof[];
  gateFailures: string[];
}

/** Judge one field against the OCR words (gate) and truth (measure). */
export function proveField(field: Field, expected: string | null, ocr: OcrResult): FieldProof {
  const words = new Map(ocr.words.map((w) => [w.id, w.text]));
  const failures: string[] = [];
  const cited = field.wordIds.map((id) => words.get(id));
  const citedText = cited.map((t) => t ?? '?').join(' ');

  if (field.value !== null) {
    if (field.wordIds.length === 0) failures.push('has a value but cites no words');
    for (const id of field.wordIds) {
      if (!words.has(id)) failures.push(`cites ${id}, which is not an OCR word`);
    }
    if (cited.every((t) => t !== undefined) && field.wordIds.length > 0) {
      if (!citedText.includes(field.value)) {
        failures.push(`value "${field.value}" is not contained in cited words "${citedText}"`);
      }
      const citedTokens = new Set((cited as string[]).flatMap((t) => t.split(/\s+/)));
      const stray = field.value.split(/\s+/).filter((t) => t !== '' && !citedTokens.has(t));
      if (stray.length > 0) failures.push(`value has text not on the page: ${stray.join(' ')}`);
    }
  } else {
    if (field.wordIds.length > 0) failures.push('is empty but still cites words');
    if (field.flags.length === 0 || field.flags.every((f) => f.trim() === '')) {
      failures.push('is empty but has no plain reason flag');
    }
  }

  const flagged = field.flags.length > 0;
  let tier: FieldProof['tier'];
  if (field.value === null) tier = 'null-flagged';
  else if (field.value === expected) tier = 'exact';
  else tier = flagged ? 'flagged-misread' : 'unflagged-misread';

  return {
    name: field.name,
    value: field.value,
    expected,
    wordIds: field.wordIds,
    citedText,
    flags: field.flags,
    gateFailures: failures,
    tier,
    correctButFlagged: field.value !== null && field.value === expected && flagged,
  };
}

export function proveFax(
  fax: string,
  trap: string | null,
  truthFields: TruthField[],
  result: ExtractionResult,
  ocr: OcrResult,
): FaxProof {
  const expectedByName = new Map(truthFields.map((f) => [f.name, f.value]));
  const fields = result.fields.map((f) => proveField(f, expectedByName.get(f.name) ?? null, ocr));
  const gateFailures: string[] = [];
  for (const f of fields) for (const g of f.gateFailures) gateFailures.push(`${fax} ${f.name}: ${g}`);
  if (trap === 'bad-npi') {
    const npi = fields.find((f) => f.name === 'npi');
    if (npi === undefined || npi.flags.length === 0) {
      gateFailures.push(`${fax} npi: the bad-npi fax is not flagged for its provider number`);
    }
  }
  return { fax, trap, fields, gateFailures };
}

export interface Tally {
  total: number;
  exact: number;
  nullFlagged: number;
  flaggedMisreads: number;
  unflaggedMisreads: string[];
  correctButFlagged: string[];
}

export function tally(proofs: FaxProof[]): Tally {
  const t: Tally = {
    total: 0,
    exact: 0,
    nullFlagged: 0,
    flaggedMisreads: 0,
    unflaggedMisreads: [],
    correctButFlagged: [],
  };
  for (const p of proofs) {
    for (const f of p.fields) {
      t.total += 1;
      if (f.tier === 'exact') t.exact += 1;
      else if (f.tier === 'null-flagged') t.nullFlagged += 1;
      else if (f.tier === 'flagged-misread') t.flaggedMisreads += 1;
      else t.unflaggedMisreads.push(`${p.fax} ${f.name}`);
      if (f.correctButFlagged) t.correctButFlagged.push(`${p.fax} ${f.name}`);
    }
  }
  return t;
}
