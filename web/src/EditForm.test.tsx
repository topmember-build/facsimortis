import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { MemoryStore } from './storage';
import { stubSite } from './test-site';

type UserApi = ReturnType<typeof userEvent.setup>;

async function openFax3(user: UserApi) {
  const view = render(<App storage={new MemoryStore()} />);
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
  await user.click(screen.getByRole('button', { name: 'Incoming fax' }));
  await user.click(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === 'fax-0003')!);
  await screen.findByRole('heading', { level: 2, name: 'Fax fax-0003' });
  return view;
}

const edit = (name: string) => document.querySelector<HTMLElement>(`[data-edit="${name}"]`)!;

const HINTS: Record<string, string> = {
  npi: '10 digits, for example 1234567893',
  dob: 'MM/DD/YYYY, for example 03/15/1980',
  callbackPhone: 'For example 555-0147, 555-014-7000 or (555) 014-7000',
  urgency: 'routine, urgent or emergent',
};

const LABELS: Record<string, string> = {
  npi: 'Provider number (NPI)',
  dob: 'Date of birth',
  callbackPhone: 'Callback phone',
  urgency: 'Urgency',
};

describe('edit form: label, hint and primary button', () => {
  it('puts a real label above the input, tied to it, with the plain field name', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax3(user);
    await user.click(edit('callbackPhone'));

    const input = screen.getByLabelText('New value for Callback phone');
    const label = document.querySelector<HTMLLabelElement>('label.edit-label')!;
    expect(label.tagName).toBe('LABEL');
    expect(label.htmlFor).toBe(input.id);
    expect(label.textContent).toBe('New value for Callback phone');
    // Label comes before the input in the same form (block layout is in the stylesheet).
    expect(label.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(label.closest('form')).toBe(input.closest('form'));
  });

  it.each(Object.keys(HINTS))('shows the %s hint and ties it to the input', async (name) => {
    stubSite();
    const user = userEvent.setup();
    await openFax3(user);
    await user.click(edit(name));

    const input = screen.getByLabelText(`New value for ${LABELS[name]}`);
    const hint = screen.getByText(HINTS[name]!);
    expect(hint.id).not.toBe('');
    expect(input.getAttribute('aria-describedby')!.split(' ')).toContain(hint.id);
    expect(input).toHaveAccessibleDescription(HINTS[name]!);
  });

  it('shows no format hint for the patient name', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax3(user);
    await user.click(edit('patientName'));

    const input = screen.getByLabelText('New value for Patient name');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(document.querySelector('.format-hint')).toBeNull();
  });

  it('keeps the empty-value note tied to the input as well as the hint', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax3(user);
    await user.click(edit('npi'));
    const input = screen.getByLabelText('New value for Provider number (NPI)');
    await user.clear(input);
    expect(input).toHaveAccessibleDescription(`${HINTS['npi']} Type a value to save it. To keep the field empty, use Accept.`);
  });

  it('gives only Verify record the primary class', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax3(user);
    await user.click(edit('npi'));

    const primary = Array.from(document.querySelectorAll('button')).filter((b) => b.classList.contains('button-primary'));
    expect(primary).toEqual([screen.getByRole('button', { name: 'Verify record' })]);
    for (const name of ['Save', 'Cancel', 'Back to inbox', 'Show full page', 'Model answers']) {
      expect(screen.getByRole('button', { name })).not.toHaveClass('button-primary');
    }
    expect(document.querySelector('[data-accept]')).not.toHaveClass('button-primary');
    expect(edit('npi')).not.toHaveClass('button-primary');
  });

  it('marks the live announcement region as screen-reader-only and leaves the status line visible', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax3(user);
    await user.click(document.querySelector<HTMLElement>('[data-accept="npi"]')!);

    const live = document.querySelector('[aria-live="polite"].sr-only')!;
    expect(live).toHaveTextContent('Provider number (NPI) accepted although the check failed.');
    expect(document.querySelector('.selection-line')).not.toHaveClass('sr-only');
    expect(document.querySelector('#verify-reason')).not.toHaveClass('sr-only');
    // The field name after Accept/Edit is read aloud only.
    expect(edit('npi').querySelector('.sr-only')).toHaveTextContent('Provider number (NPI)');
  });

  it('has no axe violations with Edit open (with a hint) and in the summary bar', async () => {
    stubSite();
    const user = userEvent.setup();
    const { container } = await openFax3(user);
    await user.click(edit('callbackPhone'));
    expect((await axe.run(container)).violations).toEqual([]);
    expect((await axe.run(screen.getByRole('region', { name: 'Review summary' }))).violations).toEqual([]);
  });
});
