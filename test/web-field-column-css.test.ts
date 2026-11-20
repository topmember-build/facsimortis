import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// jsdom has no layout, so the field column rules (D4) are checked in the stylesheet text.
const css = readFileSync(resolve(__dirname, '..', 'web', 'src', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');
const theme = readFileSync(resolve(__dirname, '..', 'web', 'src', 'theme.css'), 'utf8').replace(/\r\n/g, '\n');

function rule(source: string, prelude: string): string {
  const start = source.indexOf(`\n${prelude} {`);
  expect(start, `${prelude} not found`).toBeGreaterThanOrEqual(0);
  return source.slice(source.indexOf('{', start) + 1, source.indexOf('}', start));
}
const rem = (text: string, prop: string): number => {
  const match = new RegExp(`(?:^|[\\s;])${prop}:\\s*([\\d.]+)rem`).exec(text);
  expect(match, `${prop} in rule`).not.toBeNull();
  return Number(match![1]);
};
const hexOf = (name: string) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(theme)![1]!;
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe('field column rules in styles.css', () => {
  it('makes every field column button at least 44px (2.75rem) high', () => {
    const buttons = rule(css, '.field-card .field-actions .button');
    expect(rem(buttons, 'min-height') * 16).toBeGreaterThanOrEqual(44);
    expect(rem(buttons, 'min-width') * 16).toBeGreaterThanOrEqual(44);
  });

  it('sets the expanded value in IBM Plex Mono at 1.25rem or more', () => {
    const value = rule(css, '.field-card.field-expanded .field-value');
    expect(value).toMatch(/font-family:\s*var\(--font-data\)/);
    expect(rem(value, 'font-size')).toBeGreaterThanOrEqual(1.25);
    expect(theme).toMatch(/--font-data:\s*'IBM Plex Mono'/);
  });

  it('draws reasons in --flag-text and confidence in --text-muted, never --flag', () => {
    expect(rule(css, '.field-flag')).toMatch(/color:\s*var\(--flag-text\)/);
    const confidence = rule(css, '.confidence');
    expect(confidence).toMatch(/color:\s*var\(--text-muted\)/);
    expect(confidence).not.toMatch(/--flag/);
    expect(rule(css, '.confidence-fill')).not.toMatch(/--flag/);
  });

  it('marks the selected card with border and ring widths, not colour alone', () => {
    const selected = rule(css, '.field-card.field-selected,\n.field-card.field-selected:hover');
    const ring = /box-shadow:\s*inset 0 0 0 (\d+)px/.exec(selected);
    expect(ring).not.toBeNull();
    expect(Number(ring![1])).toBeGreaterThanOrEqual(2);
    expect(rule(css, '.field-card')).toMatch(/border:\s*1px solid/);
    expect(rule(css, '.selected-tag')).toMatch(/font-weight:\s*600/);
  });

  it('fills Edit with a neutral colour that has AA contrast and is neither flag, ghost nor primary', () => {
    const fill = rule(css, '.button.button-fill');
    expect(fill).toMatch(/background:\s*var\(--text\)/);
    expect(fill).toMatch(/color:\s*var\(--ground\)/);
    expect(fill).not.toMatch(/--flag|--ghost|--primary/);
    expect(contrast(hexOf('--text'), hexOf('--ground'))).toBeGreaterThanOrEqual(4.5);
    expect(css).not.toMatch(/\.button-primary[^{]*button-fill|button-fill[^{]*button-primary/);
  });
});
