import { createHash } from 'node:crypto';
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

describe('ambiguous-chars trap fixture (slashed zero)', () => {
  const trapDir = join(root, 'fixtures', 'traps', 'ambiguous-chars');
  const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex').toUpperCase();
  const trapPng = readFileSync(join(trapDir, 'fax-0001-slashed-zero.png'));

  it('keeps the recorded slashed-zero image', () => {
    expect(sha256(trapPng)).toBe('1948A1F7AE7900234D5E3A372132BCED9EB009E24045BAD11025FEA4153F0EDD');
  });

  it('differs from the plain-zero fax-0001 image', () => {
    const current = readFileSync(join(root, 'fixtures', 'faxes', 'L1', 'fax-0001.png'));
    expect(trapPng.equals(current)).toBe(false);
  });

  it('has the same truth text and boxes as the plain-zero fax-0001', () => {
    const trapTruth = readFileSync(join(trapDir, 'fax-0001-slashed-zero.truth.json'));
    const current = readFileSync(join(root, 'fixtures', 'faxes', 'L1', 'fax-0001.truth.json'));
    expect(trapTruth.equals(current)).toBe(true);
  });
});
