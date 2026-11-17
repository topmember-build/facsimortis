import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { NO_SAVED_ANSWER_MESSAGE } from '../../src/samples/schema.js';
import { App, SYNTHETIC_BANNER_TEXT } from './App';
import { MemoryStore } from './storage';
import { committedFaxes, json, stubSite } from './test-site';

const TEXT = 'Synthetic data. Demo only, no real patient information.';
const LANDMARKS = '[role="region"], [role="banner"], [role="main"], [role="navigation"], header, main, nav, aside, footer, section[aria-label], section[aria-labelledby]';

function expectOneBanner(container: HTMLElement) {
  const notices = screen.getAllByRole('region', { name: 'Synthetic data notice' });
  expect(notices).toHaveLength(1);
  const banner = notices[0]!;
  expect(banner).toHaveTextContent(TEXT);
  expect(banner.textContent).toBe(TEXT);
  // First element of the app, and the first landmark in the page.
  expect(container.firstElementChild).toBe(banner);
  expect(container.querySelector(LANDMARKS)).toBe(banner);
  // The words appear once on the page, and the banner is not focusable.
  expect((container.textContent ?? '').match(/Synthetic data/g)).toHaveLength(1);
  expect(banner).not.toHaveAttribute('tabindex');
  expect(banner.querySelector('a, button, input, [tabindex]')).toBeNull();
}

async function expectNoViolations(container: HTMLElement) {
  const results = await axe.run(container);
  expect(results.violations).toEqual([]);
}

const inboxHeading = () => screen.findByRole('heading', { level: 2, name: 'Inbox' });
const faxRow = (id: string) => screen.getAllByRole('button').find((b) => b.dataset['faxId'] === id)!;

describe('Synthetic data banner', () => {
  it('has the agreed text', () => {
    expect(SYNTHETIC_BANNER_TEXT).toBe(TEXT);
  });

  it('is shown while loading', () => {
    stubSite({ 'index.json': () => new Promise<Response>(() => {}) });
    const { container } = render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the sample faxes');
    expectOneBanner(container);
  });

  it('is shown on the loaded inbox and is axe clean', async () => {
    stubSite();
    const { container } = render(<App />);
    await inboxHeading();
    expectOneBanner(container);
    await expectNoViolations(container);
  });

  it('is shown when the inbox is empty', async () => {
    stubSite({ 'index.json': () => json({ version: 2, referenceDate: '2026-10-01', faxes: [] }) });
    const { container } = render(<App />);
    await screen.findByText('There are no sample faxes.');
    expectOneBanner(container);
    await expectNoViolations(container);
  });

  it('is shown on the error screen and is axe clean', async () => {
    stubSite({ 'index.json': () => json({}, 500) });
    const { container } = render(<App />);
    await screen.findByRole('alert');
    expectOneBanner(container);
    await expectNoViolations(container);
  });

  it('is shown on the fax view with the model reader and the rules reader', async () => {
    stubSite();
    const user = userEvent.setup();
    const { container } = render(<App />);
    await inboxHeading();
    await user.click(faxRow('fax-0001'));
    await screen.findByRole('heading', { level: 2, name: 'Fax fax-0001' });
    expectOneBanner(container);
    await expectNoViolations(container);

    await user.click(screen.getByRole('button', { name: 'Rules reader' }));
    expect(screen.getByText('Reader: rules')).toBeInTheDocument();
    expectOneBanner(container);
    await expectNoViolations(container);
  });

  it('is shown when there is no saved model answer', async () => {
    const clone = structuredClone(committedFaxes['fax-0002.json']) as { readers: { model: unknown } };
    clone.readers.model = { status: 'no-saved-answer', message: NO_SAVED_ANSWER_MESSAGE };
    stubSite({ 'fax-0002.json': () => json(clone) });
    const user = userEvent.setup();
    const { container } = render(<App />);
    await inboxHeading();
    await user.click(faxRow('fax-0002'));
    await screen.findByText(NO_SAVED_ANSWER_MESSAGE);
    expectOneBanner(container);
    await expectNoViolations(container);
  });

  it('is shown on a record that is laid to rest', async () => {
    stubSite();
    const user = userEvent.setup();
    const { container } = render(<App storage={new MemoryStore()} now={() => new Date(Date.UTC(2026, 9, 1, 9, 30))} />);
    await inboxHeading();
    await user.click(screen.getByRole('button', { name: 'Incoming fax' }));
    await user.click(faxRow('fax-0003'));
    await screen.findByRole('heading', { level: 2, name: 'Fax fax-0003' });
    await user.click(document.querySelector<HTMLElement>('[data-accept="npi"]')!);
    await user.click(document.querySelector<HTMLElement>('[data-edit="callbackPhone"]')!);
    const input = screen.getByLabelText('New value for Callback phone');
    await user.clear(input);
    await user.type(input, '555-0151{Enter}');
    await user.click(screen.getByRole('button', { name: 'Verify record' }));
    await screen.findByRole('heading', { level: 3, name: 'Laid to rest' });
    expectOneBanner(container);
    await expectNoViolations(container);
  });
});
