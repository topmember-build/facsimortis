import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// jsdom has no layout, so the size minimums are checked in the stylesheet text.
const css = readFileSync(resolve(__dirname, '..', 'web', 'src', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');

function rule(prelude: string): string {
  const start = css.indexOf(`\n${prelude} {`);
  expect(start, `${prelude} not found`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
}

const rem = (text: string, prop: string): number => {
  const match = new RegExp(`(?:^|[\\s;])${prop}:\\s*([\\d.]+)rem`).exec(text);
  expect(match, `${prop} in rule`).not.toBeNull();
  return Number(match![1]);
};

describe('field card size minimums in styles.css', () => {
  it('keeps compact buttons at least 24x24 CSS px with text of at least 0.875rem', () => {
    const compact = rule('.button.button-compact');
    expect(rem(compact, 'min-height') * 16).toBeGreaterThanOrEqual(24);
    expect(rem(compact, 'min-width') * 16).toBeGreaterThanOrEqual(24);
    expect(rem(compact, 'font-size')).toBeGreaterThanOrEqual(0.875);
  });

  it('sets card text to at least 0.875rem and never uses a smaller font size in a card rule', () => {
    expect(rem(rule('.field-card'), 'font-size')).toBeGreaterThanOrEqual(0.875);
    for (const name of ['.field-name', '.field-value', '.confidence', '.no-change']) {
      expect(rem(rule(name), 'font-size'), name).toBeGreaterThanOrEqual(0.875);
    }
  });

  it('puts Accept and Edit inside the card and keeps the focus ring inside it', () => {
    expect(rule('.field-card .field-actions')).toMatch(/position:\s*absolute/);
    expect(rule('.field-item:focus-visible')).toMatch(/outline-offset:\s*-/);
  });
});
