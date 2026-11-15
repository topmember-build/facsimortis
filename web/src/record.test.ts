import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FIELD_ORDER, type FieldName } from '../../src/extract/schema.js';
import { SAMPLE_DATA_VERSION, SampleFaxSchema, type SampleFax } from '../../src/samples/schema.js';
import {
  SYNTHETIC_NOTICE,
  VERIFIER_LABEL,
  VerifiedRecordSchema,
  buildVerifiedRecord,
  exportFileName,
  serialiseRecord,
  verifiedLine,
} from './record';
import { EMPTY_REVIEW, reviewReducer, type ReviewState } from './review-state';
import { committedFaxes } from './test-site';

const fax3: SampleFax = SampleFaxSchema.parse(committedFaxes['fax-0003.json']);
const REF = '2026-10-01';
const VERIFIED_AT = '2026-10-01T09:30:02.000Z';

function reviewed(): ReviewState {
  let state = reviewReducer(EMPTY_REVIEW, {
    type: 'accept',
    field: 'npi',
    originalValue: '6720988041',
    at: '2026-10-01T09:30:00.000Z',
  });
  state = reviewReducer(state, {
    type: 'edit',
    field: 'callbackPhone',
    originalValue: '555~0151',
    newValue: '555-0151',
    at: '2026-10-01T09:30:01.000Z',
  });
  return state;
}

const build = (state: ReviewState) =>
  buildVerifiedRecord({ fax: fax3, reader: 'model', referenceDate: REF, sampleDataVersion: SAMPLE_DATA_VERSION, state, verifiedAt: VERIFIED_AT })!;

describe('buildVerifiedRecord (fax-0003, model, Accept NPI, Edit phone)', () => {
  const state = reviewed();
  const record = build(state);

  it('has the header fields and the seven fields in schema order', () => {
    expect(record).toMatchObject({
      synthetic: true,
      notice: SYNTHETIC_NOTICE,
      faxId: 'fax-0003',
      reader: 'model',
      readerEngine: expect.any(String),
      sampleDataVersion: SAMPLE_DATA_VERSION,
      referenceDate: REF,
      verifiedAt: VERIFIED_AT,
      verifier: VERIFIER_LABEL,
    });
    expect(record.fields.map((f) => f.name)).toEqual([...FIELD_ORDER]);
    expect(VerifiedRecordSchema.safeParse(record).success).toBe(true);
  });

  it('keeps the page value, takes the reviewer value, and marks the source', () => {
    const phone = record.fields.find((f) => f.name === 'callbackPhone')!;
    expect(phone).toMatchObject({
      originalValue: '555~0151',
      finalValue: '555-0151',
      source: 'reviewer',
      reviewed: true,
    });
    expect(phone.originalFlags.length).toBeGreaterThan(0);
    const npi = record.fields.find((f) => f.name === 'npi')!;
    expect(npi).toMatchObject({ originalValue: '6720988041', finalValue: '6720988041', source: 'page', reviewed: true });
    const name = record.fields.find((f) => f.name === 'patientName')!;
    expect(name).toMatchObject({ source: 'page', reviewed: false, finalValue: name.originalValue });
  });

  it('lists the actions as recorded and leaves the reader data untouched', () => {
    expect(record.actions).toEqual(state.actions);
    expect(record.actions.map((a) => a.action)).toEqual(['accepted', 'edited']);
    const read = fax3.readers.model;
    if (read.status !== 'ok') throw new Error('expected an answer');
    expect(record.fields.map((f) => f.originalValue)).toEqual(read.fields.map((f) => f.value));
    expect(record.fields.map((f) => f.wordIds)).toEqual(read.fields.map((f) => f.wordIds));
  });

  it('serialises as pretty JSON with a trailing newline that parses back to the record', () => {
    const text = serialiseRecord(record);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "faxId": "fax-0003"');
    expect(JSON.parse(text)).toEqual(record);
  });

  it('names the export file and writes the verified line', () => {
    expect(exportFileName(record)).toBe('facsimortis-fax-0003-model-verified.json');
    expect(verifiedLine(VERIFIED_AT)).toBe('Verified on Oct 1, 09:30. This record is read-only.');
  });

  it('returns null when the reader has no answer', () => {
    const none: SampleFax = { ...fax3, readers: { ...fax3.readers, model: { status: 'no-saved-answer', message: 'x' } } };
    expect(
      buildVerifiedRecord({ fax: none, reader: 'model', referenceDate: REF, sampleDataVersion: 2, state: EMPTY_REVIEW, verifiedAt: VERIFIED_AT }),
    ).toBeNull();
  });
});

describe('property: nothing original is overwritten', () => {
  it('keeps every original value and the action list for any sequence of edits', () => {
    const edit = fc.record({
      field: fc.constantFrom<FieldName>(...FIELD_ORDER),
      newValue: fc.string({ minLength: 1 }).filter((s) => s.trim() !== ''),
    });
    fc.assert(
      fc.property(fc.array(edit, { maxLength: 8 }), (edits) => {
        let state = EMPTY_REVIEW;
        edits.forEach((e, i) => {
          const field = (fax3.readers.model.status === 'ok' ? fax3.readers.model.fields : []).find((f) => f.name === e.field)!;
          state = reviewReducer(state, {
            type: 'edit',
            field: e.field,
            originalValue: field.value,
            newValue: e.newValue,
            at: `2026-10-01T09:30:${String(i).padStart(2, '0')}.000Z`,
          });
        });
        const record = build(state);
        const read = fax3.readers.model.status === 'ok' ? fax3.readers.model.fields : [];
        expect(record.fields.map((f) => f.originalValue)).toEqual(read.map((f) => f.value));
        expect(record.actions).toEqual(state.actions);
        for (const f of record.fields) {
          const last = [...edits].reverse().find((e) => e.field === f.name);
          expect(f.finalValue).toBe(last ? last.newValue : f.originalValue);
          expect(f.source).toBe(last ? 'reviewer' : 'page');
        }
      }),
    );
  });
});
