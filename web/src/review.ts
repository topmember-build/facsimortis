import type { SampleFax } from '../../src/samples/schema.js';
import type { ReaderName } from './flags';
import type { VerifiedRecord } from './record';
import {
  EMPTY_REVIEW,
  LAID_TO_REST,
  NOT_YET_REVIEWED,
  reviewKey,
  reviewStatus,
  type ReviewState,
} from './review-state';

/** The review status for one fax and reader, as shown in the inbox row. */
export function reviewLabel(
  fax: SampleFax,
  reader: ReaderName,
  reviews: Readonly<Record<string, ReviewState>>,
  referenceDate: string,
  verified: Readonly<Record<string, VerifiedRecord>> = {},
): string {
  const result = fax.readers[reader];
  if (result.status !== 'ok') return NOT_YET_REVIEWED;
  const key = reviewKey(fax.id, reader);
  if (verified[key]) return LAID_TO_REST;
  return reviewStatus(result.fields, reviews[key] ?? EMPTY_REVIEW, referenceDate);
}
