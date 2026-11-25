import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { faxScreenArea, ghostScrollOptions, isFullyVisible, isWideLayout, scrollGhostIntoView, type VisibleArea } from './ghost-scroll';
import { WIDE_LAYOUT_QUERY } from './source-string';

const AREA: VisibleArea = { top: 100, left: 0, bottom: 800, right: 1360 };

function rectOf(left: number, top: number, width: number, height: number) {
  return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
}

/** A stand-in element with a fixed rectangle and a scrollIntoView spy. */
function target(rect: DOMRect) {
  const scrollIntoView = vi.fn();
  return { el: { getBoundingClientRect: () => rect, scrollIntoView } as unknown as Element, scrollIntoView };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isFullyVisible', () => {
  it('is true only when all four edges are inside the area (an edge on the line counts as inside)', () => {
    expect(isFullyVisible(rectOf(10, 100, 50, 20), AREA)).toBe(true);
    expect(isFullyVisible(rectOf(10, 780, 50, 20), AREA)).toBe(true);
    expect(isFullyVisible(rectOf(10, 99, 50, 20), AREA)).toBe(false);
    expect(isFullyVisible(rectOf(10, 781, 50, 20), AREA)).toBe(false);
    expect(isFullyVisible(rectOf(-1, 200, 50, 20), AREA)).toBe(false);
    expect(isFullyVisible(rectOf(1311, 200, 50, 20), AREA)).toBe(false);
  });

  it('agrees with a direct edge check for any rectangle', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -2000, max: 2000 }),
        fc.integer({ min: -2000, max: 2000 }),
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 0, max: 400 }),
        (left, top, width, height) => {
          const inside = top >= AREA.top && left >= AREA.left && top + height <= AREA.bottom && left + width <= AREA.right;
          expect(isFullyVisible(rectOf(left, top, width, height), AREA)).toBe(inside);
        },
      ),
    );
  });
});

describe('scrollGhostIntoView', () => {
  it('scrolls a ghost that is off screen, to the nearest edge and smoothly', () => {
    const { el, scrollIntoView } = target(rectOf(40, -300, 80, 12));
    expect(scrollGhostIntoView(el, AREA, false)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  });

  it('scrolls a ghost that is only partly visible, or hidden under the summary bar', () => {
    for (const rect of [rectOf(40, 795, 80, 12), rectOf(40, 90, 80, 12)]) {
      const { el, scrollIntoView } = target(rect);
      expect(scrollGhostIntoView(el, AREA, false)).toBe(true);
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    }
  });

  it('does not scroll a ghost that is fully visible', () => {
    const { el, scrollIntoView } = target(rectOf(40, 300, 80, 12));
    expect(scrollGhostIntoView(el, AREA, false)).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('scrolls instantly when reduced motion is asked for', () => {
    const { el, scrollIntoView } = target(rectOf(40, 1200, 80, 12));
    expect(scrollGhostIntoView(el, AREA, true)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    expect(ghostScrollOptions(true).behavior).toBe('instant');
    expect(ghostScrollOptions(false).behavior).toBe('smooth');
  });

  it('does nothing, and does not throw, without a target or without scrollIntoView', () => {
    expect(scrollGhostIntoView(null, AREA, false)).toBe(false);
    expect(scrollGhostIntoView(undefined, AREA, false)).toBe(false);
    const bare = { getBoundingClientRect: () => rectOf(0, -500, 10, 10) } as unknown as Element;
    expect(scrollGhostIntoView(bare, AREA, false)).toBe(false);
  });
});

describe('isWideLayout', () => {
  it('asks the same query as the source string, which is the stylesheet\'s 60rem breakpoint', () => {
    const asked: string[] = [];
    vi.stubGlobal('matchMedia', (query: string) => {
      asked.push(query);
      return { matches: true, media: query };
    });
    expect(isWideLayout()).toBe(true);
    expect(asked).toEqual([WIDE_LAYOUT_QUERY]);
    expect(WIDE_LAYOUT_QUERY).toBe('(min-width: 60rem)');
  });

  it('follows the answer: wide when it matches, stacked when it does not', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }));
    expect(isWideLayout()).toBe(false);
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query }));
    expect(isWideLayout()).toBe(true);
  });

  it('counts as wide without matchMedia, like the source string', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(isWideLayout()).toBe(true);
  });
});

describe('faxScreenArea', () => {
  it('is the window below the summary bar', () => {
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('innerHeight', 844);
    const bar = { getBoundingClientRect: () => rectOf(0, 0, 390, 229) } as unknown as Element;
    expect(faxScreenArea(bar)).toEqual({ top: 229, left: 0, bottom: 844, right: 390 });
  });

  it('is the whole window when there is no bar, or the bar has scrolled above the top', () => {
    vi.stubGlobal('innerWidth', 1360);
    vi.stubGlobal('innerHeight', 900);
    expect(faxScreenArea(null)).toEqual({ top: 0, left: 0, bottom: 900, right: 1360 });
    const gone = { getBoundingClientRect: () => rectOf(0, -300, 1360, 120) } as unknown as Element;
    expect(faxScreenArea(gone).top).toBe(0);
  });
});
