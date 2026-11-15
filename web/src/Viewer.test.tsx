import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { NO_SAVED_ANSWER_MESSAGE, SampleFaxSchema } from '../../src/samples/schema.js';
import { App } from './App';
import { committedFaxes, json, stubSite } from './test-site';

type UserApi = ReturnType<typeof userEvent.setup>;

async function expectNoViolations(container: HTMLElement) {
  const results = await axe.run(container);
  expect(results.violations).toEqual([]);
}

async function openFax(user: UserApi, id: string) {
  const view = render(<App />);
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
  if (id === 'fax-0003') await user.click(screen.getByRole('button', { name: 'Incoming fax' }));
  const row = screen.getAllByRole('button').find((b) => b.dataset['faxId'] === id)!;
  await user.click(row);
  await screen.findByRole('heading', { level: 2, name: `Fax ${id}` });
  return view;
}

const fieldButton = (name: string) => document.querySelector<HTMLElement>(`button[data-field="${name}"]`)!;
const ghostGroup = (container: HTMLElement, name: string) =>
  container.querySelector<SVGGElement>(`g[data-field="${name}"]`);

function wordBox(faxId: string, wordId: string) {
  const fax = SampleFaxSchema.parse(committedFaxes[`${faxId}.json`]);
  const [x0, y0, x1, y1] = fax.ocr.words.find((w) => w.id === wordId)!.box;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function noModelAnswer() {
  const clone = structuredClone(committedFaxes['fax-0002.json']) as { readers: { model: unknown } };
  clone.readers.model = { status: 'no-saved-answer', message: NO_SAVED_ANSWER_MESSAGE };
  return clone;
}

function stubMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('viewer', () => {
  it('draws one rect per cited word at the OCR box, in a viewBox the size of the fax', async () => {
    stubSite();
    const user = userEvent.setup();
    const { container } = await openFax(user, 'fax-0003');
    const fax = SampleFaxSchema.parse(committedFaxes['fax-0003.json']);

    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('viewBox', `0 0 ${fax.width} ${fax.height}`);
    expect(svg.querySelector('image')).toHaveAttribute('width', String(fax.width));
    expect(svg.querySelector('image')).toHaveAttribute('height', String(fax.height));

    await user.click(fieldButton('patientName'));
    const group = ghostGroup(container, 'patientName')!;
    const rects = Array.from(group.querySelectorAll('rect'));
    expect(rects.map((r) => r.dataset['wordId'])).toEqual(['o0018', 'o0019']);
    for (const rect of rects) {
      const box = wordBox('fax-0003', rect.dataset['wordId']!);
      expect(rect).toHaveAttribute('x', String(box.x));
      expect(rect).toHaveAttribute('y', String(box.y));
      expect(rect).toHaveAttribute('width', String(box.width));
      expect(rect).toHaveAttribute('height', String(box.height));
    }
  });

  it('draws a quiet ghost for every field and a selected ghost that pulses once per selection', async () => {
    stubMotion(false);
    stubSite();
    const user = userEvent.setup();
    const { container } = await openFax(user, 'fax-0003');
    expect(container.querySelectorAll('g.ghost')).toHaveLength(7);
    expect(container.querySelector('.ghost-selected')).toBeNull();

    await user.click(fieldButton('dob'));
    const first = ghostGroup(container, 'dob')!;
    expect(first).toHaveAttribute('data-selected', 'true');
    expect(first).toHaveClass('ghost-selected', 'ghost-pulse');
    expect(ghostGroup(container, 'npi')).not.toHaveClass('ghost-selected');
    expect(ghostGroup(container, 'npi')).toHaveAttribute('data-selected', 'false');

    // Selecting again makes a new element, so the animation can run again.
    await user.click(fieldButton('dob'));
    expect(ghostGroup(container, 'dob')).not.toBe(first);

    await user.click(fieldButton('urgency'));
    expect(ghostGroup(container, 'dob')).not.toHaveClass('ghost-pulse');
    expect(ghostGroup(container, 'urgency')).toHaveClass('ghost-pulse');
    expect(screen.getByRole('status')).toHaveTextContent('Showing source for Urgency: urgent');
  });

  it('uses a static outline and no animation class with reduced motion', async () => {
    stubMotion(true);
    stubSite();
    const user = userEvent.setup();
    const { container } = await openFax(user, 'fax-0003');
    await user.click(fieldButton('npi'));
    const group = ghostGroup(container, 'npi')!;
    expect(group).toHaveClass('ghost-selected', 'ghost-static');
    expect(group).not.toHaveClass('ghost-pulse');
  });

  it('shows value, confidence and flags exactly as stored for fax-0003', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax(user, 'fax-0003');

    const npi = within(fieldButton('npi'));
    expect(npi.getByText('Provider number (NPI)')).toBeInTheDocument();
    expect(npi.getByText('6720988041')).toBeInTheDocument();
    expect(npi.getByText('Confidence: 94%')).toBeInTheDocument();
    expect(npi.getByText('The provider number looks wrong: the last digit does not match.')).toBeInTheDocument();

    const phone = within(fieldButton('callbackPhone'));
    expect(phone.getByText('555~0151')).toBeInTheDocument();
    expect(phone.getByText('The callback phone number is not in a usual format. Please check it.')).toBeInTheDocument();

    expect(within(fieldButton('patientName')).getByText('Nell Copperfield')).toBeInTheDocument();
    expect(within(fieldButton('patientName')).queryByText(/⚑/)).not.toBeInTheDocument();
    expect(document.querySelectorAll('button[data-field]')).toHaveLength(7);
    expect(screen.getByRole('region', { name: 'Synthetic data' })).toBeVisible();
    expect(screen.getByText('Not yet reviewed')).toBeInTheDocument();
  });

  it('toggles the reader, the results and the reader name; the inbox follows', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax(user, 'fax-0002');
    expect(screen.getByText('Reader: model (saved answers)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Model answers' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(fieldButton('npi')).getByText('8128904231')).toBeInTheDocument();
    expect(within(fieldButton('npi')).queryByText(/Not found on the page/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Rules reader' }));
    expect(screen.getByText('Reader: rules')).toBeInTheDocument();
    expect(screen.queryByText('Reader: model (saved answers)')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rules reader' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Model answers' })).toHaveAttribute('aria-pressed', 'false');

    const npi = within(fieldButton('npi'));
    expect(npi.getByText('Not found on the page')).toBeInTheDocument();
    expect(npi.getByText('The provider number (NPI) could not be read clearly from the page. Please check it.')).toBeInTheDocument();
    expect(within(fieldButton('reason')).getByText('Not found on the page')).toBeInTheDocument();
    expect(within(fieldButton('referringProvider')).getByText('Family Clinic')).toBeInTheDocument();
    // A field with no words has no ghost.
    expect(ghostGroup(document.body, 'npi')).toBeNull();
    expect(ghostGroup(document.body, 'reason')).toBeNull();
    expect(ghostGroup(document.body, 'urgency')).not.toBeNull();

    await user.click(fieldButton('npi'));
    expect(screen.getByRole('status')).toHaveTextContent('Showing source for Provider number (NPI): not found on the page');

    await user.click(screen.getByRole('button', { name: 'Back to inbox' }));
    const row = within(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === 'fax-0002')!);
    expect(screen.getByText('Reader: rules')).toBeInTheDocument();
    expect(row.getByText('3 flagged fields')).toBeInTheDocument();
    expect(row.getByText('Not yet reviewed')).toBeInTheDocument();
  });

  it('shows 0 flagged fields for fax-0002 under the model reader in the inbox', async () => {
    stubSite();
    const user = userEvent.setup();
    await openFax(user, 'fax-0002');
    await user.click(screen.getByRole('button', { name: 'Back to inbox' }));
    const row = within(screen.getAllByRole('button').find((b) => b.dataset['faxId'] === 'fax-0002')!);
    expect(row.getByText(/No flagged fields/)).toBeInTheDocument();
  });

  it('says plainly when there is no saved model answer and offers the rules reader', async () => {
    stubSite({ 'fax-0002.json': () => json(noModelAnswer()) });
    const user = userEvent.setup();
    const { container } = await openFax(user, 'fax-0002');
    expect(screen.getByText(NO_SAVED_ANSWER_MESSAGE)).toBeInTheDocument();
    expect(document.querySelectorAll('button[data-field]')).toHaveLength(0);
    expect(container.querySelectorAll('g.ghost')).toHaveLength(0);
    await expectNoViolations(container);

    await user.click(screen.getByRole('button', { name: 'Show the rules reader' }));
    expect(screen.queryByText(NO_SAVED_ANSWER_MESSAGE)).not.toBeInTheDocument();
    expect(screen.getByText('Reader: rules')).toBeInTheDocument();
    expect(document.querySelectorAll('button[data-field]')).toHaveLength(7);
  });

  it('is reachable by keyboard: toggle, fields in review order, and Enter selects', async () => {
    stubSite();
    const user = userEvent.setup();
    const { container } = await openFax(user, 'fax-0003');
    expect(screen.getByRole('heading', { level: 2, name: 'Fax fax-0003' })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Model answers' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Rules reader' })).toHaveFocus();
    // Flagged fields come first, lowest confidence first: Callback phone, then NPI.
    await user.tab();
    expect(fieldButton('callbackPhone')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(ghostGroup(container, 'callbackPhone')).toHaveClass('ghost-selected');
    await user.tab();
    expect(document.querySelector('[data-accept="callbackPhone"]')).toHaveFocus();
    await user.tab();
    expect(document.querySelector('[data-edit="callbackPhone"]')).toHaveFocus();
    await user.tab();
    expect(fieldButton('npi')).toHaveFocus();
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    expect(fieldButton('callbackPhone')).toHaveFocus();

    // Back to inbox comes before the toggle and the fields in tab order.
    for (let i = 0; i < 3; i += 1) await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Back to inbox' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { level: 2, name: 'Inbox' })).toBeInTheDocument();
  });
  it('has no accessibility violations with the model reader, the rules reader and a selection', async () => {
    stubSite();
    const user = userEvent.setup();
    const { container } = await openFax(user, 'fax-0003');
    await expectNoViolations(container);
    await user.click(fieldButton('npi'));
    await expectNoViolations(container);
    await user.click(screen.getByRole('button', { name: 'Rules reader' }));
    await expectNoViolations(container);
  });
});
