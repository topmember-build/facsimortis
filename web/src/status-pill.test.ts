import { describe, expect, it } from 'vitest';
import { SampleFaxSchema, type SampleFax } from '../../src/samples/schema.js';
import type { FieldName } from '../../src/extract/schema.js';
import type { VerifiedRecord } from './record';
import { EMPTY_REVIEW, reviewKey, reviewReducer, type ReviewState } from './review-state';
import { formatReceived } from './format';
import { PILL_ICONS, failedRowStatus, rowAccessibleName, statusPill, type PillKind } from './status-pill';
import { committedFaxes } from './test-site';

const REF = '2026-10-01';
const AT = '2026-10-01T09:30:00.000Z';
const fax = (id: string) => SampleFaxSchema.parse(committedFaxes[`${id}.json`]);
const accept = (state: ReviewState, field: FieldName) =>
  reviewReducer(state, { type: 'accept', field, originalValue: 'x', at: AT });
const reviews = (fax: SampleFax, state: ReviewState): Record<string, ReviewState> => ({
  [reviewKey(fax.id, 'model')]: state,
});
// Only the presence of a verified record matters to the pill.
const verifiedFor = (fax: SampleFax) => ({ [reviewKey(fax.id, 'model')]: {} as VerifiedRecord });

/** fax-0003 with the flags removed from every field except those named. */
function withFlagsOn(names: FieldName[]): SampleFax {
  const copy = structuredClone(fax('fax-0003'));
  const result = copy.readers.model;
  if (result.status !== 'ok') throw new Error('expected a saved model answer');
  for (const field of result.fields) if (!names.includes(field.name)) field.flags = [];
  return copy;
}

describe('statusPill', () => {
  it('flagged and not yet reviewed: warm flag, count, and the review state', () => {
    const f = fax('fax-0003');
    const pill = statusPill(f, 'model', {}, REF);
    expect(pill).toMatchObject({ kind: 'flagged', icon: '⚑', flagText: '2 flagged', reviewText: 'Not yet reviewed' });
    expect(pill.sentence).toBe('2 flagged, Not yet reviewed');
  });

  it('uses the singular for one flagged field', () => {
    const f = withFlagsOn(['npi']);
    expect(statusPill(f, 'model', {}, REF).flagText).toBe('1 flagged');
    const one = accept(EMPTY_REVIEW, 'npi');
    expect(statusPill(f, 'model', reviews(f, one), REF)).toMatchObject({
      kind: 'reviewed',
      flagText: '1 flagged, reviewed',
      reviewText: 'Ready to verify',
    });
  });

  it('in progress: how many of the flagged fields are reviewed', () => {
    const f = fax('fax-0003');
    const pill = statusPill(f, 'model', reviews(f, accept(EMPTY_REVIEW, 'npi')), REF);
    expect(pill).toMatchObject({
      kind: 'in-progress',
      icon: '◐',
      flagText: '2 flagged, 1 reviewed',
      reviewText: 'Review in progress',
    });
  });

  it('all flagged fields reviewed but not verified', () => {
    const f = fax('fax-0003');
    const state = accept(accept(EMPTY_REVIEW, 'npi'), 'callbackPhone');
    const pill = statusPill(f, 'model', reviews(f, state), REF);
    expect(pill).toMatchObject({ kind: 'reviewed', flagText: '2 flagged, reviewed', reviewText: 'Ready to verify' });
    expect(pill.sentence).toBe('2 flagged, reviewed, Ready to verify');
  });

  it('laid to rest keeps the flag history with a filled mark', () => {
    const f = fax('fax-0003');
    const state = accept(accept(EMPTY_REVIEW, 'npi'), 'callbackPhone');
    const pill = statusPill(f, 'model', reviews(f, state), REF, verifiedFor(f));
    expect(pill).toMatchObject({ kind: 'laid-to-rest', icon: '●', flagText: '2 flagged, reviewed', reviewText: 'Laid to rest' });
    expect(pill.sentence).toBe('2 flagged, reviewed, Laid to rest');
  });

  it('nothing flagged: "No flags raised", never a tick, before and after verifying', () => {
    const f = fax('fax-0001');
    expect(statusPill(f, 'model', {}, REF)).toMatchObject({
      kind: 'no-flags',
      icon: '○',
      flagText: 'No flags raised',
      reviewText: 'Ready to verify',
    });
    expect(statusPill(f, 'model', {}, REF, verifiedFor(f))).toMatchObject({
      kind: 'laid-to-rest',
      flagText: 'No flags raised',
      reviewText: 'Laid to rest',
    });
  });

  it('follows the chosen reader', () => {
    const f = fax('fax-0002');
    expect(statusPill(f, 'model', {}, REF).flagText).toBe('No flags raised');
    expect(statusPill(f, 'rules', {}, REF).flagText).toBe('3 flagged');
  });

  it('no saved model answer: plain text and a neutral mark, no number', () => {
    const f = structuredClone(fax('fax-0002'));
    f.readers.model = { status: 'no-saved-answer', message: 'none' };
    const pill = statusPill(f, 'model', {}, REF);
    expect(pill).toMatchObject({ kind: 'no-answer', icon: '–', flagText: 'No saved model answer' });
    expect(pill.sentence).not.toMatch(/\d/);
  });

  it('gives every state its own icon', () => {
    const icons = Object.values(PILL_ICONS);
    expect(new Set(icons).size).toBe(icons.length);
    expect(Object.keys(PILL_ICONS).sort()).toEqual(
      (['flagged', 'in-progress', 'reviewed', 'laid-to-rest', 'no-flags', 'no-answer'] as PillKind[]).sort(),
    );
  });

  it('never claims that values are right', () => {
    const f = fax('fax-0003');
    const done = accept(accept(EMPTY_REVIEW, 'npi'), 'callbackPhone');
    const texts = [
      statusPill(f, 'model', {}, REF),
      statusPill(f, 'model', reviews(f, done), REF),
      statusPill(f, 'model', reviews(f, done), REF, verifiedFor(f)),
      statusPill(fax('fax-0001'), 'model', {}, REF),
    ].map((pill) => pill.sentence);
    for (const text of texts) expect(text).not.toMatch(/correct|good|clean|\bright\b|no errors/i);
  });
});

describe('rowAccessibleName', () => {
  const at = '2026-10-01T09:14:00';

  it('puts the received time between the id and the status sentence', () => {
    const f = fax('fax-0003');
    const name = (state: ReviewState, verified = {}) =>
      rowAccessibleName(f.id, at, statusPill(f, 'model', reviews(f, state), REF, verified).sentence);
    expect(name(EMPTY_REVIEW)).toBe('fax-0003, received Oct 1, 09:14, 2 flagged, Not yet reviewed');
    expect(name(accept(EMPTY_REVIEW, 'npi'))).toBe(
      'fax-0003, received Oct 1, 09:14, 2 flagged, 1 reviewed, Review in progress',
    );
    expect(name(EMPTY_REVIEW, verifiedFor(f))).toBe('fax-0003, received Oct 1, 09:14, 2 flagged, reviewed, Laid to rest');
  });

  it('covers no flags and no saved answer', () => {
    const f1 = fax('fax-0001');
    expect(rowAccessibleName(f1.id, '2026-10-01T09:00:00', statusPill(f1, 'model', {}, REF).sentence)).toBe(
      'fax-0001, received Oct 1, 09:00, No flags raised, Ready to verify',
    );
    const none = structuredClone(f1);
    none.readers.model = { status: 'no-saved-answer', message: 'x' } as SampleFax['readers']['model'];
    const sentence = statusPill(none, 'model', {}, REF).sentence;
    expect(rowAccessibleName(none.id, '2026-10-01T09:00:00', sentence)).toMatch(/^fax-0001, received Oct 1, 09:00, No saved model answer/);
  });

  it('uses the visible time formatter and keeps the error wording for a failed fax', () => {
    expect(rowAccessibleName('fax-0002', at, failedRowStatus('It is broken.'))).toBe(
      'fax-0002, received ' + formatReceived(at) + ', Could not be read. It is broken.',
    );
  });
});