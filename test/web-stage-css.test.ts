import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// jsdom has no layout, so the fax stage rules are checked in the stylesheet text.
const read = (name: string) =>
  readFileSync(resolve(__dirname, '..', 'web', 'src', name), 'utf8').replace(/\r\n/g, '\n');
const css = read('styles.css');
const theme = read('theme.css');

/** The inside of a rule or at-rule block, found by its exact prelude. Brace-matched. */
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

describe('fax stage rules in styles.css', () => {
  it('puts the fax on a --paper sheet with rounded corners and a layered shadow', () => {
    const sheet = block(css, '.fax-sheet');
    expect(sheet).toMatch(/background:\s*var\(--paper\)/);
    const radius = /border-radius:\s*(\d+)px/.exec(sheet);
    expect(radius).not.toBeNull();
    expect(Number(radius![1])).toBeGreaterThanOrEqual(6);
    expect(Number(radius![1])).toBeLessThanOrEqual(10);
    const shadow = /box-shadow:([^;]+);/.exec(sheet)![1]!;
    expect(shadow.split(/\)\s*,/).length).toBeGreaterThanOrEqual(2);
    expect(sheet).toMatch(/padding:/);
  });

  it('draws the scanlines as a repeating gradient that takes no pointer events', () => {
    const lines = block(css, '.fax-sheet::after');
    expect(lines).toMatch(/repeating-linear-gradient/);
    expect(lines).toMatch(/pointer-events:\s*none/);
    const alphas = [...lines.matchAll(/rgb\(0 0 0 \/ ([\d.]+)\)/g)].map((m) => Number(m[1]));
    expect(alphas.length).toBeGreaterThan(0);
    for (const a of alphas) expect(a).toBeLessThanOrEqual(0.1);
  });

  it('makes the page glow a radial gradient that does not use the ghost or flag colours', () => {
    const glow = block(css, '.page-main-wide::before');
    expect(glow).toMatch(/radial-gradient/);
    expect(glow).toMatch(/pointer-events:\s*none/);
    expect(glow).not.toMatch(/--ghost|--flag/);
  });

  it('keeps muted text at 4.5:1 or better over the brightest part of the glow', () => {
    const m = /radial-gradient\([^)]*rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/.exec(block(css, '.page-main-wide::before'))!;
    const [r, g, b] = [m[1], m[2], m[3]].map(Number) as [number, number, number];
    const alpha = Number(m[4]);
    const ground = hex(/--ground:\s*(#[0-9a-fA-F]{6})/.exec(theme)![1]!);
    const lit = [r, g, b].map((v, i) => v * alpha + ground[i]! * (1 - alpha));
    const muted = hex(/--text-muted:\s*(#[0-9a-fA-F]{6})/.exec(theme)![1]!);
    expect(contrast(muted, lit)).toBeGreaterThanOrEqual(4.5);
    const text = hex(/--text:\s*(#[0-9a-fA-F]{6})/.exec(theme)![1]!);
    expect(contrast(text, lit)).toBeGreaterThanOrEqual(4.5);
  });

  it('stacks by default and sets the two columns only inside the wide media query', () => {
    const base = block(css, '.viewer');
    expect(base).not.toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+\d/);
    const stackedAt = css.indexOf('grid-template-columns: minmax(0, 1fr);');
    const wideAt = css.indexOf('@media (min-width: 60rem)');
    expect(stackedAt).toBeGreaterThanOrEqual(0);
    expect(stackedAt).toBeLessThan(wideAt);
    const wide = block(css, '@media (min-width: 60rem)');
    expect(block(wide, '.viewer')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+24rem/);
    const reference = block(css, '@media (min-width: 80rem)');
    expect(block(reference, '.viewer')).toMatch(/37\.5rem.*38\.75rem/);
    expect(css).not.toMatch(/tabindex/i);
  });
});
