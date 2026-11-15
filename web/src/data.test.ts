import { describe, expect, it } from 'vitest';
import { loadFax, loadIndex, loadInbox } from './data';
import { committedFaxes, committedIndex, json, stubSite } from './test-site';

const BASE = '/site/samples/';

describe('loadIndex', () => {
  it('validates the committed index', async () => {
    const fetchMock = stubSite();
    const result = await loadIndex(BASE);
    expect(result.ok && result.value.faxes.map((f) => f.id)).toEqual(['fax-0001', 'fax-0002', 'fax-0003']);
    expect(fetchMock).toHaveBeenCalledWith('/site/samples/index.json', {});
  });

  it('reports a missing file plainly', async () => {
    stubSite({ 'index.json': () => json({}, 404) });
    expect(await loadIndex(BASE)).toEqual({ ok: false, error: 'The list of sample faxes could not be loaded.' });
  });

  it('reports a network failure plainly', async () => {
    stubSite({
      'index.json': () => {
        throw new TypeError('offline');
      },
    });
    expect(await loadIndex(BASE)).toEqual({ ok: false, error: 'The list of sample faxes could not be reached.' });
  });

  it('reports text that is not JSON plainly', async () => {
    stubSite({ 'index.json': () => new Response('<html>') });
    expect(await loadIndex(BASE)).toEqual({ ok: false, error: 'The list of sample faxes could not be read.' });
  });

  it('reports data that fails the shared schema', async () => {
    stubSite({ 'index.json': () => json({ version: 99, referenceDate: '2026-10-01', faxes: [] }) });
    expect(await loadIndex(BASE)).toEqual({
      ok: false,
      error: 'The list of sample faxes is not in the expected form.',
    });
  });
});

describe('loadFax', () => {
  const entry = (committedIndex as { faxes: Array<{ id: string; level: string; image: string; data: string; receivedAt: string }> })
    .faxes[0]!;

  it('validates a committed fax file', async () => {
    stubSite();
    const result = await loadFax(entry, BASE);
    expect(result.ok && result.value.id).toBe('fax-0001');
  });

  it('rejects a fax file that fails the schema', async () => {
    stubSite({ 'fax-0001.json': () => json({ id: 'fax-0001' }) });
    const result = await loadFax(entry, BASE);
    expect(result).toEqual({ ok: false, error: 'The saved data for fax-0001 is not in the expected form.' });
  });

  it('rejects a fax file that belongs to another fax', async () => {
    stubSite({ 'fax-0001.json': () => json(committedFaxes['fax-0002.json']) });
    const result = await loadFax(entry, BASE);
    expect(result).toEqual({ ok: false, error: 'The saved data for fax-0001 belongs to a different fax.' });
  });
});

describe('loadInbox', () => {
  it('loads every fax with its image address', async () => {
    stubSite();
    const result = await loadInbox(BASE);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.referenceDate).toBe('2026-10-01');
    expect(result.value.items.map((i) => i.imageUrl)).toEqual([
      '/site/samples/fax-0001.png',
      '/site/samples/fax-0002.png',
      '/site/samples/fax-0003.png',
    ]);
    expect(result.value.items.every((i) => i.fax.ok)).toBe(true);
  });

  it('keeps the other faxes when one file is bad', async () => {
    stubSite({ 'fax-0002.json': () => json({}, 500) });
    const result = await loadInbox(BASE);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.items.map((i) => i.fax.ok)).toEqual([true, false, true]);
  });

  it('fails as a whole when the index is bad', async () => {
    stubSite({ 'index.json': () => json({}, 500) });
    expect((await loadInbox(BASE)).ok).toBe(false);
  });
});
