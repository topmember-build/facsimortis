import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// R2: the inbox as an amber desktop. jsdom has no layout, so the stylesheet rules are read as text.
const root = resolve(__dirname, '..');
const read = (name: string) => readFileSync(resolve(root, 'web', 'src', name), 'utf8').replace(/\r\n/g, '\n');
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
const token = (name: string) => hex(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(theme)![1]!);
const remOf = (text: string, prop: string) => Number(new RegExp(`(?:^|[\\s;])${prop}:\\s*([\\d.]+)rem`).exec(text)![1]);

describe('desktop icon grid', () => {
  it('is two columns by default and three at phone width', () => {
    expect(block(css, '.fax-list')).toMatch(/grid-template-columns:\s*repeat\(2,/);
    const phone = block(css, '@media (max-width: 36rem)');
    expect(block(phone, '.fax-list')).toMatch(/grid-template-columns:\s*repeat\(3,/);
  });

  it('draws the frame in amber and the badge in the flag colour with a dark "!"', () => {
    expect(block(css, '.doc-frame-line')).toMatch(/fill:\s*var\(--amber\)/);
    expect(block(css, '.doc-badge-fill')).toMatch(/fill:\s*var\(--flag\)/);
    expect(block(css, '.doc-badge-mark')).toMatch(/fill:\s*var\(--ground\)/);
    expect(contrast(token('--ground'), token('--flag'))).toBeGreaterThanOrEqual(4.5);
  });

  it('uses the flag colour only for flags: never for load problems or notes', () => {
    for (const prelude of ['.problem-box', '.problem-box p', '.app-notes', '.app-notes p', '.row-error', '.desktop-hint', '.synthetic-banner']) {
      expect(block(css, prelude), prelude).not.toMatch(/--flag/);
    }
  });
});

describe('pixel font', () => {
  it('is Pixelify Sans, used for the wordmark, icon labels and the clock, never under 16px', () => {
    expect(theme).toMatch(/--font-display:\s*'Pixelify Sans'/);
    expect(block(theme, '.row-id,\n.taskbar-clock')).toMatch(/font-family:\s*var\(--font-display\)/);
    expect(remOf(block(css, '.row-id'), 'font-size')).toBeGreaterThanOrEqual(1);
    expect(remOf(block(css, '.taskbar-clock'), 'font-size')).toBeGreaterThanOrEqual(1);
    const wordmark = /font-size:\s*clamp\(([\d.]+)rem/.exec(block(theme, '.page-header h1'))!;
    expect(Number(wordmark[1])).toBeGreaterThanOrEqual(1);
  });

  it('leaves no Instrument Serif behind', () => {
    expect(theme).not.toMatch(/Instrument/i);
    expect(css).not.toMatch(/Instrument/i);
    expect(readFileSync(resolve(root, 'web', 'public', 'fonts', 'SOURCES.md'), 'utf8')).not.toMatch(/instrument/i);
    expect(existsSync(resolve(root, 'web', 'public', 'fonts', 'instrument-serif'))).toBe(false);
  });
});

describe('taskbar', () => {
  it('is --taskbar with a 2px amber top border, after the content and not fixed', () => {
    const bar = block(css, '.taskbar');
    expect(bar).toMatch(/background:\s*var\(--taskbar\)/);
    expect(bar).toMatch(/border-top:\s*2px solid var\(--amber\)/);
    expect(bar).not.toMatch(/position:\s*(fixed|sticky)/);
  });

  it('has buttons of at least 44px with an amber outline, and text above 4.5:1 on it', () => {
    const button = block(css, '.taskbar-button');
    expect(remOf(button, 'min-width') * 16).toBeGreaterThanOrEqual(44);
    expect(remOf(button, 'min-height') * 16).toBeGreaterThanOrEqual(44);
    expect(button).toMatch(/border:\s*2px solid var\(--amber\)/);
    for (const name of ['--amber', '--amber-dim', '--flag']) {
      expect(contrast(token(name), token('--taskbar')), name).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('desktop glow', () => {
  const glow = block(css, '.page-main.page-main-desktop::before');
  const m = /radial-gradient\([^)]*rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/.exec(glow)!;

  it('is a soft amber radial gradient that takes no pointer events', () => {
    expect(glow).toMatch(/pointer-events:\s*none/);
    expect(Number(m[4])).toBeLessThanOrEqual(0.08);
    expect(glow).not.toMatch(/--ghost|--flag/);
  });

  it('keeps every desktop text colour at 4.5:1 or better over its brightest point', () => {
    const alpha = Number(m[4]);
    const ground = token('--ground');
    const lit = [m[1], m[2], m[3]].map((v, i) => Number(v) * alpha + ground[i]! * (1 - alpha)) as Rgb;
    for (const name of ['--amber', '--amber-dim', '--flag', '--text']) {
      expect(contrast(token(name), lit), name).toBeGreaterThanOrEqual(4.5);
    }
  });
});
