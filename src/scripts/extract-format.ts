// Pure helpers for the extract CLI: argument parsing and table output. No I/O.
import { parseArgs } from 'node:util';
import { PLAIN_FIELD_NAMES } from '../extract/rules.js';
import { FIELD_ORDER } from '../extract/schema.js';
import type { ExtractionResult } from '../extract/schema.js';

export const DEFAULT_FAX = 'fixtures/faxes/L1/fax-0001.png';

const USAGE = 'Usage: npm run extract -- [--json] [path-to-png]';

export interface ExtractCliArgs {
  path: string;
  json: boolean;
}

export type ParseResult = { ok: true; args: ExtractCliArgs } | { ok: false; message: string };

export function parseExtractArgs(argv: string[]): ParseResult {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { json: { type: 'boolean' } },
      allowPositionals: true,
    });
  } catch {
    return { ok: false, message: `Unknown option. ${USAGE}` };
  }
  if (parsed.positionals.length > 1) {
    return { ok: false, message: `Give one fax at a time. ${USAGE}` };
  }
  return {
    ok: true,
    args: { path: parsed.positionals[0] ?? DEFAULT_FAX, json: parsed.values.json === true },
  };
}

export interface ExtractTableMeta {
  file: string;
  ocrEngine: string;
  /** Seconds for OCR plus extraction. */
  seconds: number;
}

export function formatExtractTable(result: ExtractionResult, meta: ExtractTableMeta): string {
  const lines: string[] = [
    `File: ${meta.file}`,
    `OCR engine: ${meta.ocrEngine}`,
    `Extraction engine: ${result.engine}`,
    '',
  ];
  const rows = FIELD_ORDER.map((name) => {
    const field = result.fields.find((f) => f.name === name);
    return {
      label: PLAIN_FIELD_NAMES[name],
      value: field?.value ?? '(empty)',
      conf: (field?.confidence ?? 0).toFixed(2),
      ids: field === undefined || field.wordIds.length === 0 ? '-' : field.wordIds.join(','),
      flags: field?.flags ?? [],
    };
  });
  const labelWidth = Math.max(5, ...rows.map((r) => r.label.length));
  const valueWidth = Math.max(5, ...rows.map((r) => r.value.length));
  lines.push(`${'field'.padEnd(labelWidth)}  ${'value'.padEnd(valueWidth)}  conf  word IDs`);
  for (const r of rows) {
    lines.push(`${r.label.padEnd(labelWidth)}  ${r.value.padEnd(valueWidth)}  ${r.conf}  ${r.ids}`);
    for (const flag of r.flags) lines.push(`    Flag: ${flag}`);
  }
  const flagged = rows.filter((r) => r.flags.length > 0).length;
  lines.push('');
  lines.push(`OCR and extraction took ${meta.seconds.toFixed(1)} s.`);
  lines.push(`${flagged} of ${FIELD_ORDER.length} fields flagged`);
  return lines.join('\n');
}
