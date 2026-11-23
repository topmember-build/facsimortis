import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { WINDOW_TITLE_KIND } from './FaxView';
import { MemoryStore } from './storage';
import { stubSite } from './test-site';

// R4a: the review screen inside a window. On screen the title bar reads "<id> — referral"; to screen readers
// the heading still reads "Fax <id>". Close window does what Back to inbox does, and nothing else.
type UserApi = ReturnType<typeof userEvent.setup>;

const row = (id: string) => screen.getAllByRole('button').find((b) => b.dataset['faxId'] === id)!;
const closeButton = () => screen.getByRole('button', { name: 'Close window' });
const backButton = () => screen.getByRole('button', { name: 'Back to inbox' });
const faxWindow = () => document.querySelector<HTMLElement>('section.fax-view')!;

async function showInbox(user: UserApi, store = new MemoryStore()) {
  const view = render(<App storage={store} />);
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
  await user.click(screen.getByRole('button', { name: 'Incoming fax' }));
  return view;
}

async function openFax(user: UserApi, id: string, store = new MemoryStore()) {
  const view = await showInbox(user, store);
  await user.click(row(id));
  await screen.findByRole('heading', { level: 2, name: `Fax ${id}` });
  return view;
}

describe('R4a review window title bar', () => {
  it.each(['fax-0001', 'fax-0003'])('titles the window of %s "<id> — referral" and keeps the heading "Fax <id>"', async (id) => {
    stubSite();
    await openFax(userEvent.setup(), id);
    const heading = screen.getByRole('heading', { level: 2, name: `Fax ${id}` });
    expect(heading.textContent).toBe(`Fax ${id}`);
    // "Fax" is for screen readers only; the id is the visible start of the title.
    expect(heading.querySelector('.sr-only')!.textContent).toBe('Fax');
    const kind = document.querySelector('.fax-title-row > .fax-title-kind')!;
    expect(kind.textContent).toBe(`— ${WINDOW_TITLE_KIND}`);
    expect(WINDOW_TITLE_KIND).toBe('referral');
    expect(kind).toHaveAttribute('aria-hidden', 'true');
    expect(faxWindow()).toHaveAccessibleName(`Fax ${id}`);
  });

  it('keeps the heading hierarchy: the h1, the fax heading as the only h2, then the two field sections', async () => {
    stubSite();
    await openFax(userEvent.setup(), 'fax-0003');
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));
    expect(headings.map((h) => h.tagName)).toEqual(['H1', 'H2', 'H3', 'H3']);
    expect(headings[0]).toBe(screen.getByRole('heading', { level: 1, name: 'Facsimortis' }));
    expect(headings[1]).toBe(screen.getByRole('heading', { level: 2, name: 'Fax fax-0003' }));
    expect(headings[2]).toBe(screen.getByRole('heading', { level: 3, name: 'Needs your eyes' }));
    expect(headings[3]).toBe(screen.getByRole('heading', { level: 3, name: 'Read cleanly' }));
  });

  it('holds Back to inbox and Close window as real buttons, with no minimise or maximise and no SVG', async () => {
    stubSite();
    await openFax(userEvent.setup(), 'fax-0003');
    for (const [button, name] of [
      [closeButton(), 'Close window'],
      [backButton(), 'Back to inbox'],
    ] as const) {
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveAttribute('type', 'button');
      expect(button).toHaveAttribute('aria-label', name);
    }
    // Close window opens the window in the DOM; Back to inbox opens the header, before the heading.
    expect(faxWindow().firstElementChild).toBe(closeButton());
    expect(document.querySelector('.fax-header')!.firstElementChild).toBe(backButton());
    expect(screen.queryByRole('button', { name: /minimi[sz]e|maximi[sz]e/i })).toBeNull();
    // The glyphs are CSS, so the fax image is still the first SVG in the window.
    expect(faxWindow().querySelector('svg')).toHaveClass('fax-image');
  });
});

describe('R4a keyboard and Close window', () => {
  it('goes Close window, Back to inbox, then the reader toggle, and Close returns focus to the fax row', async () => {
    stubSite();
    const user = userEvent.setup();
    await showInbox(user);
    row('fax-0003').focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 2, name: 'Fax fax-0003' })).toHaveFocus();

    await user.tab({ shift: true });
    expect(backButton()).toHaveFocus();
    await user.tab({ shift: true });
    expect(closeButton()).toHaveFocus();
    for (const name of ['Back to inbox', 'Model answers', 'Rules reader', 'Show full page']) {
      await user.tab();
      expect(screen.getByRole('button', { name })).toHaveFocus();
    }

    closeButton().focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('heading', { level: 2, name: 'Inbox' });
    expect(row('fax-0003')).toHaveFocus();
  });

  it('does what Back to inbox does and nothing else: same inbox row, same saved progress', async () => {
    stubSite();
    const user = userEvent.setup();
    const store = new MemoryStore();
    await openFax(user, 'fax-0003', store);
    await user.click(document.querySelector<HTMLElement>('[data-accept="npi"]')!);

    await user.click(closeButton());
    await screen.findByRole('heading', { level: 2, name: 'Inbox' });
    const afterClose = { row: row('fax-0003').textContent, saved: JSON.stringify([...store.data]) };

    await user.click(row('fax-0003'));
    await screen.findByRole('heading', { level: 2, name: 'Fax fax-0003' });
    await user.click(backButton());
    await screen.findByRole('heading', { level: 2, name: 'Inbox' });
    const afterBack = { row: row('fax-0003').textContent, saved: JSON.stringify([...store.data]) };

    expect(afterClose).toEqual(afterBack);
    expect(afterClose.row).toContain('Review in progress');
  });

  it('has no axe violations in the window, on both readers', async () => {
    stubSite();
    const user = userEvent.setup();
    const { container } = await openFax(user, 'fax-0003');
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Rules reader' }));
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
