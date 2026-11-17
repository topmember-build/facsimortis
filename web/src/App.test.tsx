import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { NO_SAVED_ANSWER_MESSAGE, SampleFaxSchema } from '../../src/samples/schema.js';
import { App } from './App';
import { cropBox, viewBoxAttr } from './crop';
import { committedFaxes, committedIndex, json, stubSite } from './test-site';

async function expectNoViolations(container: HTMLElement) {
  const results = await axe.run(container);
  expect(results.violations).toEqual([]);
}

async function renderInbox() {
  const view = render(<App />);
  await screen.findByRole('heading', { level: 2, name: 'Inbox' });
  return view;
}

const rowNames = () => screen.queryAllByRole('button').filter((b) => b.dataset['faxId'] !== undefined);

describe('inbox', () => {
  it('shows all but the last sample fax with thumbnail, received time and flag count', async () => {
    stubSite();
    await renderInbox();

    expect(rowNames().map((row) => row.dataset['faxId'])).toEqual(['fax-0001', 'fax-0002']);
    // Thumbnails are SVGs (so they can show the cropped area); the alt text is the accessible name.
    const thumb = screen.getByRole('img', { name: 'First page of fax fax-0001' });
    expect(thumb.querySelector('image')).toHaveAttribute('href', expect.stringMatching(/samples\/fax-0001\.png$/));
    expect(screen.getByRole('img', { name: 'First page of fax fax-0002' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'First page of fax fax-0003' })).not.toBeInTheDocument();

    const first = within(rowNames()[0]!);
    expect(first.getByText('Oct 1, 09:00')).toBeInTheDocument();
    expect(first.getByText('No flags raised')).toBeInTheDocument();
    expect(within(rowNames()[1]!).getByText('Oct 1, 09:07')).toBeInTheDocument();

    expect(screen.getByText('Reader: model (saved answers)')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Synthetic data' })).toBeVisible();
  });

  it('reveals the next fax with Incoming fax, then stops after the last', async () => {
    stubSite();
    const user = userEvent.setup();
    await renderInbox();
    const button = screen.getByRole('button', { name: 'Incoming fax' });
    expect(button).toHaveAttribute('aria-disabled', 'false');
    expect(screen.queryByText('No more sample faxes.')).not.toBeInTheDocument();

    await user.click(button);
    expect(rowNames().map((row) => row.dataset['faxId'])).toEqual(['fax-0001', 'fax-0002', 'fax-0003']);
    const third = within(rowNames()[2]!);
    expect(third.getByText('Oct 1, 09:14')).toBeInTheDocument();
    expect(third.getByText('2 flagged')).toBeInTheDocument();
    expect(screen.getByText('Fax fax-0003 arrived.')).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('No more sample faxes.')).toBeInTheDocument();
    expect(button).toHaveAccessibleDescription(/No more sample faxes\./);

    await user.click(button);
    expect(rowNames()).toHaveLength(3);
  });

  it('shows plain text instead of a number when the model has no saved answer', async () => {
    const noAnswer = structuredClone(committedFaxes['fax-0002.json']) as { readers: { model: unknown } };
    noAnswer.readers.model = { status: 'no-saved-answer', message: NO_SAVED_ANSWER_MESSAGE };
    stubSite({ 'fax-0002.json': () => json(noAnswer) });
    await renderInbox();
    const row = within(rowNames()[1]!);
    expect(row.getByText(/No saved model answer/)).toBeInTheDocument();
    expect(row.queryByText(/flagged/)).not.toBeInTheDocument();
    expect(row.queryByText(/\b0\b/)).not.toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    stubSite();
    const { container } = await renderInbox();
    await expectNoViolations(container);
  });
});

describe('thumbnails', () => {
  it('show the same cropped area as the fax screen, with the image and size unchanged', async () => {
    stubSite();
    await renderInbox();
    for (const id of ['fax-0001', 'fax-0002']) {
      const fax = SampleFaxSchema.parse(committedFaxes[`${id}.json`]);
      const crop = cropBox(fax.ocr.words, fax);
      const thumb = screen.getByRole('img', { name: `First page of fax ${id}` });
      expect(thumb).toHaveAttribute('viewBox', viewBoxAttr(crop));
      expect(crop.width * crop.height).toBeLessThan(fax.width * fax.height);
      const image = thumb.querySelector('image')!;
      expect(image).toHaveAttribute('width', String(fax.width));
      expect(image).toHaveAttribute('height', String(fax.height));
    }
  });
});

describe('keyboard', () => {
  it('reaches rows and the button, opens a fax with Enter and returns focus to its row', async () => {
    stubSite();
    const user = userEvent.setup();
    await renderInbox();

    await user.tab();
    expect(rowNames()[0]).toHaveFocus();
    await user.tab();
    expect(rowNames()[1]).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Incoming fax' })).toHaveFocus();

    await user.tab({ shift: true });
    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { level: 2, name: 'Fax fax-0002' })).toHaveFocus();
    expect(screen.queryByRole('heading', { name: 'Inbox' })).not.toBeInTheDocument();

    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Back to inbox' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(rowNames()[1]).toHaveFocus();
  });

  it('opens a fax with Space too', async () => {
    stubSite();
    const user = userEvent.setup();
    await renderInbox();
    await user.tab();
    await user.keyboard(' ');
    expect(screen.getByRole('heading', { level: 2, name: 'Fax fax-0001' })).toBeInTheDocument();
  });
});

describe('opened fax', () => {
  it('shows the full image, id, reader, synthetic notice and a way back', async () => {
    stubSite();
    const user = userEvent.setup();
    const { container } = await renderInbox();
    await user.click(rowNames()[0]!);

    expect(screen.getByRole('heading', { level: 2, name: 'Fax fax-0001' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Faxed referral form, fax fax-0001/ })).toBeInTheDocument();
    expect(container.querySelector('image')).toHaveAttribute('href', expect.stringMatching(/fax-0001\.png$/));
    expect(screen.getByText('Reader: model (saved answers)')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Synthetic data' })).toBeVisible();
    await expectNoViolations(container);

    await user.click(screen.getByRole('button', { name: 'Back to inbox' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Inbox' })).toBeInTheDocument();
  });
});

describe('heading focus ring', () => {
  // jsdom does not load the stylesheet. The ring rule is keyed on data-opened-by, so the
  // tests check that attribute; the heading always takes focus either way.
  const heading = () => screen.getByRole('heading', { level: 2, name: 'Fax fax-0001' });

  it('is marked for the keyboard when opened with Enter', async () => {
    stubSite();
    const user = userEvent.setup();
    await renderInbox();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(heading()).toHaveFocus();
    expect(heading()).toHaveAttribute('data-opened-by', 'keyboard');
  });

  it('is marked for the keyboard when opened with Space', async () => {
    stubSite();
    const user = userEvent.setup();
    await renderInbox();
    await user.tab();
    await user.keyboard(' ');
    expect(heading()).toHaveFocus();
    expect(heading()).toHaveAttribute('data-opened-by', 'keyboard');
  });

  it('is marked for the pointer when opened with a mouse click', async () => {
    stubSite();
    const user = userEvent.setup();
    await renderInbox();
    await user.click(rowNames()[0]!);
    expect(heading()).toHaveFocus();
    expect(heading()).toHaveAttribute('data-opened-by', 'pointer');
  });

  it('follows the latest way of opening: mouse, back, then keyboard', async () => {
    stubSite();
    const user = userEvent.setup();
    await renderInbox();
    await user.click(rowNames()[0]!);
    await user.click(screen.getByRole('button', { name: 'Back to inbox' }));
    await user.keyboard('{Enter}');
    expect(heading()).toHaveAttribute('data-opened-by', 'keyboard');
  });
});

describe('states', () => {
  it('shows a loading status first, with the notice', () => {
    stubSite({ 'index.json': () => new Promise<Response>(() => {}) });
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the sample faxes');
    expect(screen.getByRole('region', { name: 'Synthetic data' })).toBeInTheDocument();
  });

  it('shows an empty state when the index has no faxes', async () => {
    stubSite({ 'index.json': () => json({ version: 2, referenceDate: '2026-10-01', faxes: [] }) });
    const { container } = render(<App />);
    expect(await screen.findByText('There are no sample faxes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Incoming fax' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('No more sample faxes.')).toBeInTheDocument();
    await expectNoViolations(container);
  });

  it('shows an error with a retry that loads the inbox', async () => {
    let failing = true;
    stubSite({ 'index.json': () => (failing ? json({}, 500) : json(committedIndex)) });
    const user = userEvent.setup();
    const { container } = render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The list of sample faxes could not be loaded.');
    await expectNoViolations(container);

    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Inbox' })).toBeInTheDocument();
    expect(rowNames()).toHaveLength(2);
  });

  it('treats an index that fails the schema as an error', async () => {
    stubSite({ 'index.json': () => json({ version: 99, referenceDate: '2026-10-01', faxes: [] }) });
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('not in the expected form');
  });

  it('shows the other faxes and a row error when one fax file is bad', async () => {
    stubSite({ 'fax-0002.json': () => json({ id: 'fax-0002' }) });
    const { container } = await renderInbox();
    expect(rowNames().map((row) => row.dataset['faxId'])).toEqual(['fax-0001']);
    expect(screen.getByText(/fax-0002 is not in the expected form/)).toBeInTheDocument();
    expect(screen.getByText('fax-0002')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('One fax could not be loaded.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    await expectNoViolations(container);
  });
});
