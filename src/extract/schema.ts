import { z } from 'zod';

/** The seven fields, in the order a result must list them (design.md). */
export const FIELD_ORDER = [
  'patientName',
  'dob',
  'referringProvider',
  'npi',
  'reason',
  'urgency',
  'callbackPhone',
] as const;

export const FieldNameSchema = z.enum(FIELD_ORDER);

/**
 * One extracted field. Messages are written for a front-desk reader.
 * Whether the value really appears in the cited OCR words is NOT checked here;
 * that needs the OCR words and belongs to the citation check (0.6).
 */
export const FieldSchema = z
  .strictObject({
    name: FieldNameSchema,
    value: z.string().nullable(),
    wordIds: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    flags: z.array(z.string()),
    reviewed: z.boolean(),
  })
  .superRefine((field, ctx) => {
    if (field.value !== null && field.value.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'A value cannot be empty. Leave it out and flag it instead.',
      });
    }
    if (field.value !== null && field.wordIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['wordIds'],
        message: 'A value needs at least one word from the page to show where it came from.',
      });
    }
    if (field.value === null && field.wordIds.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['wordIds'],
        message: 'A missing value cannot point to words on the page.',
      });
    }
    if (field.value === null && field.flags.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['flags'],
        message: 'A missing value must be flagged so someone checks it.',
      });
    }
    if (new Set(field.wordIds).size !== field.wordIds.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['wordIds'],
        message: 'The same word is listed more than once.',
      });
    }
  });

export const ExtractionResultSchema = z
  .strictObject({
    engine: z.string().min(1, 'The reader name is missing.'),
    fields: z.array(FieldSchema),
  })
  .superRefine((result, ctx) => {
    const names = result.fields.map((f) => f.name);
    const ok =
      names.length === FIELD_ORDER.length && FIELD_ORDER.every((n, i) => names[i] === n);
    if (!ok) {
      ctx.addIssue({
        code: 'custom',
        path: ['fields'],
        message: `Expected exactly seven fields in this order: ${FIELD_ORDER.join(', ')}.`,
      });
    }
  });

export type FieldName = z.infer<typeof FieldNameSchema>;
export type Field = z.infer<typeof FieldSchema>;
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
