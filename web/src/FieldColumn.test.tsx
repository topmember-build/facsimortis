import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { stubSite } from './test-site';

// D4: the field column has a "Needs your eyes" section and a "Read cleanly" section.
// **Validates: Requirements 5, 6, 10** (see the design brief, "Field column").

type UserApi = ReturnType<typeof userEvent.setup>;

async function openFax(user: UserApi, id: string, reader: 'model' | 'rules' = 'model') {
  const view = render(<App />);
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
  if (id === 'fax-0003') await user.click(screen.getByRole('button', { name: 'Incoming fax' }));
  await user.click(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === id)!);
  await screen.findByRole('heading', { level: 2, name: `Fax ${id}` });
  if (reader === 'rules') await user.click(screen.getByRole('button', { name: 'Rules reader' }));
  return view;
}

const section = (key: 'needs-your-eyes' | 'read-cleanly') =>
  document.querySelector<HTMLElement>(`[data-section="${key}"]`)!;
const fieldsIn = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLElement>('button[data-field]')).map((b) => b.dataset['field']);
const fieldButton = (name: string) => document.querySelector<HTMLElement>(`button[data-field="${name}"]`)!;
const card = (name: string) => fieldButton(name).closest('li')!;
const accept = (name: string) => document.querySelector<HTMLElement>(`[data-accept="${name}"]`);
const edit = (name: string) => document.querySelector<HTMLElement>(`[data-edit="${name}"]`)!;

async function tabSequence(user: UserApi): Promise<string[]> {
  const seen: string[] = [];
  const first = document.querySelector<HTMLElement>('button[data-field]')!;
  first.focus();
  for (let i = 0; i < 20; i += 1) {
    const el = document.activeElement as HTMLElement;
    seen.push(el.dataset['field'] ?? el.dataset['accept'] ?? el.dataset['edit'] ?? el.dataset['verify'] ?? el.textContent ?? '');
    if (el.dataset['verify']) break;
    await user.tab();
  }
  return seen;
}

describe('field column sections', () => {
  it('has two level-3 headings and a labelled list for each filled section', async () => {
    stubSite();
    await openFax(userEvent.setup(), 'fax-0003');
    const needs = screen.getByRole('heading', { level: 3, name: 'Needs your eyes' });
    const clean = screen.getByRole('heading', { level: 3, name: 'Read cleanly' });
    expect(within(section('needs-your-eyes')).getByRole('list', { name: 'Needs your eyes' })).toBeInTheDocument();
    expect(within(section('read-cleanly')).getByRole('list', { name: 'Read cleanly' })).toBeInTheDocument();
    expect(needs.compareDocumentPosition(clean) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('puts the flagged fields of fax-0003 (model) under Needs your eyes, the rest under Read cleanly', async () => {
    stubSite();
    await openFax(userEvent.setup(), 'fax-0003');
    expect(fieldsIn(section('needs-your-eyes'))).toEqual(['callbackPhone', 'npi']);
    expect(fieldsIn(section('read-cleanly'))).toEqual(['referringProvider', 'patientName', 'reason', 'urgency', 'dob']);
  });

  it('puts the three flagged fields of fax-0002 (rules) under Needs your eyes', async () => {
    stubSite();
    await openFax(userEvent.setup(), 'fax-0002', 'rules');
    expect(fieldsIn(section('needs-your-eyes'))).toHaveLength(3);
    expect(fieldsIn(section('read-cleanly'))).toHaveLength(4);
  });

  it('shows a plain line when nothing is flagged (fax-0001, model) and lists every field as read cleanly', async () => {
    stubSite();
    await openFax(userEvent.setup(), 'fax-0001');
    expect(screen.getByRole('heading', { level: 3, name: 'Needs your eyes' })).toBeInTheDocument();
    expect(within(section('needs-your-eyes')).getByText('No fields are flagged.')).toBeInTheDocument();
    expect(section('needs-your-eyes').querySelector('ul')).toBeNull();
    expect(fieldsIn(section('read-cleanly'))).toHaveLength(7);
  });

  it('says the clean fields were not checked by a person, and never that they were verified', async () => {
    stubSite();
    await openFax(userEvent.setup(), 'fax-0003');
    const note = within(section('read-cleanly')).getByText('Read by the reader. Not checked by a person.');
    expect(note).toBeInTheDocument();
    expect(section('read-cleanly').textContent).not.toMatch(/verified|correct/i);
  });

  it('keeps one #verify-note and Verify record with the same description', async () => {
    stubSite();
    await openFax(userEvent.setup(), 'fax-0003');
    expect(document.querySelectorAll('#verify-note')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Verify record' })).toHaveAttribute('aria-describedby', 'verify-reason verify-note');
  });

  it('does not move a card between sections while it is reviewed', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    await user.click(accept('npi')!);
    expect(fieldsIn(section('needs-your-eyes'))).toEqual(['callbackPhone', 'npi']);
  });
});

describe('selected flagged card', () => {
  it('is expanded with both buttons, Edit filled and not the primary button', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    await user.click(fieldButton('npi'));
    const npi = card('npi');
    expect(npi).toHaveClass('field-selected', 'field-expanded');
    expect(card('callbackPhone')).not.toHaveClass('field-expanded');
    expect(npi.querySelector('.field-value')).toHaveTextContent('6720988041');
    expect(npi.querySelector('.field-flag')).toBeInTheDocument();
    expect(npi.querySelector('.confidence')).toHaveTextContent('Confidence: 94%');
    expect(npi.querySelector('.field-flag')!.closest('.confidence')).toBeNull();
    const acceptBtn = accept('npi')!;
    expect(acceptBtn).toHaveTextContent('Accept anyway');
    expect(npi.contains(acceptBtn)).toBe(true);
    expect(edit('npi')).toHaveClass('button-fill');
    expect(edit('npi')).not.toHaveClass('button-primary');
    expect(acceptBtn).not.toHaveClass('button-fill');
    expect(document.querySelectorAll('.button-primary')).toHaveLength(1);
  });

  it('shows the selected outline cue on a card in either section', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    await user.click(fieldButton('patientName'));
    const clean = card('patientName');
    expect(clean).toHaveClass('field-selected');
    expect(clean).not.toHaveClass('field-expanded');
    expect(clean.querySelector('.selected-tag')).toHaveTextContent('Selected');
    await user.click(fieldButton('callbackPhone'));
    expect(card('callbackPhone').querySelector('.selected-tag')).toHaveTextContent('Selected');
    expect(document.querySelectorAll('.selected-tag')).toHaveLength(1);
  });

  it('keeps Accept and Edit rendered on unselected flagged cards and the tab order unchanged', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');
    for (const name of ['callbackPhone', 'npi']) {
      expect(accept(name)).toBeInTheDocument();
      expect(edit(name)).toBeInTheDocument();
    }
    await user.click(fieldButton('callbackPhone'));
    const before = await tabSequence(user);
    await user.click(fieldButton('npi'));
    const after = await tabSequence(user);
    expect(after).toEqual(before);
    expect(before.slice(0, 7)).toEqual(['callbackPhone', 'callbackPhone', 'callbackPhone', 'npi', 'npi', 'npi', 'referringProvider']);
  });

  it('gives every field a button of at least 44px height via the field-card button rule (see the css test)', async () => {
    stubSite();
    await openFax(userEvent.setup(), 'fax-0003');
    expect(document.querySelectorAll('.field-card .field-actions .button').length).toBe(7 + 2);
  });
});

describe('field column accessibility', () => {
  it('has no axe violations before review, with Edit open, after review and laid to rest', async () => {
    stubSite();
    const user = userEvent.setup();
    const { container } = await openFax(user, 'fax-0003');
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(fieldButton('npi'));
    await user.click(edit('callbackPhone'));
    expect((await axe.run(container)).violations).toEqual([]);
    await user.clear(screen.getByLabelText('New value for Callback phone'));
    await user.type(screen.getByLabelText('New value for Callback phone'), '555-0151{Enter}');
    await user.click(accept('npi')!);
    expect((await axe.run(container)).violations).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Verify record' }));
    await screen.findByRole('button', { name: 'Download JSON' });
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it('has no axe violations on the empty Needs your eyes section', async () => {
    stubSite();
    const { container } = await openFax(userEvent.setup(), 'fax-0001');
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
