import type { Field, FieldName } from '../../src/extract/schema.js';
import {
  DOB_FUTURE_FLAG,
  DOB_NOT_A_DATE_FLAG,
  DOB_TOO_OLD_FLAG,
  NPI_FLAG,
  PHONE_FLAG,
} from '../../src/validators/messages.js';
import { editFlag } from './edit-check';
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
      /**
       * True when the reviewer accepted a value while a validator check on it was failing
       * and the value was unchanged from what the check failed on.
       */
      acceptedDespiteFlag: boolean;
      /** The exact validator messages that were failing. Empty when acceptedDespiteFlag is false. */
      failedChecks: string[];
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

/** Review state for one fax and one reader. Saved in this browser only (see storage.ts). */
export interface ReviewState {
  readonly actions: readonly ReviewAction[];
}

export const EMPTY_REVIEW: ReviewState = { actions: [] };

export type ReviewEvent =
  | {
      type: 'accept';
      field: FieldName;
      originalValue: string | null;
      /** Validator messages standing on the field at Accept (see validatorFailures). Default: none. */
      failedChecks?: readonly string[];
      at: string;
    }
  | { type: 'edit'; field: FieldName; originalValue: string | null; newValue: string; at: string }
  | { type: 'cancel' };

/** The action an accept or edit event records. Cancel records nothing. */
export function actionFromEvent(event: ReviewEvent): ReviewAction | null {
  if (event.type === 'accept') {
    const failedChecks = [...(event.failedChecks ?? [])];
    return {
      field: event.field,
      action: 'accepted',
      originalValue: event.originalValue,
      acceptedDespiteFlag: failedChecks.length > 0,
      failedChecks,
      at: event.at,
    };
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

/** The reviewer's side of one field. */
export interface FieldReview {
  reviewed: boolean;
  /** The reviewer's value: the newest edit, kept when it is accepted later. */
  enteredValue: string | null;
  /** The latest action is an Accept (the reviewer confirmed the value shown, even an empty one). */
  accepted: boolean;
  /** The latest action is an Accept made while a validator check was failing. Cleared by any later action. */
  acceptedDespiteFlag: boolean;
  /** The validator messages of that Accept, or an empty list. */
  failedChecks: string[];
}

export function fieldReview(state: ReviewState, name: FieldName): FieldReview {
  let latest: ReviewAction | undefined;
  let entered: string | null = null;
  for (const action of state.actions) {
    if (action.field !== name) continue;
    latest = action;
    if (action.action === 'edited') entered = action.newValue;
  }
  if (!latest) {
    return { reviewed: false, enteredValue: null, accepted: false, acceptedDespiteFlag: false, failedChecks: [] };
  }
  const despite = latest.action === 'accepted' && latest.acceptedDespiteFlag;
  return {
    reviewed: true,
    enteredValue: entered,
    accepted: latest.action === 'accepted',
    acceptedDespiteFlag: despite,
    failedChecks: latest.action === 'accepted' && despite ? [...latest.failedChecks] : [],
  };
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

/**
 * The flag messages that still stand for a field, in the order shown.
 *  - Not edited: the reader's flags, until the reviewer acts on them.
 *  - Edited: the validator message for the reviewer's value (if it is bad), until the
 *    reviewer accepts that value. A good value clears the flag.
 * `referenceDate` (YYYY-MM-DD) is "today" for the date of birth check.
 */
export function standingFlags(
  field: Field,
  state: ReviewState,
  referenceDate: string,
): string[] {
  const review = fieldReview(state, field.name);
  if (review.enteredValue !== null) {
    if (review.accepted) return [];
    const message = editFlag(field.name, review.enteredValue, referenceDate);
    return message === null ? [] : [message];
  }
  return isOriginallyFlagged(field) && !review.reviewed ? [...field.flags] : [];
}

/** The validator messages (NPI, date of birth, phone) and nothing else. Matched by message. */
const VALIDATOR_FLAGS: ReadonlySet<string> = new Set([
  NPI_FLAG,
  DOB_NOT_A_DATE_FLAG,
  DOB_FUTURE_FLAG,
  DOB_TOO_OLD_FLAG,
  PHONE_FLAG,
]);

/**
 * The validator messages standing on a field right now: what Accept would accept despite.
 * Reader flags that are not validator messages (label not found, not read clearly) are left out.
 * Standing flags always describe the value now shown, so the value is unchanged by definition.
 */
export const validatorFailures = (field: Field, state: ReviewState, referenceDate: string): string[] =>
  standingFlags(field, state, referenceDate).filter((message) => VALIDATOR_FLAGS.has(message));

/** Fields that are flagged and not yet reviewed: originally flagged, or flagged again by a bad edit. */
export function unreviewedFlagged(fields: readonly Field[], state: ReviewState, referenceDate: string): Field[] {
  return fields.filter((field) => standingFlags(field, state, referenceDate).length > 0);
}

/** Verify is allowed only when no field is flagged and unreviewed (R5.3). */
export const canVerify = (fields: readonly Field[], state: ReviewState, referenceDate: string): boolean =>
  unreviewedFlagged(fields, state, referenceDate).length === 0;

export const NOT_YET_REVIEWED = 'Not yet reviewed';
export const REVIEW_IN_PROGRESS = 'Review in progress';
export const READY_TO_VERIFY = 'Ready to verify';
/** The status of a verified record. */
export const LAID_TO_REST = 'Laid to rest';

/**
 * The status line. Ready to verify when no flagged field is waiting (so a fax with no
 * flags is ready at once). Otherwise "Not yet reviewed" until a field is reviewed, then
 * "Review in progress".
 */
export function reviewStatus(fields: readonly Field[], state: ReviewState, referenceDate: string): string {
  if (unreviewedFlagged(fields, state, referenceDate).length === 0) return READY_TO_VERIFY;
  const anyReviewed = fields.some((field) => fieldReview(state, field.name).reviewed);
  return anyReviewed ? REVIEW_IN_PROGRESS : NOT_YET_REVIEWED;
}

/** Plain reason shown beside the Verify record button. */
export function verifyReason(fields: readonly Field[], state: ReviewState, referenceDate: string): string {
  const waiting = unreviewedFlagged(fields, state, referenceDate);
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

/** Plain line shown beside the Verify record button. */
export const VERIFY_NOTE = 'Check each value against the fax before verifying.';

export const NO_ANSWER_VERIFY_REASON = 'There is no saved model answer to verify. Show the rules reader.';

export const reviewKey = (faxId: string, reader: string): string => `${faxId}|${reader}`;