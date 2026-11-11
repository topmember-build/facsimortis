import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRng } from '../src/generator/prng.js';
import { REFERENCE_DATE, generateReferral } from '../src/generator/data.js';
import { loadSpleen } from '../src/generator/font.js';
import { Page } from '../src/generator/raster.js';
import type { Box } from '../src/generator/raster.js';
import {
  LEVEL_PRESETS,
  addSpeckle,
  addStreaks,
  drawFaxHeader,
  mapBox,
  pickSkew,
  placeStamp,
  rotatePage,
} from '../src/generator/degrade.js';
import {
  MIN_CLEARANCE,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  drawTemplate,
} from '../src/generator/templates.js';
import type { TemplateName } from '../src/generator/templates.js';

const font = loadSpleen();
const W = 400;
const H = 300;

function intersects(a: Box, b: Box): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

function inkPixels(page: Page): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let y = 0; y < page.height; y++) {
    for (let x = 0; x < page.width; x++) if (page.getPixel(x, y) === 1) out.push([x, y]);
  }
  return out;
}

function insideBox(p: [number, number], b: Box): boolean {
  return p[0] >= b[0] && p[0] < b[2] && p[1] >= b[1] && p[1] < b[3];
}

function templateBoxes(template: TemplateName, seed: number): Box[] {
  const referral = generateReferral(createRng(seed), { trap: null, referenceDate: REFERENCE_DATE });
  const page = new Page(PAGE_WIDTH, PAGE_HEIGHT);
  return drawTemplate(page, font, template, referral).valueBoxes;
}

describe('mapBox', () => {
  it('returns the box unchanged at 0 degrees', () => {
    expect(mapBox([10, 20, 110, 70], 0, W, H)).toEqual([10, 20, 110, 70]);
  });

  it('positive angles are counter-clockwise on screen', () => {
    // A box right of centre moves up the screen (smaller y) for a positive angle.
    const [, y0] = mapBox([300, 140, 340, 160], 10, W, H);
    expect(y0).toBeLessThan(140);
  });

  it('contains all four rotated corners and stays on the page', () => {
    const box = fc
      .tuple(
        fc.integer({ min: 0, max: W - 1 }),
        fc.integer({ min: 0, max: H - 1 }),
        fc.integer({ min: 1, max: W }),
        fc.integer({ min: 1, max: H }),
      )
      .map(([x, y, w, h]): Box => [x, y, Math.min(W, x + w), Math.min(H, y + h)]);
    fc.assert(
      fc.property(box, fc.double({ min: -5, max: 5, noNaN: true }), (b, angle) => {
        const r = (angle * Math.PI) / 180;
        const [c, s] = [Math.cos(r), Math.sin(r)];
        const out = mapBox(b, angle, W, H);
        expect(out[0]).toBeGreaterThanOrEqual(0);
        expect(out[1]).toBeGreaterThanOrEqual(0);
        expect(out[2]).toBeLessThanOrEqual(W);
        expect(out[3]).toBeLessThanOrEqual(H);
        for (const [px, py] of [
          [b[0], b[1]],
          [b[2], b[1]],
          [b[0], b[3]],
          [b[2], b[3]],
        ] as const) {
          const dx = px - W / 2;
          const dy = py - H / 2;
          const rx = Math.min(W, Math.max(0, W / 2 + dx * c + dy * s));
          const ry = Math.min(H, Math.max(0, H / 2 - dx * s + dy * c));
          expect(rx).toBeGreaterThanOrEqual(out[0]);
          expect(rx).toBeLessThanOrEqual(out[2]);
          expect(ry).toBeGreaterThanOrEqual(out[1]);
          expect(ry).toBeLessThanOrEqual(out[3]);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('rotatePage + mapBox consistency', () => {
  const pos = fc.record({
    x: fc.integer({ min: 40, max: W - 44 }),
    y: fc.integer({ min: 40, max: H - 44 }),
    angle: fc.double({ min: -3, max: 3, noNaN: true }),
  });

  it('a single ink pixel lands inside its mapped box', () => {
    fc.assert(
      fc.property(pos, ({ x, y, angle }) => {
        const page = new Page(W, H);
        page.setPixel(x, y);
        const box = mapBox([x, y, x + 1, y + 1], angle, W, H);
        for (const p of inkPixels(rotatePage(page, angle))) expect(insideBox(p, box)).toBe(true);
      }),
      { numRuns: 40 },
    );
  });

  it('a 3x3 block keeps ink, all inside its mapped box', () => {
    fc.assert(
      fc.property(pos, ({ x, y, angle }) => {
        const page = new Page(W, H);
        page.fillRect(x, y, 3, 3);
        const box = mapBox([x, y, x + 3, y + 3], angle, W, H);
        const ink = inkPixels(rotatePage(page, angle));
        expect(ink.length).toBeGreaterThan(0);
        for (const p of ink) expect(insideBox(p, box)).toBe(true);
      }),
      { numRuns: 40 },
    );
  });
});

describe('drawFaxHeader', () => {
  it('stays above y=120 with sequential IDs and a 555-01NN phone', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9999 }), fc.integer({ min: 1, max: 900 }), (seed, first) => {
        const page = new Page(PAGE_WIDTH, 200);
        const words = drawFaxHeader(page, font, createRng(seed), { firstWordIndex: first });
        expect(words.length).toBeGreaterThan(0);
        words.forEach((w, i) => {
          expect(w.id).toBe(`w${String(first + i).padStart(4, '0')}`);
          expect(w.box[1]).toBeGreaterThanOrEqual(0);
          expect(w.box[3]).toBeLessThanOrEqual(120);
        });
        expect(words[0]?.text).toBe('10/01/2026');
        const phone = words.find((w) => w.text.startsWith('555-'))?.text ?? '';
        expect(phone).toMatch(/^555-01\d\d$/);
        // Ink exists and none of it is at or below y=120.
        expect(inkPixels(page).length).toBeGreaterThan(0);
        expect(inkPixels(page).every(([, y]) => y < 120)).toBe(true);
      }),
      { numRuns: 20 },
    );
  });
});

describe('placeStamp', () => {
  const cases: Array<[TemplateName, Box[]]> = [
    ['typed-form', templateBoxes('typed-form', 42)],
    ['table-form', templateBoxes('table-form', 42)],
  ];

  for (const [name, boxes] of cases) {
    it(`keeps MIN_CLEARANCE from every value box on ${name}`, () => {
      for (let seed = 0; seed < 10; seed++) {
        const page = new Page(PAGE_WIDTH, PAGE_HEIGHT);
        const stamp = placeStamp(page, font, createRng(seed), boxes, { firstWordIndex: 50 });
        expect(stamp).not.toBeNull();
        if (!stamp) continue;
        const p = stamp.box;
        const padded: Box = [
          p[0] - MIN_CLEARANCE,
          p[1] - MIN_CLEARANCE,
          p[2] + MIN_CLEARANCE,
          p[3] + MIN_CLEARANCE,
        ];
        for (const b of boxes) expect(intersects(padded, b)).toBe(false);
        expect(stamp.words.map((w) => w.text)).toEqual(['RECEIVED', '10/01/2026']);
        expect(stamp.words.map((w) => w.id)).toEqual(['w0050', 'w0051']);
        for (const w of stamp.words) expect(intersects(w.box, p)).toBe(true);
      }
    });
  }

  it('returns null and draws nothing when avoid covers every candidate', () => {
    const page = new Page(PAGE_WIDTH, PAGE_HEIGHT);
    const stamp = placeStamp(page, font, createRng(1), [[0, 0, PAGE_WIDTH, PAGE_HEIGHT]], {
      firstWordIndex: 1,
    });
    expect(stamp).toBeNull();
    expect(page.data.every((v) => v === 0)).toBe(true);
  });
});

describe('addSpeckle', () => {
  const protect: Box[] = [
    [50, 50, 150, 90],
    [200, 150, 380, 200],
  ];

  it('adds no ink inside padded protect boxes and counts close to density * area', () => {
    const page = new Page(W, H);
    const density = 0.01;
    const count = addSpeckle(page, createRng(7), density, protect);
    const target = density * W * H;
    expect(count).toBeLessThanOrEqual(target);
    expect(count).toBeGreaterThan(target * 0.85);
    const padded = protect.map((b): Box => [b[0] - 4, b[1] - 4, b[2] + 4, b[3] + 4]);
    for (const p of inkPixels(page)) for (const b of padded) expect(insideBox(p, b)).toBe(false);
  });

  it('places exactly the target count with nothing protected', () => {
    const page = new Page(W, H);
    expect(addSpeckle(page, createRng(3), 0.005, [])).toBe(600);
  });

  it('is deterministic for a seed', () => {
    const a = new Page(W, H);
    const b = new Page(W, H);
    addSpeckle(a, createRng(11), 0.01, protect);
    addSpeckle(b, createRng(11), 0.01, protect);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
  });
});

describe('addStreaks', () => {
  const protect: Box[] = [
    [30, 40, 370, 100],
    [30, 180, 370, 230],
  ];

  it('never touches rows near protect boxes', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }), (seed) => {
        const page = new Page(W, H);
        page.fillRect(30, 40, 340, 60);
        page.fillRect(30, 180, 340, 50);
        const before = Uint8Array.from(page.data);
        const streaks = addStreaks(page, createRng(seed), 8, protect);
        expect(streaks.length).toBeGreaterThan(0);
        for (const s of streaks) {
          expect(s.height).toBeGreaterThanOrEqual(1);
          expect(s.height).toBeLessThanOrEqual(4);
          for (const b of protect) {
            expect(intersects([0, s.y, W, s.y + s.height], [0, b[1] - MIN_CLEARANCE, W, b[3] + MIN_CLEARANCE])).toBe(false);
          }
        }
        // Protect boxes themselves are untouched.
        let changed = 0;
        for (const b of protect) {
          for (let y = b[1]; y < b[3]; y++) {
            for (let x = b[0]; x < b[2]; x++) {
              if (page.data[y * W + x] !== before[y * W + x]) changed++;
            }
          }
        }
        expect(changed).toBe(0);
      }),
      { numRuns: 30 },
    );
  });

  it('is deterministic for a seed', () => {
    const a = new Page(W, H);
    const b = new Page(W, H);
    const sa = addStreaks(a, createRng(9), 5, protect);
    const sb = addStreaks(b, createRng(9), 5, protect);
    expect(sa).toEqual(sb);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
  });
});

describe('presets and skew', () => {
  it('pickSkew stays within range and rounds to 0.01', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100000 }), fc.constantFrom(1, 3), (seed, max) => {
        const a = pickSkew(createRng(seed), max);
        expect(Math.abs(a)).toBeLessThanOrEqual(max);
        expect(Math.abs(a * 100 - Math.round(a * 100))).toBeLessThan(1e-6);
        expect(Object.is(a, -0)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('L2 is rougher than L1', () => {
    expect(LEVEL_PRESETS.L2.maxSkewDeg).toBeGreaterThan(LEVEL_PRESETS.L1.maxSkewDeg);
    expect(LEVEL_PRESETS.L2.speckleDensity).toBeGreaterThan(LEVEL_PRESETS.L1.speckleDensity);
    expect(LEVEL_PRESETS.L1.streaks).toEqual([0, 0]);
    expect(LEVEL_PRESETS.L2.streaks).toEqual([3, 5]);
  });
});

describe('determinism', () => {
  it('header + stamp + rotate + speckle + streaks is byte-identical for a seed', () => {
    const referral = generateReferral(createRng(42), { trap: null, referenceDate: REFERENCE_DATE });
    const build = (seed: number): Uint8Array => {
      const rng = createRng(seed);
      const page = new Page(PAGE_WIDTH, PAGE_HEIGHT);
      const tpl = drawTemplate(page, font, 'typed-form', referral);
      const header = drawFaxHeader(page, font, rng, { firstWordIndex: tpl.words.length + 1 });
      const stamp = placeStamp(page, font, rng, tpl.valueBoxes, {
        firstWordIndex: tpl.words.length + 1 + header.length,
      });
      expect(stamp).not.toBeNull();
      const preset = LEVEL_PRESETS.L2;
      const rotated = rotatePage(page, pickSkew(rng, preset.maxSkewDeg));
      const protect = tpl.valueBoxes.map((b) => mapBox(b, 0, PAGE_WIDTH, PAGE_HEIGHT));
      addSpeckle(rotated, rng, preset.speckleDensity, protect);
      addStreaks(rotated, rng, rng.int(preset.streaks[0], preset.streaks[1]), protect);
      return rotated.data;
    };
    const a = build(2026);
    const b = build(2026);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(a.some((v) => v === 1)).toBe(true);
  });
});
