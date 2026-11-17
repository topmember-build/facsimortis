import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FIELD_ORDER, type FieldName } from '../../src/extract/schema.js';
import { SAMPLE_DATA_VERSION, SampleFaxSchema, type SampleFax } from '../../src/samples/schema.js';
import { NPI_FLAG } from '../../src/validators/messages.js';
import { App } from './App';
import { buildVerifiedRecord } from './record';
import {
  EMPTY_REVIEW,
  canVerify,
  fieldReview,
  isUnchangedEdit,
  reviewReducer,
  reviewStatus,
  standingFlags,
  type ReviewEvent,
  type ReviewState,
} from './review-state';
import { MemoryStore } from './storage';
import { committedFaxes, stubSite } from './test-site';

const fax3: SampleFax = SampleFaxSchema.parse(committedFaxes['fax-0003.json']);
const REF = '2026-10-01';
const AT = '2026-10-01T09:30:00.000Z';
const fields = (fax3.readers.model.status === 'ok' ? fax3.readers.model.fields : [])!;
const pageValue = (name: FieldName) => fields.find((f) => f.name === name)!.value;

const edit = (field: FieldName, newValue: string, original = pageValue(field)): ReviewEvent => ({
  type: 'edit',
  field,
  originalValue: original,
  newValue,
  at: AT,
});
const accept = (field: FieldName): ReviewEvent => ({ type: 'accept', field, originalValue: pageValue(field), at: AT });

describe('reducer: an unchanged edit is no change', () => {
  it('returns the same state when the text equals the page value', () => {
    const state = reviewReducer(EMPTY_REVIEW, accept('npi'));
    expect(reviewReducer(state, edit('callbackPhone', '555~0151'))).toBe(state);
    expect(reviewReducer(EMPTY_REVIEW, edit('callbackPhone', '555~0151'))).toBe(EMPTY_REVIEW);
  });

  it('compares with the reviewer value once there is one', () => {
    const state = reviewReducer(EMPTY_REVIEW, edit('callbackPhone', '555-0151'));
    expect(reviewReducer(state, edit('callbackPhone', '555-0151'))).toBe(state);
    // Back to the page value is a real change now.
    const back = reviewReducer(state, edit('callbackPhone', '555~0151'));
    expect(back.actions).toHaveLength(2);
  });

  it('trims the text before comparing, and matches exactly otherwise', () => {
    expect(isUnchangedEdit(EMPTY_REVIEW, edit('callbackPhone', '  555~0151  '))).toBe(true);
    expect(isUnchangedEdit(EMPTY_REVIEW, edit('patientName', 'x', 'X'))).toBe(false);
    expect(isUnchangedEdit(EMPTY_REVIEW, edit('npi', '5', null))).toBe(false);
  });

  it('keeps actions, reviewed flag, flags, summary and record as they were', () => {
    const before = reviewReducer(EMPTY_REVIEW, accept('npi'));
    const after = reviewReducer(before, edit('callbackPhone', '555~0151'));
    expect(after.actions).toEqual(before.actions);
    expect(fieldReview(after, 'callbackPhone')).toEqual(fieldReview(before, 'callbackPhone'));
    expect(fieldReview(after, 'callbackPhone').reviewed).toBe(false);
    const build = (state: ReviewState) =>
      buildVerifiedRecord({ fax: fax3, reader: 'model', referenceDate: REF, sampleDataVersion: SAMPLE_DATA_VERSION, state, verifiedAtUtc: AT });
    expect(build(after)).toEqual(build(before));
    expect(build(after)!.summary).toEqual(build(before)!.summary);
  });

  it('leaves the NPI flag standing and Verify blocked when the flagged NPI is saved unchanged', () => {
    const after = reviewReducer(EMPTY_REVIEW, edit('npi', '6720988041'));
    expect(after).toBe(EMPTY_REVIEW);
    const npi = fields.find((f) => f.name === 'npi')!;
    expect(standingFlags(npi, after, REF)).toContain(NPI_FLAG);
    expect(canVerify(fields, after, REF)).toBe(false);
    expect(reviewStatus(fields, after, REF)).toBe('Not yet reviewed');
  });

  it('property: an unchanged edit leaves any reachable state deep-equal', () => {
    const event = fc.record({
      kind: fc.constantFrom('accept', 'edit'),
      field: fc.constantFrom(...FIELD_ORDER),
      text: fc.constantFrom('a', 'b', '555-0151', 'routine'),
    });
    fc.assert(
      fc.property(fc.array(event, { maxLength: 12 }), fc.constantFrom(...FIELD_ORDER), fc.string(), (steps, name, pad) => {
        let state: ReviewState = EMPTY_REVIEW;
        for (const step of steps) {
          state = reviewReducer(state, step.kind === 'accept' ? accept(step.field) : edit(step.field, step.text));
        }
        const snapshot = structuredClone(state);
        const current = fieldReview(state, name).enteredValue ?? pageValue(name);
        if (current === null) return true;
        const spaces = pad.replace(/\S/g, ' ');
        const next = reviewReducer(state, edit(name, `${spaces}${current}${spaces}`));
        expect(next).toBe(state);
        expect(next).toEqual(snapshot);
        return true;
      }),
    );
  });
});

class SpyStore extends MemoryStore {
  writes: string[] = [];
  override setItem(key: string, value: string): void {
    this.writes.push(key);
    super.setItem(key, value);
  }
}

async function openFax3(user: ReturnType<typeof userEvent.setup>, store: SpyStore) {
  stubSite();
  const recorded: unknown[] = [];
  const view = render(<App storage={store} onReviewAction={(_f, _r, a) => recorded.push(a)} />);
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
  await user.click(screen.getByRole('button', { name: 'Incoming fax' }));
  await user.click(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === 'fax-0003')!);
  await screen.findByRole('heading', { level: 2, name: 'Fax fax-0003' });
  return { view, recorded };
}

const editButton = (name: string) => document.querySelector<HTMLElement>(`[data-edit="${name}"]`)!;
const fieldButton = (name: string) => document.querySelector<HTMLElement>(`button[data-field="${name}"]`)!;
const live = () => document.querySelector('[aria-live="polite"].sr-only')!;

describe('review panel: unchanged Save', () => {
  it('closes the form, returns focus to Edit, says "No change made" and writes nothing', async () => {
    const user = userEvent.setup();
    const store = new SpyStore();
    const { view, recorded } = await openFax3(user, store);
    const writesBefore = store.writes.length;

    await user.click(editButton('callbackPhone'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.queryByLabelText('New value for Callback phone')).toBeNull();
    expect(editButton('callbackPhone')).toHaveFocus();
    const note = document.querySelector('[data-no-change]')!;
    expect(note).toHaveTextContent('No change made');
    // The note sits inside that field's card, in the same row as the field name.
    const card = fieldButton('callbackPhone').closest('li')!;
    expect(card.contains(note)).toBe(true);
    expect(note.previousElementSibling).toHaveTextContent('Callback phone');
    expect(note.parentElement).toBe(card.querySelector('.field-head'));
    // Edit is a compact button inside the same card, named with the field.
    expect(card.contains(editButton('callbackPhone'))).toBe(true);
    expect(editButton('callbackPhone')).toHaveClass('button-compact');
    expect(editButton('callbackPhone')).toHaveAccessibleName('Edit Callback phone');
    expect(live()).toHaveTextContent('Callback phone: no change made.');
    expect(screen.queryByText(/Entered by you/)).toBeNull();
    expect(fieldButton('callbackPhone')).toHaveTextContent('555~0151');
    expect(recorded).toEqual([]);
    expect(store.writes.length).toBe(writesBefore);
    expect(screen.getByRole('button', { name: 'Verify record' })).toHaveAttribute('aria-disabled', 'true');
    expect((await axe.run(view.container)).violations).toEqual([]);

    // The message goes away on the next action on that field.
    await user.click(editButton('callbackPhone'));
    expect(document.querySelector('[data-no-change]')).toBeNull();
  });

  it('keeps the NPI flag when the flagged NPI is saved unchanged', async () => {
    const user = userEvent.setup();
    const store = new SpyStore();
    const { recorded } = await openFax3(user, store);
    await user.click(editButton('npi'));
    await user.keyboard('{Enter}');
    expect(fieldButton('npi')).toHaveTextContent(NPI_FLAG);
    expect(document.querySelector('[data-accept="npi"]')).not.toBeNull();
    expect(recorded).toEqual([]);
    expect(screen.getByRole('button', { name: 'Verify record' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('still records a real change', async () => {
    const user = userEvent.setup();
    const { recorded } = await openFax3(user, new SpyStore());
    await user.click(editButton('callbackPhone'));
    const input = screen.getByLabelText('New value for Callback phone');
    await user.clear(input);
    await user.type(input, '555-0151{Enter}');
    expect(recorded).toHaveLength(1);
    expect(screen.getByText('Entered by you. Read from the page: 555~0151')).toBeInTheDocument();
    expect(document.querySelector('[data-no-change]')).toBeNull();
  });
});
