import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { findLabels } from '../src/extract/labels.js';
import { extractWithDetails } from '../src/extract/rules.js';
import { ExtractionResultSchema, FIELD_ORDER } from '../src/extract/schema.js';
import type { FieldName } from '../src/extract/schema.js';
import { build, tableSpecs, typedSpecs } from './page-helpers.js';

/** Random printable ASCII token (no spaces), 1 to 12 characters. Includes ~ - . : and friends. */
const token = fc
  .array(fc.integer({ min: 33, max: 126 }).map((c) => String.fromCharCode(c)), { minLength: 1, maxLength: 12 })
  .map((chars) => chars.join(''));

const valueLines = fc.array(fc.array(token, { minLength: 1, maxLength: 3 }), { minLength: 0, maxLength: 2 });

const pageArb = (layout: 'typed' | 'table') =>
  fc.record({
    values: fc.tuple(...FIELD_ORDER.map(() => valueLines)),
    skipped: fc.subarray([...FIELD_ORDER], { maxLength: 2 }),
    skew: fc.oneof(fc.constant(0), fc.double({ min: -3, max: 3, noNaN: true })),
    confidences: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 12 }),
    layout: fc.constant(layout),
  });

describe('never invents a value', () => {
  it.each(['typed', 'table'] as const)('%s pages: every value is exactly its cited words', (layout) => {
    fc.assert(
      fc.property(pageArb(layout), (p) => {
        const value = Object.fromEntries(FIELD_ORDER.map((n, i) => [n, p.values[i] ?? []])) as Record<
          FieldName,
          string[][]
        >;
        const options = { value, skip: p.skipped };
        const specs = layout === 'typed' ? typedSpecs(options) : tableSpecs(options);
        const ocr = build(specs, p.skew);
        ocr.words.forEach((w, i) => {
          w.confidence = p.confidences[i % p.confidences.length] ?? 0.5;
        });

        const { result } = extractWithDetails(ocr);
        expect(ExtractionResultSchema.safeParse(result).success).toBe(true);

        const byId = new Map(ocr.words.map((w) => [w.id, w]));
        const labelIds = new Set(
          findLabels(ocr.words).flatMap((f) => f.matches.flatMap((m) => m.wordIds)),
        );
        for (const f of result.fields) {
          if (f.value === null) {
            expect(f.wordIds).toEqual([]);
            expect(f.flags.length).toBeGreaterThan(0);
            continue;
          }
          const cited = f.wordIds.map((id) => byId.get(id));
          expect(cited.every((w) => w !== undefined)).toBe(true);
          const texts = cited.map((w) => w?.text ?? '');
          expect(new Set(f.wordIds).size).toBe(f.wordIds.length);
          expect(f.wordIds.some((id) => labelIds.has(id))).toBe(false);
          expect(f.value).toBe(texts.join(' '));
          for (const piece of f.value.split(' ')) expect(texts).toContain(piece);
          expect(f.confidence).toBe(Math.min(...cited.map((w) => w?.confidence ?? 0)));
        }
      }),
      { numRuns: 100 },
    );
  });
});
