import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { WINDOW_TITLE_KIND, WINDOW_TITLE_KIND_VERIFIED } from './FaxView';
import { MemoryStore } from './storage';
import { stubSite } from './test-site';
import { SLOW_TEST_TIMEOUT } from './test-timeout';

// T1: this file renders the whole app or runs axe, which is slow on a busy machine. One shared limit: ./test-timeout.
vi.setConfig({ testTimeout: SLOW_TEST_TIMEOUT });

// R5a: when the record is laid to rest, the window's title bar reads "<id> — laid to rest", the window says so
// in data-state (the stylesheet fades the coral emphasis on it), and the heading, the status and the
// Download JSON button keep their names.
type UserApi = ReturnType<typeof userEvent.setup>;
const faxWindow = () => document.querySelector<HTMLElement>('section.fax-view')!;
const titleKind = () => document.querySelector('.fax-title-row > .fax-title-kind')!;

async function openFax3(user: UserApi) {
  stubSite();
  const view = render(<App storage={new MemoryStore()} />);
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
  await user.click(screen.getByRole('button', { name: 'Incoming fax' }));
  await user.click(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === 'fax-0003')!);
  await screen.findByRole('heading', { level: 2, name: 'Fax fax-0003' });
  return view;
}
async function verify(user: UserApi) {
  await user.click(document.querySelector<HTMLElement>('[data-accept="callbackPhone"]')!);
  await user.click(document.querySelector<HTMLElement>('[data-accept="npi"]')!);
  await user.click(screen.getByRole('button', { name: 'Verify record' }));
  await screen.findByRole('heading', { level: 3, name: 'Laid to rest' });
}

describe('R5a laid to rest window', () => {
  it('reads "<id> — referral" until Verify and "<id> — laid to rest" after, with the heading name unchanged', async () => {
    const user = userEvent.setup();
    await openFax3(user);
    expect(WINDOW_TITLE_KIND_VERIFIED).toBe('laid to rest');
    expect(titleKind()).toHaveTextContent(`— ${WINDOW_TITLE_KIND}`);
    expect(titleKind()).toHaveAttribute('aria-hidden', 'true');
    expect(faxWindow()).not.toHaveAttribute('data-state');

    await verify(user);
    expect(titleKind()).toHaveTextContent('— laid to rest');
    expect(titleKind()).toHaveAttribute('aria-hidden', 'true');
    expect(faxWindow()).toHaveAttribute('data-state', 'laid-to-rest');
    expect(screen.getByRole('heading', { level: 2, name: 'Fax fax-0003' }).textContent).toBe('Fax fax-0003');
    expect(screen.getByText('Laid to rest', { selector: '.review-status' })).toBeInTheDocument();
  });

  it('keeps the flagged count and the flag notes on screen once laid to rest', async () => {
    const user = userEvent.setup();
    await openFax3(user);
    await verify(user);
    expect(document.querySelector('[data-count="flagged"]')).toHaveTextContent('2 flagged');
    expect(document.querySelector('[data-count="flagged"]')).toHaveClass('count-flag');
    const panel = document.querySelector<HTMLElement>('.laid-to-rest')!;
    expect(panel).toHaveTextContent('Provider number (NPI): Accepted although the check failed');
    expect(panel).toHaveTextContent('Callback phone: Accepted although the check failed');
    expect(panel).toHaveTextContent('2 were flagged');
  });

  it('has Download JSON as a real button in the amber style, and no axe violations', async () => {
    const user = userEvent.setup();
    const { container } = await openFax3(user);
    await verify(user);
    const download = screen.getByRole('button', { name: 'Download JSON' });
    expect(download).toHaveClass('button', 'button-download');
    expect(download).not.toHaveClass('button-primary');
    expect(download).toHaveAttribute('data-download', 'true');
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('opens an already verified fax in the quiet state', async () => {
    const user = userEvent.setup();
    await openFax3(user);
    await verify(user);
    await user.click(screen.getByRole('button', { name: 'Back to inbox' }));
    await screen.findByRole('heading', { level: 2, name: 'Inbox' });
    await user.click(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === 'fax-0003')!);
    await screen.findByRole('heading', { level: 2, name: 'Fax fax-0003' });
    expect(faxWindow()).toHaveAttribute('data-state', 'laid-to-rest');
    expect(titleKind()).toHaveTextContent('— laid to rest');
  });
});
