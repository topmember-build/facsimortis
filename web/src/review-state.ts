import type { Field, FieldName } from '../../src/extract/schema.js';
import { FIELD_LABELS } from './field-labels';

/**
 * One recorded review action. The list of these is append-only: an earlier action is
 * never changed or removed, and a second edit adds a new action.
 */
export type ReviewAction =
  | {
      field: FieldName;
      action: 'accepted';
      /** The value as read from the page (null: nothing was read). */
      originalValue: string | null;
      /** ISO timestamp from the injected clock. */
      at: string;
    }
  | {
      field: FieldName;
      action: 'edited';
      originalValue: string | null;
      /** What the reviewer entered. */
      newValue: string;
      at: string;
    };

/** Review state for one fax and one reader. In memory only (saving comes in 2.6). */
export interface ReviewState {
  readonly actions: readonly ReviewAction[];
}

export const EMPTY_REVIEW: ReviewState = { actions: [] };

export type ReviewEvent =
  | { type: 'accept'; field: FieldName; originalValue: string | null; at: string }
  | { type: 'edit'; field: FieldName; originalValue: string | null; newValue: string; at: string }
  | { type: 'cancel' };

/** The action an accept or edit event records. Cancel records nothing. */
export function actionFromEvent(event: ReviewEvent): ReviewAction | null {
  if (event.type === 'accept') {
    return { field: event.field, action: 'accepted', originalValue: event.originalValue, at: event.at };
  }
  if (event.type === 'edit') {
    return {
      field: event.field,
      action: 'edited',
      originalValue: event.originalValue,
      newValue: event.newValue,
      at: event.at,
    };
  }
  return null;
}

/** Pure: returns a new state with the action appended. Cancel returns the same state. */
export function reviewReducer(state: ReviewState, event: ReviewEvent): ReviewState {
  const action = actionFromEvent(event);
  if (!action) return state;
  return { actions: [...state.actions, action] };
}

/** The reviewer's side of one field: the latest action decides. */
export interface FieldReview {
  reviewed: boolean;
  /** The reviewer's value, when the latest action is an edit. */
  enteredValue: string | null;
  /** The reviewer confirmed the field as read (including an empty field). */
  accepted: boolean;
}

export function fieldReview(state: ReviewState, name: FieldName): FieldReview {
  let latest: ReviewAction | undefined;
  for (const action of state.actions) {
    if (action.field === name) latest = action;
  }
  if (!latest) return { reviewed: false, enteredValue: null, accepted: false };
  if (latest.action === 'edited') return { reviewed: true, enteredValue: latest.newValue, accepted: false };
  return { reviewed: true, enteredValue: null, accepted: true };
}

/** Flagged as read: the flags list is not empty. The reader's flags are never changed. */
export const isOriginallyFlagged = (field: Field): boolean => field.flags.length > 0;

/**
 * Order for the review panel: flagged fields first, then lowest confidence first within
 * each group. An empty field counts as confidence 0. Ties keep the order given (schema
 * order). Uses the ORIGINAL flags, so a field does not move while it is being reviewed.
 */
export function sortForReview(fields: readonly Field[]): Field[] {
  const key = (field: Field) => (field.value === null ? 0 : field.confidence);
  return fields
    .map((field, index) => ({ field, index }))
    .sort((a, b) => {
      const flagged = Number(isOriginallyFlagged(b.field)) - Number(isOriginallyFlagged(a.field));
      if (flagged !== 0) return flagged;
      const confidence = key(a.field) - key(b.field);
      return confidence !== 0 ? confidence : a.index - b.index;
    })
    .map((entry) => entry.field);
}

/** Originally flagged fields that have no review action yet, in the order given. */
export function unreviewedFlagged(fields: readonly Field[], state: ReviewState): Field[] {
  return fields.filter((field) => isOriginallyFlagged(field) && !fieldReview(state, field.name).reviewed);
}

/** Verify is allowed only when no field is flagged and unreviewed (R5.3). */
export const canVerify = (fields: readonly Field[], state: ReviewState): boolean =>
  unreviewedFlagged(fields, state).length === 0;

export const NOT_YET_REVIEWED = 'Not yet reviewed';
export const REVIEW_IN_PROGRESS = 'Review in progress';
export const READY_TO_VERIFY = 'Ready to verify';

/**
 * The status line. Ready to verify when no flagged field is waiting (so a fax with no
 * flags is ready at once). Otherwise "Not yet reviewed" until a field is reviewed, then
 * "Review in progress".
 */
export function reviewStatus(fields: readonly Field[], state: ReviewState): string {
  if (unreviewedFlagged(fields, state).length === 0) return READY_TO_VERIFY;
  const anyReviewed = fields.some((field) => fieldReview(state, field.name).reviewed);
  return anyReviewed ? REVIEW_IN_PROGRESS : NOT_YET_REVIEWED;
}

/** Plain reason shown beside the Verify record button. */
export function verifyReason(fields: readonly Field[], state: ReviewState): string {
  const waiting = unreviewedFlagged(fields, state);
  if (waiting.length === 0) {
    return fields.some(isOriginallyFlagged)
      ? 'Every flagged field has been reviewed. You can verify the record.'
      : 'No fields are flagged. You can verify the record.';
  }
  const names = waiting.map((field) => FIELD_LABELS[field.name]).join(', ');
  return waiting.length === 1
    ? `1 flagged field still needs review: ${names}.`
    : `${waiting.length} flagged fields still need review: ${names}.`;
}

export const NO_ANSWER_VERIFY_REASON = 'There is no saved model answer to verify. Show the rules reader.';

export const reviewKey = (faxId: string, reader: string): string => `${faxId}|${reader}`;