import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SampleFaxSchema } from '../../src/samples/schema.js';
import { App } from './App';
import { committedFaxes, stubSite } from './test-site';

/*
 * R6.1 in the fax screen: selecting a field scrolls its first cited ghost into view, but only when it is not fully
 * visible. jsdom has no layout and no scrollIntoView, so these tests stub both: ghost rectangles report a position
 * chosen by the test, and scrollIntoView is a spy. Real positions and the real scroll are checked in a browser.
 */

type UserApi = ReturnType<typeof userEvent.setup>;

const WINDOW_HEIGHT = 844;
const BAR_BOTTOM = 229;

function rectOf(x: number, y: number, width: number, height: number) {
  return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON: () => ({}) } as DOMRect;
}

let ghostTop = 0;
let scrollIntoView: ReturnType<typeof vi.fn>;
const original = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');

function stubLayout() {
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('innerHeight', WINDOW_HEIGHT);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.matches('rect[data-word-id]')) return rectOf(40, ghostTop, 80, 12);
    if (this.matches('.summary-bar')) return rectOf(0, 0, 390, BAR_BOTTOM);
    return rectOf(0, 0, 0, 0);
  });
}

function stubMedia(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduce : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

async function openFax(user: UserApi, id: string) {
  render(<App now={() => new Date(Date.UTC(2026, 9, 1, 9, 30))} />);
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
  if (id === 'fax-0003') await user.click(screen.getByRole('button', { name: 'Incoming fax' }));
  await user.click(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === id)!);
  await screen.findByRole('heading', { level: 2, name: `Fax ${id}` });
}

const fieldButton = (name: string) => document.querySelector<HTMLElement>(`button[data-field="${name}"]`)!;

function firstWordId(faxFile: string, field: string): string {
  const fax = SampleFaxSchema.parse(committedFaxes[faxFile]);
  const model = fax.readers.model;
  if (model.status !== 'ok') throw new Error('no saved answer');
  return model.fields.find((f) => f.name === field)!.wordIds[0]!;
}

beforeEach(() => {
  stubSite();
  stubMedia(false);
  stubLayout();
  scrollIntoView = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true, writable: true });
  ghostTop = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (original) Object.defineProperty(Element.prototype, 'scrollIntoView', original);
  else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe('selecting a field scrolls its first ghost into view (R6.1)', () => {
  it('scrolls the first cited ghost, nearest edge and smooth, when it is off screen', async () => {
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    ghostTop = -400;
    expect(scrollIntoView).not.toHaveBeenCalled();
    await user.click(fieldButton('referringProvider'));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    const scrolled = scrollIntoView.mock.contexts[0] as Element;
    expect(scrolled.getAttribute('data-word-id')).toBe(firstWordId('fax-0003.json', 'referringProvider'));
    expect(scrolled.closest('.ghost')).toHaveAttribute('data-field', 'referringProvider');
  });

  it('scrolls when the ghost is below the window or hidden under the summary bar', async () => {
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    ghostTop = WINDOW_HEIGHT - 4;
    await user.click(fieldButton('callbackPhone'));
    ghostTop = BAR_BOTTOM - 6;
    await user.click(fieldButton('npi'));
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('does not scroll when the ghost is fully visible', async () => {
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    ghostTop = 400;
    await user.click(fieldButton('npi'));
    await user.click(fieldButton('dob'));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('scrolls instantly under prefers-reduced-motion, and the ghost still does not pulse', async () => {
    stubMedia(true);
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    ghostTop = 1200;
    await user.click(fieldButton('npi'));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    const ghost = document.querySelector('.ghost[data-field="npi"]')!;
    expect(ghost).toHaveClass('ghost-static');
    expect(ghost).not.toHaveClass('ghost-pulse');
  });

  it('follows the pulse rule: choosing the field again scrolls again, accepting it does not', async () => {
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    ghostTop = -400;
    await user.click(fieldButton('npi'));
    await user.click(fieldButton('npi'));
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    await user.click(document.querySelector<HTMLElement>('[data-accept="npi"]')!);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('does not scroll for a field with no cited words', async () => {
    const user = userEvent.setup();
    await openFax(user, 'fax-0002');
    await user.click(screen.getByRole('button', { name: 'Rules reader' }));
    ghostTop = -400;
    await user.click(fieldButton('npi'));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
