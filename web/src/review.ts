import type { SampleFax } from '../../src/samples/schema.js';

export const NOT_YET_REVIEWED = 'Not yet reviewed';

/**
 * Review comes later (2.5). For now a fax is shown as "Not yet reviewed" when no field
 * in either reader's result has been reviewed. Nothing else is claimed.
 */
export function reviewLabel(fax: SampleFax): string | null {
  const anyReviewed = (['model', 'rules'] as const).some((name) => {
    const result = fax.readers[name];
    return result.status === 'ok' && result.fields.some((field) => field.reviewed);
  });
  return anyReviewed ? null : NOT_YET_REVIEWED;
}
