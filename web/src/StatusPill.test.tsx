import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { MemoryStore } from './storage';
import { committedFaxes, json, stubSite } from './test-site';
import { NO_SAVED_ANSWER_MESSAGE } from '../../src/samples/schema.js';
import { SLOW_TEST_TIMEOUT } from './test-timeout';

// T1: this file renders the whole app or runs axe, which is slow on a busy machine. One shared limit: ./test-timeout.
vi.setConfig({ testTimeout: SLOW_TEST_TIMEOUT });

type UserApi = ReturnType<typeof userEvent.setup>;

function clock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 9, 1, 9, 30, tick++));
}

function setup() {
  stubSite();
  const view = render(<App now={clock()} storage={new MemoryStore()} onVerify={vi.fn()} download={() => {}} />);
  return { view, user: userEvent.setup() };
}

const rowButton = (id: string) => screen.getAllByRole('button').find((b) => b.dataset['faxId'] === id)!;
const pillOf = (id: string) => rowButton(id).querySelector<HTMLElement>('[data-pill]')!;
const accept = (name: string) => document.querySelector<HTMLElement>(`[data-accept="${name}"]`)!;
const edit = (name: string) => document.querySelector<HTMLElement>(`[data-edit="${name}"]`)!;

async function inbox() {
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
}

async function openFax(user: UserApi, id: string) {
  await user.click(rowButton(id));
  await screen.findByRole('heading', { level: 2, name: `Fax ${id}` });
}

const back = (user: UserApi) => user.click(screen.getByRole('button', { name: 'Back to inbox' }));
const icon = (id: string) => pillOf(id).querySelector('.pill-icon')!;

async function expectNoViolations(container: HTMLElement) {
  expect((await axe.run(container)).violations).toEqual([]);
}

describe('inbox status pills', () => {
  it('shows "No flags raised" for fax-0001 and no old wording anywhere', async () => {
    const { view } = setup();
    await inbox();
    const pill = pillOf('fax-0001');
    expect(pill).toHaveAttribute('data-pill', 'no-flags');
    expect(pill).toHaveTextContent('No flags raised');
    expect(pill).toHaveTextContent('Ready to verify');
    expect(icon('fax-0001')).toHaveTextContent('○');
    expect(rowButton('fax-0001')).toHaveAccessibleName('fax-0001, received Oct 1, 09:00, No flags raised, Ready to verify');
    expect(view.container.textContent).not.toContain('No flagged fields');
    expect(view.container.textContent).not.toContain('✓');
  });

  it('follows fax-0003 through every state, with a distinct icon and style each time', async () => {
    const { user, view } = setup();
    await inbox();
    await user.click(screen.getByRole('button', { name: 'Incoming fax' }));

    const seen: { kind: string; icon: string }[] = [];
    const note = (expected: string, iconText: string, flags: string, review: string, name: string) => {
      const pill = pillOf('fax-0003');
      expect(pill).toHaveAttribute('data-pill', expected);
      expect(pill).toHaveClass(`pill-${expected}`);
      expect(icon('fax-0003')).toHaveAttribute('aria-hidden', 'true');
      expect(icon('fax-0003')).toHaveTextContent(iconText);
      expect(pill.querySelector('.pill-flags')).toHaveTextContent(flags);
      expect(pill.querySelector('.pill-review')).toHaveTextContent(review);
      expect(rowButton('fax-0003')).toHaveAccessibleName(name);
      seen.push({ kind: expected, icon: iconText });
    };

    note('flagged', '⚑', '2 flagged', 'Not yet reviewed', 'fax-0003, received Oct 1, 09:14, 2 flagged, Not yet reviewed');
    await expectNoViolations(view.container);

    await openFax(user, 'fax-0003');
    await user.click(accept('npi'));
    await back(user);
    note('in-progress', '◐', '2 flagged, 1 reviewed', 'Review in progress', 'fax-0003, received Oct 1, 09:14, 2 flagged, 1 reviewed, Review in progress');
    await expectNoViolations(view.container);

    await openFax(user, 'fax-0003');
    await user.click(edit('callbackPhone'));
    const input = screen.getByLabelText('New value for Callback phone');
    await user.clear(input);
    await user.type(input, '555-0151{Enter}');
    await back(user);
    note('reviewed', '✓', '2 flagged, reviewed', 'Ready to verify', 'fax-0003, received Oct 1, 09:14, 2 flagged, reviewed, Ready to verify');
    await expectNoViolations(view.container);

    await openFax(user, 'fax-0003');
    await user.click(screen.getByRole('button', { name: 'Verify record' }));
    await back(user);
    note('laid-to-rest', '●', '2 flagged, reviewed', 'Laid to rest', 'fax-0003, received Oct 1, 09:14, 2 flagged, reviewed, Laid to rest');
    await expectNoViolations(view.container);

    expect(new Set(seen.map((s) => s.icon)).size).toBe(seen.length);
    expect(new Set(seen.map((s) => s.kind)).size).toBe(seen.length);
  });

  it('fax-0002 reads "No flags raised" for the model and "3 flagged" for the rules reader', async () => {
    const { user } = setup();
    await inbox();
    expect(pillOf('fax-0002')).toHaveTextContent('No flags raised');

    await openFax(user, 'fax-0002');
    await user.click(screen.getByRole('button', { name: 'Rules reader' }));
    await back(user);
    expect(pillOf('fax-0002')).toHaveAttribute('data-pill', 'flagged');
    expect(pillOf('fax-0002')).toHaveTextContent('3 flagged');
    expect(rowButton('fax-0002')).toHaveAccessibleName('fax-0002, received Oct 1, 09:07, 3 flagged, Not yet reviewed');
  });

  it('the time in each row name equals the visible time', async () => {
    setup();
    await inbox();
    for (const id of ['fax-0001', 'fax-0002']) {
      const visible = rowButton(id).querySelector('time')!.textContent;
      expect(rowButton(id).getAttribute('aria-label')).toContain(`, received ${visible}, `);
    }
  });

  it('names a row with no saved model answer', async () => {
    const noAnswer = structuredClone(committedFaxes['fax-0002.json']) as { readers: { model: unknown } };
    noAnswer.readers.model = { status: 'no-saved-answer', message: NO_SAVED_ANSWER_MESSAGE };
    stubSite({ 'fax-0002.json': () => json(noAnswer) });
    const { container } = render(<App now={clock()} storage={new MemoryStore()} onVerify={vi.fn()} download={() => {}} />);
    await inbox();
    expect(rowButton('fax-0002').getAttribute('aria-label')).toMatch(/^fax-0002, received Oct 1, 09:07, No saved model answer/);
    await expectNoViolations(container);
  });

  it('names a row that failed to load with its time and error, axe clean', async () => {
    stubSite({ 'fax-0002.json': () => json({ id: 'fax-0002' }) });
    const { container } = render(<App now={clock()} storage={new MemoryStore()} onVerify={vi.fn()} download={() => {}} />);
    await inbox();
    const failed = screen.getByRole('group', { name: /^fax-0002, received Oct 1, 09:07, Could not be read\. .*not in the expected form/ });
    expect(failed).toBeInTheDocument();
    await expectNoViolations(container);
  });
});
