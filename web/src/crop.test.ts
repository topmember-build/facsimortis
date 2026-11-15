import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CROP_MARGIN, boxContains, cropBox, fullPageBox, viewBoxAttr, viewerBox } from './crop';

const page = { width: 1000, height: 1400 };
const word = (x0: number, y0: number, x1: number, y1: number) => ({ box: [x0, y0, x1, y1] as [number, number, number, number] });

describe('cropBox', () => {
  it('is the union of the word boxes plus the margin', () => {
    const box = cropBox([word(200, 300, 400, 340), word(250, 500, 700, 560)], page, 40);
    expect(box).toEqual({ x: 160, y: 260, width: 580, height: 340 });
  });

  it('uses a 40 px margin by default', () => {
    expect(CROP_MARGIN).toBe(40);
    expect(cropBox([word(200, 300, 400, 340)], page)).toEqual(cropBox([word(200, 300, 400, 340)], page, 40));
  });

  it('is clamped to the page', () => {
    const box = cropBox([word(10, 5, 980, 1395)], page, 40);
    expect(box).toEqual({ x: 0, y: 0, width: 1000, height: 1400 });
  });

  it('falls back to the full page when there are no words', () => {
    expect(cropBox([], page)).toEqual(fullPageBox(page));
  });

  it('falls back to the full page when no word is on the page', () => {
    expect(cropBox([word(2000, 2000, 2100, 2100)], page, 40)).toEqual(fullPageBox(page));
  });

  it('always contains every word that is on the page and stays inside the page', () => {
    const wordBox = fc
      .tuple(fc.integer({ min: 0, max: 900 }), fc.integer({ min: 0, max: 1300 }), fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 100 }))
      .map(([x, y, w, h]) => word(x, y, x + w, y + h));
    fc.assert(
      fc.property(fc.array(wordBox, { minLength: 1, maxLength: 20 }), (words) => {
        const box = cropBox(words, page);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(page.width);
        expect(box.y + box.height).toBeLessThanOrEqual(page.height);
        const rects = words.map(({ box: [x0, y0, x1, y1] }) => ({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }));
        expect(boxContains(box, rects)).toBe(true);
      }),
    );
  });
});

describe('viewerBox', () => {
  const crop = { x: 100, y: 100, width: 400, height: 400 };

  it('shows the crop when the highlights are inside it', () => {
    expect(viewerBox(crop, page, [{ x: 120, y: 120, width: 50, height: 20 }], false)).toEqual(crop);
    expect(viewerBox(crop, page, [], false)).toEqual(crop);
  });

  it('shows the full page when asked', () => {
    expect(viewerBox(crop, page, [], true)).toEqual(fullPageBox(page));
  });

  it('shows the full page when a highlight falls outside the crop', () => {
    expect(viewerBox(crop, page, [{ x: 480, y: 120, width: 50, height: 20 }], false)).toEqual(fullPageBox(page));
  });
});

it('writes a viewBox attribute', () => {
  expect(viewBoxAttr({ x: 1, y: 2, width: 3, height: 4 })).toBe('1 2 3 4');
});
