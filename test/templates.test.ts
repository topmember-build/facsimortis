import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRng } from '../src/generator/prng.js';
import { REFERENCE_DATE, generateReferral } from '../src/generator/data.js';
import type { Referral } from '../src/generator/data.js';
import { loadSpleen } from '../src/generator/font.js';
import { Page } from '../src/generator/raster.js';
import {
  DEFAULT_TOP,
  FIELD_NAMES,
  MIN_CLEARANCE,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  drawTemplate,
} from '../src/generator/templates.js';
import type { TemplateName, TemplateResult } from '../src/generator/templates.js';

const font = loadSpleen();
const TEMPLATES: TemplateName[] = ['typed-form', 'table-form'];

function referralFor(seed: number): Referral {
  return generateReferral(createRng(seed), { trap: null, referenceDate: REFERENCE_DATE });
}

function draw(template: TemplateName, referral: Referral, options?: { firstWordIndex?: number; top?: number }) {
  const page = new Page(PAGE_WIDTH, PAGE_HEIGHT);
  const result = drawTemplate(page, font, template, referral, options);
  return { page, result };
}

/** Citation property: ids exist and joined texts equal the value exactly. */
function expectCitations(result: TemplateResult, referral: Referral): void {
  const byId = new Map(result.words.map((w) => [w.id, w]));
  for (const field of FIELD_NAMES) {
    const ids = result.fieldWordIds[field];
    expect(ids.length, field).toBeGreaterThan(0);
    const texts = ids.map((id) => {
      const w = byId.get(id);
      expect(w, `${field} cites ${id}`).toBeDefined();
      return w?.text ?? '';
    });
    expect(texts.join(' '), field).toBe(referral[field]);
  }
}

function expectBoxesInside(result: TemplateResult, top: number): void {
  for (const w of result.words) {
    const [x0, y0, x1, y1] = w.box;
    expect(x0).toBeGreaterThanOrEqual(0);
    expect(x1).toBeLessThanOrEqual(PAGE_WIDTH);
    expect(y0).toBeGreaterThanOrEqual(top);
    expect(y1).toBeLessThanOrEqual(PAGE_HEIGHT);
  }
  for (const [x0, y0, x1, y1] of result.valueBoxes) {
    expect(x0).toBeGreaterThanOrEqual(0);
    expect(x1).toBeLessThanOrEqual(PAGE_WIDTH);
    expect(y0).toBeGreaterThanOrEqual(top);
    expect(y1).toBeLessThanOrEqual(PAGE_HEIGHT);
  }
}

describe.each(TEMPLATES)('%s', (template) => {
  const referral = referralFor(42);

  it('cites existing words whose text equals each value', () => {
    const { result } = draw(template, referral);
    expectCitations(result, referral);
  });

  it('has unique, sequential IDs and boxes inside the page below top', () => {
    const { result } = draw(template, referral);
    result.words.forEach((w, i) => expect(w.id).toBe(`w${String(i + 1).padStart(4, '0')}`));
    expect(new Set(result.words.map((w) => w.id)).size).toBe(result.words.length);
    expectBoxesInside(result, DEFAULT_TOP);
  });

  it('honours firstWordIndex and top', () => {
    const { result } = draw(template, referral, { firstWordIndex: 7, top: 200 });
    expect(result.words[0]?.id).toBe('w0007');
    expectBoxesInside(result, 200);
    expectCitations(result, referral);
  });

  it('does not cite label words', () => {
    const { result } = draw(template, referral);
    const cited = new Set(FIELD_NAMES.flatMap((f) => result.fieldWordIds[f]));
    const labels = result.words.filter((w) => w.text.endsWith(':'));
    expect(labels.length).toBeGreaterThanOrEqual(FIELD_NAMES.length);
    for (const l of labels) expect(cited.has(l.id)).toBe(false);
    expect(result.valueBoxes.length).toBe(cited.size);
  });

  it('records the synthetic data notice as words', () => {
    const { result } = draw(template, referral);
    const text = result.words.map((w) => w.text).join(' ');
    expect(text).toContain('SYNTHETIC DATA - NOT A REAL PATIENT');
  });

  it('keeps ruled lines and borders at least 16 px from value boxes', () => {
    // Ink that is not inside any recorded word box is a rule or border. Within
    // MIN_CLEARANCE - 1 px of each value box, there must be no such ink.
    const { page, result } = draw(template, referral);
    const pad = MIN_CLEARANCE - 1;
    const inWord = (x: number, y: number) =>
      result.words.some(({ box: [x0, y0, x1, y1] }) => x >= x0 && x < x1 && y >= y0 && y < y1);
    for (const [x0, y0, x1, y1] of result.valueBoxes) {
      for (let y = y0 - pad; y < y1 + pad; y++) {
        for (let x = x0 - pad; x < x1 + pad; x++) {
          if (page.getPixel(x, y) === 1) expect(inWord(x, y), `rule ink at ${x},${y}`).toBe(true);
        }
      }
    }
  });

  it('satisfies the citation property for random seeds (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
        const r = referralFor(seed);
        const { result } = draw(template, r);
        expectCitations(result, r);
        expectBoxesInside(result, DEFAULT_TOP);
      }),
      { numRuns: 25 },
    );
  });

  it('wraps long values at word boundaries without splitting words', () => {
    const long: Referral = {
      ...referral,
      reason: 'orthopedic evaluation and follow-up for persistent knee pain after a long fall at home last winter',
    };
    const { result } = draw(template, long);
    expectCitations(result, long);
    const ys = new Set(result.fieldWordIds.reason.map((id) => result.words.find((w) => w.id === id)?.box[1]));
    expect(ys.size).toBeGreaterThan(1);
  });

  it('throws a clear error when a single word cannot fit', () => {
    const bad: Referral = { ...referral, reason: 'x'.repeat(200) };
    expect(() => draw(template, bad)).toThrow(/reason/);
  });
});
