import { FIELD_ORDER } from '../src/extract/schema.js';
import type { FieldName } from '../src/extract/schema.js';
import type { Box, OcrResult, OcrWord } from '../src/ocr/types.js';

export const H = 34;
export const W = 1728;

export interface Spec {
  text: string;
  x: number;
  y: number;
  confidence?: number;
}

/** Build OCR words from specs (width = 14px per character), rotated about the page centre. */
export function build(specs: Spec[], rotateDegrees = 0): OcrResult {
  const cx = W / 2;
  const cy = 1100;
  const rad = (rotateDegrees * Math.PI) / 180;
  const words: OcrWord[] = specs.map((s, i) => {
    const w = s.text.length * 14;
    const mx = s.x + w / 2;
    const my = s.y + H / 2;
    const rx = cx + (mx - cx) * Math.cos(rad) - (my - cy) * Math.sin(rad);
    const ry = cy + (mx - cx) * Math.sin(rad) + (my - cy) * Math.cos(rad);
    const box: Box = [Math.round(rx - w / 2), Math.round(ry - H / 2), Math.round(rx + w / 2), Math.round(ry + H / 2)];
    return { id: `o${String(i + 1).padStart(4, '0')}`, text: s.text, box, confidence: s.confidence ?? 0.9 };
  });
  return { words, width: W, height: 2200, engine: 'test' };
}

/** Lay out a line of words left to right from x with a 14px gap. */
export function line(texts: string[], x: number, y: number, confidence?: number): Spec[] {
  const out: Spec[] = [];
  let cursor = x;
  for (const text of texts) {
    out.push(confidence === undefined ? { text, x: cursor, y } : { text, x: cursor, y, confidence });
    cursor += text.length * 14 + 14;
  }
  return out;
}

export const DEFAULT_LABELS: Record<FieldName, string[]> = {
  patientName: ['Patient', 'name:'],
  dob: ['Date', 'of', 'birth:'],
  referringProvider: ['Referring', 'provider:'],
  npi: ['Provider', 'NPI:'],
  reason: ['Reason', 'for', 'referral:'],
  urgency: ['Urgency:'],
  callbackPhone: ['Callback', 'phone:'],
};

export const TABLE_LABEL_X = 130;
export const TABLE_VALUE_X = 460;
export const TYPED_LEFT = 130;
export const TYPED_RIGHT = 920;

export interface PageOptions {
  skip?: FieldName[];
  label?: Partial<Record<FieldName, string[]>>;
  /** Lines of value words per field. An empty array means no value. */
  value: Record<FieldName, string[][]>;
  confidence?: Partial<Record<string, number>>;
  extra?: Spec[];
}

const TYPED_POSITIONS: Record<FieldName, { x: number; y: number }> = {
  patientName: { x: TYPED_LEFT, y: 300 },
  dob: { x: TYPED_RIGHT, y: 310 },
  referringProvider: { x: TYPED_LEFT, y: 440 },
  npi: { x: TYPED_RIGHT, y: 450 },
  reason: { x: TYPED_LEFT, y: 580 },
  urgency: { x: TYPED_RIGHT, y: 590 },
  callbackPhone: { x: TYPED_LEFT, y: 720 },
};

function header(): Spec[] {
  return [
    ...line(['10/01/2026', '16:03', 'FROM:', '555-0159', 'Page', '1/1'], 56, 30),
    ...line(['REFERRAL', 'FORM'], 114, 130),
    ...line(['SYNTHETIC', 'DATA', '-', 'NOT', 'A', 'REAL', 'PATIENT'], 113, 220),
  ];
}

export function typedSpecs(o: PageOptions): Spec[] {
  const specs = header();
  for (const name of FIELD_ORDER) {
    if (o.skip?.includes(name)) continue;
    const { x, y } = TYPED_POSITIONS[name];
    specs.push(...line(o.label?.[name] ?? DEFAULT_LABELS[name], x, y));
    o.value[name].forEach((texts, i) => specs.push(...line(texts, x, y + 40 * (i + 1))));
  }
  specs.push(...(o.extra ?? []));
  return specs;
}

/** Table form: label in the left column, value in the right column starting on the label's row. */
export function tableSpecs(o: PageOptions): Spec[] {
  const specs = header();
  FIELD_ORDER.forEach((name, row) => {
    if (o.skip?.includes(name)) return;
    const y = 300 + 100 * row;
    specs.push(...line(o.label?.[name] ?? DEFAULT_LABELS[name], TABLE_LABEL_X, y));
    o.value[name].forEach((texts, i) => specs.push(...line(texts, TABLE_VALUE_X, y + 40 * i)));
  });
  specs.push(...(o.extra ?? []));
  return specs;
}
