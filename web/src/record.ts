import { z } from 'zod';
import { FIELD_ORDER, FieldNameSchema, type Field } from '../../src/extract/schema.js';
import type { SampleFax } from '../../src/samples/schema.js';
import { FIELD_LABELS } from './field-labels';
import type { ReaderName } from './flags';
import { formatUtc } from './format';
import { fieldReview, type ReviewAction, type ReviewState } from './review-state';

/** There are no accounts. Every verified record names this one fixed demo label. */
export const VERIFIER_LABEL = 'Demo reviewer';

export const SYNTHETIC_NOTICE = 'Synthetic data. Demo only.';

/** An ISO 8601 time that must end in Z, so every stored time is UTC. */
export const IsoTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
const ReaderNameSchema = z.enum(['model', 'rules']);

/** One recorded review action. Append-only: see review-state.ts. */
export const ReviewActionSchema = z.discriminatedUnion('action', [
  z.strictObject({
    field: FieldNameSchema,
    action: z.literal('accepted'),
    originalValue: z.string().nullable(),
    acceptedDespiteFlag: z.boolean(),
    failedChecks: z.array(z.string()),
    atUtc: IsoTimeSchema,
  }),
  z.strictObject({
    field: FieldNameSchema,
    action: z.literal('edited'),
    originalValue: z.string().nullable(),
    newValue: z.string().min(1),
    atUtc: IsoTimeSchema,
  }),
]);

export const VerifiedFieldSchema = z.strictObject({
  name: FieldNameSchema,
  label: z.string(),
  /** The value as read from the page. Never changed by a later edit. */
  originalValue: z.string().nullable(),
  wordIds: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  originalFlags: z.array(z.string()),
  /** The reviewer's last value when the field was edited, else the original. */
  finalValue: z.string().nullable(),
  source: z.enum(['page', 'reviewer']),
  /** The reviewer accepted or edited this field. */
  reviewed: z.boolean(),
  /** The final state: the last action was an Accept made while a validator check was failing. */
  acceptedDespiteFlag: z.boolean(),
  /** The exact validator messages for that Accept. Always present; empty when acceptedDespiteFlag is false. */
  failedChecks: z.array(z.string()),
});

/**
 * Counts over the seven fields. Derived from the record's fields by summarise(); never
 * entered by hand. Categories overlap, except notFlaggedNotChecked, which is disjoint from
 * flagged and reviewed.
 */
export const SummarySchema = z.strictObject({
  totalFields: z.number().int().nonnegative(),
  /** Fields whose original reader result had at least one flag. */
  flagged: z.number().int().nonnegative(),
  /** Fields the reviewer accepted or edited. */
  reviewed: z.number().int().nonnegative(),
  /** Fields whose final value came from the reviewer. */
  edited: z.number().int().nonnegative(),
  acceptedDespiteFlag: z.number().int().nonnegative(),
  /** Fields that were not flagged and that no reviewer acted on. */
  notFlaggedNotChecked: z.number().int().nonnegative(),
});

export type Summary = z.infer<typeof SummarySchema>;

/** Pure. The one place the summary counts are worked out, for the export and the card. */
export function summarise(fields: readonly VerifiedField[]): Summary {
  const count = (test: (field: VerifiedField) => boolean) => fields.filter(test).length;
  return {
    totalFields: fields.length,
    flagged: count((f) => f.originalFlags.length > 0),
    reviewed: count((f) => f.reviewed),
    edited: count((f) => f.source === 'reviewer'),
    acceptedDespiteFlag: count((f) => f.acceptedDespiteFlag),
    notFlaggedNotChecked: count((f) => f.originalFlags.length === 0 && !f.reviewed),
  };
}

export const VerifiedRecordSchema = z
  .strictObject({
    synthetic: z.literal(true),
    notice: z.literal(SYNTHETIC_NOTICE),
    faxId: z.string().min(1),
    reader: ReaderNameSchema,
    readerEngine: z.string().min(1),
    sampleDataVersion: z.number().int(),
    referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    verifiedAtUtc: IsoTimeSchema,
    verifier: z.string().min(1),
    summary: SummarySchema,
    fields: z.array(VerifiedFieldSchema),
    actions: z.array(ReviewActionSchema),
  })
  .superRefine((record, ctx) => {
    const names = record.fields.map((f) => f.name);
    if (names.length !== FIELD_ORDER.length || !FIELD_ORDER.every((n, i) => names[i] === n)) {
      ctx.addIssue({ code: 'custom', path: ['fields'], message: 'Expected the seven fields in schema order.' });
    }
    if (JSON.stringify(record.summary) !== JSON.stringify(summarise(record.fields))) {
      ctx.addIssue({ code: 'custom', path: ['summary'], message: 'The summary does not match the fields.' });
    }
  });

export type VerifiedRecord = z.infer<typeof VerifiedRecordSchema>;
export type VerifiedField = z.infer<typeof VerifiedFieldSchema>;

/** Pure. The record's fields for a reader's fields and a review state. Used by the export and the live counts. */
export function verifiedFields(readerFields: readonly Field[], state: ReviewState): VerifiedField[] {
  return readerFields.map((field) => {
    const review = fieldReview(state, field.name);
    const edited = review.enteredValue !== null;
    return {
      name: field.name,
      label: FIELD_LABELS[field.name],
      originalValue: field.value,
      wordIds: [...field.wordIds],
      confidence: field.confidence,
      originalFlags: [...field.flags],
      finalValue: edited ? review.enteredValue : field.value,
      source: edited ? ('reviewer' as const) : ('page' as const),
      reviewed: review.reviewed,
      acceptedDespiteFlag: review.acceptedDespiteFlag,
      failedChecks: [...review.failedChecks],
    };
  });
}

/** Pure. The counts shown in the summary bar: the same summarise() the export uses. */
export const liveSummary = (readerFields: readonly Field[], state: ReviewState): Summary =>
  summarise(verifiedFields(readerFields, state));

export interface BuildRecordInput {
  fax: SampleFax;
  reader: ReaderName;
  referenceDate: string;
  sampleDataVersion: number;
  state: ReviewState;
  /** ISO 8601 UTC time (ends in Z) from the injected clock. */
  verifiedAtUtc: string;
}

/**
 * Pure. Builds the verified record (also the export). Nothing is overwritten: the
 * original value, word IDs, confidence and flags are copied as read, and the review
 * actions are copied in order. Returns null when the reader has no answer to verify.
 */
export function buildVerifiedRecord(input: BuildRecordInput): VerifiedRecord | null {
  const result = input.fax.readers[input.reader];
  if (result.status !== 'ok') return null;
  const actions: ReviewAction[] = input.state.actions.map((action) => ({ ...action }));
  const fields = verifiedFields(result.fields, input.state);
  return {
    synthetic: true,
    notice: SYNTHETIC_NOTICE,
    faxId: input.fax.id,
    reader: input.reader,
    readerEngine: result.engine,
    sampleDataVersion: input.sampleDataVersion,
    referenceDate: input.referenceDate,
    verifiedAtUtc: input.verifiedAtUtc,
    verifier: VERIFIER_LABEL,
    summary: summarise(fields),
    fields,
    actions,
  };
}

/** Pretty-printed JSON with a trailing newline. */
export const serialiseRecord = (record: VerifiedRecord): string => `${JSON.stringify(record, null, 2)}\n`;

export const exportFileName = (record: VerifiedRecord): string =>
  `facsimortis-${record.faxId}-${record.reader}-verified.json`;

/** Shown beside a field that was accepted while a validator check was failing. Does not say the value is right. */
export const ACCEPTED_DESPITE_TEXT = 'Accepted although the check failed';

export const LAID_TO_REST_RULE = 'This record is read-only.';

/** "Verified on Oct 1, 09:30 UTC. This record is read-only." The time is read as written (UTC), not converted. */
export const verifiedLine = (verifiedAtUtc: string): string =>
  `Verified on ${formatUtc(verifiedAtUtc)}. ${LAID_TO_REST_RULE}`;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * The summary as short plain lines for the verified card. They count what happened and
 * never say the values are right.
 */
export function summaryLines(summary: Summary): string[] {
  return [
    plural(summary.totalFields, 'field', 'fields'),
    `${summary.flagged} ${summary.flagged === 1 ? 'was' : 'were'} flagged`,
    `${summary.reviewed} reviewed by you`,
    `${summary.edited} edited by you`,
    `${summary.acceptedDespiteFlag} accepted although the check failed`,
    `${summary.notFlaggedNotChecked} not flagged and not checked by a reviewer`,
  ];
}
