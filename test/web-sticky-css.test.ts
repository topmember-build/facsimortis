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

describe('Synthetic data banner rules in styles.css', () => {
  const banner = block(css, '.synthetic-banner');

  it('is at least 0.875rem, scrolls away (not sticky) and uses neutral colours', () => {
    const size = /font-size:\s*([\d.]+)rem/.exec(banner);
    expect(size).not.toBeNull();
    expect(Number(size![1])).toBeGreaterThanOrEqual(0.875);
    expect(banner).not.toMatch(/position:\s*(sticky|fixed)/);
    expect(banner).not.toMatch(/--ghost|--flag/);
  });
});

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

  it('makes the summary bar sticky at the top of the fax screen, just under the sticky banner, and shows it above the viewer', () => {
    const bar = block(css, '.summary-bar');
    expect(bar).toMatch(/position:\s*sticky/);
    // B1: was `top: 0`. Now just under the sticky Synthetic data banner; 0 when the banner is not sticky.
    expect(bar).toMatch(/top:\s*var\(--banner-h,\s*0px\)/);
    expect(bar).toMatch(/order:\s*1/);
    expect(block(css, '.viewer')).toMatch(/order:\s*2/);
  });
});

describe('sticky Synthetic data banner on the review screen (B1)', () => {
  const sticky = block(css, '.synthetic-banner-sticky');
  const zIndex = (rule: string) => Number(/z-index:\s*(\d+)/.exec(rule)?.[1]);

  it('sticks at the very top, above the summary bar and the source string, in neutral colours', () => {
    expect(sticky).toMatch(/position:\s*sticky/);
    expect(sticky).toMatch(/top:\s*0/);
    expect(sticky).not.toMatch(/--ghost|--flag/);
    expect(zIndex(sticky)).toBeGreaterThan(zIndex(block(css, '.summary-bar')));
    expect(zIndex(block(css, '.summary-bar'))).toBeGreaterThan(zIndex(block(css, '.source-string-overlay')));
  });

  it('counts the banner in --bar-h, the offset the field column and every scroll margin on the fax screen use', () => {
    expect(block(css, '.fax-view')).toMatch(/--bar-h:\s*calc\(var\(--summary-bar-h,\s*5rem\)\s*\+\s*var\(--banner-h,\s*0px\)\)/);
    // S1's margins: buttons, inputs and the ghost rectangles keep clear of the banner and the bar together.
    for (const prelude of ['.fax-view button,\n.fax-view input', '.fax-view rect[data-word-id]']) {
      expect(block(css, prelude)).toMatch(/scroll-margin-top:\s*calc\(var\(--bar-h\)\s*\+\s*0\.75rem\)/);
    }
    const side = block(block(css, '@media (min-width: 60rem)'), '.viewer-side');
    expect(side).toMatch(/top:\s*calc\(var\(--bar-h\)\s*\+\s*0\.5rem\)/);
    expect(side).toMatch(/max-height:\s*calc\(100dvh - var\(--bar-h\) - 1rem\)/);
  });
});
