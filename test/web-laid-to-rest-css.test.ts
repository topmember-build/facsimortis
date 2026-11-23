import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// R5a: the Laid to rest panel and the verify moment. jsdom has no layout or animation, so the rules are read as
// text; the fade itself was timed in headless Chrome (R5a report).
const read = (name: string) => readFileSync(resolve(__dirname, '..', 'web', 'src', name), 'utf8').replace(/\r\n/g, '\n');
const css = read('styles.css');
const theme = read('theme.css');

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
const mix = (a: Rgb, b: Rgb, t: number): Rgb => a.map((v, i) => Math.round(v + (b[i]! - v) * t)) as Rgb;
const token = (name: string) => hex(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(theme)![1]!);
const rem = (text: string, prop: string) => Number(new RegExp(`(?:^|[\\s;])${prop}:\\s*([\\d.]+)rem`).exec(text)![1]);

const PANEL = token('--panel');
const VERIFIED = ".fax-view[data-state='laid-to-rest']";

describe('R5a Laid to rest panel', () => {
  it('has an --amber-border outline, a 4px teal accent line in --ghost, and keeps its arrival fade', () => {
    const panel = rule('.laid-to-rest');
    expect(panel).toMatch(/border:\s*1px solid var\(--amber-border\)/);
    expect(panel).toMatch(/border-left:\s*4px solid var\(--ghost\)/);
    expect(panel).not.toMatch(/--edge|--border\b/);
    expect(panel).toMatch(/background:\s*var\(--panel\)/);
    expect(panel).toMatch(/animation:\s*settle 0\.8s/);
    expect(contrast(token('--ghost'), PANEL)).toBeGreaterThanOrEqual(3);
    expect(contrast(token('--ghost'), token('--ground'))).toBeGreaterThanOrEqual(3);
  });

  it('sets the heading in Pixelify Sans at 16px or more, in --text', () => {
    expect(rule('.rest-title, .button.button-download', themeRules)).toMatch(/font-family:\s*var\(--font-display\)/);
    expect(rem(rule('.rest-title'), 'font-size') * 16).toBeGreaterThanOrEqual(16);
    expect(rule('.rest-title')).not.toMatch(/color:/);
    expect(contrast(token('--text'), PANEL)).toBeGreaterThanOrEqual(4.5);
  });

  it('styles Download JSON in amber: outlined, an --amber label in Pixelify Sans at 17px or more, 44px high', () => {
    const button = rule('.button.button-download');
    expect(button).toMatch(/color:\s*var\(--amber\)/);
    expect(button).toMatch(/border:\s*2px solid var\(--amber\)/);
    expect(rem(button, 'font-size') * 16).toBeGreaterThanOrEqual(17);
    expect(rem(button, 'min-height') * 16).toBeGreaterThanOrEqual(44);
    expect(rule('.button.button-download:hover')).toMatch(/background:\s*var\(--panel-raised\)/);
    expect(contrast(token('--amber'), PANEL)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('--amber'), token('--panel-raised'))).toBeGreaterThanOrEqual(4.5);
    // The Save button of the edit form keeps its own look.
    expect(rule('.button-strong')).toMatch(/border:\s*2px solid var\(--text\)/);
  });
});

describe('R5a the verify moment', () => {
  it('fades the selected flagged card and the flagged count over 400ms, only into the laid-to-rest state', () => {
    const card = rule(`${VERIFIED} .field-card.field-flagged.field-selected, ${VERIFIED} .field-card.field-flagged.field-selected:hover`);
    expect(card).toMatch(/border-color:\s*var\(--amber-dim\)/);
    expect(card).toMatch(/inset 0 0 0 2px var\(--amber-dim\)/);
    expect(card).toMatch(/rgb\(255 106 92 \/ 0\)/);
    expect(card).toMatch(/border-color 400ms/);
    expect(card).toMatch(/box-shadow 400ms/);
    const count = rule(`${VERIFIED} .summary-count.count-flag`);
    expect(count).toMatch(/color:\s*var\(--amber-dim\)/);
    expect(count).toMatch(/transition:\s*color 400ms/);
    // The look before Verify is declared without a transition, so selecting a card stays instant.
    expect(rule('.field-card.field-flagged.field-selected, .field-card.field-flagged.field-selected:hover')).not.toMatch(/transition/);
    expect(rule('.summary-count.count-flag')).not.toMatch(/transition/);
  });

  it('fades the glow of the selected flagged highlight and its source string, after their base rules', () => {
    const glow = rule(`${VERIFIED} .ghost-flag.ghost-selected, ${VERIFIED} .ghost-string-flag`);
    expect(glow).toMatch(/filter:\s*drop-shadow\(0 0 0 rgb\(255 106 92 \/ 0\)\)/);
    expect(glow).toMatch(/transition:\s*filter 400ms/);
    const at = (prelude: string) => css.indexOf(prelude);
    expect(at(`${VERIFIED} .ghost-string-flag`)).toBeGreaterThan(at('\n.ghost-string-flag {'));
    expect(at(`${VERIFIED} .ghost-flag.ghost-selected`)).toBeGreaterThan(at('\n.ghost-flag.ghost-selected {'));
  });

  it('removes every transition and animation under reduced motion, so the change is instant', () => {
    const reduced = cssRules.find((r) => r.prelude === '@media (prefers-reduced-motion: reduce)')!;
    expect(reduced.body).toMatch(/transition:\s*none !important/);
    expect(reduced.body).toMatch(/animation:\s*none !important/);
    expect(reduced.body).toMatch(/\*,\s*\*::before,\s*\*::after/);
  });

  it('keeps every colour on the way from coral to quiet readable: 4.5:1 for the count, 3:1 for the border', () => {
    const [flag, dim] = [token('--flag'), token('--amber-dim')];
    for (let step = 0; step <= 10; step += 1) {
      const colour = mix(flag, dim, step / 10);
      expect(contrast(colour, PANEL), `step ${step}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(dim, PANEL)).toBeGreaterThanOrEqual(4.5);
  });
});
