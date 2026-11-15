// Test helper: a fake static site that serves the committed sample files through a
// stubbed fetch. Not part of the app.
import { vi } from 'vitest';
import fax1 from '../public/samples/fax-0001.json';
import fax2 from '../public/samples/fax-0002.json';
import fax3 from '../public/samples/fax-0003.json';
import index from '../public/samples/index.json';

export const committedIndex: unknown = index;
export const committedFaxes: Record<string, unknown> = {
  'fax-0001.json': fax1,
  'fax-0002.json': fax2,
  'fax-0003.json': fax3,
};

export type Overrides = Record<string, () => Response | Promise<Response>>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/**
 * Stubs fetch. Files are looked up by file name (index.json, fax-0001.json, ...);
 * `overrides` replace what a file name returns. Unknown files give 404.
 */
export function stubSite(overrides: Overrides = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const name = String(input).split('/').pop() ?? '';
    const override = overrides[name];
    if (override) return override();
    if (name === 'index.json') return json(committedIndex);
    const data = committedFaxes[name];
    return data === undefined ? json({}, 404) : json(data);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
