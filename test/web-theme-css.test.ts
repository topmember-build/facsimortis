import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const css = readFileSync(resolve(root, 'web', 'src', 'theme.css'), 'utf8').replace(/\r\n/g, '\n');
const fontsDir = resolve(root, 'web', 'public', 'fonts');

const BRIEF_TOKENS: Record<string, string> = {
  '--ground': '#141414',
  '--panel': '#151a22',
  '--panel-raised': '#171c24',
  '--line': '#262d38',
  '--text': '#fff3dc',
  '--text-muted': '#9aa4b2',
  '--ghost': '#6fd3c0',
  '--flag': '#ff6a5c',
  '--flag-text': '#ff9a8d',
  '--paper': '#e8e4d6',
  '--paper-ink': '#1d1c1a',
  '--amber': '#f6a93b',
  '--amber-dim': '#c98a2b',
  '--amber-soft': '#e9b565',
  '--amber-border': '#5a3f14',
  '--taskbar': '#05101a',
};

const fontFaces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);
const fontUrls = fontFaces.map((f) => /url\('?\/fonts\/([^')]+)'?\)/.exec(f)?.[1] ?? '');

describe('theme.css tokens', () => {
  it.each(Object.entries(BRIEF_TOKENS))('defines %s as %s', (name, value) => {
    expect(css).toMatch(new RegExp(`${name}:\\s*${value};`));
  });

  it('keeps the old names as aliases of the new ones', () => {
    expect(css).toMatch(/--bg:\s*var\(--ground\)/);
    expect(css).toMatch(/--muted:\s*var\(--text-muted\)/);
    expect(css).toMatch(/--border:\s*var\(--line\)/);
  });

  it('makes no http(s) requests', () => {
    expect(css).not.toMatch(/https?:\/\//);
  });
});

describe('theme.css fonts', () => {
  it('declares nine faces, each with swap and a woff2 url under /fonts/', () => {
    expect(fontFaces).toHaveLength(9);
    for (const face of fontFaces) {
      expect(face).toMatch(/font-display:\s*swap/);
      expect(face).toMatch(/url\('\/fonts\/[a-z-]+\/[a-z0-9-]+\.woff2'\)\s*format\('woff2'\)/);
    }
  });

  it('points every face at a file that exists in web/public/fonts and is a woff2', () => {
    for (const url of fontUrls) {
      const file = resolve(fontsDir, url);
      expect(existsSync(file), url).toBe(true);
      expect(readFileSync(file).subarray(0, 4).toString('latin1'), url).toBe('wOF2');
    }
  });

  it('has an OFL.txt per family', () => {
    for (const family of new Set(fontUrls.map((u) => u.split('/')[0]!))) {
      expect(existsSync(resolve(fontsDir, family, 'OFL.txt')), family).toBe(true);
    }
  });

  it('lists every woff2 in SOURCES.md with the SHA-256 of the file', () => {
    const sources = readFileSync(resolve(fontsDir, 'SOURCES.md'), 'utf8');
    for (const url of fontUrls) {
      const row = sources.split('\n').find((l) => l.includes(url));
      expect(row, url).toBeDefined();
      const hash = /\b([0-9a-f]{64})\b/.exec(row!)?.[1];
      expect(hash, url).toBeDefined();
      const actual = createHash('sha256').update(readFileSync(resolve(fontsDir, url))).digest('hex');
      expect(hash).toBe(actual);
    }
  });
});
