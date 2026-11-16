import { describe, expect, it } from 'vitest';
import { SAMPLE_DATA_VERSION, SampleFaxSchema, type SampleFax } from '../../src/samples/schema.js';
import { buildVerifiedRecord, summarise } from './record';
import { reviewReducer, EMPTY_REVIEW } from './review-state';
import {
  MemoryStore,
  ReviewStorage,
  LEGACY_PREFIXES,
  CORRUPT_NOTE,
  STALE_NOTE,
  STORAGE_PREFIX,
  hydrate,
  entryKey,
  faxFingerprint,
  loadEntry,
  migrateV3Entry,
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
    expect(entryKey('fax-0003', 'model')).toBe('facsimortis:v4:fax-0003:model');
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
      verifiedAtUtc: '2026-10-01T09:30:02.000Z',
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

describe('acceptedDespiteFlag in storage (format v4)', () => {
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
      fax, reader: 'model', referenceDate: REF, sampleDataVersion: SAMPLE_DATA_VERSION, state: despite, verifiedAtUtc: '2026-10-01T09:30:02.000Z',
    });
    saveEntry(new ReviewStorage(store), fax, 'model', REF, despite, record);
    const loaded = loadEntry(new ReviewStorage(store), 'fax-0003', 'model', context);
    expect(loaded).toEqual({ kind: 'ok', actions: despite.actions, verified: record });
    expect(loaded.kind === 'ok' && loaded.actions[0]).toMatchObject({ acceptedDespiteFlag: true, failedChecks: FAILED });
  });

  it('does not read a v1 entry, says so with the stale note, and never throws', () => {
    expect(STORAGE_PREFIX).toBe('facsimortis:v4:');
    expect(LEGACY_PREFIXES).toEqual(['facsimortis:v2:', 'facsimortis:v1:']);
    const store = new MemoryStore();
    const v1Entry = {
      version: 1, faxId: 'fax-0003', reader: 'model', sampleDataVersion: context.sampleDataVersion,
      referenceDate: REF, fingerprint: context.fingerprint,
      actions: [{ field: 'npi', action: 'accepted', originalValue: '6720988041', at: '2026-10-01T09:30:00.000Z' }],
      verified: null,
    };
    store.setItem('facsimortis:v1:fax-0003:model', JSON.stringify(v1Entry));
    expect(loadEntry(new ReviewStorage(store), 'fax-0003', 'model', context)).toEqual({ kind: 'stale' });
    const item = { fax: { ok: true, value: fax } } as unknown as Parameters<typeof hydrate>[1][number];
    const out = hydrate(new ReviewStorage(store), [item], REF);
    expect(out.notices).toEqual([STALE_NOTE]);
    expect(out.reviews).toEqual({});
    // The old entry is left alone.
    expect(store.data.has('facsimortis:v1:fax-0003:model')).toBe(true);
  });

  it('does not read a v2 entry, says so with the stale note, and leaves it alone', () => {
    const store = new MemoryStore();
    store.setItem(
      'facsimortis:v2:fax-0003:model',
      JSON.stringify({ version: 2, faxId: 'fax-0003', reader: 'model', actions: [], verified: {} }),
    );
    expect(loadEntry(new ReviewStorage(store), 'fax-0003', 'model', context)).toEqual({ kind: 'stale' });
    const item = { fax: { ok: true, value: fax } } as unknown as Parameters<typeof hydrate>[1][number];
    const out = hydrate(new ReviewStorage(store), [item], REF);
    expect(out.notices).toEqual([STALE_NOTE]);
    expect(out.reviews).toEqual({});
    expect(store.data.has('facsimortis:v2:fax-0003:model')).toBe(true);
  });

  it('treats a v4 entry whose Accept lacks the new fields as corrupt', () => {
    const store = new MemoryStore();
    saveEntry(new ReviewStorage(store), fax, 'model', REF, despite, null);
    const key = entryKey('fax-0003', 'model');
    const entry = JSON.parse(store.data.get(key)!) as { actions: Record<string, unknown>[] };
    delete entry.actions[0]!['acceptedDespiteFlag'];
    store.setItem(key, JSON.stringify(entry));
    expect(loadEntry(new ReviewStorage(store), 'fax-0003', 'model', context)).toEqual({ kind: 'corrupt' });
  });
});

describe('summary in storage (format v4)', () => {
  const verifiedAt = '2026-10-01T09:30:02.000Z';
  const build = () =>
    buildVerifiedRecord({ fax, reader: 'model', referenceDate: REF, sampleDataVersion: SAMPLE_DATA_VERSION, state, verifiedAtUtc: verifiedAt })!;
  const item = { fax: { ok: true, value: fax } } as unknown as Parameters<typeof hydrate>[1][number];

  it('round-trips a record whose summary matches its fields', () => {
    const store = new MemoryStore();
    saveEntry(new ReviewStorage(store), fax, 'model', REF, state, build());
    const loaded = loadEntry(new ReviewStorage(store), 'fax-0003', 'model', context);
    expect(loaded.kind === 'ok' && loaded.verified?.summary).toEqual(build().summary);
  });

  it('treats a stored record whose summary disagrees with its fields as corrupt', () => {
    const store = new MemoryStore();
    const key = entryKey('fax-0003', 'model');
    saveEntry(new ReviewStorage(store), fax, 'model', REF, state, build());
    const entry = JSON.parse(store.data.get(key)!) as { verified: { summary: { reviewed: number } } };
    entry.verified.summary.reviewed += 1;
    store.setItem(key, JSON.stringify(entry));
    expect(loadEntry(new ReviewStorage(store), 'fax-0003', 'model', context)).toEqual({ kind: 'corrupt' });
    expect(hydrate(new ReviewStorage(store), [item], REF).notices).toEqual([CORRUPT_NOTE]);
  });

  it('treats a stored record with no summary as corrupt', () => {
    const store = new MemoryStore();
    const key = entryKey('fax-0003', 'model');
    saveEntry(new ReviewStorage(store), fax, 'model', REF, state, build());
    const entry = JSON.parse(store.data.get(key)!) as { verified: Record<string, unknown> };
    delete entry.verified['summary'];
    store.setItem(key, JSON.stringify(entry));
    expect(loadEntry(new ReviewStorage(store), 'fax-0003', 'model', context)).toEqual({ kind: 'corrupt' });
  });
});

describe('migration from v3 to v4', () => {
  const item = { fax: { ok: true, value: fax } } as unknown as Parameters<typeof hydrate>[1][number];
  const V3_KEY = 'facsimortis:v3:fax-0003:model';
  const V4_KEY = entryKey('fax-0003', 'model');
  const rename = (action: Record<string, unknown>, from: string, to: string) => {
    const { [from]: time, ...rest } = action;
    return { ...rest, [to]: time };
  };

  type StoredShape = {
    actions: Record<string, unknown>[];
    verified: (Record<string, unknown> & { actions: Record<string, unknown>[] }) | null;
  };

  /** A v3 entry, as the previous version of the page wrote it. */
  function v3Entry(withRecord: boolean): Record<string, unknown> {
    const record = buildVerifiedRecord({
      fax, reader: 'model', referenceDate: REF, sampleDataVersion: SAMPLE_DATA_VERSION, state, verifiedAtUtc: '2026-10-01T09:30:02.000Z',
    })!;
    const store = new MemoryStore();
    saveEntry(new ReviewStorage(store), fax, 'model', REF, state, withRecord ? record : null);
    const v4 = JSON.parse(store.data.get(V4_KEY)!) as StoredShape;
    return {
      ...v4,
      version: 3,
      actions: v4.actions.map((a: Record<string, unknown>) => rename(a, 'atUtc', 'at')),
      verified: v4.verified
        ? {
            ...rename(v4.verified, 'verifiedAtUtc', 'verifiedAt'),
            actions: v4.verified.actions.map((a: Record<string, unknown>) => rename(a, 'atUtc', 'at')),
          }
        : null,
    };
  }

  it('migrateV3Entry renames the time keys and keeps every value (verified record)', () => {
    const out = migrateV3Entry(v3Entry(true))!;
    expect(out.version).toBe(4);
    expect(out.actions[0]).toMatchObject({ atUtc: '2026-10-01T09:30:00.000Z' });
    expect(out.actions[0]).not.toHaveProperty('at');
    expect(out.verified?.verifiedAtUtc).toBe('2026-10-01T09:30:02.000Z');
    expect(out.verified).not.toHaveProperty('verifiedAt');
    expect(out.verified?.actions).toEqual(out.actions);
    expect(out.verified?.summary).toEqual(summarise(out.verified!.fields));
  });

  it('migrateV3Entry converts in-progress actions with no record', () => {
    const out = migrateV3Entry(v3Entry(false))!;
    expect(out.verified).toBeNull();
    expect(out.actions).toEqual(state.actions);
  });

  it('migrateV3Entry returns null for invalid input and a summary that does not match', () => {
    expect(migrateV3Entry(null)).toBeNull();
    expect(migrateV3Entry({ ...v3Entry(false), version: 4 })).toBeNull();
    const bad = v3Entry(true) as { verified: { summary: { reviewed: number } } };
    bad.verified.summary.reviewed += 1;
    expect(migrateV3Entry(bad)).toBeNull();
    const local = v3Entry(false) as { actions: { at: string }[] };
    local.actions[0]!.at = '2026-10-01T09:30:00.000+02:00';
    expect(migrateV3Entry(local)).toBeNull();
  });

  it('on load writes v4, then removes v3, with no note', () => {
    const store = new MemoryStore();
    store.setItem(V3_KEY, JSON.stringify(v3Entry(true)));
    const out = hydrate(new ReviewStorage(store), [item], REF);
    expect(out.notices).toEqual([]);
    expect(out.reviews['fax-0003|model']?.actions).toEqual(state.actions);
    expect(out.verified['fax-0003|model']?.verifiedAtUtc).toBe('2026-10-01T09:30:02.000Z');
    expect(store.data.has(V3_KEY)).toBe(false);
    const written = JSON.parse(store.data.get(V4_KEY)!) as { version: number; verified: { summary: unknown; fields: never[] } };
    expect(written.version).toBe(4);
    expect(written.verified.summary).toEqual(out.verified['fax-0003|model']!.summary);
    // A reload reads the v4 entry.
    expect(loadEntry(new ReviewStorage(store), 'fax-0003', 'model', context).kind).toBe('ok');
  });

  it('keeps v3 when the v4 write fails, and still uses the migrated entry', () => {
    const store = new MemoryStore();
    store.setItem(V3_KEY, JSON.stringify(v3Entry(false)));
    const removed: string[] = [];
    const storage = new ReviewStorage({
      getItem: (k) => store.getItem(k),
      setItem: (k, v) => {
        if (k.startsWith('facsimortis:v4:fax')) throw new Error('quota');
        store.setItem(k, v);
      },
      removeItem: (k) => {
        removed.push(k);
        store.removeItem(k);
      },
    });
    removed.length = 0;
    const loaded = loadEntry(storage, 'fax-0003', 'model', context);
    expect(loaded).toMatchObject({ kind: 'ok', actions: state.actions });
    expect(store.data.has(V3_KEY)).toBe(true);
    expect(store.data.has(V4_KEY)).toBe(false);
    expect(removed).not.toContain(V3_KEY);
    expect(storage.ok).toBe(false);
  });

  it('leaves an invalid v3 entry untouched, does not read it, and shows the plain note', () => {
    const store = new MemoryStore();
    const bad = v3Entry(true) as { verified: { summary: { reviewed: number } } };
    bad.verified.summary.reviewed += 1;
    const text = JSON.stringify(bad);
    store.setItem(V3_KEY, text);
    const out = hydrate(new ReviewStorage(store), [item], REF);
    expect(out.notices).toEqual([CORRUPT_NOTE]);
    expect(out.reviews).toEqual({});
    expect(store.data.get(V3_KEY)).toBe(text);
    expect(store.data.has(V4_KEY)).toBe(false);
  });

  it('leaves a v3 entry for a different key untouched', () => {
    const store = new MemoryStore();
    const other = { ...v3Entry(false), faxId: 'fax-0001' };
    store.setItem(V3_KEY, JSON.stringify(other));
    expect(loadEntry(new ReviewStorage(store), 'fax-0003', 'model', context)).toEqual({ kind: 'corrupt' });
    expect(store.data.has(V3_KEY)).toBe(true);
    expect(store.data.has(V4_KEY)).toBe(false);
  });
});
