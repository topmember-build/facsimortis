import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { ReviewAction } from './review-state';
import { NPI_FLAG as VALIDATOR_NPI_FLAG } from '../../src/validators/messages.js';
import { committedIndex, json, stubSite } from './test-site';
import { SLOW_TEST_TIMEOUT } from './test-timeout';

// T1: this file renders the whole app or runs axe, which is slow on a busy machine. One shared limit: ./test-timeout.
vi.setConfig({ testTimeout: SLOW_TEST_TIMEOUT });

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
const statusLine = () => document.querySelector('.summary-bar .review-status')!.textContent;
const rowFor = (id: string) => within(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === id)!);

async function expectNoViolations(container: HTMLElement) {
  expect((await axe.run(container)).violations).toEqual([]);
}

const NOTE = 'Check each value against the fax before verifying.';
const withNote = (reason: string) => `${reason} ${NOTE}`;
const BOTH =
  '2 flagged fields still need review: Provider number (NPI), Callback phone.';

describe('review panel: fax-0003, model reader', () => {
  it('lists flagged fields first, lowest confidence first, and blocks Verify with a plain reason', async () => {
    const { user } = setup();
    await openFax(user, 'fax-0003');
    expect(fieldOrder()).toEqual(['callbackPhone', 'npi', 'referringProvider', 'patientName', 'reason', 'urgency', 'dob']);
    expect(verify()).toHaveAttribute('aria-disabled', 'true');
    expect(verify()).toHaveAccessibleDescription(withNote(BOTH));
    expect(statusLine()).toContain('Not yet reviewed');
    // Accept is for flagged fields only. Every field can be edited.
    expect(document.querySelectorAll('[data-accept]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-edit]')).toHaveLength(7);
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

    expect(verify()).toHaveAccessibleDescription(withNote('1 flagged field still needs review: Callback phone.'));
    expect(statusLine()).toContain('Review in progress');
    expect(accept('callbackPhone')).toHaveFocus();
    expect(document.querySelector('[data-accept="npi"]')).toBeNull();
    // Order does not change during review, and the value is as read.
    expect(fieldOrder()[0]).toBe('callbackPhone');
    const npi = within(fieldButton('npi'));
    expect(npi.getByText('6720988041')).toBeInTheDocument();
    // Accepted although the check failed: the label carries the message.
    expect(npi.getByText('Accepted although the check failed')).toBeInTheDocument();
    expect(npi.queryByText(/Was flagged/)).not.toBeInTheDocument();
    expect(ghost('npi')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByText('Provider number (NPI) accepted although the check failed.')).toBeInTheDocument();
    expect(recorded).toEqual([
      {
        faxId: 'fax-0003',
        reader: 'model',
        action: {
          field: 'npi',
          action: 'accepted',
          originalValue: '6720988041',
          acceptedDespiteFlag: true,
          failedChecks: [VALIDATOR_NPI_FLAG],
          atUtc: '2025-01-02T03:04:00.000Z',
        },
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
    const input = screen.getByLabelText('New value for Callback phone');
    expect(input).toHaveValue('555~0151');
    expect(input).toHaveFocus();
    expect(ghost('callbackPhone')).toHaveAttribute('data-selected', 'true');

    await user.clear(input);
    await user.type(input, '555-0151{Enter}');
    expect(screen.queryByLabelText('New value for Callback phone')).not.toBeInTheDocument();
    const phone = within(fieldButton('callbackPhone'));
    expect(phone.getByText('555-0151')).toBeInTheDocument();
    expect(phone.getByText('Entered by you. Read from the page: 555~0151')).toBeInTheDocument();
    expect(screen.queryByText(/Was flagged/)).toBeNull();
    expect(ghost('callbackPhone')).toHaveAttribute('data-selected', 'true');
    expect(ghost('callbackPhone')!.querySelectorAll('rect').length).toBeGreaterThan(0);
    expect(screen.getByRole('status')).toHaveTextContent('the page value was 555~0151');
    expect(edit('callbackPhone')).toHaveFocus();
    expect(verify()).toHaveAccessibleDescription(withNote('1 flagged field still needs review: Provider number (NPI).'));

    await user.click(accept('npi'));
    expect(verify()).toHaveFocus();
    await user.click(verify());
    expect(onVerify).toHaveBeenCalledWith('fax-0003', 'model');
    expect(recorded.map((r) => r.action)).toEqual([
      { field: 'callbackPhone', action: 'edited', originalValue: '555~0151', newValue: '555-0151', atUtc: '2025-01-02T03:04:00.000Z' },
      {
        field: 'npi',
        action: 'accepted',
        originalValue: '6720988041',
        acceptedDespiteFlag: true,
        failedChecks: [VALIDATOR_NPI_FLAG],
        atUtc: '2025-01-02T03:04:01.000Z',
      },
    ]);
  });

  it('Escape cancels an edit, changes nothing and returns focus to Edit', async () => {
    const { user, recorded } = setup();
    await openFax(user, 'fax-0003');
    await user.click(edit('npi'));
    await user.type(screen.getByLabelText('New value for Provider number (NPI)'), '9');
    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('New value for Provider number (NPI)')).not.toBeInTheDocument();
    expect(edit('npi')).toHaveFocus();
    expect(within(fieldButton('npi')).getByText('6720988041')).toBeInTheDocument();
    expect(verify()).toHaveAccessibleDescription(withNote(BOTH));
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
    const input = screen.getByLabelText('New value for Provider number (NPI)');
    await user.clear(input);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(input, '   {Enter}');
    expect(recorded).toEqual([]);
    expect(screen.getByLabelText('New value for Provider number (NPI)')).toBeInTheDocument();
  });

  it('keeps review state per reader and the inbox label follows the reader', async () => {
    const { user } = setup();
    await openFax(user, 'fax-0003');
    await user.click(accept('npi'));
    await user.click(screen.getByRole('button', { name: 'Rules reader' }));
    expect(verify()).toHaveAccessibleDescription(withNote(BOTH));
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
      { field: 'reason', action: 'accepted', originalValue: null, acceptedDespiteFlag: false, failedChecks: [], atUtc: expect.any(String) },
    ]);
    expect(within(fieldButton('reason')).getByText('Not on the page, confirmed by you')).toBeInTheDocument();
    expect(verify()).toHaveAccessibleDescription(
      withNote('2 flagged fields still need review: Referring provider, Provider number (NPI).'),
    );
    // Editing an empty field starts from an empty box and keeps "Not read" as the page value.
    await user.click(edit('npi'));
    expect(screen.getByLabelText('New value for Provider number (NPI)')).toHaveValue('');
    await user.type(screen.getByLabelText('New value for Provider number (NPI)'), '1234567893{Enter}');
    expect(within(fieldButton('npi')).getByText('Entered by you. Read from the page: Not read')).toBeInTheDocument();
  });

  it('enables Verify at once for a fax with no flags and offers Edit but no Accept', async () => {
    const { user, onVerify } = setup();
    await openFax(user, 'fax-0001');
    expect(verify()).toHaveAttribute('aria-disabled', 'false');
    expect(statusLine()).toContain('Ready to verify');
    expect(document.querySelectorAll('[data-accept]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-edit]')).toHaveLength(7);
    await user.click(verify());
    expect(onVerify).toHaveBeenCalledWith('fax-0001', 'model');
  });
});

describe('Edit on every field', () => {
  const REFERRER = 'Dr.Linnea Ashgrove, Willowbrook Family Clinic';

  it('edits an unflagged field, keeps the page value and offers no Accept', async () => {
    const { user, recorded } = setup();
    await openFax(user, 'fax-0002');
    expect(within(fieldButton('referringProvider')).getByText(REFERRER)).toBeInTheDocument();
    expect(document.querySelectorAll('[data-accept]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-edit]')).toHaveLength(7);

    await user.click(edit('referringProvider'));
    const input = screen.getByLabelText('New value for Referring provider');
    expect(input).toHaveValue(REFERRER);
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, 'Dr Linnea Ashgrove, Willowbrook Family Clinic{Enter}');

    const row = within(fieldButton('referringProvider'));
    expect(row.getByText('Dr Linnea Ashgrove, Willowbrook Family Clinic')).toBeInTheDocument();

    expect(row.getByText(`Entered by you. Read from the page: ${REFERRER}`)).toBeInTheDocument();
    expect(ghost('referringProvider')!.querySelectorAll('rect').length).toBeGreaterThan(0);
    expect(edit('referringProvider')).toHaveFocus();
    expect(statusLine()).toContain('Ready to verify');
    expect(verify()).toHaveAttribute('aria-disabled', 'false');
    expect(recorded.map((r) => r.action)).toEqual([
      {
        field: 'referringProvider',
        action: 'edited',
        originalValue: REFERRER,
        newValue: 'Dr Linnea Ashgrove, Willowbrook Family Clinic',
        atUtc: '2025-01-02T03:04:00.000Z',
      },
    ]);
  });

  it('cancels and rejects blank text on an unflagged field too', async () => {
    const { user, recorded } = setup();
    await openFax(user, 'fax-0002');
    await user.click(edit('patientName'));
    await user.keyboard('{Escape}');
    expect(edit('patientName')).toHaveFocus();
    await user.click(edit('patientName'));
    await user.clear(screen.getByLabelText('New value for Patient name'));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(recorded).toEqual([]);
  });
});

describe('edits are checked again', () => {
  const NPI_FLAG = 'The provider number looks wrong: the last digit does not match.';
  const PHONE_FLAG = 'The callback phone number is not in a usual format. Please check it.';
  const FUTURE = 'The date of birth is in the future. Please check it.';
  const flagText = (name: string) =>
    Array.from(fieldButton(name).querySelectorAll('.field-flag:not([data-accepted-despite])')).map((n) => n.textContent!.replace('⚑', '').trim());

  it('keeps the flag for a bad NPI, blocks Verify, and Accept confirms the entered value', async () => {
    const { user, recorded, onVerify } = setup();
    await openFax(user, 'fax-0003');
    await user.click(accept('callbackPhone'));
    await user.click(edit('npi'));
    await user.clear(screen.getByLabelText('New value for Provider number (NPI)'));
    await user.type(screen.getByLabelText('New value for Provider number (NPI)'), '1234567890{Enter}');

    const npi = within(fieldButton('npi'));
    expect(npi.getByText('1234567890')).toBeInTheDocument();
    expect(npi.getByText('Entered by you. Read from the page: 6720988041')).toBeInTheDocument();
    expect(flagText('npi')).toEqual([NPI_FLAG]);
    expect(accept('npi')).toBeInTheDocument();
    expect(verify()).toHaveAttribute('aria-disabled', 'true');
    expect(verify()).toHaveAccessibleDescription(
      withNote('1 flagged field still needs review: Provider number (NPI).'),
    );
    expect(statusLine()).toContain('Review in progress');
    await user.click(verify());
    expect(onVerify).not.toHaveBeenCalled();
    // The check is not a user action.
    expect(recorded.map((r) => r.action.action)).toEqual(['accepted', 'edited']);

    await user.click(accept('npi'));
    expect(flagText('npi')).toEqual([]);
    expect(npi.getByText('1234567890')).toBeInTheDocument();
    expect(npi.getByText('Entered by you. Read from the page: 6720988041')).toBeInTheDocument();
    expect(document.querySelector('[data-accept="npi"]')).toBeNull();
    expect(verify()).toHaveAttribute('aria-disabled', 'false');
    expect(statusLine()).toContain('Ready to verify');
    expect(recorded.map((r) => r.action.action)).toEqual(['accepted', 'edited', 'accepted']);
    expect(recorded[1]!.action).toMatchObject({ field: 'npi', originalValue: '6720988041', newValue: '1234567890' });
  });

  it('clears the flag for a valid NPI', async () => {
    const { user } = setup();
    await openFax(user, 'fax-0003');
    await user.click(edit('npi'));
    await user.clear(screen.getByLabelText('New value for Provider number (NPI)'));
    await user.type(screen.getByLabelText('New value for Provider number (NPI)'), '1234567893{Enter}');
    expect(flagText('npi')).toEqual([]);
    expect(document.querySelector('[data-accept="npi"]')).toBeNull();
    expect(screen.queryByText(/Was flagged/)).toBeNull();
    expect(verify()).toHaveAccessibleDescription(
      withNote('1 flagged field still needs review: Callback phone.'),
    );
  });

  it('flags an edit of an unflagged date of birth that is in the future of the index reference date', async () => {
    const { user } = setup();
    await openFax(user, 'fax-0002');
    expect(verify()).toHaveAttribute('aria-disabled', 'false');
    await user.click(edit('dob'));
    await user.clear(screen.getByLabelText('New value for Date of birth'));
    await user.type(screen.getByLabelText('New value for Date of birth'), '10/02/2026{Enter}');
    expect(flagText('dob')).toEqual([FUTURE]);
    expect(accept('dob')).toBeInTheDocument();
    expect(verify()).toHaveAttribute('aria-disabled', 'true');
    expect(verify()).toHaveAccessibleDescription(withNote('1 flagged field still needs review: Date of birth.'));
    expect(statusLine()).toContain('Review in progress');

    // The reference day itself is fine.
    await user.click(edit('dob'));
    expect(screen.getByLabelText('New value for Date of birth')).toHaveValue('10/02/2026');
    await user.clear(screen.getByLabelText('New value for Date of birth'));
    await user.type(screen.getByLabelText('New value for Date of birth'), '10/01/2026{Enter}');
    expect(flagText('dob')).toEqual([]);
    expect(verify()).toHaveAttribute('aria-disabled', 'false');
  });

  it('uses the reference date from the index, not the browser clock', async () => {
    const earlier = { ...(committedIndex as object), referenceDate: '2000-01-01' };
    stubSite({ 'index.json': () => json(earlier) });
    const user = userEvent.setup();
    render(<App now={() => new Date(Date.UTC(2025, 0, 2, 3, 4, 5))} />);
    await openFax(user, 'fax-0002');
    await user.click(edit('dob'));
    await user.clear(screen.getByLabelText('New value for Date of birth'));
    await user.type(screen.getByLabelText('New value for Date of birth'), '01/02/2001{Enter}');
    expect(flagText('dob')).toEqual([FUTURE]);
  });

  it('keeps the phone message for a bad phone and clears it for a good one', async () => {
    const { user } = setup();
    await openFax(user, 'fax-0003');
    await user.click(edit('callbackPhone'));
    await user.clear(screen.getByLabelText('New value for Callback phone'));
    await user.type(screen.getByLabelText('New value for Callback phone'), '555~0152{Enter}');
    expect(flagText('callbackPhone')).toEqual([PHONE_FLAG]);
    expect(accept('callbackPhone')).toBeInTheDocument();
    expect(verify()).toHaveAttribute('aria-disabled', 'true');

    await user.click(edit('callbackPhone'));
    expect(screen.getByLabelText('New value for Callback phone')).toHaveValue('555~0152');
    await user.clear(screen.getByLabelText('New value for Callback phone'));
    await user.type(screen.getByLabelText('New value for Callback phone'), '555-0151{Enter}');
    expect(flagText('callbackPhone')).toEqual([]);
    expect(verify()).toHaveAccessibleDescription(
      withNote('1 flagged field still needs review: Provider number (NPI).'),
    );
  });

  it('shows the verify reminder beside the button and has no accessibility violations', async () => {
    const { user, view } = setup();
    await openFax(user, 'fax-0003');
    expect(screen.getByText(NOTE)).toBeVisible();
    expect(verify().getAttribute('aria-describedby')).toBe('verify-reason verify-note');
    await user.click(edit('npi'));
    await user.clear(screen.getByLabelText('New value for Provider number (NPI)'));
    await user.type(screen.getByLabelText('New value for Provider number (NPI)'), '1234567890{Enter}');
    await expectNoViolations(view.container);
  });
});

describe('condensed field cards', () => {
  const provenance = (name: string) => Array.from(fieldButton(name).querySelectorAll('[data-provenance]')).map((n) => n.textContent);
  const warnings = (name: string) => Array.from(fieldButton(name).querySelectorAll('.field-flag')).map((n) => n.textContent);

  it('shows exactly one provenance line per card, with the right text for each state', async () => {
    const { user } = setup();
    await openFax(user, 'fax-0003');
    for (const name of fieldOrder()) expect(provenance(name!)).toHaveLength(1);
    expect(provenance('patientName')).toEqual(['Read from the page']);

    await user.click(accept('npi'));
    expect(provenance('npi')).toEqual(['Read from the page, accepted by you']);

    await user.click(edit('callbackPhone'));
    await user.clear(screen.getByLabelText('New value for Callback phone'));
    await user.type(screen.getByLabelText('New value for Callback phone'), '555-0151{Enter}');
    expect(provenance('callbackPhone')).toEqual(['Entered by you. Read from the page: 555~0151']);
    expect(screen.queryByText(/Was flagged/)).toBeNull();
    expect(fieldButton('callbackPhone').textContent).not.toMatch(/Entered by the reviewer|Accepted by the reviewer/);
  });

  it('covers empty page values: not reviewed, accepted, and edited', async () => {
    const { user } = setup();
    await openFax(user, 'fax-0002');
    await user.click(screen.getByRole('button', { name: 'Rules reader' }));
    expect(provenance('npi')).toEqual(['Nothing was read from the page']);
    expect(provenance('reason')).toEqual(['Nothing was read from the page']);
    await user.click(accept('reason'));
    expect(provenance('reason')).toEqual(['Not on the page, confirmed by you']);
    await user.click(edit('npi'));
    await user.type(screen.getByLabelText('New value for Provider number (NPI)'), '1234567893{Enter}');
    expect(provenance('npi')).toEqual(['Entered by you. Read from the page: Not read']);
  });

  it('shows the warning only when a flag stands or a failed check was accepted', async () => {
    const { user } = setup();
    await openFax(user, 'fax-0003');
    expect(warnings('patientName')).toEqual([]);
    expect(warnings('npi')).toHaveLength(1);
    expect(warnings('npi')[0]).toContain('The provider number looks wrong');
    expect(fieldButton('npi').textContent).toContain('Confidence: ');
    await user.click(accept('npi'));
    expect(warnings('npi')).toHaveLength(1);
    expect(warnings('npi')[0]).toContain('Accepted although the check failed');
    expect(warnings('npi')[0]).toContain(VALIDATOR_NPI_FLAG);
  });

  it('shows the highlight caption once, linked to the image, and no per-field caption', async () => {
    const { user } = setup();
    await openFax(user, 'fax-0003');
    const caption = 'The highlight shows where the page value was read.';
    expect(screen.getAllByText(caption)).toHaveLength(1);
    const svg = screen.getByRole('img', { name: /Faxed referral form/ });
    expect(svg).toHaveAccessibleDescription(caption);
    await user.click(edit('callbackPhone'));
    await user.clear(screen.getByLabelText('New value for Callback phone'));
    await user.type(screen.getByLabelText('New value for Callback phone'), '555-0151{Enter}');
    expect(document.body.textContent!.split(caption)).toHaveLength(2);
    expect(document.querySelector('.field-list')!.textContent).not.toMatch(/highlight/i);
  });

  it('has no accessibility violations before review, with Edit open, and after review', async () => {
    const { user, view } = setup();
    await openFax(user, 'fax-0003');
    await expectNoViolations(view.container);
    await user.click(edit('callbackPhone'));
    await expectNoViolations(view.container);
    await user.keyboard('{Escape}');
    await user.click(accept('npi'));
    await expectNoViolations(view.container);
  });
});
