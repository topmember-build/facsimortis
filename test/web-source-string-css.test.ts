import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WIDE_LAYOUT_QUERY } from '../web/src/source-string.js';

// D5: jsdom has no layout, so the stylesheet rules for the source string are read as text.
const read = (name: string) => readFileSync(resolve(__dirname, '..', 'web', 'src', name), 'utf8').replace(/\r\n/g, '\n');
const css = read('styles.css');

function block(prelude: string): string {
  const start = css.indexOf(`${prelude} {`);
  expect(start, `${prelude} not found`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
}

describe('source string stylesheet', () => {
  it('uses the same breakpoint as the two-column layout', () => {
    expect(WIDE_LAYOUT_QUERY).toBe('(min-width: 60rem)');
    const wide = css.indexOf(`@media ${WIDE_LAYOUT_QUERY} {`);
    expect(wide).toBeGreaterThanOrEqual(0);
    // The sticky field column is defined inside that media query.
    expect(css.slice(wide, wide + 600)).toMatch(/\.viewer-side\s*\{[^}]*position:\s*sticky/);
  });

  it('puts the overlay below the sticky bar, with no pointer events', () => {
    const overlay = block('.source-string-overlay');
    expect(overlay).toMatch(/position:\s*fixed/);
    expect(overlay).toMatch(/pointer-events:\s*none/);
    const z = (s: string) => Number(/z-index:\s*(\d+)/.exec(s)![1]);
    expect(z(overlay)).toBeLessThan(z(block('.summary-bar')));
  });

  it('draws the flagged string in --flag with a glow and the clean string in --ghost, thin', () => {
    const clean = block('.ghost-string');
    const flag = block('.ghost-string-flag');
    expect(clean).toMatch(/stroke:\s*var\(--ghost\)/);
    expect(Number(/stroke-width:\s*([\d.]+)px/.exec(clean)![1])).toBeLessThanOrEqual(1.5);
    expect(flag).toMatch(/stroke:\s*var\(--flag\)/);
    expect(flag).toMatch(/drop-shadow\([^)]*var\(--flag\)/);
  });

  it('animates only through its own class, for about 300ms, so reduced motion can remove it', () => {
    expect(block('.ghost-string')).not.toMatch(/animation/);
    expect(block('.ghost-string-draw')).toMatch(/animation:\s*ghost-string-draw 300ms/);
  });
});
