import { describe, expect, it } from 'vitest';
import { SampleFaxSchema, type SampleWord } from '../../src/samples/schema.js';
import { ghostRects } from './ghost';
import { committedFaxes } from './test-site';

const words: SampleWord[] = [
  { id: 'o1', text: 'a', box: [10, 20, 40, 50], confidence: 0.9 },
  { id: 'o2', text: 'b', box: [100, 200, 130, 260], confidence: 0.9 },
];

describe('ghostRects', () => {
  it('converts [x0, y0, x1, y1] boxes to x, y, width, height in citation order', () => {
    expect(ghostRects({ wordIds: ['o2', 'o1'] }, words)).toEqual([
      { id: 'o2', x: 100, y: 200, width: 30, height: 60 },
      { id: 'o1', x: 10, y: 20, width: 30, height: 30 },
    ]);
  });

  it('skips unknown IDs without throwing', () => {
    expect(ghostRects({ wordIds: ['nope', 'o1', 'o9'] }, words)).toEqual([
      { id: 'o1', x: 10, y: 20, width: 30, height: 30 },
    ]);
    expect(ghostRects({ wordIds: ['nope'] }, [])).toEqual([]);
  });

  it('gives no ghost for no field or no words', () => {
    expect(ghostRects(null, words)).toEqual([]);
    expect(ghostRects(undefined, words)).toEqual([]);
    expect(ghostRects({ wordIds: [] }, words)).toEqual([]);
  });

  it('matches the cited word boxes for every field of every committed fax and both readers', () => {
    for (const data of Object.values(committedFaxes)) {
      const fax = SampleFaxSchema.parse(data);
      for (const reader of ['model', 'rules'] as const) {
        const result = fax.readers[reader];
        if (result.status !== 'ok') continue;
        for (const field of result.fields) {
          const expected = field.wordIds.map((id) => {
            const word = fax.ocr.words.find((w) => w.id === id)!;
            const [x0, y0, x1, y1] = word.box;
            return { id, x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
          });
          expect(ghostRects(field, fax.ocr.words)).toEqual(expected);
          expect(expected).toHaveLength(field.wordIds.length);
        }
      }
    }
  });
});
