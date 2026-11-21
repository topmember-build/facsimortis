import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { NO_SAVED_ANSWER_MESSAGE } from '../../src/samples/schema.js';
import { App } from './App';
import { MemoryStore } from './storage';
import { committedFaxes, json, stubSite } from './test-site';

// R2: the inbox as an amber desktop. jsdom has no layout, so these check structure, names and order;
// the stylesheet rules are checked in test/web-desktop-css.test.ts.

type UserApi = ReturnType<typeof userEvent.setup>;

function setup() {
  stubSite();
  const view = render(<App storage={new MemoryStore()} now={() => new Date(Date.UTC(2026, 9, 1, 9, 30))} onVerify={vi.fn()} download={() => {}} />);
  return { ...view, user: userEvent.setup() };
}

const inbox = () => screen.findByRole('heading', { level: 2, name: 'Inbox' });
const icon = (id: string) => screen.getAllByRole('button').find((b) => b.dataset['faxId'] === id)!;
const taskbar = () => screen.getByRole('contentinfo');
const incoming = (user: UserApi) => user.click(screen.getByRole('button', { name: 'Incoming fax' }));

async function expectNoViolations(container: HTMLElement) {
  expect((await axe.run(container)).violations).toEqual([]);
}

describe('desktop icons', () => {
  it('keep each fax a button with its existing name, the thumbnail inside, and a ./ label', async () => {
    const { user } = setup();
    await inbox();
    await incoming(user);
    expect(icon('fax-0003')).toHaveAccessibleName('fax-0003, received Oct 1, 09:14, 2 flagged, Not yet reviewed');
    expect(icon('fax-0001')).toHaveAccessibleName('fax-0001, received Oct 1, 09:00, No flags raised, Ready to verify');
    const row = within(icon('fax-0003'));
    expect(row.getByRole('img', { name: 'First page of fax fax-0003' })).toBeInTheDocument();
    const label = icon('fax-0003').querySelector('.row-id')!;
    expect(label).toHaveTextContent('./fax-0003');
    expect(label.querySelector('.row-id-path')).toHaveAttribute('aria-hidden', 'true');
    // The pixel-art frame is decoration.
    expect(icon('fax-0003').querySelector('svg.doc-frame')).toHaveAttribute('aria-hidden', 'true');
  });

  it('show the coral "!" badge while flagged fields wait, and not after they are reviewed', async () => {
    const { user } = setup();
    await inbox();
    expect(document.querySelectorAll('.doc-badge')).toHaveLength(0);
    await incoming(user);
    const badge = icon('fax-0003').querySelector('svg.doc-badge')!;
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    expect(badge.querySelector('.doc-badge-mark')).not.toBeNull();
    expect(icon('fax-0001').querySelector('.doc-badge')).toBeNull();

    await user.click(icon('fax-0003'));
    await screen.findByRole('heading', { level: 2, name: 'Fax fax-0003' });
    await user.click(document.querySelector<HTMLElement>('[data-accept="npi"]')!);
    await user.click(screen.getByRole('button', { name: 'Back to inbox' }));
    expect(icon('fax-0003').querySelector('.doc-badge')).not.toBeNull();

    await user.click(icon('fax-0003'));
    await screen.findByRole('heading', { level: 2, name: 'Fax fax-0003' });
    await user.click(document.querySelector<HTMLElement>('[data-accept="callbackPhone"]')!);
    await user.click(screen.getByRole('button', { name: 'Back to inbox' }));
    expect(icon('fax-0003').querySelector('.doc-badge')).toBeNull();
    expect(within(icon('fax-0003')).getByText('2 flagged, reviewed')).toBeInTheDocument();
  });

  it('show the hint only when there are icons', async () => {
    setup();
    await inbox();
    expect(screen.getByText('Open an icon to see a fax.')).toBeInTheDocument();
  });
});

describe('taskbar', () => {
  it('shows the Inbox button, the tray status, the reader in use and the demo clock', async () => {
    const { user } = setup();
    await inbox();
    const bar = within(taskbar());
    expect(bar.getByRole('button', { name: 'Inbox' })).toBeInTheDocument();
    expect(taskbar()).toHaveTextContent('Now: 2 faxes in the tray · No flags raised');
    expect(bar.getByText('Reader: model (saved answers)')).toBeInTheDocument();
    const clock = taskbar().querySelector('.taskbar-clock')!;
    expect(clock).toHaveTextContent('Demo clock, Oct 1, 09:07');
    expect(clock.querySelector('time')).toHaveAttribute('dateTime', '2026-10-01T09:07:00');
    expect(clock.textContent).not.toMatch(/UTC/);

    await incoming(user);
    expect(taskbar()).toHaveTextContent('Now: 3 faxes in the tray · 2 flagged on fax-0003');
    expect(bar.getByText('2 flagged on fax-0003')).toHaveClass('taskbar-flag');
    expect(clock).toHaveTextContent('Demo clock, Oct 1, 09:14');
  });

  it('makes no "No flags raised" claim while a fax in the tray was not read', async () => {
    const noAnswer = structuredClone(committedFaxes['fax-0002.json']) as { readers: { model: unknown } };
    noAnswer.readers.model = { status: 'no-saved-answer', message: NO_SAVED_ANSWER_MESSAGE };
    stubSite({ 'fax-0002.json': () => json(noAnswer) });
    render(<App storage={new MemoryStore()} />);
    await inbox();
    expect(taskbar()).toHaveTextContent('Now: 2 faxes in the tray');
    expect(taskbar()).not.toHaveTextContent('No flags raised');
  });

  it('is not a live region, so the arrival is announced once, by the inbox', async () => {
    setup();
    await inbox();
    expect(taskbar().closest('[aria-live], [role="status"]')).toBeNull();
    expect(taskbar().querySelector('[aria-live], [role="status"]')).toBeNull();
  });

  it('Inbox moves focus to the first fax icon', async () => {
    const { user } = setup();
    await inbox();
    await user.click(within(taskbar()).getByRole('button', { name: 'Inbox' }));
    expect(icon('fax-0001')).toHaveFocus();
  });

  it('is only on the inbox: not on the fax screen', async () => {
    const { user } = setup();
    await inbox();
    await user.click(icon('fax-0001'));
    await screen.findByRole('heading', { level: 2, name: 'Fax fax-0001' });
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to inbox' }));
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });
});

describe('desktop order and accessibility', () => {
  it('keeps the tab order (icons, then Incoming fax) and adds the taskbar button last', async () => {
    const { user } = setup();
    await inbox();
    await user.tab();
    expect(icon('fax-0001')).toHaveFocus();
    await user.tab();
    expect(icon('fax-0002')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Incoming fax' })).toHaveFocus();
    await user.tab();
    expect(within(taskbar()).getByRole('button', { name: 'Inbox' })).toHaveFocus();
  });

  it('keeps the banner first, then the h1 and its line, then the inbox, then the taskbar, in the DOM', async () => {
    const { container } = setup();
    await inbox();
    const order = Array.from(container.children).map((el) => el.getAttribute('aria-label') ?? el.tagName.toLowerCase());
    expect(order).toEqual(['Synthetic data notice', 'header', 'main', 'footer']);
    expect(screen.getByRole('heading', { level: 1, name: 'Facsimortis' })).toBeInTheDocument();
    expect(screen.getByText(/built on synthetic data only/)).toBeInTheDocument();
  });

  it('is axe clean with two faxes, with three, and after a review', async () => {
    const { user, container } = setup();
    await inbox();
    await expectNoViolations(container);
    await incoming(user);
    await expectNoViolations(container);
    await user.click(icon('fax-0003'));
    await screen.findByRole('heading', { level: 2, name: 'Fax fax-0003' });
    await user.click(document.querySelector<HTMLElement>('[data-accept="npi"]')!);
    await user.click(screen.getByRole('button', { name: 'Back to inbox' }));
    await expectNoViolations(container);
  });
});
