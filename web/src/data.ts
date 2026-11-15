// Loads the precomputed sample data (static files only, no other network use).
// Only pure Zod schema modules may be imported from src/ (enforced by ESLint).
import {
  SampleFaxSchema,
  SampleIndexSchema,
  type SampleFax,
  type SampleIndex,
} from '../../src/samples/schema.js';

export type IndexEntry = SampleIndex['faxes'][number];

/** Either a value or a plain-language reason it could not be had. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface InboxItem {
  entry: IndexEntry;
  /** URL of the fax PNG, used for the thumbnail and the full page. */
  imageUrl: string;
  /** The fax data, or why it could not be loaded. One bad fax does not hide the others. */
  fax: Result<SampleFax>;
}

export interface Inbox {
  items: InboxItem[];
  /** "Today" for date checks (YYYY-MM-DD), from the index. Not the browser clock. */
  referenceDate: string;
}

export const DEFAULT_SAMPLES_URL = `${import.meta.env.BASE_URL}samples/`;

const failure = <T>(error: string): Result<T> => ({ ok: false, error });

async function fetchJson(url: string, signal: AbortSignal | undefined, what: string): Promise<Result<unknown>> {
  let response: Response;
  try {
    response = await fetch(url, signal ? { signal } : {});
  } catch (cause) {
    if (signal?.aborted) throw cause;
    return failure(`${what} could not be reached.`);
  }
  if (!response.ok) return failure(`${what} could not be loaded.`);
  try {
    return { ok: true, value: await response.json() };
  } catch {
    return failure(`${what} could not be read.`);
  }
}

export async function loadIndex(samplesUrl = DEFAULT_SAMPLES_URL, signal?: AbortSignal): Promise<Result<SampleIndex>> {
  const raw = await fetchJson(`${samplesUrl}index.json`, signal, 'The list of sample faxes');
  if (!raw.ok) return raw;
  const parsed = SampleIndexSchema.safeParse(raw.value);
  if (!parsed.success) return failure('The list of sample faxes is not in the expected form.');
  return { ok: true, value: parsed.data };
}

export async function loadFax(
  entry: IndexEntry,
  samplesUrl = DEFAULT_SAMPLES_URL,
  signal?: AbortSignal,
): Promise<Result<SampleFax>> {
  const what = `The saved data for ${entry.id}`;
  const raw = await fetchJson(`${samplesUrl}${entry.data}`, signal, what);
  if (!raw.ok) return raw;
  const parsed = SampleFaxSchema.safeParse(raw.value);
  if (!parsed.success) return failure(`${what} is not in the expected form.`);
  if (parsed.data.id !== entry.id) return failure(`${what} belongs to a different fax.`);
  return { ok: true, value: parsed.data };
}

/**
 * Loads the index and every fax file. A failed index fails the whole load; a failed fax
 * file only marks that fax.
 */
export async function loadInbox(
  samplesUrl = DEFAULT_SAMPLES_URL,
  signal?: AbortSignal,
): Promise<Result<Inbox>> {
  const index = await loadIndex(samplesUrl, signal);
  if (!index.ok) return index;
  const items = await Promise.all(
    index.value.faxes.map(async (entry): Promise<InboxItem> => ({
      entry,
      imageUrl: `${samplesUrl}${entry.image}`,
      fax: await loadFax(entry, samplesUrl, signal),
    })),
  );
  return { ok: true, value: { items, referenceDate: index.value.referenceDate } };
}
