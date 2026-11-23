import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '..', 'web', 'src', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');
const theme = readFileSync(resolve(__dirname, '..', 'web', 'src', 'theme.css'), 'utf8').replace(/\r\n/g, '\n');

function rule(prelude: string): string {
  const start = css.indexOf(`${prelude} {`);
  expect(start, `${prelude} not found`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const variable = (name: string, source = css) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(source)![1]!;

describe('styles.css: source highlight', () => {
  it('uses a thick, non-scaling outline when selected and a thinner one when quiet', () => {
    const quiet = rule('.ghost rect');
    const selected = rule('.ghost-selected rect');
    expect(quiet).toMatch(/vector-effect:\s*non-scaling-stroke/);
    expect(quiet).toMatch(/stroke:\s*var\(--ghost-edge\)/);
    expect(quiet).toMatch(/fill:\s*var\(--ghost\)/);
    const width = (s: string) => Number(/stroke-width:\s*([\d.]+)px/.exec(s)![1]);
    expect(width(selected)).toBeGreaterThanOrEqual(3);
    expect(width(quiet)).toBeLessThan(width(selected));
    expect(selected).toMatch(/stroke-opacity:\s*1\b/);
    // The words stay readable: the fill stays translucent.
    expect(Number(/fill-opacity:\s*([\d.]+)/.exec(selected)![1])).toBeLessThanOrEqual(0.5);
  });

  it('colours the glow in the ghost colour and keeps the pulse out of reduced-motion rules', () => {
    expect(rule('.ghost-glow-flood')).toMatch(/flood-color:\s*var\(--ghost\)/);
    expect(css).not.toMatch(/animation:[^;]*glow/);
    expect(css).not.toMatch(/\.ghost-static[^{]*\{[^}]*animation/);
  });

  it('keeps the outline colour at 3:1 or better against white and the dark background', () => {
    const edge = variable('--ghost-edge');
    expect(contrast(edge, '#ffffff')).toBeGreaterThanOrEqual(3);
    // The page background is --bg, which theme.css sets as an alias of --ground.
    expect(contrast(edge, variable('--ground', theme))).toBeGreaterThanOrEqual(3);
  });

  it('uses the ghost variables only in ghost rules, plus the named "Laid to rest" status', () => {
    // Named exceptions, by class: they may use --ghost, never --ghost-edge. The quiet teal "Laid to rest"
    // status in the inbox (R2b) and the "Read cleanly" section heading in the field column (R4b).
    const named = ['.pill-laid-to-rest', '.field-section-title-clean'];
    const lines = css.split('\n');
    let selector = '';
    let inComment = false;
    for (const line of lines) {
      if (line.includes('/*')) inComment = true;
      if (!inComment) {
        if (/\{\s*$/.test(line)) selector = line.trim();
        if (/var\(--ghost(-edge)?\)/.test(line)) {
          const ghostRule = /\.ghost/.test(selector);
          const namedRule = named.includes(selector.split(/[\s,:{]/)[0]!) && !/--ghost-edge/.test(line);
          expect(ghostRule || namedRule, `${line.trim()} in ${selector}`).toBe(true);
        }
      }
      if (line.includes('*/')) inComment = false;
    }
  });
});
