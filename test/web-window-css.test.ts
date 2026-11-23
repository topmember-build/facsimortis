import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// R4a: the review window frame. jsdom has no layout, so the rules are read as text; the layout itself was
// checked in headless Chrome at 1360x900, 1366x657 and 390x844 (R4a report).
const read = (name: string) => readFileSync(resolve(__dirname, '..', 'web', 'src', name), 'utf8').replace(/\r\n/g, '\n');
const css = read('styles.css');
const theme = read('theme.css');

/** Top-level rules (not inside @media), comments removed, preludes with their whitespace collapsed. */
function topLevelRules(source: string): Array<{ prelude: string; body: string }> {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Array<{ prelude: string; body: string }> = [];
  let start = 0;
  let depth = 0;
  let open = -1;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') {
      if (depth === 0) open = i;
      depth += 1;
    } else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        rules.push({ prelude: text.slice(start, open).trim().replace(/\s+/g, ' '), body: text.slice(open + 1, i) });
        start = i + 1;
      }
    }
  }
  return rules;
}
const cssRules = topLevelRules(css);
const themeRules = topLevelRules(theme);
/** The one top-level rule with exactly this prelude. */
function rule(prelude: string, rules = cssRules): string {
  const found = rules.filter((r) => r.prelude === prelude);
  expect(found, prelude).toHaveLength(1);
  return found[0]!.body;
}

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const over = (fg: Rgb, bg: Rgb, alpha: number): Rgb => fg.map((v, i) => Math.round(v * alpha + bg[i]! * (1 - alpha))) as Rgb;
const variable = (source: string, name: string) => hex(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(source)![1]!);
const px = (length: string) => (length.endsWith('rem') ? Number.parseFloat(length) * 16 : Number.parseFloat(length));

const AMBER = variable(theme, '--amber');
const GROUND = variable(theme, '--ground');
const PANEL = variable(theme, '--panel');

describe('R4a review window frame', () => {
  it('draws a 2px amber border with no fill and no overflow, positioned for the title bar buttons', () => {
    const win = rule('.fax-view');
    expect(win).toMatch(/border:\s*2px solid var\(--amber\)/);
    expect(win).toMatch(/position:\s*relative/);
    // No fill, so the lamp glow behind the stage still shows; no overflow, so focus rings are not clipped and
    // the summary bar stays sticky.
    expect(win).not.toMatch(/background|overflow/);
    expect(contrast(AMBER, GROUND)).toBeGreaterThanOrEqual(3);
  });

  it('keeps the stage and the field column at their widths: page padding, border and viewer padding make 1.5rem', () => {
    const page = /padding:\s*([\d.]+rem)/.exec(rule('.page-header, .page-main'))![1]!;
    const wide = rule('.page-main.page-main-wide');
    const left = /padding-left:\s*([\d.]+rem)/.exec(wide)![1]!;
    expect(/padding-right:\s*([\d.]+rem)/.exec(wide)![1]).toBe(left);
    const border = /border:\s*(\d+px)/.exec(rule('.fax-view'))![1]!;
    const viewers = cssRules.filter((r) => r.prelude === '.viewer' && /padding/.test(r.body));
    expect(viewers).toHaveLength(1);
    const side = /padding:\s*[\d.]+rem ([\d.]+rem)/.exec(viewers[0]!.body)![1]!;
    expect(px(left) + px(border) + px(side)).toBe(px(page));
  });
});

describe('R4a title bar', () => {
  it('is filled --amber with dark text at 9.35:1, at least 44px high', () => {
    const bar = rule('.fax-header > .fax-title-row');
    expect(bar).toMatch(/background:\s*var\(--amber\)/);
    expect(bar).toMatch(/color:\s*var\(--ground\)/);
    expect(bar).toMatch(/flex:\s*1 0 100%/);
    expect(px(/min-height:\s*([\d.]+rem)/.exec(bar)![1]!)).toBeGreaterThanOrEqual(44);
    expect(contrast(GROUND, AMBER).toFixed(2)).toBe('9.35');
  });

  it('sets the title in Pixelify Sans at 18px, with the heading taking the same font', () => {
    expect(rule('.fax-title-row', themeRules)).toMatch(/font-family:\s*var\(--font-display\)/);
    expect(theme).toMatch(/--font-display:\s*'Pixelify Sans'/);
    expect(px(/font-size:\s*([\d.]+rem)/.exec(rule('.fax-header > .fax-title-row'))![1]!)).toBe(18);
    expect(rule('.fax-title-row h2')).toMatch(/font:\s*inherit/);
    expect(rule('.fax-title-kind')).toMatch(/white-space:\s*nowrap/);
  });

  it('makes both buttons 44px targets, dark on amber, at the right end with Close window last', () => {
    const button = rule('.window-button');
    expect(px(/width:\s*([\d.]+rem)/.exec(button)![1]!)).toBe(44);
    expect(px(/height:\s*([\d.]+rem)/.exec(button)![1]!)).toBe(44);
    expect(button).toMatch(/color:\s*var\(--ground\)/);
    expect(button).toMatch(/background:\s*var\(--amber\)/);
    const placed = rule('.window-close, .fax-header > .back-button');
    expect(placed).toMatch(/position:\s*absolute/);
    expect(placed).toMatch(/top:\s*0/);
    expect(rule('.window-close')).toMatch(/right:\s*0/);
    expect(rule('.fax-header > .back-button')).toMatch(/right:\s*2\.75rem/);
    // The title's right padding keeps its text clear of both buttons.
    const padding = /padding:\s*0 ([\d.]+rem) 0 [\d.]+rem/.exec(rule('.fax-header > .fax-title-row'))![1]!;
    expect(px(padding)).toBeGreaterThanOrEqual(2 * 44);
  });

  it('draws the glyphs in the pixel font from CSS, readable on the hover tint', () => {
    expect(rule('.window-button-face::before')).toMatch(/font-family:\s*var\(--font-display\)/);
    expect(rule('.back-button .window-button-face::before')).toMatch(/content:\s*'<'/);
    expect(rule('.window-close .window-button-face::before')).toMatch(/content:\s*'\\00d7'/);
    expect(rule('.window-button-face')).toMatch(/border:\s*2px solid var\(--ground\)/);
    const m = /background:\s*rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/.exec(rule('.window-button:hover .window-button-face'))!;
    const tint = over([m[1], m[2], m[3]].map(Number) as Rgb, AMBER, Number(m[4]));
    expect(contrast(GROUND, tint)).toBeGreaterThanOrEqual(4.5);
  });

  it('shows the double focus ring on amber by its dark band', () => {
    expect(contrast(variable(css, '--focus-inner'), AMBER)).toBeGreaterThanOrEqual(3);
  });
});

describe('R4a reader line under the title bar', () => {
  it('sits on --panel, joined to the summary bar, with readable text and a hover that shows', () => {
    const line = rule('.fax-header > .reader-name, .fax-header > .reader-toggle');
    expect(line).toMatch(/background:\s*var\(--panel\)/);
    const bar = rule('.summary-bar');
    expect(bar).toMatch(/background:\s*var\(--panel\)/);
    expect(bar).toMatch(/border-top:\s*1px solid var\(--panel\)/);
    expect(contrast(variable(theme, '--text-muted'), PANEL)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(variable(theme, '--text'), PANEL)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(variable(css, '--edge'), PANEL)).toBeGreaterThanOrEqual(3);
    expect(rule(".fax-header > .reader-toggle .toggle-button[aria-pressed='false']:hover")).toMatch(
      /background:\s*var\(--panel-raised\)/,
    );
  });
});
