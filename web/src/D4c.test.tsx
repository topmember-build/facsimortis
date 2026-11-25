import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { SampleFaxSchema } from '../../src/samples/schema.js';
import { App } from './App';
import { ghostRects } from './ghost';
import { isOriginallyFlagged } from './review-state';
import { MemoryStore } from './storage';
import { committedFaxes, stubSite } from './test-site';

// D4c: flag and ghost highlight classes, and the compact review header.
type UserApi = ReturnType<typeof userEvent.setup>;

async function openFax(user: UserApi, id: string) {
  const view = render(<App storage={new MemoryStore()} />);
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
  if (id === 'fax-0003') await user.click(screen.getByRole('button', { name: 'Incoming fax' }));
  await user.click(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === id)!);
  await screen.findByRole('heading', { level: 2, name: `Fax ${id}` });
  return view;
}

const group = (name: string) => document.querySelector<SVGGElement>(`g[data-field="${name}"]`);
const fieldButton = (name: string) => document.querySelector<HTMLElement>(`button[data-field="${name}"]`)!;
const noViolations = async (el: HTMLElement) => expect((await axe.run(el)).violations).toEqual([]);

describe('D4c highlight classes (fax-0003, model answers)', () => {
  it('marks words of flagged fields as flag and all other words as ghost, with rects on the word boxes', async () => {
    stubSite();
    await openFax(userEvent.setup(), 'fax-0003');
    const fax = SampleFaxSchema.parse(committedFaxes['fax-0003.json']);
    const result = fax.readers.model;
    if (result.status !== 'ok') throw new Error('no answer');

    expect(group('callbackPhone')).toHaveClass('ghost', 'ghost-flag');
    expect(group('npi')).toHaveClass('ghost', 'ghost-flag');
    expect(group('patientName')).toHaveClass('ghost');
    expect(group('patientName')).not.toHaveClass('ghost-flag');

    let drawn = 0;
    for (const field of result.fields) {
      const rects = ghostRects(field, fax.ocr.words);
      if (rects.length === 0) continue;
      const g = group(field.name)!;
      expect(g.classList.contains('ghost-flag'), field.name).toBe(isOriginallyFlagged(field));
      expect(Array.from(g.querySelectorAll('rect')).map((r) => r.dataset['wordId'])).toEqual(rects.map((r) => r.id));
      for (const r of rects) {
        const el = g.querySelector(`rect[data-word-id="${r.id}"]`)!;
        expect([el.getAttribute('x'), el.getAttribute('y'), el.getAttribute('width'), el.getAttribute('height')]).toEqual(
          [r.x, r.y, r.width, r.height].map(String),
        );
        drawn += 1;
      }
    }
    expect(drawn).toBeGreaterThan(0);
  });

  it('keeps the flag class on a flagged field after it is accepted, and on its selected group', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    await user.click(document.querySelector<HTMLElement>('[data-accept="callbackPhone"]')!);
    expect(group('callbackPhone')).toHaveClass('ghost-flag', 'ghost-selected');
  });
});

describe('D4c review header', () => {
  it('puts Back, the heading, the reader line and the toggle in one row in that order', async () => {
    stubSite();
    await openFax(userEvent.setup(), 'fax-0003');
    const row = document.querySelector('.fax-header')!;
    const parts = Array.from(row.children).map((c) => c.querySelector('h2')?.textContent ?? c.textContent);
    expect(parts[0]).toBe('Back to inbox');
    expect(parts[1]).toBe('Fax fax-0003');
    expect(row.children[2]).toHaveClass('reader-name');
    expect(row.children[3]).toHaveAttribute('aria-label', 'Which reader to show');
    expect(row.children).toHaveLength(4);
  });

  it('marks the page header for the review screen only and keeps the h1, the tagline and the banner first', async () => {
    stubSite();
    const user = userEvent.setup();
    const { container } = render(<App storage={new MemoryStore()} />);
    await screen.findByRole('heading', { level: 2, name: 'Inbox' });
    const header = () => document.querySelector('header.page-header')!;
    expect(header()).not.toHaveClass('page-header-review');
    expect(screen.getByRole('heading', { level: 1, name: 'Facsimortis' })).toBeInTheDocument();
    expect(screen.getByText(/built on synthetic data only/)).toBeInTheDocument();

    await user.click(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === 'fax-0001')!);
    await screen.findByRole('heading', { level: 2, name: 'Fax fax-0001' });
    expect(header()).toHaveClass('page-header', 'page-header-review');
    expect(screen.getByRole('heading', { level: 1, name: 'Facsimortis' })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute('aria-label', 'Synthetic data notice');

    await user.click(screen.getByRole('button', { name: 'Back to inbox' }));
    await screen.findByRole('heading', { level: 2, name: 'Inbox' });
    expect(header()).not.toHaveClass('page-header-review');
  });
});

describe('D4c axe', () => {
  it('is clean on the inbox, both readers, Edit open and laid to rest', async () => {
    stubSite();
    const user = userEvent.setup();
    const { container } = await openFax(user, 'fax-0003');
    await noViolations(container);
    await user.click(fieldButton('npi'));
    await noViolations(container);
    await user.click(screen.getByRole('button', { name: 'Rules reader' }));
    await noViolations(container);
    await user.click(screen.getByRole('button', { name: 'Model answers' }));
    await user.click(document.querySelector<HTMLElement>('[data-edit="callbackPhone"]')!);
    await noViolations(container);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(document.querySelector<HTMLElement>('[data-accept="callbackPhone"]')!);
    await user.click(document.querySelector<HTMLElement>('[data-accept="npi"]')!);
    await user.click(screen.getByRole('button', { name: 'Verify record' }));
    expect(screen.getByRole('heading', { level: 3, name: 'Laid to rest' })).toBeInTheDocument();
    await noViolations(container);
    await user.click(screen.getByRole('button', { name: 'Back to inbox' }));
    await screen.findByRole('heading', { level: 2, name: 'Inbox' });
    await noViolations(container);
  });
});
