import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { MemoryStore } from './storage';
import { stubSite } from './test-site';

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
    expect(rowButton('fax-0001')).toHaveAccessibleName('fax-0001, No flags raised, Ready to verify');
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

    note('flagged', '⚑', '2 flagged', 'Not yet reviewed', 'fax-0003, 2 flagged, Not yet reviewed');
    await expectNoViolations(view.container);

    await openFax(user, 'fax-0003');
    await user.click(accept('npi'));
    await back(user);
    note('in-progress', '◐', '2 flagged, 1 reviewed', 'Review in progress', 'fax-0003, 2 flagged, 1 reviewed, Review in progress');
    await expectNoViolations(view.container);

    await openFax(user, 'fax-0003');
    await user.click(edit('callbackPhone'));
    const input = screen.getByLabelText('New value for Callback phone');
    await user.clear(input);
    await user.type(input, '555-0151{Enter}');
    await back(user);
    note('reviewed', '✓', '2 flagged, reviewed', 'Ready to verify', 'fax-0003, 2 flagged, reviewed, Ready to verify');
    await expectNoViolations(view.container);

    await openFax(user, 'fax-0003');
    await user.click(screen.getByRole('button', { name: 'Verify record' }));
    await back(user);
    note('laid-to-rest', '●', '2 flagged, reviewed', 'Laid to rest', 'fax-0003, 2 flagged, reviewed, Laid to rest');
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
    expect(rowButton('fax-0002')).toHaveAccessibleName('fax-0002, 3 flagged, Not yet reviewed');
  });
});
