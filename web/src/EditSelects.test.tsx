import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { SampleFaxSchema } from '../../src/samples/schema.js';
import { App } from './App';
import { ghostRects } from './ghost';
import { MemoryStore } from './storage';
import { committedFaxes, stubSite } from './test-site';

type UserApi = ReturnType<typeof userEvent.setup>;

async function openFax(user: UserApi, id: string) {
  const view = render(<App storage={new MemoryStore()} />);
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
  if (id === 'fax-0003') await user.click(screen.getByRole('button', { name: 'Incoming fax' }));
  await user.click(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === id)!);
  await screen.findByRole('heading', { level: 2, name: `Fax ${id}` });
  return view;
}

const edit = (name: string) => document.querySelector<HTMLElement>(`[data-edit="${name}"]`)!;
const fieldButton = (name: string) => document.querySelector<HTMLElement>(`button[data-field="${name}"]`)!;
const ghost = (name: string) => document.querySelector<SVGGElement>(`g[data-field="${name}"]`);
const card = (name: string) => fieldButton(name).closest('li')!;
const input = (label: string) => screen.getByLabelText(`New value for ${label}`);

function citedRects(faxId: string, reader: 'model' | 'rules', name: string) {
  const fax = SampleFaxSchema.parse(committedFaxes[`${faxId}.json`]);
  const result = fax.readers[reader];
  if (result.status !== 'ok') throw new Error('no answer');
  return ghostRects(result.fields.find((f) => f.name === name), fax.ocr.words);
}

function rectIds(name: string) {
  return Array.from(ghost(name)?.querySelectorAll('rect') ?? []).map((r) => r.dataset['wordId']);
}

function stubMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('opening Edit selects the field', () => {
  it('selects the field, highlights its cited words, pulses, updates the status and keeps focus in the input', async () => {
    stubMotion(false);
    stubSite();
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    expect(document.querySelector('.ghost-selected')).toBeNull();

    await user.click(edit('callbackPhone'));

    expect(card('callbackPhone')).toHaveClass('field-selected');
    expect(fieldButton('callbackPhone')).toHaveAttribute('aria-pressed', 'true');
    const group = ghost('callbackPhone')!;
    expect(group).toHaveAttribute('data-selected', 'true');
    expect(group).toHaveClass('ghost-selected', 'ghost-pulse');
    const expected = citedRects('fax-0003', 'model', 'callbackPhone');
    expect(expected.length).toBeGreaterThan(0);
    expect(rectIds('callbackPhone')).toEqual(expected.map((r) => r.id));
    for (const rect of expected) {
      const el = group.querySelector(`rect[data-word-id="${rect.id}"]`)!;
      expect([el.getAttribute('x'), el.getAttribute('y'), el.getAttribute('width'), el.getAttribute('height')]).toEqual(
        [rect.x, rect.y, rect.width, rect.height].map(String),
      );
    }
    expect(screen.getByRole('status')).toHaveTextContent('Showing source for Callback phone: 555~0151');
    expect(input('Callback phone')).toHaveFocus();
  });

  it('uses the static outline under reduced motion', async () => {
    stubMotion(true);
    stubSite();
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    await user.click(edit('callbackPhone'));
    expect(ghost('callbackPhone')).toHaveClass('ghost-selected', 'ghost-static');
    expect(ghost('callbackPhone')).not.toHaveClass('ghost-pulse');
    expect(input('Callback phone')).toHaveFocus();
  });

  it('works from the keyboard with Enter and Space', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    edit('npi').focus();
    await user.keyboard('{Enter}');
    expect(ghost('npi')).toHaveAttribute('data-selected', 'true');
    expect(input('Provider number (NPI)')).toHaveFocus();
    await user.keyboard('{Escape}');

    edit('dob').focus();
    await user.keyboard(' ');
    expect(ghost('dob')).toHaveAttribute('data-selected', 'true');
    expect(card('dob')).toHaveClass('field-selected');
    expect(input('Date of birth')).toHaveFocus();
  });

  it('selects a field with no cited words and shows no highlight', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax(user, 'fax-0002');
    await user.click(screen.getByRole('button', { name: 'Rules reader' }));
    expect(citedRects('fax-0002', 'rules', 'npi')).toEqual([]);

    await user.click(edit('npi'));
    expect(card('npi')).toHaveClass('field-selected');
    expect(ghost('npi')).toBeNull();
    expect(document.querySelector('.ghost-selected')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Showing source for Provider number (NPI): not found on the page, so there is nothing to highlight.',
    );
    expect(input('Provider number (NPI)')).toHaveFocus();
  });

  it('keeps an already selected field selected, without a new pulse element', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    await user.click(fieldButton('callbackPhone'));
    const before = ghost('callbackPhone')!;
    await user.click(edit('callbackPhone'));
    expect(ghost('callbackPhone')).toBe(before);
    expect(ghost('callbackPhone')).toHaveAttribute('data-selected', 'true');
    expect(card('callbackPhone')).toHaveClass('field-selected');
    expect(input('Callback phone')).toHaveFocus();
  });

  it('opening Edit on another field closes the open form and selects the new field', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    await user.click(edit('callbackPhone'));
    await user.type(input('Callback phone'), '9');
    await user.click(edit('npi'));

    expect(screen.queryByLabelText('New value for Callback phone')).toBeNull();
    expect(document.querySelectorAll('form.edit-form')).toHaveLength(1);
    expect(card('npi')).toHaveClass('field-selected');
    expect(card('callbackPhone')).not.toHaveClass('field-selected');
    expect(ghost('npi')).toHaveAttribute('data-selected', 'true');
    expect(ghost('callbackPhone')).toHaveAttribute('data-selected', 'false');
    expect(input('Provider number (NPI)')).toHaveFocus();
    // The abandoned text was not saved.
    expect(document.querySelector('[data-provenance]')!.textContent).not.toMatch(/Entered by you/);
  });

  it('keeps the selection after Cancel and after Save', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    await user.click(edit('callbackPhone'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(card('callbackPhone')).toHaveClass('field-selected');
    expect(ghost('callbackPhone')).toHaveAttribute('data-selected', 'true');
    expect(edit('callbackPhone')).toHaveFocus();

    await user.click(edit('callbackPhone'));
    const field = input('Callback phone');
    await user.clear(field);
    await user.type(field, '555-0151');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(card('callbackPhone')).toHaveClass('field-selected');
    expect(ghost('callbackPhone')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Showing source for Callback phone');
    expect(edit('callbackPhone')).toHaveFocus();
  });

  it('has no axe violations with Edit open on a selected field', async () => {
    stubSite();
    const user = userEvent.setup();
    const { container } = await openFax(user, 'fax-0003');
    await user.click(edit('callbackPhone'));
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
