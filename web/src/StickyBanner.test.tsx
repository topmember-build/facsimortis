import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { MemoryStore } from './storage';
import { stubSite } from './test-site';

// B1: the Synthetic data banner is sticky on the review screen only, and hands its height to the stylesheet as
// --banner-h on <html>. jsdom has no layout, so the height is 0px here; the real sizes are checked in Chrome.

const banner = () => screen.getByRole('region', { name: 'Synthetic data notice' });
const bannerHeight = () => document.documentElement.style.getPropertyValue('--banner-h');

async function openFax(user: ReturnType<typeof userEvent.setup>, id: string) {
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
  await user.click(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === id)!);
  await screen.findByRole('heading', { level: 2, name: `Fax ${id}` });
}

describe('sticky Synthetic data banner', () => {
  it('is not sticky on the inbox and sets no height there', async () => {
    stubSite();
    render(<App storage={new MemoryStore()} />);
    await screen.findByRole('heading', { level: 2, name: 'Inbox' });
    expect(banner()).not.toHaveClass('synthetic-banner-sticky');
    expect(bannerHeight()).toBe('');
  });

  it('is sticky on the review screen with its height in --banner-h, and goes back to normal on the inbox', async () => {
    stubSite();
    const user = userEvent.setup();
    const { container } = render(<App storage={new MemoryStore()} />);
    await openFax(user, 'fax-0002');
    expect(banner()).toHaveClass('synthetic-banner', 'synthetic-banner-sticky');
    expect(bannerHeight()).toBe('0px');
    // Still one notice, first in the page, with its words.
    expect(screen.getAllByRole('region', { name: 'Synthetic data notice' })).toHaveLength(1);
    expect(container.firstElementChild).toBe(banner());
    await user.click(screen.getByRole('button', { name: 'Back to inbox' }));
    await screen.findByRole('heading', { level: 2, name: 'Inbox' });
    expect(banner()).not.toHaveClass('synthetic-banner-sticky');
    expect(bannerHeight()).toBe('');
  });

  it('leaves the review screen with no axe violations', async () => {
    stubSite();
    const user = userEvent.setup();
    const { container } = render(<App storage={new MemoryStore()} />);
    await openFax(user, 'fax-0002');
    const results = await axe.run(container);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
