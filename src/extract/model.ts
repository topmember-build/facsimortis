import { z } from 'zod';
import type { OcrResult } from '../ocr/types.js';
import type { GeminiReply, GeminiRequest } from './gemini.js';
import { PLAIN_FIELD_NAMES } from './names.js';
import { FIELD_ORDER, FieldNameSchema } from './schema.js';
import type { ExtractionResult, Field, FieldName } from './schema.js';
import { parseExtractionResult } from './types.js';
import type { ExtractionAdapter } from './types.js';

/**
 * Model extraction (R3.1, R3.2). The model sees the OCR words with their IDs and
 * answers with a value and the word IDs it used for each field. It is never asked
 * for coordinates: highlights are drawn from word IDs only (tech.md rule 2).
 */

/** What the model must return. Strict, so extra keys such as "box" are rejected. */
export const ModelReplySchema = z.strictObject({
  fields: z.array(
    z.strictObject({
      name: FieldNameSchema,
      value: z.string().nullable(),
      wordIds: z.array(z.string()),
    }),
  ),
});
export type ModelReply = z.infer<typeof ModelReplySchema>;

/** The same shape as JSON Schema, sent to the model as the response format. */
export const MODEL_REPLY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['fields'],
  properties: {
    fields: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'value', 'wordIds'],
        properties: {
          name: { type: 'string', enum: [...FIELD_ORDER] },
          value: { type: ['string', 'null'] },
          wordIds: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

export function buildPrompt(ocr: OcrResult): string {
  const words = ocr.words.map((w) => `${w.id}\t${JSON.stringify(w.text)}`).join('\n');
  return [
    'You read a faxed clinic referral from its OCR words. Each line below is: word ID, tab, word text.',
    '',
    `Return JSON with exactly ${FIELD_ORDER.length} fields, in this order: ${FIELD_ORDER.join(', ')}.`,
    'Each field has "name", "value" and "wordIds".',
    '',
    'Rules:',
    '- "wordIds" lists the IDs of the words you used, in reading order. Use only IDs from the list.',
    '- "value" is those words\' text exactly as read, joined by single spaces. Copy it character for character.',
    '- Never correct, complete, reformat or guess. Keep misspellings, odd characters and wrong-looking numbers as they are.',
    '- If a field is not on the page, set "value" to null and "wordIds" to an empty list.',
    '- Do not return coordinates or any other keys.',
    '',
    'Words:',
    words,
  ].join('\n');
}

export type ReplyProblem = { ok: false; problem: string };
export type ReplyOk = { ok: true; reply: ModelReply };

/**
 * Checks a raw reply against the schema and against the OCR words:
 * valid JSON, the schema, the seven names in order, every cited ID exists, no
 * repeated ID, and the value equals the cited words joined by single spaces.
 * A null value must cite nothing. Pure.
 */
export function checkReply(text: string, ocr: OcrResult): ReplyOk | ReplyProblem {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, problem: 'not JSON' };
  }
  const parsed = ModelReplySchema.safeParse(json);
  if (!parsed.success) return { ok: false, problem: 'wrong shape' };
  const { fields } = parsed.data;
  if (fields.length !== FIELD_ORDER.length || !FIELD_ORDER.every((n, i) => fields[i]?.name === n)) {
    return { ok: false, problem: 'wrong fields' };
  }
  const words = new Map(ocr.words.map((w) => [w.id, w.text]));
  for (const f of fields) {
    if (new Set(f.wordIds).size !== f.wordIds.length) {
      return { ok: false, problem: `${f.name}: repeated word` };
    }
    if (f.value === null) {
      if (f.wordIds.length > 0) return { ok: false, problem: `${f.name}: null value with words` };
      continue;
    }
    if (f.wordIds.length === 0) return { ok: false, problem: `${f.name}: no words cited` };
    const missing = f.wordIds.filter((id) => !words.has(id));
    if (missing.length > 0) return { ok: false, problem: `${f.name}: unknown word` };
    const cited = f.wordIds.map((id) => words.get(id) as string).join(' ');
    if (cited !== f.value) return { ok: false, problem: `${f.name}: text differs from cited words` };
  }
  return { ok: true, reply: parsed.data };
}

export function absentFlag(name: FieldName): string {
  return `The ${PLAIN_FIELD_NAMES[name]} was not found on the page. Please check it.`;
}

export const NEEDS_REVIEW_FLAG =
  'This fax needs review. The reader gave no usable answer, so nothing was filled in.';

/** Confidence is the weakest OCR confidence among the cited words; the model gives none. */
export function toResult(reply: ModelReply, ocr: OcrResult, engine: string): ExtractionResult {
  const conf = new Map(ocr.words.map((w) => [w.id, w.confidence]));
  const fields = reply.fields.map((f): Field => {
    if (f.value === null) {
      return {
        name: f.name,
        value: null,
        wordIds: [],
        confidence: 0,
        flags: [absentFlag(f.name)],
        reviewed: false,
      };
    }
    const confidence = Math.min(...f.wordIds.map((id) => conf.get(id) ?? 0));
    return {
      name: f.name,
      value: f.value,
      wordIds: f.wordIds,
      confidence: Math.max(0, Math.min(1, confidence)),
      flags: [],
      reviewed: false,
    };
  });
  return parseExtractionResult({ engine, fields });
}

/** Every field null and flagged. Used when the reply cannot be trusted. */
export function needsReviewResult(engine: string): ExtractionResult {
  return parseExtractionResult({
    engine,
    fields: FIELD_ORDER.map((name) => ({
      name,
      value: null,
      wordIds: [],
      confidence: 0,
      flags: [NEEDS_REVIEW_FLAG],
      reviewed: false,
    })),
  });
}

/** Where the raw reply comes from: a live call or a recorded answer. */
export type ModelSource = (ocr: OcrResult, request: GeminiRequest) => Promise<GeminiReply>;

export const MAX_ATTEMPTS = 2; // first try plus one retry

export class ModelExtractor implements ExtractionAdapter {
  readonly name = 'model';
  readonly #source: ModelSource;

  constructor(source: ModelSource) {
    this.#source = source;
  }

  async extract(ocr: OcrResult): Promise<ExtractionResult> {
    const request: GeminiRequest = { prompt: buildPrompt(ocr), schema: MODEL_REPLY_JSON_SCHEMA };
    let model = 'model';
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Source errors (no key, unreachable) propagate; only unusable output is retried.
      const reply = await this.#source(ocr, request);
      model = reply.model;
      const checked = checkReply(reply.text, ocr);
      if (checked.ok) return toResult(checked.reply, ocr, `model:${model}`);
    }
    return needsReviewResult(`model:${model}`);
  }
}
