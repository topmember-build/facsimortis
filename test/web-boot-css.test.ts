import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// R3: the boot screen's stylesheet rules. jsdom has no layout or animation, so they are read as text.
const root = resolve(__dirname, '..');
const read = (...parts: string[]) => readFileSync(resolve(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
const css = read('web', 'src', 'styles.css');
const theme = read('web', 'src', 'theme.css');

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
const msOf = (text: string) => Number(/animation-delay:\s*(\d+)ms/.exec(text)![1]);
/** Every boot-screen rule (selectors starting with .boot-), with its body. */
const bootRules = [...css.matchAll(/(^|\n)(\.boot-[^{]*)\{([^}]*)\}/g)].map((m) => ({ prelude: m[2]!.trim(), body: m[3]! }));

describe('boot screen handshake lines', () => {
  it('appear one after another, about 0.5s apart, all in by about 1.5s', () => {
    const delays = [1, 2, 3].map((n) => msOf(block(css, `.boot-line:nth-child(${n})`)));
    expect(delays[0]).toBeLessThan(delays[1]!);
    expect(delays[1]).toBeLessThan(delays[2]!);
    const line = block(css, '.boot-line');
    const duration = Number(/animation:\s*boot-line-in\s+(\d+)ms/.exec(line)![1]);
    expect(delays[2]! + duration).toBeLessThanOrEqual(1600);
    expect(delays[2]! + duration).toBeGreaterThanOrEqual(1000);
  });

  it('are visible by default and hidden only by the animation, so reduced motion shows them all at once', () => {
    const line = block(css, '.boot-line');
    expect(line).not.toMatch(/opacity|visibility|display:\s*none/);
    expect(line).toMatch(/animation:\s*boot-line-in\s+\d+ms\s+[\w-]+\s+both/);
    expect(block(css, '@keyframes boot-line-in')).toMatch(/from\s*\{\s*opacity:\s*0;?\s*\}/);
    const reduced = block(css, '@media (prefers-reduced-motion: reduce)');
    expect(reduced).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{[^}]*animation:\s*none\s*!important/);
  });

  it('never blink or type: one fade-in each, no infinite or stepped animation', () => {
    for (const { prelude, body } of bootRules) {
      expect(body, prelude).not.toMatch(/infinite|steps\(|alternate/);
    }
  });
});

describe('boot screen type and colour', () => {
  it('uses Pixelify Sans for the wordmark, prompt and button at 20px or more, and IBM Plex Mono for the lines', () => {
    expect(block(theme, '.boot-wordmark,\n.boot-prompt,\n.boot-button')).toMatch(/font-family:\s*var\(--font-display\)/);
    expect(remOf(block(css, '.boot-prompt'), 'font-size') * 16).toBeGreaterThanOrEqual(20);
    expect(remOf(block(css, '.boot-button'), 'font-size') * 16).toBeGreaterThanOrEqual(20);
    expect(Number(/font-size:\s*clamp\(([\d.]+)rem/.exec(block(css, '.boot-wordmark'))![1]) * 16).toBeGreaterThanOrEqual(20);
    expect(block(css, '.boot-log')).toMatch(/font-family:\s*var\(--font-data\)/);
    expect(block(css, '.boot-status')).toMatch(/font-family:\s*var\(--font-data\)/);
  });

  it('has the glow on the wordmark only, and no background effect', () => {
    for (const { prelude, body } of bootRules) {
      if (prelude === '.boot-wordmark') expect(body).toMatch(/text-shadow/);
      else expect(body, prelude).not.toMatch(/text-shadow|box-shadow|filter|gradient/);
    }
    expect(css).not.toMatch(/\.boot-screen::(before|after)/);
  });

  it('draws text in amber and amber-dim on --ground, above 4.5:1, and never in the flag or ghost colours', () => {
    expect(block(css, '.boot-screen')).toMatch(/color:\s*var\(--amber\)/);
    expect(block(css, '.boot-status')).toMatch(/color:\s*var\(--amber-dim\)/);
    for (const { prelude, body } of bootRules) expect(body, prelude).not.toMatch(/--flag|--ghost/);
    for (const name of ['--amber', '--amber-dim']) {
      expect(contrast(token(name), token('--ground')), name).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(token('--amber'), token('--panel'))).toBeGreaterThanOrEqual(4.5);
  });

  it('gives Receive faxes a 2px amber outline and at least 44px of height', () => {
    const button = block(css, '.boot-button');
    expect(button).toMatch(/border:\s*2px solid var\(--amber\)/);
    expect(remOf(button, 'min-height') * 16).toBeGreaterThanOrEqual(44);
    expect(contrast(token('--amber'), token('--ground'))).toBeGreaterThanOrEqual(3);
  });

  it('keeps a fixed height for the "Receiving fax…" line, so nothing moves when it appears', () => {
    expect(remOf(block(css, '.boot-status'), 'min-height')).toBeGreaterThan(0);
  });
});

describe('boot screen source', () => {
  it('uses no canvas, video or sound', () => {
    const source = read('web', 'src', 'BootScreen.tsx') + read('web', 'src', 'boot.ts');
    expect(source).not.toMatch(/<canvas|<video|<audio|new Audio|AudioContext|getContext/);
  });
});
