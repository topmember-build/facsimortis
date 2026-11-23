import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { MemoryStore } from './storage';
import { stubSite } from './test-site';

// R4b: the two section headings carry their own classes (for their colours) and nothing else about them
// changed: same words, same level, same place, same list names.
async function openFax3() {
  stubSite();
  const user = userEvent.setup();
  const view = render(<App storage={new MemoryStore()} />);
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
  await user.click(screen.getByRole('button', { name: 'Incoming fax' }));
  await user.click(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === 'fax-0003')!);
  await screen.findByRole('heading', { level: 2, name: 'Fax fax-0003' });
  return view;
}

describe('R4b field column headings', () => {
  it('keeps "Needs your eyes" and "Read cleanly" as level-3 headings that name their lists', async () => {
    await openFax3();
    const needs = screen.getByRole('heading', { level: 3, name: 'Needs your eyes' });
    const clean = screen.getByRole('heading', { level: 3, name: 'Read cleanly' });
    expect(needs).toHaveClass('field-section-title', 'field-section-title-flagged');
    expect(needs).not.toHaveClass('field-section-title-clean');
    expect(clean).toHaveClass('field-section-title', 'field-section-title-clean');
    expect(clean).not.toHaveClass('field-section-title-flagged');
    expect(screen.getByRole('list', { name: 'Needs your eyes' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Read cleanly' })).toBeInTheDocument();
    // The section order, and so the tab order, is unchanged: flagged first.
    expect(needs.compareDocumentPosition(clean) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the Accept anyway and Edit names, with the field name read aloud', async () => {
    await openFax3();
    expect(screen.getByRole('button', { name: 'Accept anyway Provider number (NPI)' })).toHaveClass('button-accept');
    expect(screen.getByRole('button', { name: 'Edit Provider number (NPI)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify record' })).toHaveClass('button-primary');
  });

  it('has no axe violations with a flagged card selected', async () => {
    const { container } = await openFax3();
    await userEvent.setup().click(document.querySelector<HTMLElement>('button[data-field="npi"]')!);
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
