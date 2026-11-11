import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildFax, citationOk, phase0Specs, type Truth } from '../src/generator/fax.js';
import { readPngText } from '../src/generator/png.js';

const root = join(import.meta.dirname, '..');
const specs = phase0Specs(42);
const built = new Map<string, ReturnType<typeof buildFax>>();

beforeAll(() => {
  for (const spec of specs) built.set(spec.id, buildFax(spec));
});

describe.each(specs.map((s) => [s.id, s] as const))('committed fixture %s', (id, spec) => {
  const base = join(root, 'fixtures', 'faxes', spec.level, id);

  it('is byte-identical to a fresh build', () => {
    const fresh = built.get(id)!;
    expect(readFileSync(`${base}.png`).equals(fresh.png)).toBe(true);
    expect(readFileSync(`${base}.truth.json`, 'utf8')).toBe(fresh.truthJson);
  });

  it('has valid citations and is marked synthetic', () => {
    const truth = JSON.parse(readFileSync(`${base}.truth.json`, 'utf8')) as Truth;
    expect(citationOk(truth)).toBe(true);
    expect(truth.synthetic).toBe(true);
    expect(readPngText(readFileSync(`${base}.png`))['Synthetic']).toBe('true');
  });
});
