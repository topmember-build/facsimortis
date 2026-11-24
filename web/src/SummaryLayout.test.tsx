import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { MemoryStore } from './storage';
import { stubSite } from './test-site';
import { SLOW_TEST_TIMEOUT } from './test-timeout';

// T1: this file renders the whole app or runs axe, which is slow on a busy machine. One shared limit: ./test-timeout.
vi.setConfig({ testTimeout: SLOW_TEST_TIMEOUT });

async function openFax3(user: ReturnType<typeof userEvent.setup>) {
  const view = render(<App storage={new MemoryStore()} />);
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
  await user.click(screen.getByRole('button', { name: 'Incoming fax' }));
  await user.click(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === 'fax-0003')!);
  await screen.findByRole('heading', { level: 2, name: 'Fax fax-0003' });
  return view;
}
const accept = (name: string) => document.querySelector<HTMLElement>(`[data-accept="${name}"]`)!;

describe('summary bar structure (D4b)', () => {
  it('keeps the bar last in the DOM, the reason grouped directly above Verify, and the same description', async () => {
    stubSite();
    const user = userEvent.setup();
    const { container } = await openFax3(user);
    const bar = screen.getByRole('region', { name: 'Review summary' });
    const fax = container.querySelector('.fax-view')!;
    expect(fax.lastElementChild).toBe(bar);
    expect(Array.from(bar.children).map((c) => c.className)).toEqual(['summary-row', 'summary-verify', 'verify-note']);
    const group = bar.querySelector('.summary-verify')!;
    expect(Array.from(group.children).map((c) => c.id || c.tagName)).toEqual(['verify-reason', 'BUTTON']);
    const verify = screen.getByRole('button', { name: 'Verify record' });
    expect(verify).toHaveAttribute('aria-describedby', 'verify-reason verify-note');
    expect(verify.previousElementSibling).toBe(document.getElementById('verify-reason'));
    expect(document.getElementById('verify-reason')).toHaveAttribute('aria-live', 'polite');
    // Top row: id, received, urgency, status, counts.
    const top = bar.querySelector('.summary-row')!;
    expect(top.querySelector('.summary-id')).not.toBeNull();
    expect(top.querySelector('.review-status')).not.toBeNull();
    expect(top.querySelector('#verify-reason, [data-verify]')).toBeNull();
  });

  it('has no accessibility violations before review, ready to verify and laid to rest', async () => {
    stubSite();
    const user = userEvent.setup();
    const { container } = await openFax3(user);
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(accept('npi'));
    await user.click(document.querySelector<HTMLElement>('[data-edit="callbackPhone"]')!);
    const input = screen.getByLabelText('New value for Callback phone');
    await user.clear(input);
    await user.type(input, '555-0151{Enter}');
    expect(screen.getByRole('button', { name: 'Verify record' })).toHaveAttribute('aria-disabled', 'false');
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Verify record' }));
    expect(within(screen.getByRole('region', { name: 'Review summary' })).getByText('Laid to rest')).toBeInTheDocument();
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
