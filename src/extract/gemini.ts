import { z } from 'zod';
import { ExtractionError } from './types.js';

export const DEFAULT_EXTRACT_MODEL = 'gemini-3.8-flash';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
/** Pins the steps-based response shape documented for the Interactions API. */
const API_REVISION = '2026-05-20';

/** Only the part of the Interactions reply we use: text from model_output steps. */
const InteractionSchema = z.object({
  steps: z.array(
    z.looseObject({
      type: z.string(),
      content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })).optional(),
    }),
  ),
});

export interface GeminiRequest {
  prompt: string;
  /** JSON Schema for the reply; sent as response_format. */
  schema: Record<string, unknown>;
}

export interface GeminiReply {
  model: string;
  /** Raw text the model returned. Parsed and checked by the caller. */
  text: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Thinking levels gemini-3.8-flash accepts (it has no "minimal"). */
export const THINKING_LEVELS = ['low', 'medium', 'high'] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/**
 * Reads EXTRACT_THINKING_LEVEL. Unset or blank gives undefined, so nothing is sent
 * and the model keeps its own default. Any other value must be low, medium or high.
 */
export function thinkingLevelFrom(env: Record<string, string | undefined>): ThinkingLevel | undefined {
  const raw = env['EXTRACT_THINKING_LEVEL']?.trim().toLowerCase();
  if (!raw) return undefined;
  if ((THINKING_LEVELS as readonly string[]).includes(raw)) return raw as ThinkingLevel;
  throw new ExtractionError('EXTRACT_THINKING_LEVEL must be low, medium or high, or left empty.');
}

export interface GeminiClientOptions {
  /** Defaults to process.env at call time. */
  env?: Record<string, string | undefined>;
  /** Defaults to the built-in fetch. Tests pass a stub. */
  fetch?: FetchLike;
}

/** Pulls the model's text out of a validated interaction. */
export function interactionText(json: unknown): string {
  const parsed = InteractionSchema.safeParse(json);
  if (!parsed.success) {
    throw new ExtractionError('The reader gave an answer in an unexpected shape.', {
      cause: parsed.error,
    });
  }
  const text = parsed.data.steps
    .filter((s) => s.type === 'model_output')
    .flatMap((s) => s.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
  if (text === '') {
    throw new ExtractionError('The reader gave an empty answer.');
  }
  return text;
}

/**
 * Minimal Gemini client over plain REST. The key and model are read from the
 * environment only when generate() runs, so building a client never needs a key.
 * The key goes in a request header and is never logged or put in an error.
 */
export class GeminiClient {
  readonly #env: Record<string, string | undefined> | undefined;
  readonly #fetch: FetchLike | undefined;

  constructor(options: GeminiClientOptions = {}) {
    this.#env = options.env;
    this.#fetch = options.fetch;
  }

  async generate(request: GeminiRequest): Promise<GeminiReply> {
    const env = this.#env ?? process.env;
    const apiKey = env['EXTRACT_API_KEY']?.trim();
    if (!apiKey) {
      throw new ExtractionError(
        'The model reader needs a key. Set EXTRACT_API_KEY, or use the saved answers.',
      );
    }
    const model = env['EXTRACT_MODEL']?.trim() || DEFAULT_EXTRACT_MODEL;
    const thinkingLevel = thinkingLevelFrom(env);
    const doFetch: FetchLike = this.#fetch ?? ((url, init) => fetch(url, init));

    let response: Response;
    try {
      response = await doFetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
          'Api-Revision': API_REVISION,
        },
        body: JSON.stringify({
          model,
          input: request.prompt,
          store: false,
          response_format: { type: 'text', mime_type: 'application/json', schema: request.schema },
          ...(thinkingLevel === undefined ? {} : { generation_config: { thinking_level: thinkingLevel } }),
        }),
      });
    } catch {
      // The original error is dropped on purpose: it could echo request details.
      throw new ExtractionError('The model reader could not be reached.');
    }

    if (!response.ok) {
      throw new ExtractionError('The model reader refused the request.', {
        cause: new Error(`HTTP ${response.status}`),
      });
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      throw new ExtractionError('The reader gave an answer that is not JSON.', { cause: err });
    }
    return { model, text: interactionText(json) };
  }
}
