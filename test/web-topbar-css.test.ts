import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(resolve(__dirname, '..', 'web', 'src', name), 'utf8').replace(/\r\n/g, '\n');
const css = read('styles.css');
const theme = read('theme.css');

/** The declarations of the first rule with exactly this prelude. */
function rule(source: string, prelude: string): string {
  const start = source.indexOf(`${prelude} {`);
  expect(start, `${prelude} not found`).toBeGreaterThanOrEqual(0);
  return source.slice(source.indexOf('{', start) + 1, source.indexOf('}', start));
}

describe('top bar rules in the stylesheets', () => {
  it('makes Verify record at least 44px (2.75rem) high with a visible border and no fill', () => {
    const primary = rule(css, '.button-primary,\n.button.button-primary');
    const min = /min-height:\s*([\d.]+)rem/.exec(primary);
    expect(Number(min![1])).toBeGreaterThanOrEqual(2.75);
    expect(primary).toMatch(/--primary-fill:\s*transparent/);
    expect(primary).toMatch(/border:\s*2px solid var\(--text\)/);
  });

  it('marks the aria-disabled Verify record with more than colour', () => {
    const disabled = rule(css, ".button.button-primary[aria-disabled='true'],\n.button.button-primary[aria-disabled='true']:hover");
    expect(disabled).toMatch(/border:\s*2px dashed/);
    expect(disabled).toMatch(/cursor:\s*not-allowed/);
    expect(disabled).toMatch(/font-weight:\s*500/);
    // Text stays strong: never the muted colour, and the fill is not dimmed with opacity on the element.
    expect(disabled).toMatch(/color:\s*var\(--text\)/);
    expect(disabled).not.toMatch(/(^|[^-])opacity/);
  });

  it('draws the banner in --text-muted, about 32px, never ghost or flag', () => {
    const banner = rule(css, '.synthetic-banner');
    expect(banner).toMatch(/color:\s*var\(--text-muted\)/);
    expect(banner).toMatch(/min-height:\s*2rem/);
    expect(banner).not.toMatch(/--ghost|--flag/);
  });

  it('sets the wordmark in Instrument Serif at 30px', () => {
    const h1 = rule(theme, '.page-header h1');
    expect(h1).toMatch(/font-family:\s*var\(--font-display\)/);
    expect(h1).toMatch(/font-size:\s*1\.875rem/);
    expect(theme).toMatch(/--font-display:\s*'Instrument Serif'/);
  });

  it('keeps the bar sticky with a 72px minimum and uses the flag colour only for the flagged count', () => {
    const bar = rule(css, '.summary-bar');
    expect(bar).toMatch(/position:\s*sticky/);
    expect(bar).toMatch(/min-height:\s*4\.5rem/);
    expect(rule(css, '.summary-count.count-flag')).toMatch(/color:\s*var\(--flag\)/);
    expect(rule(css, '.summary-counts')).not.toMatch(/--flag/);
  });

  it('sets id, time and urgency values in IBM Plex Mono', () => {
    expect(rule(css, '.summary-value')).toMatch(/font-family:\s*var\(--font-data\)/);
    expect(theme).toMatch(/\.summary-id,\n\.summary-value,/);
  });
});
