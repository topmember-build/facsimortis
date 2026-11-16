import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { MemoryStore } from './storage';
import { stubSite } from './test-site';

type UserApi = ReturnType<typeof userEvent.setup>;

async function openFax3(user: UserApi, store = new MemoryStore()) {
  const view = render(<App storage={store} />);
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
  await user.click(screen.getByRole('button', { name: 'Incoming fax' }));
  await user.click(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === 'fax-0003')!);
  await screen.findByRole('heading', { level: 2, name: 'Fax fax-0003' });
  return view;
}

const accept = (name: string) => document.querySelector<HTMLElement>(`[data-accept="${name}"]`)!;
const edit = (name: string) => document.querySelector<HTMLElement>(`[data-edit="${name}"]`)!;
const summary = () => screen.getByRole('region', { name: 'Review summary' });

async function reviewAll(user: UserApi) {
  await user.click(accept('npi'));
  await user.click(edit('callbackPhone'));
  const input = screen.getByLabelText('New value for Callback phone');
  await user.clear(input);
  await user.type(input, '555-0151{Enter}');
}

describe('review summary bar', () => {
  it('holds the one Verify record button, with the fax id, status and reason', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax3(user);

    expect(screen.getAllByRole('button', { name: 'Verify record' })).toHaveLength(1);
    const bar = within(summary());
    expect(bar.getByRole('button', { name: 'Verify record' })).toHaveAttribute('aria-disabled', 'true');
    expect(bar.getByText('Fax fax-0003')).toBeInTheDocument();
    expect(bar.getByText('Not yet reviewed')).toBeInTheDocument();
    expect(bar.getByText(/^2 flagged fields still need review: /)).toBeInTheDocument();
    expect(bar.getByText('Check each value against the fax before verifying.')).toBeInTheDocument();
    expect(bar.getByRole('button', { name: 'Verify record' })).toHaveAccessibleDescription(
      /2 flagged fields still need review: .* Check each value against the fax before verifying\./,
    );
    // The field list is not inside the bar.
    expect(bar.queryByRole('list')).toBeNull();
  });

  it('updates after Accept', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax3(user);
    await user.click(accept('npi'));

    const bar = within(summary());
    expect(bar.getByText('Review in progress')).toBeInTheDocument();
    expect(bar.getByText(/^1 flagged field still needs review: /)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Verify record' })).toHaveLength(1);
  });

  it('shows Laid to rest with no Verify button when verified; Download JSON stays in the panel', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax3(user);
    await reviewAll(user);
    await user.click(screen.getByRole('button', { name: 'Verify record' }));

    const bar = within(summary());
    expect(bar.getByText('Laid to rest')).toBeInTheDocument();
    expect(bar.getByText('Fax fax-0003')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify record' })).toBeNull();
    expect(bar.queryByRole('button')).toBeNull();
    expect(summary().contains(screen.getByRole('button', { name: 'Download JSON' }))).toBe(false);
  });

  it('keeps Back to inbox and the reader toggle reachable outside the bar', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax3(user);
    const bar = within(summary());
    expect(bar.queryByRole('button', { name: 'Back to inbox' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Back to inbox' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rules reader' })).toBeInTheDocument();
  });

  it('puts Verify after the fields in tab order (DOM order, no positive tabindex)', async () => {
    stubSite();
    const user = userEvent.setup();
    const { container } = await openFax3(user);

    const verify = screen.getByRole('button', { name: 'Verify record' });
    const lastField = Array.from(container.querySelectorAll<HTMLElement>('[data-edit]')).pop()!;
    expect(lastField.compareDocumentPosition(verify) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const el of Array.from(container.querySelectorAll('[tabindex]'))) {
      expect(Number(el.getAttribute('tabindex'))).toBeLessThanOrEqual(0);
    }

    // From the last field's Edit button, the next Tab stop is Verify record.
    lastField.focus();
    await user.tab();
    expect(verify).toHaveFocus();
  });

  it('has no accessibility violations before review, during review and when verified', async () => {
    stubSite();
    const user = userEvent.setup();
    const { container } = await openFax3(user);
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(accept('npi'));
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(edit('callbackPhone'));
    const input = screen.getByLabelText('New value for Callback phone');
    await user.clear(input);
    await user.type(input, '555-0151{Enter}');
    await user.click(screen.getByRole('button', { name: 'Verify record' }));
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
