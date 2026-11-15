import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// jsdom has no layout, so the sticky rules are checked in the stylesheet text.
const css = readFileSync(resolve(__dirname, '..', 'web', 'src', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');

/** The inside of a CSS rule or at-rule block, found by its exact prelude. Brace-matched. */
function block(source: string, prelude: string): string {
  const start = source.indexOf(`${prelude} {`);
  expect(start, `${prelude} not found`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`${prelude} is not closed`);
}

describe('sticky layout rules in styles.css', () => {
  const wide = block(css, '@media (min-width: 60rem)');

  it('makes the field list column sticky with its own scroll, only inside the wide media query', () => {
    const side = block(wide, '.viewer-side');
    expect(side).toMatch(/position:\s*sticky/);
    expect(side).toMatch(/top:\s*calc\(var\(--bar-h\)/);
    expect(side).toMatch(/max-height:\s*calc\(100dvh/);
    expect(side).toMatch(/overflow-y:\s*auto/);
    expect(side).toMatch(/scroll-padding:/);
    // Outside the wide query the list column has no rule of its own, so it is in normal flow.
    expect(css.replace(wide, '')).not.toMatch(/\.viewer-side\s*\{/);
  });

  it('makes the summary bar sticky at the top of the fax screen and shows it above the viewer', () => {
    const bar = block(css, '.summary-bar');
    expect(bar).toMatch(/position:\s*sticky/);
    expect(bar).toMatch(/top:\s*0/);
    expect(bar).toMatch(/order:\s*1/);
    expect(block(css, '.viewer')).toMatch(/order:\s*2/);
  });
});
