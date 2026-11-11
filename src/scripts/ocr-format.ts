// Pure helpers for the ocr CLI: argument parsing and table output. No I/O.
import { parseArgs } from 'node:util';
import type { OcrResult } from '../ocr/types.js';

export const DEFAULT_FAX = 'fixtures/faxes/L1/fax-0001.png';

export interface OcrCliArgs {
  path: string;
  json: boolean;
}

export type ParseResult = { ok: true; args: OcrCliArgs } | { ok: false; message: string };

export function parseOcrArgs(argv: string[]): ParseResult {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { json: { type: 'boolean' } },
      allowPositionals: true,
    });
  } catch {
    return { ok: false, message: 'Unknown option. Usage: npm run ocr -- [--json] [path-to-png]' };
  }
  if (parsed.positionals.length > 1) {
    return { ok: false, message: 'Give one fax at a time. Usage: npm run ocr -- [--json] [path-to-png]' };
  }
  return {
    ok: true,
    args: { path: parsed.positionals[0] ?? DEFAULT_FAX, json: parsed.values.json === true },
  };
}

export interface OcrTableMeta {
  file: string;
  seconds: number;
}

export function formatOcrTable(result: OcrResult, meta: OcrTableMeta): string {
  const lines: string[] = [
    `File: ${meta.file}  Engine: ${result.engine}  Image: ${result.width}x${result.height}  Words: ${result.words.length}`,
  ];
  const boxes = result.words.map((w) => w.box.join(','));
  const idWidth = Math.max(2, ...result.words.map((w) => w.id.length));
  const boxWidth = Math.max(3, ...boxes.map((b) => b.length));
  lines.push(`${'id'.padEnd(idWidth)}  ${'box'.padEnd(boxWidth)}  conf  text`);
  result.words.forEach((w, i) => {
    lines.push(
      `${w.id.padEnd(idWidth)}  ${(boxes[i] ?? '').padEnd(boxWidth)}  ${w.confidence.toFixed(2)}  ${w.text}`,
    );
  });
  const mean =
    result.words.length === 0
      ? 'n/a'
      : (result.words.reduce((s, w) => s + w.confidence, 0) / result.words.length).toFixed(2);
  lines.push(`OCR took ${meta.seconds.toFixed(1)} s. Mean confidence: ${mean}`);
  return lines.join('\n');
}
