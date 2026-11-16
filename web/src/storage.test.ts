import { describe, expect, it } from 'vitest';
import { SAMPLE_DATA_VERSION, SampleFaxSchema, type SampleFax } from '../../src/samples/schema.js';
import { buildVerifiedRecord } from './record';
import { reviewReducer, EMPTY_REVIEW } from './review-state';
import {
  MemoryStore,
  ReviewStorage,
  LEGACY_PREFIX,
  STALE_NOTE,
  STORAGE_PREFIX,
  hydrate,
  entryKey,
  faxFingerprint,
  loadEntry,
  sampleContext,
  saveEntry,
  type KeyValueStore,
} from './storage';
import { committedFaxes } from './test-site';

const fax: SampleFax = SampleFaxSchema.parse(committedFaxes['fax-0003.json']);
const REF = '2026-10-01';
const context = sampleContext(fax, REF);
const state = reviewReducer(EMPTY_REVIEW, {
  type: 'accept',
  field: 'npi',
  originalValue: '6720988041',
  at: '2026-10-01T09:30:00.000Z',
});

const throwing: KeyValueStore = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('quota');
  },
  removeItem: () => {
    throw new Error('denied');
  },
};

describe('storage', () => {
  it('uses one versioned prefix and a key per fax and reader', () => {
    expect(entryKey('fax-0003', 'model')).toBe('facsimortis:v2:fax-0003:model');
    const store = new MemoryStore();
    saveEntry(new ReviewStorage(store), fax, 'model', REF, state, null);
    expect([...store.data.keys()]).toEqual([`${STORAGE_PREFIX}fax-0003:model`]);
  });

  it('round-trips actions and a verified record', () => {
    const store = new MemoryStore();
    const record = buildVerifiedRecord({
      fax,
      reader: 'model',
      referenceDate: REF,
      sampleDataVersion: SAMPLE_DATA_VERSION,
      state,
      verifiedAt: '2026-10-01T09:30:02.000Z',
    });
    saveEntry(new ReviewStorage(store), fax, 'model', REF, state, record);
    // A new adapter over the same store is what a reload sees.
    const loaded = loadEntry(new ReviewStorage(store), 'fax-0003', 'model', context);
    expect(loaded).toEqual({ kind: 'ok', actions: state.actions, verified: record });
    expect(loadEntry(new ReviewStorage(store), 'fax-0003', 'rules', context)).toEqual({ kind: 'none' });
  });

  it('does not store flags or re-validation results', () => {
    const store = new MemoryStore();
    saveEntry(new ReviewStorage(store), fax, 'model', REF, state, null);
    const entry = JSON.parse(store.data.get(entryKey('fax-0003', 'model'))!) as Record<string, unknown>;
    expect(Object.keys(entry).sort()).toEqual(
      ['actions', 'faxId', 'fingerprint', 'reader', 'referenceDate', 'sampleDataVersion', 'verified', 'version'],
    );
  });

  it('ignores an entry when the fax data, version or reference date changed', () => {
    const store = new MemoryStore();
    saveEntry(new ReviewStorage(store), fax, 'model', REF, state, null);
    const read = (ctx: typeof context) => loadEntry(new ReviewStorage(store), 'fax-0003', 'model', ctx);
    expect(read(context).kind).toBe('ok');
    expect(read({ ...context, fingerprint: 'other' }).kind).toBe('stale');
    expect(read({ ...context, sampleDataVersion: context.sampleDataVersion + 1 }).kind).toBe('stale');
    expect(read({ ...context, referenceDate: '2026-10-02' }).kind).toBe('stale');
    const changed = structuredClone(fax);
    changed.ocr.words[0]!.text = 'changed';
    expect(faxFingerprint(changed)).not.toBe(faxFingerprint(fax));
  });

  it('ignores corrupt or unknown data without throwing', () => {
    const store = new MemoryStore();
    const key = entryKey('fax-0003', 'model');
    const load = () => loadEntry(new ReviewStorage(store), 'fax-0003', 'model', context).kind;
    for (const bad of ['{not json', 'null', '[]', '{"version":1}', JSON.stringify({ version: 2 })]) {
      store.setItem(key, bad);
      expect(load()).toBe('corrupt');
    }
    saveEntry(new ReviewStorage(store), fax, 'model', REF, state, null);
    const entry = JSON.parse(store.data.get(key)!) as { actions: { field: string }[] };
    entry.actions[0]!.field = 'shoeSize';
    store.setItem(key, JSON.stringify(entry));
    expect(load()).toBe('corrupt');
  });

  it('keeps working in memory when the store throws, and reports it', () => {
    const storage = new ReviewStorage(throwing);
    expect(storage.ok).toBe(false);
    saveEntry(storage, fax, 'model', REF, state, null);
    expect(loadEntry(storage, 'fax-0003', 'model', context)).toMatchObject({ kind: 'ok', actions: state.actions });
    const none = new ReviewStorage(null);
    expect(none.ok).toBe(false);
    saveEntry(none, fax, 'model', REF, state, null);
    expect(loadEntry(none, 'fax-0003', 'model', context).kind).toBe('ok');
  });

  it('reports a read that throws and treats it as nothing saved', () => {
    const store = new MemoryStore();
    const storage = new ReviewStorage({
      getItem: () => {
        throw new Error('denied');
      },
      setItem: (k, v) => store.setItem(k, v),
      removeItem: (k) => store.removeItem(k),
    });
    expect(storage.ok).toBe(true);
    expect(loadEntry(storage, 'fax-0003', 'model', context)).toEqual({ kind: 'none' });
    expect(storage.ok).toBe(false);
  });
});

describe('acceptedDespiteFlag in storage (format v2)', () => {
  const FAILED = ['The provider number looks wrong: the last digit does not match.'];
  const despite = reviewReducer(EMPTY_REVIEW, {
    type: 'accept',
    field: 'npi',
    originalValue: '6720988041',
    failedChecks: FAILED,
    at: '2026-10-01T09:30:00.000Z',
  });

  it('keeps the flag and messages through a save and a reload', () => {
    const store = new MemoryStore();
    const record = buildVerifiedRecord({
      fax, reader: 'model', referenceDate: REF, sampleDataVersion: SAMPLE_DATA_VERSION, state: despite, verifiedAt: '2026-10-01T09:30:02.000Z',
    });
    saveEntry(new ReviewStorage(store), fax, 'model', REF, despite, record);
    const loaded = loadEntry(new ReviewStorage(store), 'fax-0003', 'model', context);
    expect(loaded).toEqual({ kind: 'ok', actions: despite.actions, verified: record });
    expect(loaded.kind === 'ok' && loaded.actions[0]).toMatchObject({ acceptedDespiteFlag: true, failedChecks: FAILED });
  });

  it('does not read a v1 entry, says so with the stale note, and never throws', () => {
    expect(STORAGE_PREFIX).toBe('facsimortis:v2:');
    const store = new MemoryStore();
    const v1Entry = {
      version: 1, faxId: 'fax-0003', reader: 'model', sampleDataVersion: context.sampleDataVersion,
      referenceDate: REF, fingerprint: context.fingerprint,
      actions: [{ field: 'npi', action: 'accepted', originalValue: '6720988041', at: '2026-10-01T09:30:00.000Z' }],
      verified: null,
    };
    store.setItem(`${LEGACY_PREFIX}fax-0003:model`, JSON.stringify(v1Entry));
    expect(loadEntry(new ReviewStorage(store), 'fax-0003', 'model', context)).toEqual({ kind: 'stale' });
    const item = { fax: { ok: true, value: fax } } as unknown as Parameters<typeof hydrate>[1][number];
    const out = hydrate(new ReviewStorage(store), [item], REF);
    expect(out.notices).toEqual([STALE_NOTE]);
    expect(out.reviews).toEqual({});
    // The old entry is left alone.
    expect(store.data.has(`${LEGACY_PREFIX}fax-0003:model`)).toBe(true);
  });

  it('treats a v2 entry whose Accept lacks the new fields as corrupt', () => {
    const store = new MemoryStore();
    saveEntry(new ReviewStorage(store), fax, 'model', REF, despite, null);
    const key = entryKey('fax-0003', 'model');
    const entry = JSON.parse(store.data.get(key)!) as { actions: Record<string, unknown>[] };
    delete entry.actions[0]!['acceptedDespiteFlag'];
    store.setItem(key, JSON.stringify(entry));
    expect(loadEntry(new ReviewStorage(store), 'fax-0003', 'model', context)).toEqual({ kind: 'corrupt' });
  });
});
