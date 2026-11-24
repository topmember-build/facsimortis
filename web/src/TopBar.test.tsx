import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import type { SampleFax } from '../../src/samples/schema.js';
import { App } from './App';
import { liveSummary, summarise, verifiedFields } from './record';
import { EMPTY_REVIEW, reviewReducer, type ReviewState } from './review-state';
import { MemoryStore } from './storage';
import { committedFaxes, json, stubSite } from './test-site';
import { SLOW_TEST_TIMEOUT } from './test-timeout';

// T1: this file renders the whole app or runs axe, which is slow on a busy machine. One shared limit: ./test-timeout.
vi.setConfig({ testTimeout: SLOW_TEST_TIMEOUT });

type UserApi = ReturnType<typeof userEvent.setup>;

const faxRow = (id: string) => screen.getAllByRole('button').find((b) => b.dataset['faxId'] === id)!;
const accept = (name: string) => document.querySelector<HTMLElement>(`[data-accept="${name}"]`)!;
const edit = (name: string) => document.querySelector<HTMLElement>(`[data-edit="${name}"]`)!;
const bar = () => within(screen.getByRole('region', { name: 'Review summary' }));
const countText = (name: string) => document.querySelector<HTMLElement>(`[data-count="${name}"]`)!.textContent;

async function openFax(user: UserApi, id: string) {
  const view = render(<App storage={new MemoryStore()} />);
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
  await user.click(screen.getByRole('button', { name: 'Incoming fax' }));
  const row = faxRow(id);
  const inboxTime = row.querySelector('time')!.textContent;
  await user.click(row);
  await screen.findByRole('heading', { level: 2, name: `Fax ${id}` });
  return { ...view, inboxTime };
}

async function editField(user: UserApi, name: string, label: string, value: string) {
  await user.click(edit(name));
  const input = screen.getByLabelText(`New value for ${label}`);
  await user.clear(input);
  await user.type(input, `${value}{Enter}`);
}

function fax3(): SampleFax {
  return committedFaxes['fax-0003.json'] as SampleFax;
}
function fax3Fields() {
  const result = fax3().readers.model;
  if (result.status !== 'ok') throw new Error('fax-0003 has no model answer');
  return result.fields;
}
function expected(state: ReviewState) {
  const s = summarise(verifiedFields(fax3Fields(), state));
  return { flagged: s.flagged, reviewed: s.reviewed, edited: s.edited };
}
function shown() {
  return {
    flagged: Number(/^(?:⚑ )?(\d+) flagged$/.exec(countText('flagged')!.trim())![1]),
    reviewed: Number(/^(\d+) reviewed$/.exec(countText('reviewed')!)![1]),
    edited: Number(/^(\d+) edited$/.exec(countText('edited')!)![1]),
  };
}

describe('top bar: id, received time and urgency', () => {
  it('shows the id, the inbox time followed by UTC, and the page urgency', async () => {
    stubSite();
    const user = userEvent.setup();
    const { inboxTime } = await openFax(user, 'fax-0003');
    const b = bar();
    expect(b.getByText('Fax fax-0003')).toBeInTheDocument();
    const time = document.querySelector('[data-summary-received] time')!;
    expect(inboxTime).toBeTruthy();
    expect(time.textContent).toBe(`${inboxTime} (demo clock)`);
    expect(document.querySelector('[data-summary-urgency]')!.textContent).toBe('Urgency: urgent');
  });

  it('shows the reviewer value after an edit', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    await editField(user, 'urgency', 'Urgency', 'emergent');
    expect(document.querySelector('[data-summary-urgency]')!.textContent).toBe('Urgency: emergent');
  });

  it('shows "Not read" when the field is empty', async () => {
    const clone = structuredClone(committedFaxes['fax-0003.json']) as {
      readers: { model: { fields: { name: string; value: string | null; wordIds: string[]; flags: string[] }[] } };
    };
    const urgency = clone.readers.model.fields.find((f) => f.name === 'urgency')!;
    urgency.value = null;
    urgency.wordIds = [];
    urgency.flags = ['Not found on the page'];
    stubSite({ 'fax-0003.json': () => json(clone) });
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    expect(document.querySelector('[data-summary-urgency]')!.textContent).toBe('Urgency: Not read');
  });
});

describe('top bar: summary counts', () => {
  it('match summarise() before review, after Accept NPI and after Edit phone', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    let state: ReviewState = EMPTY_REVIEW;
    expect(shown()).toEqual(expected(state));
    expect(shown()).toEqual(liveSummaryPick(state));
    expect(shown().flagged).toBeGreaterThan(0);

    await user.click(accept('npi'));
    const npi = fax3Fields().find((f) => f.name === 'npi')!;
    state = reviewReducer(state, { type: 'accept', field: 'npi', originalValue: npi.value, failedChecks: [], at: 't' });
    expect(shown().reviewed).toBe(1);
    expect(shown().reviewed).toBe(expected(state).reviewed);
    expect(shown().flagged).toBe(expected(state).flagged);

    await editField(user, 'callbackPhone', 'Callback phone', '555-0151');
    expect(shown().edited).toBe(1);
    expect(shown().reviewed).toBe(2);
    expect(countText('edited')).toBe('1 edited');
  });

  it('uses the flag class on the flagged count only', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    expect(document.querySelector('[data-count="flagged"]')).toHaveClass('count-flag');
    expect(document.querySelector('[data-count="reviewed"]')).not.toHaveClass('count-flag');
    expect(document.querySelector('[data-count="edited"]')).not.toHaveClass('count-flag');
  });

  it('keeps the one Verify record button with class button-primary', async () => {
    stubSite();
    const user = userEvent.setup();
    const { container } = await openFax(user, 'fax-0003');
    expect(container.querySelectorAll('.button-primary')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Verify record' })).toHaveClass('button-primary');
  });
});

function liveSummaryPick(state: ReviewState) {
  const s = liveSummary(fax3Fields(), state);
  return { flagged: s.flagged, reviewed: s.reviewed, edited: s.edited };
}

describe('top bar: accessibility', () => {
  it('has no axe violations before review, during, ready to verify and laid to rest', async () => {
    stubSite();
    const user = userEvent.setup();
    const { container } = await openFax(user, 'fax-0003');
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(accept('npi'));
    expect((await axe.run(container)).violations).toEqual([]);
    await editField(user, 'callbackPhone', 'Callback phone', '555-0151');
    expect(bar().getByText('Ready to verify')).toBeInTheDocument();
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Verify record' }));
    await screen.findByRole('heading', { level: 3, name: 'Laid to rest' });
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
