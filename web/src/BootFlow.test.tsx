import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { BOOTED_KEY, type SessionStore } from './boot';
import { MemoryStore, STALE_NOTE } from './storage';
import { committedIndex, json, stubSite } from './test-site';

// R3: the boot screen inside the app. Each test passes its own session store, so nothing leaks.
const realSetTimeout = globalThis.setTimeout;

class MapSession implements SessionStore {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

/** Storage that is there but refuses every call, as when the browser blocks it. */
const blocked: SessionStore = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

const bootScreen = () => document.querySelector<HTMLElement>('.boot-screen');
const inboxHeading = () => screen.findByRole('heading', { level: 2, name: 'Inbox' });
const receive = () => screen.getByRole('button', { name: 'Receive faxes' });
const firstIcon = () => document.querySelector<HTMLElement>('[data-fax-id="fax-0001"]');
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const neverLoads = () => stubSite({ 'index.json': () => new Promise<Response>(() => {}) });

describe('boot screen in the app', () => {
  it('is off by default, so <App /> opens on the inbox', async () => {
    stubSite();
    render(<App storage={new MemoryStore()} />);
    expect(bootScreen()).toBeNull();
    await inboxHeading();
    expect(bootScreen()).toBeNull();
  });

  it('comes first, under the notice, then any key opens the inbox with the first fax icon focused', async () => {
    const session = new MapSession();
    stubSite();
    const user = userEvent.setup();
    const { container } = render(<App boot session={session} storage={new MemoryStore()} />);
    expect(bootScreen()).not.toBeNull();
    expect(container.firstElementChild).toHaveAttribute('aria-label', 'Synthetic data notice');
    expect(screen.queryByRole('heading', { level: 2, name: 'Inbox' })).not.toBeInTheDocument();
    expect(receive()).toHaveFocus();
    expect(session.getItem(BOOTED_KEY)).toBeNull();

    await user.keyboard('x');
    await inboxHeading();
    expect(bootScreen()).toBeNull();
    await waitFor(() => expect(firstIcon()).toHaveFocus());
    expect(session.getItem(BOOTED_KEY)).toBe('1');
  });

  it('shows once per session: the Receive faxes button opens the inbox, and the next load skips the screen', async () => {
    const session = new MapSession();
    stubSite();
    const user = userEvent.setup();
    const first = render(<App boot session={session} storage={new MemoryStore()} />);
    await user.click(receive());
    await inboxHeading();
    first.unmount();

    stubSite();
    render(<App boot session={session} storage={new MemoryStore()} />);
    expect(bootScreen()).toBeNull();
    await inboxHeading();
  });

  it('is skipped with ?skipboot, and nothing is stored', async () => {
    window.history.replaceState(null, '', '/?skipboot');
    const session = new MapSession();
    stubSite();
    render(<App boot session={session} storage={new MemoryStore()} />);
    expect(bootScreen()).toBeNull();
    await inboxHeading();
    expect(session.data.size).toBe(0);
  });

  it.each([
    ['no storage', null],
    ['storage that throws', blocked],
  ])('works with %s, and shows again on the next load', async (_name, session) => {
    stubSite();
    const user = userEvent.setup();
    const first = render(<App boot session={session} storage={new MemoryStore()} />);
    expect(bootScreen()).not.toBeNull();
    await user.click(receive());
    await inboxHeading();
    first.unmount();

    stubSite();
    render(<App boot session={session} storage={new MemoryStore()} />);
    expect(bootScreen()).not.toBeNull();
  });

  it('continues by itself after 5 seconds, even while the data is still loading', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    neverLoads();
    render(<App boot session={new MapSession()} storage={new MemoryStore()} />);
    advance(4999);
    expect(bootScreen()).not.toBeNull();
    advance(1);
    expect(bootScreen()).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Loading the sample faxes');
  });

  it('says "Receiving fax…" when the data is still loading after 150ms', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    neverLoads();
    render(<App boot session={new MapSession()} storage={new MemoryStore()} />);
    advance(149);
    expect(screen.getByRole('status').textContent).toBe('');
    advance(1);
    expect(screen.getByRole('status')).toHaveTextContent('Receiving fax…');
  });

  it('never says "Receiving fax…" when the data is in within 150ms', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let release: () => void = () => {};
    stubSite({
      'index.json': () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(json(committedIndex));
        }),
    });
    render(<App boot session={new MapSession()} storage={new MemoryStore()} />);
    advance(100);
    release();
    // Let the data load in real time while the fake clock stays at 100ms.
    for (let i = 0; i < 400 && bootScreen()?.dataset['loading'] !== 'false'; i += 1) {
      await act(() => new Promise<void>((resolve) => realSetTimeout(resolve, 5)));
    }
    expect(bootScreen()).toHaveAttribute('data-loading', 'false');
    advance(1000);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('keeps stale saved progress until the boot screen is gone and the note is on screen', async () => {
    const STALE = 'facsimortis:v1:fax-0001:model';
    const store = new MemoryStore();
    store.setItem(STALE, JSON.stringify({ version: 1 }));
    stubSite();
    const user = userEvent.setup();
    render(<App boot session={new MapSession()} storage={store} />);
    await waitFor(() => expect(bootScreen()).toHaveAttribute('data-loading', 'false'));
    expect(store.data.has(STALE)).toBe(true);

    await user.click(receive());
    await inboxHeading();
    expect(screen.getAllByText(STALE_NOTE)).toHaveLength(1);
    await waitFor(() => expect(store.data.has(STALE)).toBe(false));
  });

  it('is axe clean on the boot screen', async () => {
    stubSite();
    const { container } = render(<App boot session={new MapSession()} storage={new MemoryStore()} />);
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
