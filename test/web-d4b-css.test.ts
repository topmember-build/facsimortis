import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// D4b: scanlines, two-row summary bar, lamp glow and paper. jsdom has no layout, so the rules are read as text.
const read = (name: string) => readFileSync(resolve(__dirname, '..', 'web', 'src', name), 'utf8').replace(/\r\n/g, '\n');
const css = read('styles.css');
const theme = read('theme.css');

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

function luminance(rgb: number[]): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function contrast(a: number[], b: number[]): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const token = (name: string) => hex(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(theme)![1]!);

describe('D4b scanlines', () => {
  it('are at most 4% black', () => {
    const alphas = [...block(css, '.fax-sheet::after').matchAll(/rgb\(0 0 0 \/ ([\d.]+)\)/g)].map((m) => Number(m[1]));
    expect(alphas.length).toBeGreaterThan(0);
    for (const a of alphas) expect(a).toBeLessThanOrEqual(0.04);
  });
});

describe('D4b lamp glow and paper', () => {
  const glow = block(css, '.page-main-wide::before');
  const m = /radial-gradient\([^)]*rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/.exec(glow)!;

  it('has a centre alpha between .09 and .13 and stays neutral-warm', () => {
    const alpha = Number(m[4]);
    expect(alpha).toBeGreaterThanOrEqual(0.09);
    expect(alpha).toBeLessThanOrEqual(0.13);
    expect(glow).not.toMatch(/--ghost|--flag/);
  });

  it('keeps text at 4.5:1 or better over the brightest part of the glow', () => {
    const alpha = Number(m[4]);
    const ground = token('--ground');
    const lit = [m[1], m[2], m[3]].map((v, i) => Number(v) * alpha + ground[i]! * (1 - alpha));
    expect(contrast(token('--text-muted'), lit)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('--text'), lit)).toBeGreaterThanOrEqual(4.5);
  });

  it('puts the fax sheet on a paper darker than #e8e4d6, with the ink above 4.5:1', () => {
    const sheet = block(css, '.fax-sheet');
    const paper = hex(/--paper:\s*(#[0-9a-fA-F]{6})/.exec(sheet)![1]!);
    expect(luminance(paper)).toBeLessThan(luminance(hex('#e8e4d6')));
    expect(contrast(token('--paper-ink'), paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('--paper-ink'), hex('#e8e4d6'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('D4b summary bar layout', () => {
  const bar = block(css, '.summary-bar');

  it('is a two-row grid: facts on top, reminder left and Verify group right below', () => {
    expect(bar).toMatch(/display:\s*grid/);
    expect(bar).toMatch(/grid-template-areas:\s*'top top'\s*'note verify'/);
    expect(block(css, '.summary-row')).toMatch(/grid-area:\s*top/);
    expect(block(css, '.summary-bar .verify-note')).toMatch(/grid-area:\s*note/);
    const group = block(css, '.summary-verify');
    expect(group).toMatch(/grid-area:\s*verify/);
    expect(group).toMatch(/flex-direction:\s*column/);
    expect(group).toMatch(/align-items:\s*flex-end/);
  });

  it('stacks the note, then the reason and Verify, on narrow screens', () => {
    const narrow = block(css, '@media (max-width: 40rem)');
    expect(block(narrow, '.summary-bar')).toMatch(/grid-template-areas:\s*'top'\s*'note'\s*'verify'/);
  });
});
