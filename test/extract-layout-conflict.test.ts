import { describe, expect, it } from 'vitest';
import { extractWithDetails, PLAIN_FIELD_NAMES } from '../src/extract/rules.js';
import { FIELD_ORDER } from '../src/extract/schema.js';
import type { FieldName } from '../src/extract/schema.js';
import type { OcrResult } from '../src/ocr/types.js';
import { build, DEFAULT_LABELS, line, TABLE_LABEL_X, TYPED_LEFT, TYPED_RIGHT, tableSpecs, typedSpecs } from './page-helpers.js';
import type { PageOptions, Spec } from './page-helpers.js';

const SHORT: Record<FieldName, string[][]> = {
  patientName: [['Jasper', 'Hartley']],
  dob: [['09/06/1938']],
  referringProvider: [['Dr', 'Iris', 'Ellery,']],
  npi: [['8428731565']],
  reason: [['ENT', 'evaluation']],
  urgency: [['routine']],
  callbackPhone: [['555-0147']],
};

const LEFT_FIELDS: FieldName[] = ['patientName', 'referringProvider', 'reason', 'callbackPhone'];
const ROTATIONS = [0, 3, -3];
const LENGTHS = [3, 5, 6, 7];

function expectedOf(value: Record<FieldName, string[][]>, name: FieldName): string {
  return value[name].map((l) => l.join(' ')).join(' ');
}

function flagFor(name: FieldName): string {
  return `The ${PLAIN_FIELD_NAMES[name]} could not be read clearly from the page. Please check it.`;
}

/** 'read' when exactly right and unflagged, 'flagged' when null with the plain flag. Anything else fails. */
function outcome(ocr: OcrResult, name: FieldName, expected: string): 'read' | 'flagged' {
  const f = extractWithDetails(ocr).result.fields.find((x) => x.name === name);
  if (f === undefined) throw new Error(`no field ${name}`);
  if (f.value === null) {
    expect(f.wordIds).toEqual([]);
    expect(f.confidence).toBe(0);
    expect(f.flags).toEqual([flagFor(name)]);
    return 'flagged';
  }
  expect(f.value).toBe(expected);
  expect(f.flags).toEqual([]);
  return 'read';
}

function words(n: number): string[] {
  return Array.from({ length: n }, (_, i) => ['Maplewood', 'clinic', 'Hartley', 'north', 'annex'][i % 5] ?? 'x');
}

describe('case A: a long typed value that reaches its label line', () => {
  it('is exactly right or null with a plain flag, never wrong and unflagged', () => {
    let flagged = 0;
    let read = 0;
    let total = 0;
    for (const target of LEFT_FIELDS) {
      // Up to 7 words (about 750px) so the value stays inside the left column.
      for (const n of LENGTHS) {
        for (const rot of ROTATIONS) {
          const value = { ...SHORT, [target]: [words(n)] };
          const ocr = build(typedSpecs({ value }), rot);
          for (const name of FIELD_ORDER) {
            const result = outcome(ocr, name, expectedOf(value, name));
            if (name === target) {
              total += 1;
              if (result === 'flagged') flagged += 1;
              else read += 1;
            } else {
              // Fields next to a flagged one stay exact.
              expect(result).toBe('read');
            }
          }
        }
      }
    }
    expect(total).toBe(LEFT_FIELDS.length * LENGTHS.length * ROTATIONS.length);
    // Not vacuous: the flag does fire, and short-enough values are still read.
    expect(flagged).toBeGreaterThan(0);
    expect(read).toBeGreaterThan(0);
  });

  it('details say the page is typed and the field conflicted', () => {
    const value = { ...SHORT, reason: [words(7)] };
    const conflicts = ROTATIONS.flatMap((rot) =>
      extractWithDetails(build(typedSpecs({ value }), rot)).details.filter((x) => x.conflict),
    );
    expect(conflicts.length).toBeGreaterThan(0);
    for (const d of conflicts) {
      expect(d).toMatchObject({ pageLayout: 'typed', conflict: true, layout: null, reason: 'layout-unclear' });
    }
  });
});

describe('case B: a stray word on a typed label line, right of the label', () => {
  const STRAYS = ['~', '.', 'RECEI'];

  function positions(name: FieldName): Record<string, number> {
    const labelX = LEFT_FIELDS.includes(name) ? TYPED_LEFT : TYPED_RIGHT;
    const labelWidth = DEFAULT_LABELS[name].join(' ').length * 14;
    return {
      justRight: labelX + labelWidth + 14,
      midBox: labelX + 400,
      nearOtherColumn: LEFT_FIELDS.includes(name) ? TYPED_RIGHT - 40 : 1560,
    };
  }

  function labelY(name: FieldName): number {
    const probe = typedSpecs({ value: SHORT });
    const first = DEFAULT_LABELS[name][0];
    const spec = probe.find((s) => s.text === first);
    if (spec === undefined) throw new Error('setup');
    return spec.y;
  }

  it('is flagged or exactly right, never wrong and unflagged; other fields stay exact', () => {
    let flagged = 0;
    let total = 0;
    const flaggedByPlace: Record<string, number> = { justRight: 0, midBox: 0, nearOtherColumn: 0 };
    for (const target of FIELD_ORDER) {
      for (const [place, x] of Object.entries(positions(target))) {
        for (const text of STRAYS) {
          for (const rot of ROTATIONS) {
            const extra: Spec[] = [{ text, x, y: labelY(target) }];
            const ocr = build(typedSpecs({ value: SHORT, extra }), rot);
            for (const name of FIELD_ORDER) {
              const result = outcome(ocr, name, expectedOf(SHORT, name));
              if (name === target) {
                total += 1;
                if (result === 'flagged') {
                  flagged += 1;
                  flaggedByPlace[place] = (flaggedByPlace[place] ?? 0) + 1;
                }
              } else {
                expect(result, `${name} next to stray "${text}" at ${place} on ${target}, rot ${rot}`).toBe('read');
              }
            }
          }
        }
      }
    }
    expect(flagged).toBeGreaterThan(0);
    // A stray just right of a label, or mid-box, always lands in the field's right words.
    expect(flaggedByPlace['justRight']).toBe(FIELD_ORDER.length * STRAYS.length * ROTATIONS.length);
    expect(flaggedByPlace['midBox']).toBe(FIELD_ORDER.length * STRAYS.length * ROTATIONS.length);
    expect(total).toBe(FIELD_ORDER.length * 3 * STRAYS.length * ROTATIONS.length);
  });
});

describe('unknown page layout', () => {
  it('mixed evidence gives null and a flag for every usable field', () => {
    // Words beside three labels, as well as below them: they do not vote, so the
    // typed majority (4 of 7) is below two thirds.
    const extra: Spec[] = [
      ...line(['stray'], TYPED_LEFT + 'Patient name:'.length * 14 + 14, 300),
      ...line(['stray'], TYPED_LEFT + 'Referring provider:'.length * 14 + 14, 440),
      ...line(['stray'], TYPED_LEFT + 'Reason for referral:'.length * 14 + 14, 580),
    ];
    for (const rot of ROTATIONS) {
      const ocr = build(typedSpecs({ value: SHORT, extra }), rot);
      const { result, details } = extractWithDetails(ocr);
      for (const name of FIELD_ORDER) {
        const f = result.fields.find((x) => x.name === name);
        expect(f).toMatchObject({ value: null, wordIds: [], confidence: 0, flags: [flagFor(name)] });
        expect(details.find((d) => d.field === name)).toMatchObject({
          pageLayout: 'unknown',
          layout: null,
          reason: 'layout-unclear',
        });
      }
    }
  });

  it('fewer than three labels is unknown too', () => {
    const skip = FIELD_ORDER.slice(2);
    const ocr = build(typedSpecs({ value: SHORT, skip }));
    const { result } = extractWithDetails(ocr);
    for (const name of FIELD_ORDER.slice(0, 2)) {
      expect(result.fields.find((x) => x.name === name)?.flags).toEqual([flagFor(name)]);
      expect(result.fields.find((x) => x.name === name)?.value).toBeNull();
    }
  });
});

describe('table page with a stray word below a label', () => {
  const VALUES: Record<FieldName, string[][]> = {
    patientName: [['Jasper', 'Hartley']],
    dob: [['09/06/1938']],
    referringProvider: [['Dr', 'Iris', 'Ellery,', 'Maple'], ['Hollow', 'Practice']],
    npi: [['8428731565']],
    reason: [['ENT', 'evaluation,', 'recurring', 'sinus', 'congestion']],
    urgency: [['routine']],
    callbackPhone: [['555-0147']],
  };

  it('is exact or null with a flag, never wrong and unflagged', () => {
    let flagged = 0;
    let total = 0;
    FIELD_ORDER.forEach((target, row) => {
      for (const text of ['~', '.', 'RECEI']) {
        for (const dy of [40, 55, 70]) {
          for (const rot of ROTATIONS) {
            const opts: PageOptions = {
              value: VALUES,
              extra: [{ text, x: TABLE_LABEL_X + 20, y: 300 + 100 * row + dy }],
            };
            const ocr = build(tableSpecs(opts), rot);
            for (const name of FIELD_ORDER) {
              const result = outcome(ocr, name, expectedOf(VALUES, name));
              if (name === target) {
                total += 1;
                if (result === 'flagged') flagged += 1;
              }
            }
          }
        }
      }
    });
    expect(total).toBe(FIELD_ORDER.length * 3 * 3 * ROTATIONS.length);
    // Not vacuous: a stray in the label column makes the field null with the flag.
    expect(flagged).toBeGreaterThan(0);
  });
});
