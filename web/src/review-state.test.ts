import { describe, expect, it } from 'vitest';
import type { Field, FieldName } from '../../src/extract/schema.js';
import {
  EMPTY_REVIEW,
  canVerify,
  fieldReview,
  reviewReducer,
  reviewStatus,
  sortForReview,
  unreviewedFlagged,
  verifyReason,
  type ReviewState,
} from './review-state';

const ORDER: FieldName[] = ['patientName', 'dob', 'referringProvider', 'npi', 'reason', 'urgency', 'callbackPhone'];

function field(name: FieldName, confidence: number, flagged = false, value: string | null = 'x'): Field {
  return {
    name,
    value,
    wordIds: value === null ? [] : ['w1'],
    confidence,
    flags: flagged || value === null ? ['Check this.'] : [],
    reviewed: false,
  };
}

const names = (fields: Field[]) => fields.map((f) => f.name);
const AT = '2025-01-02T03:04:05.000Z';
const REF = '2026-10-01';

describe('sortForReview', () => {
  it('puts flagged fields first, then lowest confidence first within each group', () => {
    const fields = [
      field('patientName', 0.5),
      field('dob', 0.9, true),
      field('referringProvider', 0.2),
      field('npi', 0.4, true),
    ];
    expect(names(sortForReview(fields))).toEqual(['npi', 'dob', 'referringProvider', 'patientName']);
  });

  it('counts an empty field as confidence 0 and keeps schema order for ties', () => {
    const fields = [
      field('patientName', 0.7),
      field('dob', 0.7),
      field('npi', 0.9, true, null),
      field('reason', 0.0, true, null),
      field('callbackPhone', 0.3, true),
    ];
    // npi has a stored confidence of 0.9, but it is empty so it counts as 0.
    expect(names(sortForReview(fields))).toEqual(['npi', 'reason', 'callbackPhone', 'patientName', 'dob']);
  });

  it('uses the original flags and does not change its input', () => {
    const fields = ORDER.map((name) => field(name, 0.5));
    const copy = structuredClone(fields);
    expect(names(sortForReview(fields))).toEqual(ORDER);
    expect(fields).toEqual(copy);
  });
});

describe('reviewReducer', () => {
  const npi = field('npi', 0.94, true, '6720988041');

  it('records an accept with the original value and the time given', () => {
    const next = reviewReducer(EMPTY_REVIEW, { type: 'accept', field: 'npi', originalValue: '6720988041', at: AT });
    expect(next.actions).toEqual([{ field: 'npi', action: 'accepted', originalValue: '6720988041', at: AT }]);
    expect(fieldReview(next, 'npi')).toEqual({ reviewed: true, enteredValue: null, accepted: true });
    expect(EMPTY_REVIEW.actions).toEqual([]);
  });

  it('records an accept of an empty field', () => {
    const next = reviewReducer(EMPTY_REVIEW, { type: 'accept', field: 'reason', originalValue: null, at: AT });
    expect(next.actions[0]).toEqual({ field: 'reason', action: 'accepted', originalValue: null, at: AT });
  });

  it('records an edit and appends a second edit without changing the first', () => {
    const first = reviewReducer(EMPTY_REVIEW, {
      type: 'edit', field: 'npi', originalValue: '6720988041', newValue: '1', at: AT,
    });
    const second = reviewReducer(first, {
      type: 'edit', field: 'npi', originalValue: '6720988041', newValue: '2', at: '2025-01-02T03:05:00.000Z',
    });
    expect(second.actions).toHaveLength(2);
    expect(second.actions[0]).toEqual(first.actions[0]);
    expect(first.actions).toHaveLength(1);
    expect(fieldReview(second, 'npi').enteredValue).toBe('2');
  });

  it('changes nothing on cancel', () => {
    const state: ReviewState = reviewReducer(EMPTY_REVIEW, { type: 'accept', field: 'npi', originalValue: null, at: AT });
    expect(reviewReducer(state, { type: 'cancel' })).toBe(state);
  });

  it('never touches the field as read', () => {
    const before = structuredClone(npi);
    reviewReducer(EMPTY_REVIEW, { type: 'edit', field: 'npi', originalValue: npi.value, newValue: 'z', at: AT });
    expect(npi).toEqual(before);
  });

  it('keeps one state per fax and reader when states are held separately', () => {
    const states: Record<string, ReviewState> = {};
    states['a|model'] = reviewReducer(EMPTY_REVIEW, { type: 'accept', field: 'npi', originalValue: null, at: AT });
    expect(states['a|rules'] ?? EMPTY_REVIEW).toBe(EMPTY_REVIEW);
    expect(states['a|model']!.actions).toHaveLength(1);
  });
});

describe('verify rule and status', () => {
  const fields = [field('patientName', 0.9), field('npi', 0.9, true), field('callbackPhone', 0.8, true)];
  const accept = (state: ReviewState, name: FieldName) =>
    reviewReducer(state, { type: 'accept', field: name, originalValue: 'x', at: AT });

  it('is blocked while a flagged field is unreviewed and names the fields in schema order', () => {
    expect(canVerify(fields, EMPTY_REVIEW, REF)).toBe(false);
    expect(unreviewedFlagged(fields, EMPTY_REVIEW, REF).map((f) => f.name)).toEqual(['npi', 'callbackPhone']);
    expect(verifyReason(fields, EMPTY_REVIEW, REF)).toBe(
      '2 flagged fields still need review: Provider number (NPI), Callback phone.',
    );
    expect(reviewStatus(fields, EMPTY_REVIEW, REF)).toBe('Not yet reviewed');
  });

  it('counts down and then allows verifying', () => {
    const one = accept(EMPTY_REVIEW, 'npi');
    expect(verifyReason(fields, one, REF)).toBe('1 flagged field still needs review: Callback phone.');
    expect(reviewStatus(fields, one, REF)).toBe('Review in progress');
    const done = accept(one, 'callbackPhone');
    expect(canVerify(fields, done, REF)).toBe(true);
    expect(reviewStatus(fields, done, REF)).toBe('Ready to verify');
    expect(verifyReason(fields, done, REF)).toContain('You can verify the record');
  });

  it('allows verifying a fax with no flags at once', () => {
    const clean = [field('patientName', 0.9)];
    expect(canVerify(clean, EMPTY_REVIEW, REF)).toBe(true);
    expect(reviewStatus(clean, EMPTY_REVIEW, REF)).toBe('Ready to verify');
  });
});