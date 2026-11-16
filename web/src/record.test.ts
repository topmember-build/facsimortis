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
  summarise,
  summaryLines,
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
  buildVerifiedRecord({ fax: fax3, reader: 'model', referenceDate: REF, sampleDataVersion: SAMPLE_DATA_VERSION, state, verifiedAtUtc: VERIFIED_AT })!;

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
      verifiedAtUtc: VERIFIED_AT,
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
    expect(verifiedLine(VERIFIED_AT)).toBe('Verified on Oct 1, 09:30 UTC. This record is read-only.');
  });

  it('labels times as UTC in the export: verifiedAtUtc and atUtc, ending in Z, no old keys', () => {
    const json = JSON.parse(serialiseRecord(record)) as Record<string, unknown> & { actions: Record<string, unknown>[] };
    expect(json['verifiedAtUtc']).toMatch(/Z$/);
    expect(json).not.toHaveProperty('verifiedAt');
    for (const action of json.actions) {
      expect(action['atUtc']).toMatch(/Z$/);
      expect(action).not.toHaveProperty('at');
    }
    expect(VerifiedRecordSchema.safeParse({ ...record, verifiedAtUtc: '2026-10-01T09:30:02.000+02:00' }).success).toBe(false);
    expect(VerifiedRecordSchema.safeParse({ ...record, verifiedAtUtc: '2026-10-01T09:30:02.000' }).success).toBe(false);
  });

  it('returns null when the reader has no answer', () => {
    const none: SampleFax = { ...fax3, readers: { ...fax3.readers, model: { status: 'no-saved-answer', message: 'x' } } };
    expect(
      buildVerifiedRecord({ fax: none, reader: 'model', referenceDate: REF, sampleDataVersion: 2, state: EMPTY_REVIEW, verifiedAtUtc: VERIFIED_AT }),
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

describe('acceptedDespiteFlag in the record', () => {
  const FAILED = ['The provider number looks wrong: the last digit does not match.'];
  const despite = reviewReducer(EMPTY_REVIEW, {
    type: 'accept',
    field: 'npi',
    originalValue: '6720988041',
    failedChecks: FAILED,
    at: '2026-10-01T09:30:00.000Z',
  });

  it('carries the flag and messages on the field and the action, and false everywhere else', () => {
    const record = build(despite);
    expect(record.fields.map((f) => f.acceptedDespiteFlag)).toEqual(FIELD_ORDER.map((n) => n === 'npi'));
    expect(record.fields.find((f) => f.name === 'npi')!.failedChecks).toEqual(FAILED);
    expect(record.fields.filter((f) => f.name !== 'npi').every((f) => f.failedChecks.length === 0)).toBe(true);
    expect(record.actions[0]).toMatchObject({ acceptedDespiteFlag: true, failedChecks: FAILED });
    expect(VerifiedRecordSchema.safeParse(JSON.parse(serialiseRecord(record))).success).toBe(true);
  });

  it('requires the boolean on every field', () => {
    const record = JSON.parse(serialiseRecord(build(despite))) as { fields: Record<string, unknown>[] };
    delete record.fields[0]!['acceptedDespiteFlag'];
    expect(VerifiedRecordSchema.safeParse(record).success).toBe(false);
  });

  it('final field state is false after a later valid edit, and the earlier action stays true', () => {
    const later = reviewReducer(despite, {
      type: 'edit', field: 'npi', originalValue: '6720988041', newValue: '1234567893', at: '2026-10-01T09:30:01.000Z',
    });
    const record = build(later);
    expect(record.fields.find((f) => f.name === 'npi')).toMatchObject({ acceptedDespiteFlag: false, failedChecks: [] });
    expect(record.actions.map((a) => a.action)).toEqual(['accepted', 'edited']);
    expect(record.actions[0]).toMatchObject({ acceptedDespiteFlag: true });
  });
});
describe('summary counts (export change b)', () => {
  const fax1: SampleFax = SampleFaxSchema.parse(committedFaxes['fax-0001.json']);
  const buildFor = (fax: SampleFax, state: ReviewState) =>
    buildVerifiedRecord({ fax, reader: 'model', referenceDate: REF, sampleDataVersion: SAMPLE_DATA_VERSION, state, verifiedAtUtc: VERIFIED_AT })!;
  const FAILED = ['The provider number looks wrong: the last digit does not match.'];

  it('fax-0003 after Accept NPI (check failed) and Edit phone to 555-0151', () => {
    let state = reviewReducer(EMPTY_REVIEW, {
      type: 'accept', field: 'npi', originalValue: '6720988041', failedChecks: FAILED, at: '2026-10-01T09:30:00.000Z',
    });
    state = reviewReducer(state, {
      type: 'edit', field: 'callbackPhone', originalValue: '555~0151', newValue: '555-0151', at: '2026-10-01T09:30:01.000Z',
    });
    const record = buildFor(fax3, state);
    expect(record.summary).toEqual({
      totalFields: 7, flagged: 2, reviewed: 2, edited: 1, acceptedDespiteFlag: 1, notFlaggedNotChecked: 5,
    });
    expect(summaryLines(record.summary)).toEqual([
      '7 fields',
      '2 were flagged',
      '2 reviewed by you',
      '1 edited by you',
      '1 accepted although the check failed',
      '5 not flagged and not checked by a reviewer',
    ]);
  });

  it('fax-0001 verified with no action', () => {
    const record = buildFor(fax1, EMPTY_REVIEW);
    expect(record.summary).toEqual({
      totalFields: 7, flagged: 0, reviewed: 0, edited: 0, acceptedDespiteFlag: 0, notFlaggedNotChecked: 7,
    });
    expect(summaryLines(record.summary)[1]).toBe('0 were flagged');
  });

  it('uses singular forms for one', () => {
    expect(summaryLines({ totalFields: 1, flagged: 1, reviewed: 1, edited: 1, acceptedDespiteFlag: 1, notFlaggedNotChecked: 1 })[0]).toBe('1 field');
    expect(summaryLines({ totalFields: 7, flagged: 1, reviewed: 0, edited: 0, acceptedDespiteFlag: 0, notFlaggedNotChecked: 0 })[1]).toBe('1 was flagged');
  });

  it('property: the counts are consistent for any sequence of accepts and edits', () => {
    const step = fc.record({
      field: fc.constantFrom<FieldName>(...FIELD_ORDER),
      kind: fc.constantFrom('accept', 'acceptDespite', 'edit'),
      newValue: fc.string({ minLength: 1 }).filter((s) => s.trim() !== ''),
    });
    fc.assert(
      fc.property(fc.array(step, { maxLength: 10 }), (steps) => {
        let state = EMPTY_REVIEW;
        steps.forEach((s, i) => {
          const at = `2026-10-01T09:30:${String(i).padStart(2, '0')}.000Z`;
          const read = fax3.readers.model.status === 'ok' ? fax3.readers.model.fields : [];
          const originalValue = read.find((f) => f.name === s.field)!.value;
          state =
            s.kind === 'edit'
              ? reviewReducer(state, { type: 'edit', field: s.field, originalValue, newValue: s.newValue, at })
              : reviewReducer(state, {
                  type: 'accept', field: s.field, originalValue, at,
                  ...(s.kind === 'acceptDespite' ? { failedChecks: FAILED } : {}),
                });
        });
        const record = buildFor(fax3, state);
        const sum = record.summary;
        expect(sum).toEqual(summarise(record.fields));
        expect(sum.totalFields).toBe(7);
        const flagged = new Set(record.fields.filter((f) => f.originalFlags.length > 0).map((f) => f.name));
        const reviewedSet = new Set(record.fields.filter((f) => f.reviewed).map((f) => f.name));
        const neither = new Set(record.fields.filter((f) => !flagged.has(f.name) && !reviewedSet.has(f.name)).map((f) => f.name));
        for (const f of record.fields) {
          expect(flagged.has(f.name) || reviewedSet.has(f.name) || neither.has(f.name)).toBe(true);
        }
        expect(sum.notFlaggedNotChecked).toBe(7 - new Set([...flagged, ...reviewedSet]).size);
        expect(sum.flagged).toBe(flagged.size);
        expect(sum.reviewed).toBe(reviewedSet.size);
        expect(sum.edited).toBeLessThanOrEqual(sum.reviewed);
        expect(sum.acceptedDespiteFlag).toBeLessThanOrEqual(sum.reviewed);
      }),
    );
  });
});