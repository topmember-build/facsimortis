import { z } from 'zod';
import { FIELD_ORDER, FieldSchema } from '../extract/schema.js';

/**
 * Shape of the precomputed sample data in web/public/samples/. The precompute script
 * writes it and the static site loads it, so both import this one module.
 * Readers: "model" (saved model answers, shown by default) and "rules" (rule-based).
 */

export const SAMPLE_DATA_VERSION = 1;

/** Plain sentence shown when a fax has no saved model answer. */
export const NO_SAVED_ANSWER_MESSAGE =
  'There is no saved model answer for this fax. The rule-based reader can still be shown.';

const FileNameSchema = (ext: 'png' | 'json') =>
  z.string().regex(new RegExp(`^[A-Za-z0-9][A-Za-z0-9._-]*\\.${ext}$`), `Expected a plain .${ext} file name.`);

const BoxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export const SampleWordSchema = z.strictObject({
  id: z.string().min(1),
  text: z.string(),
  box: BoxSchema,
  confidence: z.number().min(0).max(1),
});

const OkReaderSchema = z
  .strictObject({
    status: z.literal('ok'),
    engine: z.string().min(1),
    fields: z.array(FieldSchema),
  })
  .superRefine((reader, ctx) => {
    const names = reader.fields.map((f) => f.name);
    if (names.length !== FIELD_ORDER.length || !FIELD_ORDER.every((n, i) => names[i] === n)) {
      ctx.addIssue({
        code: 'custom',
        path: ['fields'],
        message: `Expected exactly seven fields in this order: ${FIELD_ORDER.join(', ')}.`,
      });
    }
  });

const NoSavedAnswerSchema = z.strictObject({
  status: z.literal('no-saved-answer'),
  message: z.string().min(1),
});

export const ReaderResultSchema = z.discriminatedUnion('status', [OkReaderSchema, NoSavedAnswerSchema]);

export const SampleFaxSchema = z
  .strictObject({
    id: z.string().min(1),
    level: z.string().regex(/^L\d+$/),
    image: FileNameSchema('png'),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    ocr: z.strictObject({
      engine: z.string().min(1),
      words: z.array(SampleWordSchema),
    }),
    readers: z.strictObject({
      model: ReaderResultSchema,
      rules: ReaderResultSchema,
    }),
  })
  .superRefine((fax, ctx) => {
    const ids = new Set(fax.ocr.words.map((w) => w.id));
    for (const reader of ['model', 'rules'] as const) {
      const result = fax.readers[reader];
      if (result.status !== 'ok') continue;
      result.fields.forEach((field, i) => {
        for (const id of field.wordIds) {
          if (!ids.has(id)) {
            ctx.addIssue({
              code: 'custom',
              path: ['readers', reader, 'fields', i, 'wordIds'],
              message: `Word ${id} is not on the page.`,
            });
          }
        }
      });
    }
  });

export const SampleIndexSchema = z.strictObject({
  version: z.literal(SAMPLE_DATA_VERSION),
  faxes: z.array(
    z.strictObject({
      id: z.string().min(1),
      level: z.string().regex(/^L\d+$/),
      image: FileNameSchema('png'),
      data: FileNameSchema('json'),
      /** Demo value (local time, no zone), not read from any fax. */
      receivedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/),
    }),
  ),
});

export type SampleWord = z.infer<typeof SampleWordSchema>;
export type ReaderResult = z.infer<typeof ReaderResultSchema>;
export type SampleFax = z.infer<typeof SampleFaxSchema>;
export type SampleIndex = z.infer<typeof SampleIndexSchema>;
