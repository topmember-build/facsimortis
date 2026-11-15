import type { ReaderResult } from '../../src/samples/schema.js';

export type ReaderName = 'model' | 'rules';

export const DEFAULT_READER: ReaderName = 'model';

/** Plain words for the reader in use, shown on screen. */
export const READER_LABEL: Record<ReaderName, string> = {
  model: 'Reader: model (saved answers)',
  rules: 'Reader: rules',
};

/** Short label used instead of a number when the model has no saved answer. */
export const NO_SAVED_ANSWER_LABEL = 'No saved model answer';

export type FlagSummary =
  | { status: 'ok'; count: number }
  | { status: 'no-saved-answer'; message: string };

/**
 * Flagged fields for one reader's result. A field is flagged when its flags list is not
 * empty. No confidence threshold and no other rule. A result with no saved answer has no
 * count, so it never reports 0.
 */
export function summariseFlags(result: ReaderResult): FlagSummary {
  if (result.status === 'no-saved-answer') {
    return { status: 'no-saved-answer', message: result.message };
  }
  return { status: 'ok', count: result.fields.filter((field) => field.flags.length > 0).length };
}
