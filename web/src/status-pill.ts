import type { SampleFax } from '../../src/samples/schema.js';
import { formatReceived } from './format';
import { NO_SAVED_ANSWER_LABEL, type ReaderName } from './flags';
import type { VerifiedRecord } from './record';
import { reviewLabel } from './review';
import {
  EMPTY_REVIEW,
  REVIEW_IN_PROGRESS,
  isOriginallyFlagged,
  reviewKey,
  standingFlags,
  type ReviewState,
} from './review-state';

/** The states a row can be in. Each has its own icon shape and border or fill (see styles.css). */
export type PillKind =
  | 'flagged' // flags waiting, nothing reviewed yet
  | 'in-progress' // flags waiting, some reviewed
  | 'reviewed' // every flagged field reviewed, not yet verified
  | 'laid-to-rest' // verified
  | 'no-flags' // nothing flagged, not yet verified
  | 'no-answer'; // no saved model answer

/** One icon per state, each a different shape. The icon is decoration: the text carries the meaning. */
export const PILL_ICONS: Readonly<Record<PillKind, string>> = {
  flagged: '⚑',
  'in-progress': '◐',
  reviewed: '✓',
  'laid-to-rest': '●',
  'no-flags': '○',
  'no-answer': '–',
};

export const NO_FLAGS_LABEL = 'No flags raised';

export interface StatusPill {
  kind: PillKind;
  icon: string;
  /** The flag part, for example "2 flagged, 1 reviewed" or "No flags raised". */
  flagText: string;
  /** The review state, for example "Ready to verify". */
  reviewText: string;
  /** The whole status in words, for screen readers. */
  sentence: string;
}

/**
 * The accessible name of an inbox row, for example
 * "fax-0003, received Oct 1, 09:14, 2 flagged, reviewed, Laid to rest".
 * The time is the visible one (formatReceived). `status` is the pill sentence, or for a fax
 * that failed to load, "Could not be read. <error>". Pure.
 */
export function rowAccessibleName(id: string, receivedAt: string, status: string): string {
  return `${id}, received ${formatReceived(receivedAt)}, ${status}`;
}

/** The status part of a row's name when its fax failed to load. */
export function failedRowStatus(error: string): string {
  return `Could not be read. ${error}`;
}

/**
 * The one status pill for a row: flags and review state together, for the chosen reader.
 * Pure. A flagged field counts as reviewed once nothing stands on it any more.
 */
export function statusPill(
  fax: SampleFax,
  reader: ReaderName,
  reviews: Readonly<Record<string, ReviewState>>,
  referenceDate: string,
  verified: Readonly<Record<string, VerifiedRecord>> = {},
): StatusPill {
  const reviewText = reviewLabel(fax, reader, reviews, referenceDate, verified);
  const result = fax.readers[reader];
  const make = (kind: PillKind, flagText: string): StatusPill => ({
    kind,
    icon: PILL_ICONS[kind],
    flagText,
    reviewText,
    sentence: `${flagText}, ${reviewText}`,
  });

  if (result.status !== 'ok') {
    return make('no-answer', NO_SAVED_ANSWER_LABEL);
  }

  const key = reviewKey(fax.id, reader);
  const state = reviews[key] ?? EMPTY_REVIEW;
  // Flagged as read, or flagged again by a bad edit.
  const flagged = result.fields.filter(
    (field) => isOriginallyFlagged(field) || standingFlags(field, state, referenceDate).length > 0,
  );
  const waiting = flagged.filter((field) => standingFlags(field, state, referenceDate).length > 0);
  const total = flagged.length;
  const reviewed = total - waiting.length;

  if (verified[key]) {
    return make('laid-to-rest', total === 0 ? NO_FLAGS_LABEL : `${total} flagged, reviewed`);
  }
  if (total === 0) return make('no-flags', NO_FLAGS_LABEL);
  if (waiting.length === 0) return make('reviewed', `${total} flagged, reviewed`);
  if (reviewText === REVIEW_IN_PROGRESS) return make('in-progress', `${total} flagged, ${reviewed} reviewed`);
  return make('flagged', `${total} flagged`);
}
