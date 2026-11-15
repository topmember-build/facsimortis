import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { ReviewAction } from './review-state';
import { stubSite } from './test-site';

type UserApi = ReturnType<typeof userEvent.setup>;

function setup() {
  stubSite();
  const user = userEvent.setup();
  let tick = 0;
  const now = () => new Date(Date.UTC(2025, 0, 2, 3, 4, tick++));
  const recorded: { faxId: string; reader: string; action: ReviewAction }[] = [];
  const onVerify = vi.fn();
  const view = render(
    <App
      now={now}
      onReviewAction={(faxId, reader, action) => recorded.push({ faxId, reader, action })}
      onVerify={onVerify}
    />,
  );
  return { user, recorded, onVerify, view };
}

async function openFax(user: UserApi, id: string) {
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
  if (id === 'fax-0003') await user.click(screen.getByRole('button', { name: 'Incoming fax' }));
  await user.click(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === id)!);
  await screen.findByRole('heading', { level: 2, name: `Fax ${id}` });
}

const fieldOrder = () => Array.from(document.querySelectorAll<HTMLElement>('button[data-field]')).map((b) => b.dataset['field']);
const fieldButton = (name: string) => document.querySelector<HTMLElement>(`button[data-field="${name}"]`)!;
const accept = (name: string) => document.querySelector<HTMLElement>(`[data-accept="${name}"]`)!;
const edit = (name: string) => document.querySelector<HTMLElement>(`[data-edit="${name}"]`)!;
const verify = () => screen.getByRole('button', { name: 'Verify record' });
const ghost = (name: string) => document.querySelector<SVGGElement>(`g[data-field="${name}"]`);
const statusLine = () => document.querySelector('.fax-title-row .review-status')!.textContent;
const rowFor = (id: string) => within(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === id)!);

async function expectNoViolations(container: HTMLElement) {
  expect((await axe.run(container)).violations).toEqual([]);
}

const BOTH =
  '2 flagged fields still need review: Provider number (NPI), Callback phone.';

describe('review panel: fax-0003, model reader', () => {
  it('lists flagged fields first, lowest confidence first, and blocks Verify with a plain reason', async () => {
    const { user } = setup();
    await openFax(user, 'fax-0003');
    expect(fieldOrder()).toEqual(['callbackPhone', 'npi', 'referringProvider', 'patientName', 'reason', 'urgency', 'dob']);
    expect(verify()).toHaveAttribute('aria-disabled', 'true');
    expect(verify()).toHaveAccessibleDescription(BOTH);
    expect(statusLine()).toContain('Not yet reviewed');
    // Only flagged fields have review actions.
    expect(document.querySelectorAll('[data-accept]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-edit]')).toHaveLength(2);
    expect(within(fieldButton('patientName')).getByText('Confidence: 80%')).toBeInTheDocument();
  });

  it('does nothing when Verify is pressed while blocked', async () => {
    const { user, onVerify } = setup();
    await openFax(user, 'fax-0003');
    await user.click(verify());
    expect(onVerify).not.toHaveBeenCalled();
  });

  it('Accept clears the flag for review, keeps the value, records it and moves focus', async () => {
    const { user, recorded } = setup();
    await openFax(user, 'fax-0003');
    await user.click(accept('npi'));

    expect(verify()).toHaveAccessibleDescription('1 flagged field still needs review: Callback phone.');
    expect(statusLine()).toContain('Review in progress');
    expect(accept('callbackPhone')).toHaveFocus();
    expect(document.querySelector('[data-accept="npi"]')).toBeNull();
    // Order does not change during review, and the value is as read.
    expect(fieldOrder()[0]).toBe('callbackPhone');
    const npi = within(fieldButton('npi'));
    expect(npi.getByText('6720988041')).toBeInTheDocument();
    expect(npi.getByText('Was flagged: The provider number looks wrong: the last digit does not match.')).toBeInTheDocument();
    expect(ghost('npi')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByText('Provider number (NPI) accepted.')).toBeInTheDocument();
    expect(recorded).toEqual([
      {
        faxId: 'fax-0003',
        reader: 'model',
        action: { field: 'npi', action: 'accepted', originalValue: '6720988041', at: '2025-01-02T03:04:00.000Z' },
      },
    ]);

    await user.keyboard('{Enter}');
    expect(verify()).toHaveFocus();
    expect(verify()).toHaveAttribute('aria-disabled', 'false');
    expect(statusLine()).toContain('Ready to verify');
    await user.keyboard('{Enter}');
  });

  it('Edit keeps the original, shows both values, keeps the highlight and enables Verify', async () => {
    const { user, recorded, onVerify } = setup();
    await openFax(user, 'fax-0003');
    await user.click(edit('callbackPhone'));
    const input = screen.getByLabelText('Callback phone');
    expect(input).toHaveValue('555~0151');
    expect(input).toHaveFocus();
    expect(ghost('callbackPhone')).toHaveAttribute('data-selected', 'true');

    await user.clear(input);
    await user.type(input, '555-0151{Enter}');
    expect(screen.queryByLabelText('Callback phone')).not.toBeInTheDocument();
    const phone = within(fieldButton('callbackPhone'));
    expect(phone.getByText('555-0151')).toBeInTheDocument();
    expect(phone.getByText('Entered by the reviewer')).toBeInTheDocument();
    expect(phone.getByText('Read from the page: 555~0151')).toBeInTheDocument();
    expect(phone.getByText('Was flagged: The callback phone number is not in a usual format. Please check it.')).toBeInTheDocument();
    expect(ghost('callbackPhone')).toHaveAttribute('data-selected', 'true');
    expect(ghost('callbackPhone')!.querySelectorAll('rect').length).toBeGreaterThan(0);
    expect(screen.getByRole('status')).toHaveTextContent('the highlight is where the page value was read');
    expect(edit('callbackPhone')).toHaveFocus();
    expect(verify()).toHaveAccessibleDescription('1 flagged field still needs review: Provider number (NPI).');

    await user.click(accept('npi'));
    expect(verify()).toHaveFocus();
    await user.click(verify());
    expect(onVerify).toHaveBeenCalledWith('fax-0003', 'model');
    expect(recorded.map((r) => r.action)).toEqual([
      { field: 'callbackPhone', action: 'edited', originalValue: '555~0151', newValue: '555-0151', at: '2025-01-02T03:04:00.000Z' },
      { field: 'npi', action: 'accepted', originalValue: '6720988041', at: '2025-01-02T03:04:01.000Z' },
    ]);
  });

  it('Escape cancels an edit, changes nothing and returns focus to Edit', async () => {
    const { user, recorded } = setup();
    await openFax(user, 'fax-0003');
    await user.click(edit('npi'));
    await user.type(screen.getByLabelText('Provider number (NPI)'), '9');
    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('Provider number (NPI)')).not.toBeInTheDocument();
    expect(edit('npi')).toHaveFocus();
    expect(within(fieldButton('npi')).getByText('6720988041')).toBeInTheDocument();
    expect(verify()).toHaveAccessibleDescription(BOTH);
    expect(recorded).toEqual([]);

    await user.click(edit('npi'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(edit('npi')).toHaveFocus();
    expect(recorded).toEqual([]);
  });

  it('cannot save empty or blank text', async () => {
    const { user, recorded } = setup();
    await openFax(user, 'fax-0003');
    await user.click(edit('npi'));
    const input = screen.getByLabelText('Provider number (NPI)');
    await user.clear(input);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(input, '   {Enter}');
    expect(recorded).toEqual([]);
    expect(screen.getByLabelText('Provider number (NPI)')).toBeInTheDocument();
  });

  it('keeps review state per reader and the inbox label follows the reader', async () => {
    const { user } = setup();
    await openFax(user, 'fax-0003');
    await user.click(accept('npi'));
    await user.click(screen.getByRole('button', { name: 'Rules reader' }));
    expect(verify()).toHaveAccessibleDescription(BOTH);
    expect(statusLine()).toContain('Not yet reviewed');
    await user.click(screen.getByRole('button', { name: 'Back to inbox' }));
    expect(rowFor('fax-0003').getByText('Not yet reviewed')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === 'fax-0003')!);
    await user.click(screen.getByRole('button', { name: 'Model answers' }));
    expect(statusLine()).toContain('Review in progress');
    await user.click(screen.getByRole('button', { name: 'Back to inbox' }));
    expect(rowFor('fax-0003').getByText('Review in progress')).toBeInTheDocument();
  });

  it('has no accessibility violations before review, while editing and after review', async () => {
    const { user, view } = setup();
    await openFax(user, 'fax-0003');
    await expectNoViolations(view.container);
    await user.click(edit('callbackPhone'));
    await expectNoViolations(view.container);
    await user.keyboard('{Escape}');
    await user.click(accept('callbackPhone'));
    await user.click(accept('npi'));
    await expectNoViolations(view.container);
  });
});

describe('review panel: other faxes', () => {
  it('shows Not read for empty fields in the rules reader and records Accept on an empty field', async () => {
    const { user, recorded } = setup();
    await openFax(user, 'fax-0002');
    await user.click(screen.getByRole('button', { name: 'Rules reader' }));
    expect(fieldOrder()).toEqual(['npi', 'reason', 'referringProvider', 'patientName', 'callbackPhone', 'dob', 'urgency']);
    const npi = within(fieldButton('npi'));
    expect(npi.getByText('Not read')).toBeInTheDocument();
    expect(fieldButton('npi').textContent).not.toMatch(/%|Confidence/);
    expect(fieldButton('npi').querySelector('.confidence-bar')).toBeNull();
    expect(within(fieldButton('referringProvider')).getByText(/Confidence: 94%/)).toBeInTheDocument();

    await user.click(accept('reason'));
    expect(recorded.map((r) => r.action)).toEqual([
      { field: 'reason', action: 'accepted', originalValue: null, at: expect.any(String) },
    ]);
    expect(within(fieldButton('reason')).getByText(/Accepted as empty/)).toBeInTheDocument();
    expect(verify()).toHaveAccessibleDescription(
      '2 flagged fields still need review: Referring provider, Provider number (NPI).',
    );
    // Editing an empty field starts from an empty box and keeps "Not read" as the page value.
    await user.click(edit('npi'));
    expect(screen.getByLabelText('Provider number (NPI)')).toHaveValue('');
    await user.type(screen.getByLabelText('Provider number (NPI)'), '1234567893{Enter}');
    expect(within(fieldButton('npi')).getByText('Read from the page: Not read')).toBeInTheDocument();
  });

  it('enables Verify at once for a fax with no flags and offers no review actions', async () => {
    const { user, onVerify } = setup();
    await openFax(user, 'fax-0001');
    expect(verify()).toHaveAttribute('aria-disabled', 'false');
    expect(statusLine()).toContain('Ready to verify');
    expect(document.querySelectorAll('[data-accept], [data-edit]')).toHaveLength(0);
    await user.click(verify());
    expect(onVerify).toHaveBeenCalledWith('fax-0001', 'model');
  });
});