/**
 * Unskewed page templates. Deterministic: layout depends only on the referral.
 * Draws labels, values and ruled lines; records every drawn word with an ID.
 * Synthetic data only.
 */
import { CELL_H, CELL_W } from './font.js';
import type { BitmapFont } from './font.js';
import type { Referral } from './data.js';
import { Page, drawText } from './raster.js';
import type { Box } from './raster.js';

export const FIELD_NAMES = [
  'patientName',
  'dob',
  'referringProvider',
  'npi',
  'reason',
  'urgency',
  'callbackPhone',
] as const;
export type FieldName = (typeof FIELD_NAMES)[number];

export type TemplateName = 'typed-form' | 'table-form';

export interface Word {
  id: string;
  text: string;
  box: Box;
}

export interface TemplateResult {
  words: Word[];
  fieldWordIds: Record<FieldName, string[]>;
  /** Boxes of all field value words (keep noise and stamps off these). */
  valueBoxes: Box[];
}

export interface TemplateOptions {
  firstWordIndex?: number;
  top?: number;
}

export const PAGE_WIDTH = 1728;
export const PAGE_HEIGHT = 2200;
export const DEFAULT_TOP = 120;
/** White space kept between value text and any ruled line or border. */
export const MIN_CLEARANCE = 16;

const MARGIN = 100;
const LINE_GAP = 8;
const SYNTHETIC_NOTICE = 'SYNTHETIC DATA - NOT A REAL PATIENT';

const LABELS: Record<FieldName, string> = {
  patientName: 'Patient name:',
  dob: 'Date of birth:',
  referringProvider: 'Referring provider:',
  npi: 'Provider NPI:',
  reason: 'Reason for referral:',
  urgency: 'Urgency:',
  callbackPhone: 'Callback phone:',
};

/** Greedy wrap at word boundaries. Throws if one word is wider than the line. */
function wrapValue(text: string, maxWidth: number, field: FieldName): string[] {
  const maxChars = Math.floor(maxWidth / CELL_W);
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    if (word.length > maxChars) {
      throw new Error(
        `Word "${word}" in ${field} is ${word.length} characters; the field fits ${maxChars}.`,
      );
    }
    if (current === '') current = word;
    else if (current.length + 1 + word.length <= maxChars) current += ' ' + word;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

class Recorder {
  readonly words: Word[] = [];
  readonly fieldWordIds: Record<FieldName, string[]> = {
    patientName: [],
    dob: [],
    referringProvider: [],
    npi: [],
    reason: [],
    urgency: [],
    callbackPhone: [],
  };
  readonly valueBoxes: Box[] = [];
  private next: number;

  constructor(
    private readonly page: Page,
    private readonly font: BitmapFont,
    firstWordIndex: number,
  ) {
    this.next = firstWordIndex;
  }

  /** Draw a line of text, record its words; return their IDs. */
  text(text: string, x: number, y: number, scale = 1): string[] {
    const ids: string[] = [];
    for (const wb of drawText(this.page, this.font, text, x, y, scale)) {
      const id = `w${String(this.next++).padStart(4, '0')}`;
      this.words.push({ id, text: wb.text, box: wb.box });
      ids.push(id);
    }
    return ids;
  }

  /** Draw wrapped value lines for a field starting at (x, y). */
  value(field: FieldName, lines: string[], x: number, y: number): void {
    lines.forEach((line, i) => {
      const ids = this.text(line, x, y + i * (CELL_H + LINE_GAP));
      this.fieldWordIds[field].push(...ids);
    });
    for (const id of this.fieldWordIds[field]) {
      const w = this.words.find((c) => c.id === id);
      if (w) this.valueBoxes.push(w.box);
    }
  }

  result(): TemplateResult {
    return { words: this.words, fieldWordIds: this.fieldWordIds, valueBoxes: this.valueBoxes };
  }
}

function linesHeight(n: number): number {
  return n * CELL_H + (n - 1) * LINE_GAP;
}

function assertInsidePage(result: TemplateResult): void {
  for (const w of result.words) {
    const [x0, y0, x1, y1] = w.box;
    if (x0 < 0 || y0 < 0 || x1 > PAGE_WIDTH || y1 > PAGE_HEIGHT) {
      throw new Error(`Word "${w.text}" does not fit on the page.`);
    }
  }
}

/**
 * Typed form: two columns of bordered boxes. Label (scale 1) sits above the value
 * inside each box. Rows: name|dob, provider|npi, reason|urgency, callbackPhone.
 */
function drawTypedForm(rec: Recorder, page: Page, referral: Referral, top: number): void {
  rec.text('REFERRAL FORM', MARGIN, top + 20, 2);
  rec.text(SYNTHETIC_NOTICE, MARGIN, top + 110);

  const BORDER = 3;
  const PAD_X = 24;
  const PAD_TOP = 16;
  const PAD_BOTTOM = 24;
  const BOX_W = 740;
  const COL_X = [MARGIN, MARGIN + BOX_W + 48] as const;
  const ROW_GAP = 24;
  const rows: readonly (readonly FieldName[])[] = [
    ['patientName', 'dob'],
    ['referringProvider', 'npi'],
    ['reason', 'urgency'],
    ['callbackPhone'],
  ];

  let y = top + 170;
  for (const row of rows) {
    const wrapped = row.map((f) => wrapValue(referral[f], BOX_W - 2 * PAD_X, f));
    const maxLines = Math.max(...wrapped.map((l) => l.length));
    const boxH = PAD_TOP + CELL_H + LINE_GAP + linesHeight(maxLines) + PAD_BOTTOM;
    row.forEach((field, i) => {
      const x = COL_X[i] as number;
      page.strokeRect(x, y, BOX_W, boxH, BORDER);
      rec.text(LABELS[field], x + PAD_X, y + PAD_TOP);
      rec.value(field, wrapped[i] as string[], x + PAD_X, y + PAD_TOP + CELL_H + LINE_GAP);
    });
    y += boxH + ROW_GAP;
  }
}

/** Table form: label column | value column, ruled lines between all rows. */
function drawTableForm(rec: Recorder, page: Page, referral: Referral, top: number): void {
  rec.text('PATIENT REFERRAL', MARGIN, top + 20, 2);
  rec.text(SYNTHETIC_NOTICE, MARGIN, top + 110);

  const RULE = 2;
  const PAD_X = 24;
  const PAD_Y = 20;
  const TABLE_W = PAGE_WIDTH - 2 * MARGIN;
  const DIVIDER_X = MARGIN + 460;
  const VALUE_X = DIVIDER_X + RULE + PAD_X;
  const VALUE_W = MARGIN + TABLE_W - RULE - PAD_X - VALUE_X;

  const wrapped = FIELD_NAMES.map((f) => wrapValue(referral[f], VALUE_W, f));
  const rowHeights = wrapped.map((l) => RULE + PAD_Y + linesHeight(l.length) + PAD_Y);
  const tableTop = top + 170;
  const tableH = rowHeights.reduce((a, b) => a + b, 0) + RULE;

  page.strokeRect(MARGIN, tableTop, TABLE_W, tableH, RULE);
  page.fillRect(DIVIDER_X, tableTop, RULE, tableH);

  let y = tableTop;
  FIELD_NAMES.forEach((field, i) => {
    if (i > 0) page.fillRect(MARGIN, y, TABLE_W, RULE);
    rec.text(LABELS[field], MARGIN + RULE + PAD_X, y + RULE + PAD_Y);
    rec.value(field, wrapped[i] as string[], VALUE_X, y + RULE + PAD_Y);
    y += rowHeights[i] as number;
  });
}

export function drawTemplate(
  page: Page,
  font: BitmapFont,
  template: TemplateName,
  referral: Referral,
  options: TemplateOptions = {},
): TemplateResult {
  if (page.width !== PAGE_WIDTH || page.height !== PAGE_HEIGHT) {
    throw new Error(`Templates need a ${PAGE_WIDTH}x${PAGE_HEIGHT} page.`);
  }
  const top = options.top ?? DEFAULT_TOP;
  const rec = new Recorder(page, font, options.firstWordIndex ?? 1);
  if (template === 'typed-form') drawTypedForm(rec, page, referral, top);
  else drawTableForm(rec, page, referral, top);
  const result = rec.result();
  assertInsidePage(result);
  return result;
}
