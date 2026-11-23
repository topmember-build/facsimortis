import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// R4b: the field column and summary row in the amber colour roles. jsdom has no layout, so the rules are read
// as text; the layout itself was checked in headless Chrome at 1360x900, 1366x657 and 390x844 (R4b report).
const read = (name: string) => readFileSync(resolve(__dirname, '..', 'web', 'src', name), 'utf8').replace(/\r\n/g, '\n');
const css = read('styles.css');
const theme = read('theme.css');

/** Top-level rules, comments removed, preludes with their whitespace collapsed. */
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
const contrast = (a: Rgb, b: Rgb) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const over = (fg: Rgb, bg: Rgb, alpha: number): Rgb => fg.map((v, i) => Math.round(v * alpha + bg[i]! * (1 - alpha))) as Rgb;
const token = (name: string) => hex(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(theme)![1]!);
const rem = (text: string, prop: string) => Number(new RegExp(`(?:^|[\\s;])${prop}:\\s*([\\d.]+)rem`).exec(text)![1]);

const PANEL = token('--panel');
const GROUND = token('--ground');

describe('R4b cards and rows', () => {
  it('outlines every card in 1px --amber-border and brightens it to --amber-dim on hover', () => {
    expect(rule('.field-card')).toMatch(/border:\s*1px solid var\(--amber-border\)/);
    expect(rule('.field-card:hover')).toMatch(/border-color:\s*var\(--amber-dim\)/);
    expect(contrast(token('--amber-dim'), PANEL)).toBeGreaterThanOrEqual(3);
  });

  it('draws labels in --amber-dim and keeps values in --text, both at 4.5:1 or better on the card', () => {
    expect(rule('.field-name')).toMatch(/color:\s*var\(--amber-dim\)/);
    expect(rule('.field-value')).not.toMatch(/--amber/);
    expect(contrast(token('--amber-dim'), PANEL)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('--text'), PANEL)).toBeGreaterThanOrEqual(4.5);
    expect(rule('.field-flag')).toMatch(/color:\s*var\(--flag-text\)/);
  });

  it('gives a selected clean card an amber border and a selected flagged card a coral border with a soft glow', () => {
    const clean = rule('.field-card.field-selected, .field-card.field-selected:hover');
    expect(clean).toMatch(/border-color:\s*var\(--amber\)/);
    expect(clean).toMatch(/box-shadow:\s*inset 0 0 0 2px var\(--amber\)/);
    const flagged = rule('.field-card.field-flagged.field-selected, .field-card.field-flagged.field-selected:hover');
    expect(flagged).toMatch(/border-color:\s*var\(--flag\)/);
    expect(flagged).toMatch(/inset 0 0 0 2px var\(--flag\)/);
    // The glow: a short blur of coral at 40% or less, so it stays soft and the 4px list padding hardly clips it.
    const glow = /,\s*0 0 (\d+)px (?:\d+px )?rgb\(255 106 92 \/ ([\d.]+)\)/.exec(flagged.replace(/\s+/g, ' '));
    expect(glow, 'outer coral glow').not.toBeNull();
    expect(Number(glow![1])).toBeLessThanOrEqual(8);
    expect(Number(glow![2])).toBeLessThanOrEqual(0.4);
    for (const name of ['--amber', '--flag']) expect(contrast(token(name), PANEL), name).toBeGreaterThanOrEqual(3);
  });
});

describe('R4b buttons', () => {
  it('outlines Accept anyway in coral with a --flag-text label', () => {
    const accept = rule('.button.button-accept');
    expect(accept).toMatch(/color:\s*var\(--flag-text\)/);
    expect(accept).toMatch(/border:\s*2px solid var\(--flag\)/);
    expect(contrast(token('--flag-text'), PANEL)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('--flag'), PANEL)).toBeGreaterThanOrEqual(3);
    const hover = /background:\s*rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/.exec(rule('.button.button-accept:hover'))!;
    const tint = over([hover[1], hover[2], hover[3]].map(Number) as Rgb, PANEL, Number(hover[4]));
    expect(contrast(token('--flag-text'), tint)).toBeGreaterThanOrEqual(4.5);
  });

  it('fills Edit with --amber and --ground text, lightening to --amber-soft on hover', () => {
    const fill = rule('.button.button-fill');
    expect(fill).toMatch(/background:\s*var\(--amber\)/);
    expect(fill).toMatch(/color:\s*var\(--ground\)/);
    expect(rule('.button.button-fill:hover')).toMatch(/background:\s*var\(--amber-soft\)/);
    expect(contrast(GROUND, token('--amber-soft'))).toBeGreaterThanOrEqual(4.5);
  });

  it('outlines Verify record in amber with an amber label in Pixelify Sans at 17px or more', () => {
    const primary = rule('.button-primary, .button.button-primary');
    expect(primary).toMatch(/--primary-ink:\s*var\(--amber\)/);
    expect(primary).toMatch(/border:\s*2px solid var\(--amber\)/);
    expect(rem(primary, 'font-size') * 16).toBeGreaterThanOrEqual(17);
    expect(rem(primary, 'min-height') * 16).toBeGreaterThanOrEqual(44);
    expect(rule('.button.button-primary', themeRules)).toMatch(/font-family:\s*var\(--font-display\)/);
    expect(contrast(token('--amber'), PANEL)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('--amber'), token('--panel-raised'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('R4b section headings', () => {
  it('sets both in Pixelify Sans at 16px or more, "Needs your eyes" in --flag-text and "Read cleanly" in --ghost', () => {
    expect(rule('.field-section-title', themeRules)).toMatch(/font-family:\s*var\(--font-display\)/);
    expect(rem(rule('.field-section-title'), 'font-size') * 16).toBeGreaterThanOrEqual(16);
    expect(rule('.field-section-title-flagged')).toMatch(/color:\s*var\(--flag-text\)/);
    expect(rule('.field-section-title-clean')).toMatch(/color:\s*var\(--ghost\)/);
    // On --ground and on the brightest part of the lamp glow behind the column.
    const glow = /\.page-main-wide::before \{[^}]*rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/.exec(css)!;
    const lit = over([glow[1], glow[2], glow[3]].map(Number) as Rgb, GROUND, Number(glow[4]));
    for (const name of ['--flag-text', '--ghost']) {
      for (const bg of [GROUND, lit]) expect(contrast(token(name), bg), name).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('R4b summary row', () => {
  it('draws the id in --amber and the labels, counts and reminder in --amber-dim, keeping the flagged count coral', () => {
    expect(rule('.summary-id')).toMatch(/color:\s*var\(--amber\)/);
    expect(rule('.summary-meta')).toMatch(/color:\s*var\(--amber-dim\)/);
    expect(rule('.summary-counts')).toMatch(/color:\s*var\(--amber-dim\)/);
    expect(rule('.summary-bar .verify-note')).toMatch(/color:\s*var\(--amber-dim\)/);
    expect(rule('.summary-count.count-flag')).toMatch(/color:\s*var\(--flag\)/);
    expect(rule('.summary-value')).toMatch(/color:\s*var\(--text\)/);
  });
});

describe('R4b phone layout', () => {
  const narrow = rule('@media (max-width: 40rem)', cssRules.filter((r) => /field-actions/.test(r.body)));

  it('lets the field column shrink to the window: every list, section and the panel use one minmax(0, 1fr) track', () => {
    for (const prelude of ['.field-list', '.field-section', '.review-panel']) {
      expect(rule(prelude), prelude).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    }
  });

  it('puts the buttons of a compact flagged card under its text on narrow screens, still 44px high', () => {
    const actions = /\.field-card\.field-flagged:not\(\.field-expanded\) \.field-actions \{([^}]*)\}/.exec(narrow)![1]!;
    expect(actions).toMatch(/position:\s*static/);
    expect(actions).toMatch(/transform:\s*none/);
    const item = /\.field-card\.field-flagged:not\(\.field-expanded\) \.field-item \{([^}]*)\}/.exec(narrow)![1]!;
    expect(rem(item, 'padding-right') * 16).toBeLessThanOrEqual(8);
    expect(rem(rule('.field-card .field-actions .button'), 'min-height') * 16).toBeGreaterThanOrEqual(44);
  });

  it('keeps the buttons absolutely placed at the right on wider screens', () => {
    expect(rule('.field-card .field-actions')).toMatch(/position:\s*absolute/);
    expect(rem(rule('.field-card.field-flagged:not(.field-expanded) .field-item'), 'padding-right')).toBe(10);
  });
});
