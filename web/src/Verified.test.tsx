import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { downloadText } from './download';
import { VerifiedRecordSchema, type VerifiedRecord } from './record';
import { CORRUPT_NOTE, MemoryStore, NOT_KEPT_NOTE, STALE_NOTE, entryKey, type KeyValueStore } from './storage';
import { committedFaxes, committedIndex, json, stubSite } from './test-site';

type UserApi = ReturnType<typeof userEvent.setup>;

const LINE = 'Verified on Oct 1, 09:30 UTC. This record is read-only.';
const FILE = 'facsimortis-fax-0003-model-verified.json';

function clock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 9, 1, 9, 30, tick++));
}

function session(store: KeyValueStore | null, now = clock()) {
  const saved: { name: string; text: string }[] = [];
  const onVerify = vi.fn();
  const view = render(
    <App now={now} storage={store} onVerify={onVerify} download={(name, text) => saved.push({ name, text })} />,
  );
  return { view, saved, onVerify, user: userEvent.setup() };
}

async function openFax(user: UserApi, id: string) {
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
  if (id === 'fax-0003' && !rows().includes('fax-0003')) await user.click(screen.getByRole('button', { name: 'Incoming fax' }));
  await user.click(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === id)!);
  await screen.findByRole('heading', { level: 2, name: `Fax ${id}` });
}

const rows = () => screen.queryAllByRole('button').filter((b) => b.dataset['faxId']).map((b) => b.dataset['faxId']);
const rowFor = (id: string) => within(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === id)!);
const accept = (name: string) => document.querySelector<HTMLElement>(`[data-accept="${name}"]`)!;
const edit = (name: string) => document.querySelector<HTMLElement>(`[data-edit="${name}"]`)!;
const fieldButton = (name: string) => document.querySelector<HTMLElement>(`button[data-field="${name}"]`)!;
const statusLine = () => document.querySelector('.summary-bar .review-status')!.textContent;
const verifyButton = () => screen.queryByRole('button', { name: 'Verify record' });
const downloadButton = () => screen.queryByRole('button', { name: 'Download JSON' });

async function reviewAll(user: UserApi) {
  await user.click(accept('npi'));
  await user.click(edit('callbackPhone'));
  const input = screen.getByLabelText('New value for Callback phone');
  await user.clear(input);
  await user.type(input, '555-0151{Enter}');
}

async function verifyFax3(user: UserApi) {
  await openFax(user, 'fax-0003');
  await reviewAll(user);
  await user.click(verifyButton()!);
}

function storedRecord(store: MemoryStore): VerifiedRecord {
  const entry = JSON.parse(store.data.get(entryKey('fax-0003', 'model'))!) as { verified: unknown };
  return VerifiedRecordSchema.parse(entry.verified);
}

describe('save and reload', () => {
  it('restores review progress and the inbox label after a reload', async () => {
    stubSite();
    const store = new MemoryStore();
    const first = session(store);
    await openFax(first.user, 'fax-0003');
    await first.user.click(accept('npi'));
    expect(statusLine()).toContain('Review in progress');
    first.view.unmount();

    const second = session(store);
    await screen.findByRole('heading', { level: 2, name: 'Inbox' });
    await second.user.click(screen.getByRole('button', { name: 'Incoming fax' }));
    expect(rowFor('fax-0003').getByText('Review in progress')).toBeInTheDocument();
    await openFax(second.user, 'fax-0003');
    expect(statusLine()).toContain('Review in progress');
    // The NPI was accepted before the reload, so only the phone is still waiting. Flags are worked out again.
    expect(document.querySelector('[data-accept="npi"]')).toBeNull();
    expect(accept('callbackPhone')).toBeInTheDocument();
    expect(screen.queryByText(STALE_NOTE)).not.toBeInTheDocument();
  });

  it('restores the verified state after a reload', async () => {
    stubSite();
    const store = new MemoryStore();
    const first = session(store);
    await verifyFax3(first.user);
    expect(statusLine()).toContain('Laid to rest');
    first.view.unmount();

    const second = session(store);
    await screen.findByRole('heading', { level: 2, name: 'Inbox' });
    await second.user.click(screen.getByRole('button', { name: 'Incoming fax' }));
    expect(rowFor('fax-0003').getByText('Laid to rest')).toBeInTheDocument();
    expect(rowFor('fax-0001').queryByText('Laid to rest')).not.toBeInTheDocument();
    await openFax(second.user, 'fax-0003');
    expect(statusLine()).toContain('Laid to rest');
    expect(screen.getByText(LINE)).toBeInTheDocument();
    expect(downloadButton()).toBeInTheDocument();
  });

  it('keeps the two readers apart across a reload', async () => {
    stubSite();
    const store = new MemoryStore();
    const first = session(store);
    await verifyFax3(first.user);
    first.view.unmount();

    const second = session(store);
    await openFax(second.user, 'fax-0003');
    await second.user.click(screen.getByRole('button', { name: 'Rules reader' }));
    expect(statusLine()).not.toContain('Laid to rest');
    expect(verifyButton()).toBeInTheDocument();
    expect(downloadButton()).not.toBeInTheDocument();
    await second.user.click(screen.getByRole('button', { name: 'Back to inbox' }));
    expect(rowFor('fax-0003').queryByText('Laid to rest')).not.toBeInTheDocument();
    expect([...store.data.keys()].sort()).toEqual([entryKey('fax-0003', 'model')]);
  });
});

describe('the verified record', () => {
  it('is built from fax-0003 (model) after Accept NPI and Edit phone, and saved', async () => {
    stubSite();
    const store = new MemoryStore();
    const { user, onVerify } = session(store);
    await verifyFax3(user);

    expect(onVerify).toHaveBeenCalledWith('fax-0003', 'model');
    const record = storedRecord(store);
    expect(record).toMatchObject({
      synthetic: true,
      notice: 'Synthetic data. Demo only.',
      faxId: 'fax-0003',
      reader: 'model',
      referenceDate: (committedIndex as { referenceDate: string }).referenceDate,
      verifier: 'Demo reviewer',
    });
    expect(record.verifiedAtUtc).toMatch(/^2026-10-01T09:30:0\d\.000Z$/);
    expect(record).not.toHaveProperty('verifiedAt');
    expect(record.actions.every((a) => a.atUtc.endsWith('Z') && !('at' in a))).toBe(true);
    const phone = record.fields.find((f) => f.name === 'callbackPhone')!;
    const npi = record.fields.find((f) => f.name === 'npi')!;
    expect(phone).toMatchObject({ originalValue: '555~0151', finalValue: '555-0151', source: 'reviewer', reviewed: true });
    expect(npi).toMatchObject({ originalValue: '6720988041', finalValue: '6720988041', source: 'page', reviewed: true });
    expect(record.actions.map((a) => [a.field, a.action])).toEqual([
      ['npi', 'accepted'],
      ['callbackPhone', 'edited'],
    ]);
    expect(record.actions[1]).toMatchObject({ originalValue: '555~0151', newValue: '555-0151' });
  });

  it('is read-only, named "Laid to rest", and keeps highlights and the notice', async () => {
    stubSite();
    const { user } = session(new MemoryStore());
    await verifyFax3(user);

    expect(statusLine()).toContain('Laid to rest');
    expect(screen.getByRole('heading', { level: 3, name: 'Laid to rest' })).toBeInTheDocument();
    expect(screen.getByText(LINE)).toBeInTheDocument();
    expect(screen.getByText(/Verifier: Demo reviewer/)).toBeInTheDocument();
    expect(verifyButton()).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-accept], [data-edit]')).toHaveLength(0);
    expect(downloadButton()).toHaveFocus();
    expect(screen.getByText(/Record laid to rest/)).toBeInTheDocument();

    const phone = within(fieldButton('callbackPhone'));
    expect(phone.getByText('555-0151')).toBeInTheDocument();
    expect(phone.getByText('Read from the page: 555~0151')).toBeInTheDocument();
    await user.click(fieldButton('callbackPhone'));
    const ghost = document.querySelector('g[data-field="callbackPhone"]')!;
    expect(ghost).toHaveAttribute('data-selected', 'true');
    expect(ghost.querySelectorAll('rect').length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Synthetic data' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Back to inbox' }));
    expect(rowFor('fax-0003').getByText('Laid to rest')).toBeInTheDocument();
  });

  it('shows the summary counts on the card, the same as in the export, and hides the duplicate history line', async () => {
    stubSite();
    const store = new MemoryStore();
    const { user, saved } = session(store);
    await verifyFax3(user);
    const lines = [...document.querySelectorAll('[data-summary] li')].map((li) => li.textContent);
    expect(lines).toEqual([
      '7 fields',
      '2 were flagged',
      '2 reviewed by you',
      '1 edited by you',
      '1 accepted although the check failed',
      '5 not flagged and not checked by a reviewer',
    ]);
    expect(storedRecord(store).summary).toEqual({
      totalFields: 7, flagged: 2, reviewed: 2, edited: 1, acceptedDespiteFlag: 1, notFlaggedNotChecked: 5,
    });
    // Accepted although the check failed: the label is shown, the history line is not.
    expect(within(fieldButton('npi')).getByText('Accepted although the check failed')).toBeInTheDocument();
    expect(within(fieldButton('npi')).queryByText(/Was flagged/)).not.toBeInTheDocument();
    expect(document.querySelector('.laid-to-rest')!.textContent).not.toMatch(/Was flagged/);
    // Elsewhere the history line stays (phone was edited to a valid value).
    expect(within(fieldButton('callbackPhone')).getByText(/Was flagged/)).toBeInTheDocument();
    // The export keeps the full history.
    await user.click(downloadButton()!);
    const exported = VerifiedRecordSchema.parse(JSON.parse(saved[0]!.text));
    expect(exported.summary).toEqual(storedRecord(store).summary);
    expect(exported.fields.find((f) => f.name === 'npi')!.originalFlags.length).toBeGreaterThan(0);
    expect(exported.actions).toHaveLength(2);
  });  it('has no accessibility violations in the verified state', async () => {
    stubSite();
    const { user, view } = session(new MemoryStore());
    await verifyFax3(user);
    expect((await axe.run(view.container)).violations).toEqual([]);
  });
});

describe('export', () => {
  it('is not offered before verify', async () => {
    stubSite();
    const { user } = session(new MemoryStore());
    await openFax(user, 'fax-0003');
    expect(downloadButton()).not.toBeInTheDocument();
    await reviewAll(user);
    expect(downloadButton()).not.toBeInTheDocument();
  });

  it('downloads the verified record as pretty JSON with the agreed file name', async () => {
    stubSite();
    const store = new MemoryStore();
    const { user, saved } = session(store);
    await verifyFax3(user);
    await user.click(downloadButton()!);

    expect(saved).toHaveLength(1);
    expect(saved[0]!.name).toBe(FILE);
    expect(saved[0]!.text.endsWith('}\n')).toBe(true);
    expect(saved[0]!.text).toContain('\n  "synthetic": true,');
    expect(JSON.parse(saved[0]!.text)).toEqual(storedRecord(store));
  });
});

describe('download in the browser', () => {
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  afterEach(() => {
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
    vi.restoreAllMocks();
  });

  it('uses a Blob, an object URL and a download link', async () => {
    let blob: Blob | undefined;
    URL.createObjectURL = (b: Blob | MediaSource) => {
      blob = b as Blob;
      return 'blob:test';
    };
    URL.revokeObjectURL = vi.fn();
    const clicked: { download: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href });
    });
    downloadText(FILE, '{}\n');
    expect(clicked).toEqual([{ download: FILE, href: 'blob:test' }]);
    expect(blob?.type).toBe('application/json');
    expect(await blob!.text()).toBe('{}\n');
    expect(document.querySelector('a[download]')).toBeNull();
  });
});

describe('data that cannot be used', () => {
  it('ignores stale data once, plainly, and starts again', async () => {
    stubSite();
    const store = new MemoryStore();
    const first = session(store);
    await openFax(first.user, 'fax-0003');
    await first.user.click(accept('npi'));
    first.view.unmount();

    // Same fax, different data: the saved entry no longer matches.
    const changed = structuredClone(committedFaxes['fax-0003.json']) as { ocr: { words: { text: string }[] } };
    changed.ocr.words[0]!.text = 'changed';
    stubSite({ 'fax-0003.json': () => json(changed) });
    const second = session(store);
    await screen.findByRole('heading', { level: 2, name: 'Inbox' });
    expect(screen.getAllByText(STALE_NOTE)).toHaveLength(1);
    await second.user.click(screen.getByRole('button', { name: 'Incoming fax' }));
    expect(rowFor('fax-0003').getByText('Not yet reviewed')).toBeInTheDocument();
  });

  it('ignores data saved for a different reference date', async () => {
    stubSite();
    const store = new MemoryStore();
    const first = session(store);
    await openFax(first.user, 'fax-0003');
    await first.user.click(accept('npi'));
    first.view.unmount();

    stubSite({ 'index.json': () => json({ ...(committedIndex as object), referenceDate: '2026-10-02' }) });
    session(store);
    await screen.findByRole('heading', { level: 2, name: 'Inbox' });
    expect(screen.getAllByText(STALE_NOTE)).toHaveLength(1);
  });

  it('ignores corrupt data with a plain note and does not crash', async () => {
    stubSite();
    const store = new MemoryStore();
    store.setItem(entryKey('fax-0003', 'model'), '{not json');
    store.setItem(entryKey('fax-0003', 'rules'), JSON.stringify({ version: 1, actions: 'nope' }));
    const { user } = session(store);
    await screen.findByRole('heading', { level: 2, name: 'Inbox' });
    expect(screen.getAllByText(CORRUPT_NOTE)).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Incoming fax' }));
    expect(rowFor('fax-0003').getByText('Not yet reviewed')).toBeInTheDocument();
    await openFax(user, 'fax-0003');
    await user.click(accept('npi'));
    expect(statusLine()).toContain('Review in progress');
  });

  it('works in memory and says progress will not be kept when the store throws', async () => {
    stubSite();
    const broken: KeyValueStore = {
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
    const { user } = session(broken);
    await screen.findByRole('heading', { level: 2, name: 'Inbox' });
    expect(screen.getByText(NOT_KEPT_NOTE)).toBeInTheDocument();
    await verifyFax3(user);
    expect(statusLine()).toContain('Laid to rest');
    expect(screen.getAllByText(NOT_KEPT_NOTE)).toHaveLength(1);
  });

  it('says the same when there is no storage at all, and not otherwise', async () => {
    stubSite();
    const none = session(null);
    await screen.findByRole('heading', { level: 2, name: 'Inbox' });
    expect(screen.getByText(NOT_KEPT_NOTE)).toBeInTheDocument();
    none.view.unmount();

    session(new MemoryStore());
    await screen.findByRole('heading', { level: 2, name: 'Inbox' });
    expect(screen.queryByText(NOT_KEPT_NOTE)).not.toBeInTheDocument();
  });
});
