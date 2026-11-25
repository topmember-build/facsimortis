import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// jsdom is already a dev dependency (the site tests run in it), but this folder has no type package for it,
// so it is loaded with require and given the small shape used here.
interface XmlDocument {
  window: {
    document: {
      documentElement: { localName: string; namespaceURI: string | null };
      querySelectorAll(selector: string): { length: number };
    };
  };
}
const { JSDOM } = createRequire(resolve(__dirname, '..', 'package.json'))('jsdom') as {
  JSDOM: new (source: string, options: { contentType: string }) => XmlDocument;
};

// R5c: the favicon is a pixel-art SVG file in --amber on a transparent background, linked from index.html.
// Whether both builds ship it, and that the browser no longer asks for /favicon.ico, was checked in headless
// Chrome (R5c report); here the file and the link are read as text.
const root = resolve(__dirname, '..');
const svgPath = resolve(root, 'web', 'public', 'favicon.svg');
const svg = readFileSync(svgPath, 'utf8').replace(/\r\n/g, '\n');
const html = readFileSync(resolve(root, 'web', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const theme = readFileSync(resolve(root, 'web', 'src', 'theme.css'), 'utf8').replace(/\r\n/g, '\n');
const withoutComments = svg.replace(/<!--[\s\S]*?-->/g, '');

describe('favicon.svg', () => {
  it('is well-formed XML (a browser rejects a malformed SVG image, for example "--" inside a comment)', () => {
    expect(() => new JSDOM(svg, { contentType: 'image/svg+xml' })).not.toThrow();
    for (const comment of svg.matchAll(/<!--([\s\S]*?)-->/g)) expect(comment[1], 'comment text').not.toMatch(/--/);
    const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
    expect(doc.documentElement.localName).toBe('svg');
    expect(doc.documentElement.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(doc.querySelectorAll('parsererror')).toHaveLength(0);
  });

  it('is a 16 x 16 SVG with a square viewBox and crisp edges', () => {
    expect(existsSync(svgPath)).toBe(true);
    const root = /<svg\b([^>]*)>/.exec(withoutComments)![1]!;
    expect(root).toMatch(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(root).toMatch(/shape-rendering="crispEdges"/);
    const box = /viewBox="(-?\d+) (-?\d+) (\d+) (\d+)"/.exec(root)!;
    expect(Number(box[3])).toBe(16);
    expect(Number(box[4])).toBe(16);
    expect(root).toMatch(/\bwidth="16"/);
    expect(root).toMatch(/\bheight="16"/);
  });

  it('is one path in --amber on a transparent background, with nothing external and no soft edges', () => {
    const amber = /--amber:\s*(#[0-9a-fA-F]{6})/.exec(theme)![1]!.toLowerCase();
    expect([...withoutComments.matchAll(/<path\b/g)]).toHaveLength(1);
    expect(withoutComments).toMatch(new RegExp(`<path fill="${amber}"`, 'i'));
    // No background shape, image, script, style, link, gradient, filter, stroke or opacity.
    expect(withoutComments).not.toMatch(/<(rect|circle|ellipse|image|script|style|use|linearGradient|radialGradient|filter|foreignObject)\b/i);
    expect(withoutComments).not.toMatch(/href=|url\(|opacity|stroke|filter=/i);
    const colours = [...withoutComments.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
    expect(new Set(colours)).toEqual(new Set([amber]));
  });

  it('draws only whole-unit rectangles inside the page area, so every edge is crisp', () => {
    const d = /<path\b[^>]*\bd="([^"]+)"/.exec(withoutComments)![1]!;
    expect(d).not.toMatch(/[.,]|[A-Za-z]\s*-?\d+\.\d/);
    expect(d).toMatch(/^[MhvzHVZ\d\s-]+$/);
    let x = 0;
    let y = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const visit = () => {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    };
    for (const m of d.matchAll(/([MhvzHV])\s*(-?\d+)?\s*(-?\d+)?/g)) {
      const [, cmd, a, b] = m;
      if (cmd === 'M') {
        x = Number(a);
        y = Number(b);
      } else if (cmd === 'h') x += Number(a);
      else if (cmd === 'v') y += Number(a);
      else if (cmd === 'H') x = Number(a);
      else if (cmd === 'V') y = Number(a);
      visit();
    }
    // The page is 12 wide and 16 high, centred in the -2..14 viewBox.
    expect([minX, maxX, minY, maxY]).toEqual([0, 12, 0, 16]);
  });
});

describe('index.html', () => {
  it('links the SVG favicon from the site root, so Vite adds the base, and asks for no .ico', () => {
    const links = [...html.matchAll(/<link\b[^>]*rel="icon"[^>]*>/g)].map((m) => m[0]);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatch(/type="image\/svg\+xml"/);
    expect(links[0]).toMatch(/href="\/favicon\.svg"/);
    expect(html).not.toMatch(/favicon\.ico/);
  });
});
