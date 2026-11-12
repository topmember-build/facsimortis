import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findLabels } from '../src/extract/labels.js';
import { RuleExtractor, extractWithDetails } from '../src/extract/rules.js';
import { FIELD_ORDER } from '../src/extract/schema.js';
import type { FieldName } from '../src/extract/schema.js';
import type { Box, OcrResult, OcrWord } from '../src/ocr/types.js';

const H = 34; // word height
const W = 1728;

interface Spec {
  text: string;
  x: number;
  y: number;
  confidence?: number;
}

/** Build OCR words from specs (width = 14px per character). IDs follow array order. */
function build(specs: Spec[], rotateDegrees = 0): OcrResult {
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
function line(texts: string[], x: number, y: number, confidence?: number): Spec[] {
  const out: Spec[] = [];
  let cursor = x;
  for (const text of texts) {
    out.push(confidence === undefined ? { text, x: cursor, y } : { text, x: cursor, y, confidence });
    cursor += text.length * 14 + 14;
  }
  return out;
}

const LEFT = 130;
const RIGHT = 920;

interface Overrides {
  skip?: FieldName[];
  /** Replace the label words of a field. */
  label?: Partial<Record<FieldName, string[]>>;
  value?: Partial<Record<FieldName, string[][]>>;
  /** Extra specs appended to the page. */
  extra?: Spec[];
}

const DEFAULT_VALUES: Record<FieldName, string[][]> = {
  patientName: [['Jasper', 'Hartley']],
  dob: [['09/06/1938']],
  referringProvider: [['Dr', 'Iris', 'Ellery,', 'Maple', 'Hollow', 'Practice']],
  npi: [['8428731565']],
  reason: [['ENT', 'evaluation,', 'recurring', 'sinus', 'congestion']],
  urgency: [['routine']],
  callbackPhone: [['555-0147']],
};

const DEFAULT_LABELS: Record<FieldName, string[]> = {
  patientName: ['Patient', 'name:'],
  dob: ['Date', 'of', 'birth:'],
  referringProvider: ['Referring', 'provider:'],
  npi: ['Provider', 'NPI:'],
  reason: ['Reason', 'for', 'referral:'],
  urgency: ['Urgency:'],
  callbackPhone: ['Callback', 'phone:'],
};

const POSITIONS: Record<FieldName, { x: number; y: number }> = {
  patientName: { x: LEFT, y: 300 },
  dob: { x: RIGHT, y: 310 },
  referringProvider: { x: LEFT, y: 440 },
  npi: { x: RIGHT, y: 450 },
  reason: { x: LEFT, y: 580 },
  urgency: { x: RIGHT, y: 590 },
  callbackPhone: { x: LEFT, y: 720 },
};

function typedPage(o: Overrides = {}, rotate = 0): OcrResult {
  const specs: Spec[] = [
    ...line(['10/01/2026', '16:03', 'FROM:', '555-0159', 'Page', '1/1'], 56, 30),
    ...line(['REFERRAL', 'FORM'], 114, 130),
    ...line(['SYNTHETIC', 'DATA', '-', 'NOT', 'A', 'REAL', 'PATIENT'], 113, 220),
  ];
  for (const name of FIELD_ORDER) {
    if (o.skip?.includes(name)) continue;
    const { x, y } = POSITIONS[name];
    specs.push(...line(o.label?.[name] ?? DEFAULT_LABELS[name], x, y));
    (o.value?.[name] ?? DEFAULT_VALUES[name]).forEach((texts, i) => {
      specs.push(...line(texts, x, y + 40 * (i + 1)));
    });
  }
  specs.push(...(o.extra ?? []));
  return build(specs, rotate);
}

function idsOf(ocr: OcrResult, ...texts: string[]): string[] {
  return texts.map((t) => {
    const w = ocr.words.find((x) => x.text === t);
    if (!w) throw new Error(`no word ${t}`);
    return w.id;
  });
}

function fieldOf(result: Awaited<ReturnType<RuleExtractor['extract']>>, name: FieldName) {
  const f = result.fields.find((x) => x.name === name);
  if (!f) throw new Error(`no field ${name}`);
  return f;
}

describe('typed-form layout on a hand-made page', () => {
  it('reads all seven fields exactly, in reading order, with min confidence', async () => {
    const ocr = typedPage({ extra: [] });
    // Lower one word's confidence to check min.
    const hartley = ocr.words.find((w) => w.text === 'Hartley');
    if (hartley) hartley.confidence = 0.42;
    const result = await new RuleExtractor().extract(ocr);
    expect(result.engine).toBe('rules');
    expect(result.fields.map((f) => f.name)).toEqual([...FIELD_ORDER]);
    expect(fieldOf(result, 'patientName')).toMatchObject({
      value: 'Jasper Hartley',
      wordIds: idsOf(ocr, 'Jasper', 'Hartley'),
      confidence: 0.42,
      flags: [],
    });
    expect(fieldOf(result, 'dob').value).toBe('09/06/1938');
    expect(fieldOf(result, 'referringProvider')).toMatchObject({
      value: 'Dr Iris Ellery, Maple Hollow Practice',
      wordIds: idsOf(ocr, 'Dr', 'Iris', 'Ellery,', 'Maple', 'Hollow', 'Practice'),
    });
    expect(fieldOf(result, 'npi').value).toBe('8428731565');
    expect(fieldOf(result, 'reason').value).toBe('ENT evaluation, recurring sinus congestion');
    expect(fieldOf(result, 'urgency').value).toBe('routine');
    expect(fieldOf(result, 'callbackPhone')).toMatchObject({ value: '555-0147', confidence: 0.9 });
  });

  it('reads a value wrapped onto two lines inside its box', async () => {
    const ocr = typedPage({
      value: { referringProvider: [['Dr', 'Iris', 'Ellery,', 'Maple', 'Hollow'], ['Practice']] },
    });
    const result = await new RuleExtractor().extract(ocr);
    expect(fieldOf(result, 'referringProvider')).toMatchObject({
      value: 'Dr Iris Ellery, Maple Hollow Practice',
      wordIds: idsOf(ocr, 'Dr', 'Iris', 'Ellery,', 'Maple', 'Hollow', 'Practice'),
    });
    expect(fieldOf(result, 'npi').value).toBe('8428731565');
  });

  it('keeps the two columns apart', async () => {
    // The long text sits on the second line, close to the other column. A long FIRST
    // line is covered in extract-layout-conflict.test.ts (it is flagged, not read).
    const ocr = typedPage({
      value: { reason: [['ENT', 'evaluation,', 'recurring', 'sinus'], ['congestion', 'and', 'more', 'words', 'here', 'and', 'there', 'again']] },
    });
    const result = await new RuleExtractor().extract(ocr);
    expect(fieldOf(result, 'reason').value).toBe(
      'ENT evaluation, recurring sinus congestion and more words here and there again',
    );
    expect(fieldOf(result, 'urgency').value).toBe('routine');
    expect(fieldOf(result, 'dob').value).toBe('09/06/1938');
    expect(fieldOf(result, 'patientName').value).toBe('Jasper Hartley');
  });
});

describe('fields that cannot be read', () => {
  it('absent label gives null, no words, zero confidence and a plain flag', async () => {
    const ocr = typedPage({ skip: ['urgency'] });
    const result = await new RuleExtractor().extract(ocr);
    expect(fieldOf(result, 'urgency')).toEqual({
      name: 'urgency',
      value: null,
      wordIds: [],
      confidence: 0,
      flags: ['The urgency label was not found on the page.'],
      reviewed: false,
    });
    const { details } = extractWithDetails(ocr);
    expect(details.find((d) => d.field === 'urgency')).toMatchObject({
      reason: 'label-not-found',
      matchCount: 0,
    });
  });

  it('a label with nothing below it (next label directly below) gives a no-value flag', async () => {
    const ocr = typedPage({ value: { patientName: [] } });
    // Move the next left label up to sit directly below the patient name label.
    const referring = ocr.words.filter((w) => ['Referring', 'provider:'].includes(w.text));
    const patient = ocr.words.find((w) => w.text === 'name:');
    if (!patient) throw new Error('setup');
    const firstTop = referring[0]?.box[1] ?? 0;
    const dy = patient.box[3] + 6 - firstTop;
    for (const w of referring) {
      w.box = [w.box[0], w.box[1] + dy, w.box[2], w.box[3] + dy];
    }
    const result = await new RuleExtractor().extract(ocr);
    expect(fieldOf(result, 'patientName')).toMatchObject({
      value: null,
      wordIds: [],
      confidence: 0,
      flags: ['The patient name label was found, but no value was next to it.'],
    });
  });

  it('a merged label and value is not split', async () => {
    const ocr = typedPage({
      label: { callbackPhone: ['Callback'] },
      value: { callbackPhone: [] },
      extra: line(['phone:555-0147'], 130 + 8 * 14 + 14, 720),
    });
    const result = await new RuleExtractor().extract(ocr);
    expect(fieldOf(result, 'callbackPhone')).toMatchObject({
      value: null,
      wordIds: [],
      flags: ['The callback phone runs into its label on the page. Please check it.'],
    });
    const urgent = typedPage({ label: { urgency: [] }, value: { urgency: [] }, extra: line(['Urgency:routine'], RIGHT, 590) });
    const r2 = await new RuleExtractor().extract(urgent);
    expect(fieldOf(r2, 'urgency').flags).toEqual([
      'The urgency runs into its label on the page. Please check it.',
    ]);
    expect(fieldOf(r2, 'urgency').value).toBeNull();
  });

  it('a label found twice gives null and a "more than once" flag', async () => {
    const ocr = typedPage({ extra: line(['Urgency:'], RIGHT, 900).concat(line(['urgent'], RIGHT, 940)) });
    const result = await new RuleExtractor().extract(ocr);
    expect(fieldOf(result, 'urgency')).toMatchObject({
      value: null,
      wordIds: [],
      confidence: 0,
      flags: ['The urgency appears more than once on the page. Please check it.'],
    });
    expect(extractWithDetails(ocr).details.find((d) => d.field === 'urgency')?.matchCount).toBe(2);
  });
});

describe('label tolerance', () => {
  it('finds "NPL:" and says it was fuzzy', async () => {
    const ocr = typedPage({ label: { npi: ['Provider', 'NPL:'] } });
    const { result, details } = extractWithDetails(ocr);
    expect(fieldOf(result, 'npi').value).toBe('8428731565');
    expect(details.find((d) => d.field === 'npi')).toMatchObject({ fuzzy: true, reason: 'read' });
  });

  it('finds "Cal" + "tback" as Callback', async () => {
    const ocr = typedPage({ label: { callbackPhone: ['Cal', 'tback', 'phone:'] } });
    const { result, details } = extractWithDetails(ocr);
    expect(fieldOf(result, 'callbackPhone').value).toBe('555-0147');
    const d = details.find((x) => x.field === 'callbackPhone');
    expect(d).toMatchObject({ fuzzy: true, reason: 'read' });
    expect(d?.labelWordIds).toHaveLength(3);
  });

  it('"Patient:" matches "Patient" and is not fuzzy', () => {
    const ocr = typedPage({ label: { patientName: ['Patient:', 'name:'] } });
    const f = findLabels(ocr.words).find((x) => x.field === 'patientName');
    expect(f?.count).toBe(1);
    expect(f?.matches[0]?.fuzzy).toBe(false);
  });

  it('ignores case and a missing colon', () => {
    const ocr = typedPage({ label: { urgency: ['URGENCY'] } });
    expect(findLabels(ocr.words).find((x) => x.field === 'urgency')?.count).toBe(1);
  });

  it('does not match a word two edits away', async () => {
    const ocr = typedPage({ label: { urgency: ['Urgnecy:'] } });
    expect(findLabels(ocr.words).find((x) => x.field === 'urgency')?.count).toBe(0);
    const result = await new RuleExtractor().extract(ocr);
    expect(fieldOf(result, 'urgency').value).toBeNull();
  });

  it('short label words must match exactly', () => {
    const ocr = typedPage({ label: { dob: ['Date', 'or', 'birth:'] } });
    expect(findLabels(ocr.words).find((x) => x.field === 'dob')?.count).toBe(0);
  });
});

describe('values are never repaired', () => {
  it('returns misreads verbatim with the right word IDs', async () => {
    const ocr = typedPage({
      value: {
        callbackPhone: [['555~0151']],
        urgency: [['Tris']],
        reason: [['-headaches']],
        referringProvider: [['Dr.Linnea']],
      },
    });
    const result = await new RuleExtractor().extract(ocr);
    expect(fieldOf(result, 'callbackPhone')).toMatchObject({ value: '555~0151', wordIds: idsOf(ocr, '555~0151') });
    expect(fieldOf(result, 'urgency')).toMatchObject({ value: 'Tris', wordIds: idsOf(ocr, 'Tris') });
    expect(fieldOf(result, 'reason')).toMatchObject({ value: '-headaches', wordIds: idsOf(ocr, '-headaches') });
    expect(fieldOf(result, 'referringProvider')).toMatchObject({ value: 'Dr.Linnea', wordIds: idsOf(ocr, 'Dr.Linnea') });
  });
});

describe('skew', () => {
  it.each([3, -3])('reads all seven fields when the page is rotated %i degrees', async (deg) => {
    // The provider and reason values are wrapped onto two lines: as one long line each comes within
    // half a line of its label's line at -3 degrees and is flagged instead of read
    // (see extract-layout-conflict.test.ts).
    const ocr = typedPage(
      {
        value: {
          referringProvider: [['Dr', 'Iris', 'Ellery,'], ['Maple', 'Hollow', 'Practice']],
          reason: [['ENT', 'evaluation,'], ['recurring', 'sinus', 'congestion']],
        },
      },
      deg,
    );
    const result = await new RuleExtractor().extract(ocr);
    const expected: Record<FieldName, string> = {
      patientName: 'Jasper Hartley',
      dob: '09/06/1938',
      referringProvider: 'Dr Iris Ellery, Maple Hollow Practice',
      npi: '8428731565',
      reason: 'ENT evaluation, recurring sinus congestion',
      urgency: 'routine',
      callbackPhone: '555-0147',
    };
    for (const name of FIELD_ORDER) {
      expect(fieldOf(result, name).value).toBe(expected[name]);
    }
  });
});

interface Truth {
  fields: { name: FieldName; value: string; wordIds: string[] }[];
  words: { id: string; text: string; box: Box }[];
}

function loadTruth(path: string): { truth: Truth; ocr: OcrResult } {
  const truth = JSON.parse(readFileSync(path, 'utf8')) as Truth;
  const ocr: OcrResult = {
    words: truth.words.map((w) => ({ id: w.id, text: w.text, box: w.box, confidence: 1 })),
    width: 1728,
    height: 2200,
    engine: 'truth',
  };
  return { truth, ocr };
}

describe('truth-words layout', () => {
  it.each(['fixtures/faxes/L1/fax-0001.truth.json', 'fixtures/faxes/L2/fax-0003.truth.json'])(
    'reads every typed-form field exactly from %s',
    async (path) => {
      const { truth, ocr } = loadTruth(path);
      const result = await new RuleExtractor().extract(ocr);
      for (const t of truth.fields) {
        const f = fieldOf(result, t.name);
        expect(f.value).toBe(t.value);
        expect(f.wordIds).toEqual(t.wordIds);
      }
    },
  );

  it('typed pages are read as typed', () => {
    for (const path of ['fixtures/faxes/L1/fax-0001.truth.json', 'fixtures/faxes/L2/fax-0003.truth.json']) {
      const { ocr } = loadTruth(path);
      for (const d of extractWithDetails(ocr).details) {
        expect(d.layout).toBe('typed');
        expect(d.pageLayout).toBe('typed');
        expect(d.conflict).toBe(false);
      }
      const { result } = extractWithDetails(ocr);
      for (const f of result.fields) expect(f.flags).toEqual([]);
    }
  });
});

describe('default bootstrap', () => {
  afterEach(async () => {
    // Clear the registration on the module instance the test used, then drop it.
    const index = await import('../src/extract/index.js');
    index.registerRuleExtractor(undefined);
    vi.resetModules();
  });

  it('importing the bootstrap makes createExtractor return the rule extractor', async () => {
    vi.resetModules();
    const index = await import('../src/extract/index.js');
    expect(() => index.createExtractor({})).toThrow();
    const boot = await import('../src/extract/default.js');
    const rules = await import('../src/extract/rules.js');
    // Wrapped by the central citation check (0.6): check the name instead of the class.
    expect(boot.createExtractor({}).name).toBe(new rules.RuleExtractor().name);
    expect(boot.createExtractor({ EXTRACT_PROVIDER: 'rules' }).name).toBe('rules');
  });
});
