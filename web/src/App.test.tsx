import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';
import { SampleIndexSchema } from '../../src/samples/schema.js';
import { FIELD_ORDER } from '../../src/extract/schema.js';
import committedIndex from '../public/samples/index.json';
import { App } from './App';

function stubFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

describe('placeholder screen', () => {
  it('shows the title, the synthetic data notice and the sample count', async () => {
    const fetchMock = stubFetch(() => jsonResponse(committedIndex));
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'Facsimortis' })).toBeInTheDocument();
    const notice = screen.getByRole('region', { name: 'Synthetic data' });
    expect(notice).toBeVisible();
    expect(notice).toHaveTextContent('Synthetic data');
    expect(screen.getByText(/built on synthetic data/i)).toBeInTheDocument();

    const expected = SampleIndexSchema.parse(committedIndex).faxes.length;
    expect(expected).toBeGreaterThan(0);
    expect(await screen.findByText(`${expected} sample faxes are ready.`)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/samples\/index\.json$/), expect.anything());
  });

  it('shows a loading line first', () => {
    stubFetch(() => new Promise<Response>(() => {}));
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the sample faxes');
    expect(screen.getByRole('region', { name: 'Synthetic data' })).toBeInTheDocument();
  });

  it('says plainly when the sample data cannot be loaded', async () => {
    stubFetch(() => jsonResponse({}, 404));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The sample faxes could not be loaded.');
    expect(screen.getByRole('region', { name: 'Synthetic data' })).toBeInTheDocument();
  });

  it('treats data that fails the shared schema as an error', async () => {
    stubFetch(() => jsonResponse({ version: 99, faxes: [] }));
    render(<App />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('has no accessibility violations once loaded', async () => {
    stubFetch(() => jsonResponse(committedIndex));
    const { container } = render(<App />);
    await screen.findByText(/sample faxes are ready/);
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });

  it('has no accessibility violations in the error state', async () => {
    stubFetch(() => jsonResponse({}, 500));
    const { container } = render(<App />);
    await screen.findByRole('alert');
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});

describe('shared schemas in the browser environment', () => {
  it('validates the committed index and rejects a bad one', () => {
    expect(SampleIndexSchema.safeParse(committedIndex).success).toBe(true);
    expect(SampleIndexSchema.safeParse({ version: 1, faxes: [{ id: '' }] }).success).toBe(false);
    expect(FIELD_ORDER).toHaveLength(7);
  });
});
