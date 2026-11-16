import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// jsdom does not apply the stylesheet, so the focus-ring rules are checked as text here.
const css = readFileSync('web/src/styles.css', 'utf8');

describe('focus rings', () => {
  it('keeps the :focus-visible ring for every control', () => {
    expect(css).toMatch(/\n:focus-visible\s*\{\s*outline: 3px solid var\(--focus\)/);
  });

  it('hides the heading ring unless the fax was opened with the keyboard', () => {
    expect(css).toMatch(/\.fax-heading:focus,\s*\.fax-heading:focus-visible\s*\{\s*outline: none/);
    expect(css).toMatch(/\.fax-heading\[data-opened-by='keyboard'\]:focus\s*\{\s*outline: 3px solid var\(--focus\)/);
  });
});
