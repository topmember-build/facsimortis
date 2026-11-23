import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { MemoryStore } from './storage';
import { stubSite } from './test-site';

// R5b: after Verify, focus moves to the Laid to rest heading (a code-only focus target that is not a Tab stop),
// and the result is announced through the existing polite live region, which is the same element before and
// after (an element that is already in the page is announced reliably; a newly inserted one often is not).
type UserApi = ReturnType<typeof userEvent.setup>;
const live = () => document.querySelector<HTMLElement>('[aria-live="polite"].sr-only')!;
const ANNOUNCEMENT = 'Record laid to rest. It is now read-only. Download JSON is available.';

async function openFax3(user: UserApi) {
  stubSite();
  const view = render(<App storage={new MemoryStore()} />);
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
  await user.click(screen.getByRole('button', { name: 'Incoming fax' }));
  await user.click(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === 'fax-0003')!);
  await screen.findByRole('heading', { level: 2, name: 'Fax fax-0003' });
  return view;
}
/** Accepts both flags with the mouse, then presses Enter on Verify record, which has focus by then. */
async function verifyWithKeyboard(user: UserApi) {
  await user.click(document.querySelector<HTMLElement>('[data-accept="callbackPhone"]')!);
  await user.click(document.querySelector<HTMLElement>('[data-accept="npi"]')!);
  expect(screen.getByRole('button', { name: 'Verify record' })).toHaveFocus();
  await user.keyboard('{Enter}');
}

describe('R5b focus and announcement after Verify', () => {
  it('moves focus to the Laid to rest heading, which is focusable by code only', async () => {
    const user = userEvent.setup();
    await openFax3(user);
    await verifyWithKeyboard(user);
    const heading = await screen.findByRole('heading', { level: 3, name: 'Laid to rest' });
    expect(heading).toHaveFocus();
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(heading.closest('[data-laid-to-rest]')).not.toBeNull();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('keeps the heading out of the tab order, with Download JSON as the next Tab stop', async () => {
    const user = userEvent.setup();
    await openFax3(user);
    await verifyWithKeyboard(user);
    const heading = await screen.findByRole('heading', { level: 3, name: 'Laid to rest' });
    await user.tab();
    expect(screen.getByRole('button', { name: 'Download JSON' })).toHaveFocus();
    // Walk the whole page by Tab from the top: the heading is never a stop.
    (document.activeElement as HTMLElement).blur();
    const stops: Element[] = [];
    for (let i = 0; i < 60; i += 1) {
      await user.tab();
      if (stops.includes(document.activeElement!)) break;
      stops.push(document.activeElement!);
    }
    expect(stops.length).toBeGreaterThan(5);
    expect(stops).not.toContain(heading);
    expect(stops).toContain(screen.getByRole('button', { name: 'Download JSON' }));
  });

  it('announces the result through the one polite live region that was already in the page', async () => {
    const user = userEvent.setup();
    await openFax3(user);
    const region = live();
    expect(document.querySelectorAll('[aria-live="polite"].sr-only')).toHaveLength(1);
    expect(region).not.toHaveTextContent(ANNOUNCEMENT);
    await verifyWithKeyboard(user);
    await screen.findByRole('heading', { level: 3, name: 'Laid to rest' });
    expect(live()).toBe(region);
    expect(region).toHaveTextContent(ANNOUNCEMENT);
    expect(region).toBeInTheDocument();
    // Hidden from view only: it is not display:none or aria-hidden, so it is announced.
    expect(region.closest('[aria-hidden="true"]')).toBeNull();
    expect(region.hasAttribute('hidden')).toBe(false);
  });

  it('has no axe violations with the heading focused', async () => {
    const user = userEvent.setup();
    const { container } = await openFax3(user);
    await verifyWithKeyboard(user);
    await screen.findByRole('heading', { level: 3, name: 'Laid to rest' });
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
