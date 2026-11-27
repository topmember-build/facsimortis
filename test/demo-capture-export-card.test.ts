import { describe, expect, it } from 'vitest';
import { cardFields, escapeHtml, exportCardHtml, parseExport, type ExportExcerpt } from '../tools/demo-capture/export-card.js';

// V1a. The export card builder. A real export from the app is fed through it in
// web/src/DemoCaptureLabels.test.tsx; these tests use small hand-made files.

const SITE = 'http://localhost:4173/facsimortis/';

function field(overrides: Partial<ExportExcerpt['fields'][number]> & { name: string; label: string }) {
  return {
    originalValue: 'as read',
    originalFlags: [] as string[],
    finalValue: 'as read',
    source: 'page' as const,
    reviewed: false,
    acceptedDespiteFlag: false,
    failedChecks: [] as string[],
    ...overrides,
  };
}

function file(fields: ReturnType<typeof field>[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    synthetic: true,
    notice: 'Synthetic data. Demo only.',
    faxId: 'fax-0003',
    reader: 'model',
    verifiedAtUtc: '2026-10-01T09:30:00.000Z',
    verifier: 'Demo reviewer',
    fields,
    ...extra,
  });
}

describe('parseExport', () => {
  it('names the file when it is not JSON', () => {
    expect(() => parseExport('{nope', 'x.json')).toThrow('x.json is not valid JSON.');
  });

  it('names the file and the place when it is not an exported record', () => {
    expect(() => parseExport(JSON.stringify({ synthetic: false }), 'x.json')).toThrow(
      /^x\.json is not an exported record the card can show \(problem at: synthetic/,
    );
    expect(() => parseExport(file([]), 'x.json')).toThrow('problem at: fields');
  });
});

describe('cardFields', () => {
  it('shows only flagged or reviewed fields, in file order, with values exactly as saved', () => {
    const record = parseExport(
      file([
        field({ name: 'patientName', label: 'Patient name' }),
        field({
          name: 'npi',
          label: 'Provider number (NPI)',
          originalValue: '6720988041',
          finalValue: '6720988041',
          originalFlags: ['flag'],
          reviewed: true,
          acceptedDespiteFlag: true,
          failedChecks: ['check one', 'check two'],
        }),
        field({ name: 'reason', label: 'Reason for referral', originalValue: null, finalValue: null, originalFlags: ['not found'] }),
        field({ name: 'callbackPhone', label: 'Callback phone', originalValue: '555~0151', finalValue: '555-0151', source: 'reviewer', reviewed: true }),
      ]),
      'x.json',
    );
    const fields = cardFields(record);
    expect(fields.map((f) => f.label)).toEqual(['Provider number (NPI)', 'Reason for referral', 'Callback phone']);
    expect(fields[0]!.lines.map((l) => [l.key, l.value, l.flag])).toEqual([
      ['originalValue', '"6720988041"', false],
      ['acceptedDespiteFlag', 'true', true],
      ['failedChecks', '"check one"', true],
      ['failedChecks', '"check two"', true],
    ]);
    // Nothing found on the page shows as null, as saved: never a guessed value.
    expect(fields[1]!.lines).toEqual([{ caption: 'As read from the page', key: 'originalValue', value: 'null', flag: false }]);
    expect(fields[2]!.lines.map((l) => [l.key, l.value])).toEqual([
      ['originalValue', '"555~0151"'],
      ['finalValue', '"555-0151"'],
    ]);
  });
});

describe('exportCardHtml', () => {
  const record = parseExport(
    file([field({ name: 'npi', label: 'Provider number (NPI)', originalFlags: ['f'], reviewed: true, acceptedDespiteFlag: true, failedChecks: ['The provider number looks wrong: the last digit does not match.'] })]),
    'facsimortis-fax-0003-model-verified.json',
  );

  it('shows the notice, the file name, the verifier, the verify time and the failed check', () => {
    const html = exportCardHtml(record, { fileName: 'facsimortis-fax-0003-model-verified.json', siteUrl: SITE });
    expect(html).toContain('<div class="notice" role="region" aria-label="Synthetic data notice">Synthetic data. Demo only.</div>');
    expect(html).toContain('facsimortis-fax-0003-model-verified.json');
    expect(html).toContain('&quot;Demo reviewer&quot;');
    expect(html).toContain('&quot;2026-10-01T09:30:00.000Z&quot;');
    expect(html).toContain('The provider number looks wrong: the last digit does not match.');
  });

  it('loads only the site fonts and runs no script', () => {
    const html = exportCardHtml(record, { fileName: 'f.json', siteUrl: SITE });
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain(`content="default-src 'none'; style-src 'unsafe-inline'; font-src http://localhost:4173"`);
    const urls = [...html.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url!.startsWith(`${SITE}fonts/`) && url!.endsWith('.woff2'))).toBe(true);
  });

  it('escapes every value from the file', () => {
    const hostile = '<img src=x onerror=alert(1)> & "quoted" \'single\'';
    const bad = parseExport(
      file([field({ name: 'npi', label: hostile, originalValue: hostile, originalFlags: ['f'], reviewed: true, acceptedDespiteFlag: true, failedChecks: [hostile] })], {
        verifier: hostile,
        notice: hostile,
      }),
      'x.json',
    );
    const html = exportCardHtml(bad, { fileName: hostile, siteUrl: SITE });
    expect(html).not.toContain('<img');
    expect(html).toContain(escapeHtml(hostile));
  });

  it.each(['file:///C:/x/', 'http://localhost:4173/facsimortis', 'javascript:alert(1)//', 'http://localhost:4173/?q=1/'])(
    'refuses the site URL %s',
    (siteUrl) => {
      expect(() => exportCardHtml(record, { fileName: 'f.json', siteUrl })).toThrow();
    },
  );
});

describe('escapeHtml', () => {
  it('escapes the five HTML characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
