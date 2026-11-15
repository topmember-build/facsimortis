import type { SampleFax } from '../../src/samples/schema.js';
import type { ReaderName } from './flags';
import { EMPTY_REVIEW, NOT_YET_REVIEWED, reviewKey, reviewStatus, type ReviewState } from './review-state';

/** The review status for one fax and reader, as shown in the inbox row. */
export function reviewLabel(fax: SampleFax, reader: ReaderName, reviews: Readonly<Record<string, ReviewState>>): string {
  const result = fax.readers[reader];
  if (result.status !== 'ok') return NOT_YET_REVIEWED;
  return reviewStatus(result.fields, reviews[reviewKey(fax.id, reader)] ?? EMPTY_REVIEW);
}