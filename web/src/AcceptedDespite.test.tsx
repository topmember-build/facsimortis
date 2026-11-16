import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { FIELD_ORDER } from '../../src/extract/schema.js';
import { NPI_FLAG, PHONE_FLAG } from '../../src/validators/messages.js';
import { App } from './App';
import { VerifiedRecordSchema, type VerifiedRecord } from './record';
import type { ReviewAction } from './review-state';
import { MemoryStore } from './storage';
import { stubSite } from './test-site';

type UserApi = ReturnType<typeof userEvent.setup>;

const DESPITE = 'Accepted although the check failed';

function setup() {
  stubSite();
  const user = userEvent.setup();
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 9, 1, 9, 30, tick++));
  const recorded: ReviewAction[] = [];
  const saved: string[] = [];
  const view = render(
    <App
      now={now}
      storage={new MemoryStore()}
      onReviewAction={(_faxId, _reader, action) => recorded.push(action)}
      download={(_name, text) => saved.push(text)}
    />,
  );
  return { user, recorded, saved, view };
}

async function openFax(user: UserApi, id: string) {
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
  if (id === 'fax-0003') await user.click(screen.getByRole('button', { name: 'Incoming fax' }));
  await user.click(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === id)!);
  await screen.findByRole('heading', { level: 2, name: `Fax ${id}` });
}

const accept = (name: string) => document.querySelector<HTMLElement>(`[data-accept="${name}"]`)!;
const edit = (name: string) => document.querySelector<HTMLElement>(`[data-edit="${name}"]`)!;
const fieldButton = (name: string) => document.querySelector<HTMLElement>(`button[data-field="${name}"]`)!;
const verify = () => screen.getByRole('button', { name: 'Verify record' });
const live = () => document.querySelector('[aria-live="polite"].sr-only')!;

async function editTo(user: UserApi, label: string, name: string, text: string) {
  await user.click(edit(name));
  const input = screen.getByLabelText(`New value for ${label}`);
  await user.clear(input);
  await user.type(input, `${text}{Enter}`);
}

async function exported(user: UserApi, saved: string[]): Promise<VerifiedRecord> {
  await user.click(screen.getByRole('button', { name: 'Download JSON' }));
  return VerifiedRecordSchema.parse(JSON.parse(saved[saved.length - 1]!));
}

describe('accepted although a check failed: fax-0003, model reader', () => {
  it('records it on the action and the field when the NPI is accepted unchanged', async () => {
    const { user, recorded, saved } = setup();
    await openFax(user, 'fax-0003');
    await user.click(accept('npi'));
    expect(recorded).toEqual([
      {
        field: 'npi',
        action: 'accepted',
        originalValue: '6720988041',
        acceptedDespiteFlag: true,
        failedChecks: [NPI_FLAG],
        at: '2026-10-01T09:30:00.000Z',
      },
    ]);

    const npi = within(fieldButton('npi'));
    expect(npi.getByText(DESPITE)).toBeInTheDocument();
    const despite = fieldButton('npi').querySelector('[data-accepted-despite]')!;
    expect(despite).toHaveTextContent(NPI_FLAG);
    expect(despite.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(despite).toHaveClass('field-flag');
    expect(live()).toHaveTextContent('Provider number (NPI) accepted although the check failed.');

    await user.click(accept('callbackPhone'));
    // The phone was flagged by the reader as "not in a usual format": a validator message too.
    expect(recorded[1]).toMatchObject({ field: 'callbackPhone', acceptedDespiteFlag: true, failedChecks: [PHONE_FLAG] });
    await user.click(verify());

    expect(screen.getByRole('heading', { level: 3, name: 'Laid to rest' })).toBeInTheDocument();
    const card = within(document.querySelector<HTMLElement>('.laid-to-rest')!);
    expect(card.getByText(`Provider number (NPI): ${DESPITE}`)).toBeInTheDocument();
    expect(card.getByText(NPI_FLAG)).toBeInTheDocument();

    const record = await exported(user, saved);
    expect(record.fields.map((f) => f.name)).toEqual([...FIELD_ORDER]);
    for (const field of record.fields) expect(typeof field.acceptedDespiteFlag).toBe('boolean');
    const flags = Object.fromEntries(record.fields.map((f) => [f.name, f.acceptedDespiteFlag]));
    expect(flags).toEqual({
      patientName: false, dob: false, referringProvider: false, npi: true, reason: false, urgency: false, callbackPhone: true,
    });
    expect(record.fields.find((f) => f.name === 'npi')).toMatchObject({ acceptedDespiteFlag: true, failedChecks: [NPI_FLAG] });
    expect(record.fields.find((f) => f.name === 'patientName')!.failedChecks).toEqual([]);
    expect(record.actions[0]).toMatchObject({ field: 'npi', acceptedDespiteFlag: true, failedChecks: [NPI_FLAG] });
  });

  it('records an accepted bad phone edit with the phone message, then a later valid edit clears the field but not the action', async () => {
    const { user, recorded, saved } = setup();
    await openFax(user, 'fax-0003');
    await editTo(user, 'Callback phone', 'callbackPhone', '555~0152');
    expect(recorded[0]).toMatchObject({ action: 'edited', newValue: '555~0152' });
    expect(recorded[0]).not.toHaveProperty('acceptedDespiteFlag');
    await user.click(accept('callbackPhone'));
    expect(recorded[1]).toMatchObject({
      field: 'callbackPhone',
      action: 'accepted',
      originalValue: '555~0151',
      acceptedDespiteFlag: true,
      failedChecks: [PHONE_FLAG],
    });
    expect(within(fieldButton('callbackPhone')).getByText(DESPITE)).toBeInTheDocument();
    expect(live()).toHaveTextContent('Callback phone accepted although the check failed.');

    await editTo(user, 'Callback phone', 'callbackPhone', '555-0151');
    expect(recorded.map((a) => a.action)).toEqual(['edited', 'accepted', 'edited']);
    expect(within(fieldButton('callbackPhone')).queryByText(DESPITE)).not.toBeInTheDocument();
    await user.click(accept('npi'));
    await user.click(verify());

    const record = await exported(user, saved);
    expect(record.fields.find((f) => f.name === 'callbackPhone')).toMatchObject({
      finalValue: '555-0151',
      acceptedDespiteFlag: false,
      failedChecks: [],
    });
    expect(record.actions[1]).toMatchObject({ action: 'accepted', acceptedDespiteFlag: true, failedChecks: [PHONE_FLAG] });
    expect(record.actions).toHaveLength(4);
  });

  it('is not "despite" when a valid edit clears the flag: no Accept is needed', async () => {
    const { user, recorded, saved } = setup();
    await openFax(user, 'fax-0003');
    await editTo(user, 'Provider number (NPI)', 'npi', '1234567893');
    await editTo(user, 'Callback phone', 'callbackPhone', '555-0151');
    expect(verify()).toHaveAttribute('aria-disabled', 'false');
    expect(screen.queryByText(DESPITE)).not.toBeInTheDocument();
    expect(recorded.map((a) => a.action)).toEqual(['edited', 'edited']);
    await user.click(verify());
    const record = await exported(user, saved);
    expect(record.fields.every((f) => !f.acceptedDespiteFlag && f.failedChecks.length === 0)).toBe(true);
    expect(document.querySelector('.rest-despite')).toBeNull();
  });

  it('has no accessibility violations with the label shown, in review and when laid to rest', async () => {
    const { user, view } = setup();
    await openFax(user, 'fax-0003');
    await user.click(accept('npi'));
    expect(screen.getByText(DESPITE)).toBeInTheDocument();
    expect((await axe.run(view.container)).violations).toEqual([]);
    await user.click(accept('callbackPhone'));
    await user.click(verify());
    expect(document.querySelector('.rest-despite')).not.toBeNull();
    expect((await axe.run(view.container)).violations).toEqual([]);
  });
});

describe('a normal accept: fax-0002, rules reader', () => {
  it('does not mark an accept of a reader flag that is not a validator check', async () => {
    const { user, recorded } = setup();
    await openFax(user, 'fax-0002');
    await user.click(screen.getByRole('button', { name: 'Rules reader' }));
    const flag = fieldButton('npi').querySelector('.field-flag')!;
    expect(flag).toHaveTextContent('could not be read clearly');
    await user.click(accept('npi'));
    expect(recorded).toEqual([
      {
        field: 'npi',
        action: 'accepted',
        originalValue: null,
        acceptedDespiteFlag: false,
        failedChecks: [],
        at: expect.any(String),
      },
    ]);
    expect(screen.queryByText(DESPITE)).not.toBeInTheDocument();
    expect(live()).toHaveTextContent('Provider number (NPI) accepted.');
    expect(live()).not.toHaveTextContent('although');
  });
});
