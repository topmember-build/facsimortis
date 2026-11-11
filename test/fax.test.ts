import { beforeAll, describe, expect, it } from 'vitest';
import { LEVEL_PRESETS } from '../src/generator/degrade.js';
import { buildFax, citationOk, phase0Specs } from '../src/generator/fax.js';
import type { FaxSpec } from '../src/generator/fax.js';
import { decodePng, readPngText } from '../src/generator/png.js';
import type { Box } from '../src/generator/raster.js';
import { FIELD_NAMES, PAGE_HEIGHT, PAGE_WIDTH } from '../src/generator/templates.js';
import { isValidNpi } from '../src/validators/npi.js';

type Built = ReturnType<typeof buildFax>;

const specs: FaxSpec[] = phase0Specs(42);
let built: Built[] = [];
let again: Built;

beforeAll(() => {
  built = specs.map(buildFax);
  again = buildFax(specs[1] as FaxSpec);
});

function inside(b: Box): boolean {
  return b[0] >= 0 && b[1] >= 0 && b[2] <= PAGE_WIDTH && b[3] <= PAGE_HEIGHT && b[0] <= b[2] && b[1] <= b[3];
}

function intersects(a: Box, b: Box): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

describe('phase0Specs', () => {
  it('lists the three Phase 0 faxes', () => {
    expect(specs.map((s) => s.id)).toEqual(['fax-0001', 'fax-0002', 'fax-0003']);
    expect(specs.map((s) => s.seed)).toEqual([42, 43, 44]);
  });
});

describe.each([0, 1, 2])('Phase 0 fax %i', (i) => {
  const get = (): { spec: FaxSpec; fax: Built } => ({
    spec: specs[i] as FaxSpec,
    fax: built[i] as Built,
  });

  it('is tagged synthetic', () => {
    const { fax } = get();
    expect(fax.truth.synthetic).toBe(true);
    expect(readPngText(fax.png)['Synthetic']).toBe('true');
    expect(readPngText(fax.png)['Comment']).toContain('SYNTHETIC');
  });

  it('has fields in order with valid citations', () => {
    const { truth } = get().fax;
    expect(truth.fields.map((f) => f.name)).toEqual([...FIELD_NAMES]);
    const ids = new Set(truth.words.map((w) => w.id));
    for (const f of truth.fields) {
      expect(f.wordIds.every((id) => ids.has(id))).toBe(true);
    }
    expect(citationOk(truth)).toBe(true);
  });

  it('keeps boxes on the page and noise within the level preset', () => {
    const { spec, fax } = get();
    const { truth } = fax;
    expect(truth.words.every((w) => inside(w.box))).toBe(true);
    const preset = LEVEL_PRESETS[spec.level];
    expect(Math.abs(truth.degradation.skewDegrees)).toBeLessThanOrEqual(preset.maxSkewDeg);
    if (spec.level === 'L2') {
      expect(truth.degradation.streaks.length).toBeGreaterThanOrEqual(3);
      expect(truth.degradation.streaks.length).toBeLessThanOrEqual(5);
    }
  });

  it('keeps streaks and the stamp off field values', () => {
    const { spec, fax } = get();
    const { truth } = fax;
    const byId = new Map(truth.words.map((w) => [w.id, w.box]));
    const valueBoxes = truth.fields.flatMap((f) => f.wordIds.map((id) => byId.get(id) as Box));
    for (const s of truth.degradation.streaks) {
      for (const b of valueBoxes) {
        expect(s.y < b[3] && b[1] < s.y + s.height).toBe(false);
      }
    }
    const { stamp } = truth.degradation;
    expect(stamp.present).toBe(spec.stamp);
    if (stamp.present) {
      const box = stamp.box as Box;
      expect(inside(box)).toBe(true);
      expect(valueBoxes.some((b) => intersects(box, b))).toBe(false);
    } else {
      expect(stamp.box).toBeNull();
    }
  });

  it('decodes to a black and white 1728x2200 image', () => {
    const img = decodePng(get().fax.png);
    expect(img.width).toBe(1728);
    expect(img.height).toBe(2200);
    for (let p = 0; p < img.data.length; p += 4) {
      const v = img.data[p] as number;
      if (v !== 0 && v !== 255) throw new Error(`gray pixel ${v} at ${p / 4}`);
    }
  });

  it('writes truth.json that round-trips', () => {
    const { truth, truthJson } = get().fax;
    expect(truthJson.endsWith('\n')).toBe(true);
    expect(JSON.parse(truthJson)).toEqual(truth);
  });
});

describe('traps', () => {
  const npiOf = (i: number): string =>
    ((built[i] as Built).truth.fields.find((f) => f.name === 'npi') as { value: string }).value;

  it('only fax-0003 has a bad NPI', () => {
    expect(isValidNpi(npiOf(0))).toBe(true);
    expect(isValidNpi(npiOf(1))).toBe(true);
    expect(isValidNpi(npiOf(2))).toBe(false);
    expect((built[2] as Built).truth.trap).toBe('bad-npi');
  });
});

describe('determinism', () => {
  it('rebuilding gives identical bytes and truth', () => {
    const first = built[1] as Built;
    expect(first.png.equals(again.png)).toBe(true);
    expect(first.truthJson).toBe(again.truthJson);
  });
});
