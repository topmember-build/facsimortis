import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// D4c: legible highlights, compact review header, confidence row. jsdom has no layout, so the rules are read as text.
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

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const over = (fg: Rgb, bg: Rgb, alpha: number): Rgb => fg.map((v, i) => v * alpha + bg[i]! * (1 - alpha)) as Rgb;
const variable = (source: string, name: string) => hex(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(source)![1]!);
const num = (source: string, prop: string) => Number(new RegExp(`${prop}:\\s*([\\d.]+)`).exec(source)![1]);

const WHITE = hex('#ffffff');
const SHEET = hex('#ddd8c8');
const PAPER = variable(theme, '--paper');

describe('D4c highlight outline and tint', () => {
  it('draws the selected outline 3px wide and non-scaling', () => {
    expect(block(css, '.ghost-selected rect')).toMatch(/stroke-width:\s*3px/);
    expect(block(css, '.ghost rect')).toMatch(/vector-effect:\s*non-scaling-stroke/);
    expect(num(block(css, '.ghost rect'), 'stroke-width')).toBeLessThan(3);
  });

  it('keeps every tint at 20% or less and never solid', () => {
    const tints = [...css.matchAll(/fill-opacity:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    expect(tints.length).toBeGreaterThan(0);
    for (const t of tints) {
      expect(t).toBeLessThanOrEqual(0.2);
      expect(t).not.toBe(1);
    }
    expect(num(block(css, '.ghost rect'), 'fill-opacity')).toBeLessThan(num(block(css, '.ghost-selected rect'), 'fill-opacity'));
  });

  it('draws flagged words dashed in the flag colours and other words solid in the ghost colours', () => {
    const flagged = block(css, '.ghost-flag rect');
    expect(flagged).toMatch(/fill:\s*var\(--flag\)/);
    expect(flagged).toMatch(/stroke:\s*var\(--flag-edge\)/);
    expect(flagged).toMatch(/stroke-dasharray:\s*\d/);
    const quiet = block(css, '.ghost rect');
    expect(quiet).toMatch(/fill:\s*var\(--ghost\)/);
    expect(quiet).toMatch(/stroke:\s*var\(--ghost-edge\)/);
    expect(quiet).not.toMatch(/stroke-dasharray/);
    expect(block(css, '.ghost-flag.ghost-selected')).toMatch(/drop-shadow\([^)]*var\(--flag\)/);
  });

  it('keeps the outline colours at 3:1 or better on white and on the paper sheet, at the opacity they are drawn', () => {
    const edges: Array<[string, Rgb, number]> = [
      ['ghost quiet', variable(css, '--ghost-edge'), num(block(css, '.ghost rect'), 'stroke-opacity')],
      ['ghost selected', variable(css, '--ghost-edge'), num(block(css, '.ghost-selected rect'), 'stroke-opacity')],
      ['flag quiet', variable(theme, '--flag-edge'), num(block(css, '.ghost rect'), 'stroke-opacity')],
      ['flag selected', variable(theme, '--flag-edge'), num(block(css, '.ghost-selected rect'), 'stroke-opacity')],
    ];
    for (const [name, colour, alpha] of edges) {
      for (const bg of [WHITE, SHEET, PAPER]) {
        expect(contrast(over(colour, bg, alpha), bg), `${name} on ${bg}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('keeps black text readable through the tint', () => {
    const black: Rgb = [0, 0, 0];
    for (const token of ['--ghost', '--flag']) {
      const tint = over(variable(theme, token), WHITE, 0.2);
      expect(contrast(black, tint)).toBeGreaterThanOrEqual(7);
    }
  });
});

describe('D4c review header', () => {
  it('lays Back, heading, reader line and toggle out in one wrapping row', () => {
    const row = block(css, '.fax-header');
    expect(row).toMatch(/display:\s*flex/);
    expect(row).toMatch(/flex-wrap:\s*wrap/);
  });

  it('hides the tagline and visually hides the wordmark on the review screen only', () => {
    const review = '.page-header.page-header-review';
    expect(block(css, `${review} p`)).toMatch(/display:\s*none/);
    const h1 = block(css, `${review} h1`);
    expect(h1).toMatch(/clip:\s*rect\(0,\s*0,\s*0,\s*0\)/);
    expect(h1).toMatch(/width:\s*1px/);
    // The inbox rules are untouched.
    expect(block(theme, '.page-header h1')).toMatch(/font-size:\s*1\.875rem/);
    expect(css).not.toMatch(/(^|\n)\.page-header(\s+(h1|p))?\s*\{[^}]*display:\s*none/);
  });
});

describe('D4c compact flagged card confidence', () => {
  const compact = '.field-card.field-flagged:not(.field-expanded)';
  it('keeps the label on one line and gives the bar a fixed width', () => {
    expect(block(css, `${compact} .confidence > span:first-child`)).toMatch(/white-space:\s*nowrap/);
    const bar = block(css, `${compact} .confidence-bar`);
    expect(bar).toMatch(/width:\s*4\.5rem/);
    expect(bar).toMatch(/flex:\s*0 0 4\.5rem/);
  });
});
