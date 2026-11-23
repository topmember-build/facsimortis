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
  it('is three columns at every width, narrow enough for one row at 1360px', () => {
    const list = block(css, '.fax-list');
    const columns = /grid-template-columns:\s*repeat\(3,\s*([\d.]+)rem\)/.exec(list)!;
    const gap = /gap:\s*[\d.]+rem\s+([\d.]+)rem/.exec(list)!;
    // Three tiles and two gaps, plus the widest side padding (3.5rem each side), fit well inside 1360px.
    const row = (3 * Number(columns[1]) + 2 * Number(gap[1]) + 7) * 16;
    expect(row).toBeLessThan(1360);
    // Tighter than R2's 11.75rem tiles with 0.75rem gaps.
    expect(Number(columns[1]) + Number(gap[1])).toBeLessThan(11.75 + 0.75);
    const phone = block(css, '@media (max-width: 36rem)');
    expect(block(phone, '.fax-list')).toMatch(/grid-template-columns:\s*repeat\(3,/);
  });

  it('draws the 12 x 16 unit icon at a whole number of pixels a unit, about 20% larger than R2', () => {
    const px = (text: string, prop: string) => Number(new RegExp(`(?:^|[\\s;])${prop}:\\s*(\\d+)px`).exec(text)![1]);
    const icon = block(css, '.doc-icon');
    const unit = px(icon, 'width') / 12;
    expect(Number.isInteger(unit)).toBe(true);
    expect(px(icon, 'height')).toBe(16 * unit);
    expect(px(icon, 'width') / 48).toBeGreaterThanOrEqual(1.2);
    expect(px(icon, 'width') / 48).toBeLessThanOrEqual(1.3);
    expect(px(block(css, '.doc-frame'), 'width')).toBe(12 * unit);
    const badge = block(css, '.doc-badge');
    expect(px(badge, 'width')).toBe(5 * unit);
    expect(px(badge, 'height')).toBe(6 * unit);
    const thumb = block(css, '.thumb');
    expect(px(thumb, 'width')).toBe(10 * unit);
    expect(px(thumb, 'height')).toBe(14 * unit);
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
  it('is --taskbar with a 2px amber top border, pinned to the bottom of the window', () => {
    const bar = block(css, '.taskbar');
    expect(bar).toMatch(/background:\s*var\(--taskbar\)/);
    expect(bar).toMatch(/border-top:\s*2px solid var\(--amber\)/);
    expect(bar).toMatch(/position:\s*fixed/);
    expect(bar).toMatch(/bottom:\s*0/);
    expect(bar).toMatch(/left:\s*0/);
    expect(bar).toMatch(/right:\s*0/);
    expect(Number(/z-index:\s*(\d+)/.exec(bar)![1])).toBeGreaterThanOrEqual(1);
  });

  it('keeps content and focus clear of it: page padding, scroll padding and margin around controls', () => {
    expect(block(css, '#root')).toMatch(/padding-bottom:\s*var\(--taskbar-h,\s*0px\)/);
    expect(block(css, 'html')).toMatch(/scroll-padding-bottom:\s*var\(--taskbar-h,\s*0px\)/);
    // The focus ring reaches 4px outside a control (2px outline at a 2px offset).
    expect(remOf(block(css, '.page-main-desktop button'), 'scroll-margin-bottom') * 16).toBeGreaterThan(4);
    // The bar's own button keeps its ring inside the bar: at least 4px of padding above and below it.
    const pad = /padding:\s*([\d.]+)rem/.exec(block(css, '.taskbar'))!;
    expect(Number(pad[1]) * 16).toBeGreaterThanOrEqual(4);
  });

  it('goes back into the page flow on very short windows, without the padding', () => {
    const short = block(css, '@media (max-height: 30rem)');
    expect(block(short, '.taskbar')).toMatch(/position:\s*static/);
    expect(block(short, '#root')).toMatch(/padding-bottom:\s*0/);
    expect(block(short, 'html')).toMatch(/scroll-padding-bottom:\s*0/);
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
    for (const name of ['--amber', '--amber-dim', '--flag', '--text', '--ghost']) {
      expect(contrast(token(name), lit), name).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('status lines', () => {
  const pillRules = [...css.matchAll(/(^|\n)(\.(?:status-pill|pill-)[^{]*)\{([^}]*)\}/g)].map((m) => ({ prelude: m[2]!.trim(), body: m[3]! }));

  it('are plain text: no fill, outline or rounded mark on any status rule', () => {
    expect(pillRules.length).toBeGreaterThan(0);
    for (const { prelude, body } of pillRules) {
      expect(body, prelude).not.toMatch(/background|border|outline|box-shadow/);
    }
  });

  it('use --amber-dim, --flag while flagged fields wait, and --ghost for "Laid to rest" only', () => {
    expect(block(css, '.status-pill')).toMatch(/color:\s*var\(--amber-dim\)/);
    expect(block(css, '.pill-flagged,\n.pill-in-progress')).toMatch(/color:\s*var\(--flag\)/);
    expect(block(css, '.pill-laid-to-rest :is(.pill-icon, .pill-review)')).toMatch(/color:\s*var\(--ghost\)/);
    // Teal is never used for flags: the flag part of a laid-to-rest status keeps the base colour.
    for (const { prelude, body } of pillRules) {
      if (/--ghost/.test(body)) expect(prelude, prelude).not.toMatch(/pill-flags/);
    }
    for (const name of ['--amber-dim', '--flag', '--ghost']) {
      expect(contrast(token(name), token('--ground')), name).toBeGreaterThanOrEqual(4.5);
    }
  });
});
