import { z } from 'zod';
import { FieldNameSchema } from '../../src/extract/schema.js';
import { SAMPLE_DATA_VERSION, type SampleFax } from '../../src/samples/schema.js';
import type { InboxItem } from './data';
import type { ReaderName } from './flags';
import {
  IsoTimeSchema,
  ReviewActionSchema,
  SYNTHETIC_NOTICE,
  SummarySchema,
  VerifiedFieldSchema,
  VerifiedRecordSchema,
  summarise,
  type VerifiedRecord,
} from './record';
import { reviewKey, type ReviewState } from './review-state';

/** The part of localStorage the app uses. Tests pass their own. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Every key starts with this prefix. The "v4" is the storage format.
 * Key: `facsimortis:v4:<faxId>:<reader>`, one entry per fax and reader.
 *
 * RULE: any future change to the stored format needs a migration or a clear plain-language
 * note to the user. Never a silent reset.
 *
 * v4 renamed the time keys to say they are UTC: `verifiedAt` became `verifiedAtUtc` and each
 * action's `at` became `atUtc`. A v3 entry is migrated on load (see migrateV3Entry): it is
 * read, checked with the v3 schema, converted with the values unchanged, written as v4, and
 * the v3 key is removed only after the v4 write worked. A v3 entry that does not pass the
 * check is left untouched and not read, and the page shows the plain "could not be read" note.
 * A successful migration shows no note, because nothing is lost and nothing changes for the user.
 *
 * v3 added `summary` (counts worked out from the fields) to the verified record. A v2
 * entry that holds a verified record has no summary, so it cannot pass the record check and
 * would look corrupt. Entries from v1 and v2 are not migrated: they are left untouched and not
 * read, and the page shows the plain stale note.
 *
 * v2 added acceptedDespiteFlag and failedChecks to each Accept. A v1 entry cannot say
 * whether an Accept was made despite a failed check, and defaulting it to false could hide
 * one in an export. So v1 entries are not migrated: they are left untouched and not read,
 * and the page shows the plain stale note.
 */
export const STORAGE_PREFIX = 'facsimortis:v4:';
export const STORAGE_FORMAT_VERSION = 4;
/** The v3 format, which is migrated to v4 on load. */
export const V3_PREFIX = 'facsimortis:v3:';
/** The earlier formats. Only checked for, so the page can say they were not used. */
export const LEGACY_PREFIXES: readonly string[] = ['facsimortis:v2:', 'facsimortis:v1:'];
export const entryKey = (faxId: string, reader: ReaderName): string => `${STORAGE_PREFIX}${faxId}:${reader}`;

export const STALE_NOTE = 'Saved progress was made with different sample data, so it was not used.';
export const CORRUPT_NOTE = 'Some saved progress could not be read, so it was not used.';
export const NOT_KEPT_NOTE =
  'This browser is not letting the page save progress. Your review will not be kept after you close or reload this page.';

/** localStorage, or null when the browser does not give access to it (access itself can throw). */
export function browserStore(): KeyValueStore | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** A store held in memory. Used by tests. */
export class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

/**
 * Thin adapter over a store. If the store is missing or throws (private mode, quota),
 * everything keeps working from memory and `ok` turns false so the page can say so.
 */
export class ReviewStorage {
  private readonly memory = new Map<string, string>();
  private okFlag: boolean;
  private readable: boolean;

  constructor(private readonly store: KeyValueStore | null) {
    this.okFlag = store !== null;
    this.readable = store !== null;
    if (store) {
      // Writing is what fails in private mode and when the quota is full, so test it up front.
      const probe = `${STORAGE_PREFIX}probe`;
      try {
        store.setItem(probe, '1');
        store.removeItem(probe);
      } catch {
        this.okFlag = false;
      }
    }
  }

  /** False once the browser has refused to read or save. Progress is then kept in memory only. */
  get ok(): boolean {
    return this.okFlag;
  }

  read(key: string): string | null {
    const fromMemory = this.memory.get(key);
    if (fromMemory !== undefined) return fromMemory;
    if (!this.store || !this.readable) return null;
    try {
      return this.store.getItem(key);
    } catch {
      this.readable = false;
      this.okFlag = false;
      return null;
    }
  }

  /** Keeps the value in memory, and in the store if it allows. Returns true only when the store kept it. */
  write(key: string, value: string): boolean {
    this.memory.set(key, value);
    if (!this.store) return false;
    try {
      this.store.setItem(key, value);
      return true;
    } catch {
      this.okFlag = false;
      return false;
    }
  }

  remove(key: string): void {
    this.memory.delete(key);
    if (!this.store) return;
    try {
      this.store.removeItem(key);
    } catch {
      this.okFlag = false;
    }
  }
}

const EntrySchema = z.strictObject({
  version: z.literal(STORAGE_FORMAT_VERSION),
  faxId: z.string().min(1),
  reader: z.enum(['model', 'rules']),
  sampleDataVersion: z.number().int(),
  referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fingerprint: z.string().min(1),
  /** The append-only review actions. Flags are never stored: they are worked out again on load. */
  actions: z.array(ReviewActionSchema),
  verified: VerifiedRecordSchema.nullable(),
});

export type StoredEntry = z.infer<typeof EntrySchema>;

// The v3 format, kept only so a v3 entry can be read and migrated. The time keys are the old names.
const V3ActionSchema = z.discriminatedUnion('action', [
  z.strictObject({
    field: FieldNameSchema,
    action: z.literal('accepted'),
    originalValue: z.string().nullable(),
    acceptedDespiteFlag: z.boolean(),
    failedChecks: z.array(z.string()),
    at: IsoTimeSchema,
  }),
  z.strictObject({
    field: FieldNameSchema,
    action: z.literal('edited'),
    originalValue: z.string().nullable(),
    newValue: z.string().min(1),
    at: IsoTimeSchema,
  }),
]);

const V3RecordSchema = z.strictObject({
  synthetic: z.literal(true),
  notice: z.literal(SYNTHETIC_NOTICE),
  faxId: z.string().min(1),
  reader: z.enum(['model', 'rules']),
  readerEngine: z.string().min(1),
  sampleDataVersion: z.number().int(),
  referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  verifiedAt: IsoTimeSchema,
  verifier: z.string().min(1),
  summary: SummarySchema,
  fields: z.array(VerifiedFieldSchema),
  actions: z.array(V3ActionSchema),
});

const V3EntrySchema = z.strictObject({
  version: z.literal(3),
  faxId: z.string().min(1),
  reader: z.enum(['model', 'rules']),
  sampleDataVersion: z.number().int(),
  referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fingerprint: z.string().min(1),
  actions: z.array(V3ActionSchema),
  verified: V3RecordSchema.nullable(),
});

type V3Action = z.infer<typeof V3ActionSchema>;

function renameActionTime(action: V3Action): StoredEntry['actions'][number] {
  const { at, ...rest } = action;
  return { ...rest, atUtc: at };
}

/**
 * Pure. Converts a parsed v3 entry to v4: `at` becomes `atUtc` on every action and
 * `verifiedAt` becomes `verifiedAtUtc`. Values are unchanged. Returns null when the input
 * does not pass the v3 check, when its summary does not match its fields, or when the
 * result does not pass the v4 check. Never throws.
 */
export function migrateV3Entry(json: unknown): StoredEntry | null {
  const parsed = V3EntrySchema.safeParse(json);
  if (!parsed.success) return null;
  const v3 = parsed.data;
  let verified: StoredEntry['verified'] = null;
  if (v3.verified) {
    const { verifiedAt, actions, ...rest } = v3.verified;
    if (JSON.stringify(rest.summary) !== JSON.stringify(summarise(rest.fields))) return null;
    verified = { ...rest, verifiedAtUtc: verifiedAt, actions: actions.map(renameActionTime) };
  }
  const converted = {
    ...v3,
    version: STORAGE_FORMAT_VERSION,
    actions: v3.actions.map(renameActionTime),
    verified,
  };
  const checked = EntrySchema.safeParse(converted);
  return checked.success ? checked.data : null;
}
/** What a stored entry was made from. If any part differs, the entry is stale. */
export interface SampleContext {
  sampleDataVersion: number;
  referenceDate: string;
  fingerprint: string;
}

// 53-bit string hash (cyrb53). Not a security measure, only a change detector.
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

const fingerprints = new WeakMap<SampleFax, string>();

/** A fingerprint of one fax's data (OCR words and both readers' answers). */
export function faxFingerprint(fax: SampleFax): string {
  let value = fingerprints.get(fax);
  if (value === undefined) {
    value = hash(JSON.stringify(fax));
    fingerprints.set(fax, value);
  }
  return value;
}

export const sampleContext = (fax: SampleFax, referenceDate: string): SampleContext => ({
  sampleDataVersion: SAMPLE_DATA_VERSION,
  referenceDate,
  fingerprint: faxFingerprint(fax),
});

export type LoadResult =
  | { kind: 'none' }
  | { kind: 'ok'; actions: ReviewState['actions']; verified: VerifiedRecord | null }
  | { kind: 'stale' }
  | { kind: 'corrupt' };

/** The entry belongs to this key, and its verified record (if any) matches it. */
function isConsistent(entry: StoredEntry, faxId: string, reader: ReaderName): boolean {
  if (entry.faxId !== faxId || entry.reader !== reader) return false;
  if (!entry.verified) return true;
  const sameActions = JSON.stringify(entry.verified.actions) === JSON.stringify(entry.actions);
  return entry.verified.faxId === faxId && entry.verified.reader === reader && sameActions;
}
/** Reads and checks one entry. Anything unexpected is ignored, never thrown. */
export function loadEntry(
  storage: ReviewStorage,
  faxId: string,
  reader: ReaderName,
  context: SampleContext,
): LoadResult {
  const raw = storage.read(entryKey(faxId, reader));
  let entry: StoredEntry;
  if (raw === null) {
    const v3Key = `${V3_PREFIX}${faxId}:${reader}`;
    const v3Raw = storage.read(v3Key);
    if (v3Raw === null) {
      const old = LEGACY_PREFIXES.some((prefix) => storage.read(`${prefix}${faxId}:${reader}`) !== null);
      return old ? { kind: 'stale' } : { kind: 'none' };
    }
    let v3Json: unknown;
    try {
      v3Json = JSON.parse(v3Raw);
    } catch {
      return { kind: 'corrupt' };
    }
    // An invalid v3 entry is left untouched and not read.
    const migrated = migrateV3Entry(v3Json);
    if (!migrated || !isConsistent(migrated, faxId, reader)) return { kind: 'corrupt' };
    // The v3 key goes only after the v4 write worked. If it failed, v3 stays and the page
    // keeps the migrated entry in memory.
    if (storage.write(entryKey(faxId, reader), JSON.stringify(migrated))) storage.remove(v3Key);
    entry = migrated;
  } else {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { kind: 'corrupt' };
    }
    const parsed = EntrySchema.safeParse(json);
    if (!parsed.success) return { kind: 'corrupt' };
    entry = parsed.data;
  }
  if (!isConsistent(entry, faxId, reader)) return { kind: 'corrupt' };

  if (
    entry.sampleDataVersion !== context.sampleDataVersion ||
    entry.referenceDate !== context.referenceDate ||
    entry.fingerprint !== context.fingerprint
  ) {
    return { kind: 'stale' };
  }
  return { kind: 'ok', actions: entry.actions, verified: entry.verified };
}

/** Saves one entry. A failure turns `storage.ok` false and the progress stays in memory. */
export function saveEntry(
  storage: ReviewStorage,
  fax: SampleFax,
  reader: ReaderName,
  referenceDate: string,
  state: ReviewState,
  verified: VerifiedRecord | null,
): void {
  const entry: StoredEntry = {
    version: STORAGE_FORMAT_VERSION,
    faxId: fax.id,
    reader,
    ...sampleContext(fax, referenceDate),
    actions: [...state.actions],
    verified,
  };
  storage.write(entryKey(fax.id, reader), JSON.stringify(entry));
}

export interface Hydrated {
  reviews: Record<string, ReviewState>;
  verified: Record<string, VerifiedRecord>;
  /** Plain notes about ignored data. Each message appears at most once. */
  notices: string[];
}

const READERS: ReaderName[] = ['model', 'rules'];

/** Restores review state and verified records for every fax and reader that has an answer. */
export function hydrate(storage: ReviewStorage, items: readonly InboxItem[], referenceDate: string): Hydrated {
  const out: Hydrated = { reviews: {}, verified: {}, notices: [] };
  const note = (message: string) => {
    if (!out.notices.includes(message)) out.notices.push(message);
  };
  for (const item of items) {
    if (!item.fax.ok) continue;
    const fax = item.fax.value;
    for (const reader of READERS) {
      if (fax.readers[reader].status !== 'ok') continue;
      const loaded = loadEntry(storage, fax.id, reader, sampleContext(fax, referenceDate));
      if (loaded.kind === 'stale') note(STALE_NOTE);
      else if (loaded.kind === 'corrupt') note(CORRUPT_NOTE);
      else if (loaded.kind === 'ok') {
        const key = reviewKey(fax.id, reader);
        out.reviews[key] = { actions: loaded.actions };
        if (loaded.verified) out.verified[key] = loaded.verified;
      }
    }
  }
  return out;
}
