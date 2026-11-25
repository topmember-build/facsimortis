/**
 * The five tools of the read-only records server, as plain functions. No protocol, no I/O, no state: each takes a
 * SampleStore (data.ts, the only place data comes from) and the raw arguments, and returns either data or a plain
 * message. server.ts wraps them for the protocol; the tests call them directly.
 *
 * Rules (checked by test/mcp-records-*.test.ts and the eslint config):
 * - Everything is read from the committed sample JSON and worked out with the pure validators in src/validators/.
 * - Values are exactly as saved. Nothing is corrected, completed or guessed.
 * - Arguments are validated here as well as by the protocol layer, and an argument is never used as a path.
 * - An error message never repeats what the caller sent.
 */
import { z } from 'zod';
import { FIELD_ORDER, FieldNameSchema, type Field, type FieldName } from '../../src/extract/schema.js';
import type { SampleFax } from '../../src/samples/schema.js';
import { dobProblem } from '../../src/validators/dob.js';
import { DOB_FUTURE_FLAG, DOB_NOT_A_DATE_FLAG, DOB_TOO_OLD_FLAG, NPI_FLAG, PHONE_FLAG } from '../../src/validators/messages.js';
import { computeNpiCheckDigit, isValidNpi } from '../../src/validators/npi.js';
import { isValidPhone } from '../../src/validators/phone.js';
import { SampleDataError, type SampleStore } from './data.js';

/** Field names for a front-desk reader. A copy of web/src/field-labels.ts, kept equal by a test. */
export const FIELD_LABELS: Readonly<Record<FieldName, string>> = {
  patientName: 'Patient name',
  dob: 'Date of birth',
  referringProvider: 'Referring provider',
  npi: 'Provider number (NPI)',
  reason: 'Reason for referral',
  urgency: 'Urgency',
  callbackPhone: 'Callback phone',
};

export const READERS = ['model', 'rules'] as const;
export type ReaderName = (typeof READERS)[number];

const SYNTHETIC_NOTE = 'Synthetic data only: every person, provider and number here is made up.';
const READER_NOTE_DETAIL =
  'This note was written by the reader or the central checks when the fax was read. It has no separate check to run again, so it is shown as saved.';
const NOT_REVIEWED_BASIS =
  'These are the counts as the fax was read, before anyone reviewed it. Reviews, edits and the verified record are kept only in the browser that did the review, never in the sample files, so reviewed, edited and acceptedDespiteFlag are always 0 here. This is not the exported record of a verified review.';

// ---------------------------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------------------------

const SampleArg = z.string().min(1).max(64).describe('A sample id from list_samples, for example fax-0003.');
const ReaderArg = z.enum(READERS).describe('Which reader: "model" (the saved model answers, the default view in the app) or "rules" (the rule-based reader).');

export const inputs = {
  list_samples: z.strictObject({}),
  get_result: z.strictObject({ sample: SampleArg, reader: ReaderArg }),
  explain_flag: z.strictObject({
    sample: SampleArg,
    field: FieldNameSchema.describe(`The field to explain: ${FIELD_ORDER.join(', ')}.`),
    reader: ReaderArg.optional().describe('Which reader to explain. Optional, default "model".'),
  }),
  check_npi: z.strictObject({
    npi: z.string().max(64).describe('A provider number to check. Synthetic data only: do not pass a real provider number.'),
  }),
  export_summary: z.strictObject({ sample: SampleArg }),
} as const;

// ---------------------------------------------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------------------------------------------

const ReaderStatus = z.enum(['ok', 'no-saved-answer']);

const FieldOut = z.strictObject({
  name: FieldNameSchema,
  label: z.string(),
  value: z.string().nullable(),
  confidence: z.number(),
  flags: z.array(z.string()),
  wordIds: z.array(z.string()),
  citedText: z.string(),
});

const ExplanationOut = z.strictObject({
  flag: z.string(),
  check: z.enum(['npi-check-digit', 'date-of-birth', 'phone-format', 'reader-note']),
  stillFails: z.boolean().nullable(),
  detail: z.string(),
});

const SummaryOut = z.strictObject({
  totalFields: z.number().int().nonnegative(),
  flagged: z.number().int().nonnegative(),
  reviewed: z.number().int().nonnegative(),
  edited: z.number().int().nonnegative(),
  acceptedDespiteFlag: z.number().int().nonnegative(),
  notFlaggedNotChecked: z.number().int().nonnegative(),
});

const ReaderSummaryOut = z.strictObject({
  status: ReaderStatus,
  engine: z.string().optional(),
  summary: SummaryOut.optional(),
  flaggedFields: z.array(z.strictObject({ name: FieldNameSchema, label: z.string(), reasons: z.array(z.string()) })).optional(),
  message: z.string().optional(),
});

export const outputs = {
  list_samples: z.strictObject({
    note: z.string(),
    referenceDate: z.string(),
    samples: z.array(
      z.strictObject({
        id: z.string(),
        level: z.string(),
        receivedAt: z.string(),
        readers: z.strictObject({ model: ReaderStatus, rules: ReaderStatus }),
        flagged: z.strictObject({ model: z.number().int().nullable(), rules: z.number().int().nullable() }),
      }),
    ),
  }),
  get_result: z.strictObject({
    status: ReaderStatus,
    sample: z.string(),
    reader: z.enum(READERS),
    referenceDate: z.string(),
    engine: z.string().optional(),
    fields: z.array(FieldOut).optional(),
    message: z.string().optional(),
  }),
  explain_flag: z.strictObject({
    sample: z.string(),
    reader: z.enum(READERS),
    field: FieldNameSchema,
    label: z.string(),
    value: z.string().nullable(),
    confidence: z.number(),
    citedText: z.string(),
    flagged: z.boolean(),
    explanations: z.array(ExplanationOut),
    note: z.string(),
  }),
  check_npi: z.strictObject({
    npi: z.string(),
    wellFormed: z.boolean(),
    valid: z.boolean(),
    expectedCheckDigit: z.number().int().nullable(),
    message: z.string().nullable(),
    note: z.string(),
  }),
  export_summary: z.strictObject({
    sample: z.string(),
    referenceDate: z.string(),
    status: z.literal('as read, not reviewed'),
    basis: z.string(),
    readers: z.strictObject({ model: ReaderSummaryOut, rules: ReaderSummaryOut }),
  }),
} as const;

export type ListSamplesOutput = z.infer<typeof outputs.list_samples>;
export type GetResultOutput = z.infer<typeof outputs.get_result>;
export type ExplainFlagOutput = z.infer<typeof outputs.explain_flag>;
export type CheckNpiOutput = z.infer<typeof outputs.check_npi>;
export type ExportSummaryOutput = z.infer<typeof outputs.export_summary>;
type Explanation = z.infer<typeof ExplanationOut>;
type ReaderSummary = z.infer<typeof ReaderSummaryOut>;

// ---------------------------------------------------------------------------------------------------------------
// Results and helpers
// ---------------------------------------------------------------------------------------------------------------

export type ToolResult<T> = { ok: true; data: T } | { ok: false; message: string };

function fail(message: string): { ok: false; message: string } {
  return { ok: false, message };
}

/** Validates the raw arguments. The message names the argument and the rule, never the value that was sent. */
function parseInput<S extends z.ZodType>(schema: S, input: unknown): ToolResult<z.infer<S>> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`).join('; ');
  return fail(`The arguments are not valid. ${issues}`.slice(0, 400));
}

/** Looks the sample up in the index (the id is never used as a path), then runs `use` on its data. */
function withSample<T>(
  store: SampleStore,
  sample: string,
  use: (fax: SampleFax, referenceDate: string) => ToolResult<T>,
): ToolResult<T> {
  try {
    const index = store.index();
    if (!index.faxes.some((entry) => entry.id === sample)) {
      return fail(`Unknown sample. Known samples: ${index.faxes.map((entry) => entry.id).join(', ')}.`);
    }
    return use(store.fax(sample), index.referenceDate);
  } catch (error) {
    if (error instanceof SampleDataError) return fail(error.message);
    throw error;
  }
}

function wordTexts(fax: SampleFax): Map<string, string> {
  return new Map(fax.ocr.words.map((word) => [word.id, word.text]));
}

function citedText(words: Map<string, string>, field: Field): string {
  return field.wordIds.map((id) => words.get(id) ?? '').join(' ');
}

function flaggedCount(fax: SampleFax, reader: ReaderName): number | null {
  const result = fax.readers[reader];
  return result.status === 'ok' ? result.fields.filter((field) => field.flags.length > 0).length : null;
}

// ---------------------------------------------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------------------------------------------

export function listSamples(store: SampleStore, input?: unknown): ToolResult<ListSamplesOutput> {
  const parsed = parseInput(inputs.list_samples, input ?? {});
  if (!parsed.ok) return parsed;
  try {
    const index = store.index();
    return {
      ok: true,
      data: {
        note: SYNTHETIC_NOTE,
        referenceDate: index.referenceDate,
        samples: index.faxes.map((entry) => {
          const fax = store.fax(entry.id);
          return {
            id: entry.id,
            level: entry.level,
            receivedAt: entry.receivedAt,
            readers: { model: fax.readers.model.status, rules: fax.readers.rules.status },
            flagged: { model: flaggedCount(fax, 'model'), rules: flaggedCount(fax, 'rules') },
          };
        }),
      },
    };
  } catch (error) {
    if (error instanceof SampleDataError) return fail(error.message);
    throw error;
  }
}

export function getResult(store: SampleStore, input: unknown): ToolResult<GetResultOutput> {
  const parsed = parseInput(inputs.get_result, input);
  if (!parsed.ok) return parsed;
  const { sample, reader } = parsed.data;
  return withSample<GetResultOutput>(store, sample, (fax, referenceDate) => {
    const result = fax.readers[reader];
    if (result.status !== 'ok') {
      return { ok: true, data: { status: 'no-saved-answer', sample, reader, referenceDate, message: result.message } };
    }
    const words = wordTexts(fax);
    return {
      ok: true,
      data: {
        status: 'ok',
        sample,
        reader,
        referenceDate,
        engine: result.engine,
        fields: result.fields.map((field) => ({
          name: field.name,
          label: FIELD_LABELS[field.name],
          value: field.value,
          confidence: field.confidence,
          flags: [...field.flags],
          wordIds: [...field.wordIds],
          citedText: citedText(words, field),
        })),
      },
    };
  });
}

function explainNpi(flag: string, value: string): Explanation {
  if (!/^\d{10}$/.test(value)) {
    return { flag, check: 'npi-check-digit', stillFails: true, detail: 'The value is not ten digits, so the check digit rule cannot be met.' };
  }
  const first9 = value.slice(0, 9);
  const expected = computeNpiCheckDigit(first9);
  const found = value.charAt(9);
  const valid = isValidNpi(value);
  return {
    flag,
    check: 'npi-check-digit',
    stillFails: !valid,
    detail: valid
      ? `The last digit (${found}) matches the check digit worked out from the first nine digits.`
      : `The last digit is ${found}, but the first nine digits (${first9}) give a check digit of ${expected}.`,
  };
}

const DOB_FLAGS: ReadonlySet<string> = new Set([DOB_NOT_A_DATE_FLAG, DOB_FUTURE_FLAG, DOB_TOO_OLD_FLAG]);

function explainDob(flag: string, value: string, referenceDate: string): Explanation {
  const problem = dobProblem(value, referenceDate);
  const detail =
    problem === null
      ? `The date passes the check against the sample's reference date ${referenceDate} (not today's date).`
      : problem === 'not-a-date'
        ? 'The value is not a real calendar date written as MM/DD/YYYY.'
        : problem === 'future'
          ? `The date is after the sample's reference date ${referenceDate}.`
          : `The date is more than 120 years before the sample's reference date ${referenceDate}.`;
  return { flag, check: 'date-of-birth', stillFails: problem !== null, detail };
}

function explainPhone(flag: string, value: string): Explanation {
  const valid = isValidPhone(value);
  return {
    flag,
    check: 'phone-format',
    stillFails: !valid,
    detail: valid
      ? 'The value is one of the accepted shapes.'
      : 'The value is not one of the accepted shapes: NNN-NNNN, NNN-NNN-NNNN or (NNN) NNN-NNNN. Nothing is repaired or guessed.',
  };
}

function explainOne(flag: string, value: string | null, referenceDate: string): Explanation {
  if (value !== null) {
    if (flag === NPI_FLAG) return explainNpi(flag, value);
    if (DOB_FLAGS.has(flag)) return explainDob(flag, value, referenceDate);
    if (flag === PHONE_FLAG) return explainPhone(flag, value);
  }
  return { flag, check: 'reader-note', stillFails: null, detail: READER_NOTE_DETAIL };
}

export function explainFlag(store: SampleStore, input: unknown): ToolResult<ExplainFlagOutput> {
  const parsed = parseInput(inputs.explain_flag, input);
  if (!parsed.ok) return parsed;
  const { sample, field: fieldName } = parsed.data;
  const reader: ReaderName = parsed.data.reader ?? 'model';
  return withSample(store, sample, (fax, referenceDate) => {
    const result = fax.readers[reader];
    if (result.status !== 'ok') {
      return fail(`There is no saved answer from the ${reader} reader for this sample. ${result.message}`);
    }
    const field = result.fields.find((candidate) => candidate.name === fieldName);
    if (!field) return fail('That field is not in the result.');
    const flagged = field.flags.length > 0;
    const note =
      field.value === null
        ? 'No value was read, so the field is empty and flagged. It is never filled in by guessing.'
        : flagged
          ? 'Flags are shown as saved. Accepting or correcting a flagged field is done by a person in the app.'
          : 'No flag was raised for this field. That means the checks found nothing, not that a person has looked at it.';
    return {
      ok: true,
      data: {
        sample,
        reader,
        field: field.name,
        label: FIELD_LABELS[field.name],
        value: field.value,
        confidence: field.confidence,
        citedText: citedText(wordTexts(fax), field),
        flagged,
        explanations: field.flags.map((flag) => explainOne(flag, field.value, referenceDate)),
        note,
      },
    };
  });
}

export function checkNpi(_store: SampleStore, input: unknown): ToolResult<CheckNpiOutput> {
  const parsed = parseInput(inputs.check_npi, input);
  if (!parsed.ok) return parsed;
  const { npi } = parsed.data;
  const wellFormed = /^\d{10}$/.test(npi);
  const valid = isValidNpi(npi);
  const expectedCheckDigit = /^\d{9,10}$/.test(npi) ? computeNpiCheckDigit(npi.slice(0, 9)) : null;
  return {
    ok: true,
    data: {
      npi,
      wellFormed,
      valid,
      expectedCheckDigit,
      message: valid ? null : wellFormed ? NPI_FLAG : 'The number must be exactly ten digits (0 to 9) with nothing else.',
      note: SYNTHETIC_NOTE,
    },
  };
}

function readerSummary(fax: SampleFax, reader: ReaderName): ReaderSummary {
  const result = fax.readers[reader];
  if (result.status !== 'ok') return { status: 'no-saved-answer', message: result.message };
  const flagged = result.fields.filter((field) => field.flags.length > 0);
  return {
    status: 'ok',
    engine: result.engine,
    summary: {
      totalFields: result.fields.length,
      flagged: flagged.length,
      reviewed: 0,
      edited: 0,
      acceptedDespiteFlag: 0,
      notFlaggedNotChecked: result.fields.length - flagged.length,
    },
    flaggedFields: flagged.map((field) => ({ name: field.name, label: FIELD_LABELS[field.name], reasons: [...field.flags] })),
  };
}

export function exportSummary(store: SampleStore, input: unknown): ToolResult<ExportSummaryOutput> {
  const parsed = parseInput(inputs.export_summary, input);
  if (!parsed.ok) return parsed;
  const { sample } = parsed.data;
  return withSample(store, sample, (fax, referenceDate) => ({
    ok: true,
    data: {
      sample,
      referenceDate,
      status: 'as read, not reviewed',
      basis: NOT_REVIEWED_BASIS,
      readers: { model: readerSummary(fax, 'model'), rules: readerSummary(fax, 'rules') },
    },
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// The list server.ts registers
// ---------------------------------------------------------------------------------------------------------------

export const TOOL_NAMES = ['list_samples', 'get_result', 'explain_flag', 'check_npi', 'export_summary'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolDefinition {
  readonly name: ToolName;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: z.ZodObject;
  readonly outputSchema: z.ZodObject;
  readonly run: (store: SampleStore, input: unknown) => ToolResult<unknown>;
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    name: 'list_samples',
    title: 'List the sample faxes',
    description:
      'List the sample faxes (synthetic data only): id, level, received time on the demo clock, whether each reader has an answer, and how many fields each reader flagged. Read-only.',
    inputSchema: inputs.list_samples,
    outputSchema: outputs.list_samples,
    run: listSamples,
  },
  {
    name: 'get_result',
    title: 'Get what a reader read from a sample',
    description:
      'Get what one reader ("model" or "rules") read from one sample fax: for each of the seven fields the value (or null), the confidence, the flags, and the page words it was read from. Values are exactly as saved; nothing is corrected or guessed. Read-only.',
    inputSchema: inputs.get_result,
    outputSchema: outputs.get_result,
    run: getResult,
  },
  {
    name: 'explain_flag',
    title: 'Explain why a field was flagged',
    description:
      'Explain in plain words why one field of one sample was flagged. It re-runs the same pure check the app uses (provider number check digit, date of birth, phone shape) on the saved value; a flag with no such check is reported as a reader note. The reader is optional and defaults to "model". Read-only.',
    inputSchema: inputs.explain_flag,
    outputSchema: outputs.explain_flag,
    run: explainFlag,
  },
  {
    name: 'check_npi',
    title: 'Check a provider number',
    description:
      'Check a provider number (NPI) with the same check digit rule the app uses and say what the last digit should be. Synthetic data only: do not pass a real provider number. Nothing is stored or logged.',
    inputSchema: inputs.check_npi,
    outputSchema: outputs.check_npi,
    run: checkNpi,
  },
  {
    name: 'export_summary',
    title: 'Summary of a sample as read',
    description:
      'The summary counts of one sample for both readers, AS READ AND NOT REVIEWED. It is not the exported record of a verified review: reviews and verified records are kept only in the browser, never in the sample files, so reviewed and edited are always 0 here. Also lists the flagged fields and their reasons. Read-only.',
    inputSchema: inputs.export_summary,
    outputSchema: outputs.export_summary,
    run: exportSummary,
  },
];
