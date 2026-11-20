import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  EDGE_INSET,
  imageToScreen,
  sourceString,
  type Point,
  type Rect,
  type SourceStringInput,
} from './source-string';

const viewport = { width: 1360, height: 800 };
const BAND = 100;
const stage: Rect = { x: 40, y: 120, width: 600, height: 900 }; // runs below the viewport
const card: Rect = { x: 700, y: 300, width: 400, height: 100 };
const target: Rect = { x: 200, y: 400, width: 80, height: 20 };

const input = (over: Partial<SourceStringInput> = {}): SourceStringInput => ({
  card,
  target,
  stage,
  viewport,
  bandBottom: BAND,
  ...over,
});

function parsePath(path: string): { start: Point; c1: Point; c2: Point; end: Point } {
  const m = /^M (\S+) (\S+) C (\S+) (\S+) (\S+) (\S+) (\S+) (\S+)$/.exec(path);
  if (!m) throw new Error(`unexpected path: ${path}`);
  const n = m.slice(1).map(Number) as number[];
  return { start: { x: n[0]!, y: n[1]! }, c1: { x: n[2]!, y: n[3]! }, c2: { x: n[4]!, y: n[5]! }, end: { x: n[6]!, y: n[7]! } };
}

describe('sourceString endpoints', () => {
  it('starts on the card edge that faces the fax and ends on the target edge that faces the card', () => {
    const s = sourceString(input())!;
    expect(s.clamped).toBe(false);
    expect(s.marker).toBeNull();
    // Fax is to the left: start on the card's left edge, vertical middle.
    expect(s.start).toEqual({ x: 700, y: 350 });
    // End on the target's right edge (the edge facing the card), vertical middle.
    expect(s.end).toEqual({ x: 280, y: 410 });
  });

  it('mirrors when the target is to the right of the card', () => {
    const right: Rect = { x: 500, y: 420, width: 60, height: 20 };
    const s = sourceString(input({ card: { x: 100, y: 300, width: 300, height: 100 }, target: right, stage: { x: 40, y: 120, width: 700, height: 600 } }))!;
    expect(s.start).toEqual({ x: 400, y: 350 });
    expect(s.end).toEqual({ x: 500, y: 430 });
    expect(s.clamped).toBe(false);
  });

  it('returns a path that starts and ends at the returned points, with the returned control points', () => {
    const s = sourceString(input())!;
    const p = parsePath(s.path);
    expect(p.start).toEqual(s.start);
    expect(p.end).toEqual(s.end);
    expect([p.c1, p.c2]).toEqual(s.controls);
  });
});

describe('sourceString clamping', () => {
  const visibleStage = { left: 40, top: BAND + 20, right: 640, bottom: viewport.height };

  it('ends on the visible stage edge, with a marker, when the words are above the visible stage', () => {
    const s = sourceString(input({ target: { x: 200, y: 50, width: 80, height: 20 } }))!;
    expect(s.clamped).toBe(true);
    expect(s.end).toEqual({ x: 280, y: visibleStage.top + EDGE_INSET });
    expect(s.marker).toMatch(/^M .+ L .+ L .+$/);
  });

  it('ends on the bottom edge when the words are below the viewport', () => {
    const s = sourceString(input({ target: { x: 200, y: 1200, width: 80, height: 20 } }))!;
    expect(s.clamped).toBe(true);
    expect(s.end.y).toBe(visibleStage.bottom - EDGE_INSET);
    expect(s.end.x).toBe(280);
  });

  it('ends on the left edge when the words are left of the stage', () => {
    const s = sourceString(input({ target: { x: -300, y: 400, width: 80, height: 20 } }))!;
    expect(s.clamped).toBe(true);
    expect(s.end).toEqual({ x: visibleStage.left + EDGE_INSET, y: 410 });
  });

  it('ends on the right edge when the words are right of the stage', () => {
    const s = sourceString(input({ target: { x: 900, y: 400, width: 80, height: 20 } }))!;
    expect(s.clamped).toBe(true);
    expect(s.end).toEqual({ x: visibleStage.right - EDGE_INSET, y: 410 });
  });
});

describe('sourceString forbidden band and null cases', () => {
  it('draws nothing above the band', () => {
    // Card partly under the bar: the string starts in its visible part. Target is under the bar too.
    const s = sourceString(input({ card: { x: 700, y: 60, width: 400, height: 100 }, target: { x: 200, y: 30, width: 80, height: 20 } }))!;
    const p = parsePath(s.path);
    for (const pt of [p.start, p.c1, p.c2, p.end, ...s.controls]) expect(pt.y).toBeGreaterThanOrEqual(BAND);
    expect(s.start.y).toBeGreaterThanOrEqual(BAND);
  });

  it('hides the string when the card is under the bar', () => {
    expect(sourceString(input({ card: { x: 700, y: 20, width: 400, height: 60 } }))).toBeNull();
  });

  it('returns null with no target, a zero-size rectangle, or no viewport', () => {
    expect(sourceString(input({ target: null }))).toBeNull();
    expect(sourceString(input({ target: { x: 200, y: 400, width: 0, height: 20 } }))).toBeNull();
    expect(sourceString(input({ card: { x: 700, y: 300, width: 400, height: 0 } }))).toBeNull();
    expect(sourceString(input({ stage: { x: 40, y: 120, width: 0, height: 0 } }))).toBeNull();
    expect(sourceString(input({ viewport: { width: 0, height: 800 } }))).toBeNull();
    expect(sourceString(input({ bandBottom: Number.NaN }))).toBeNull();
  });

  it('returns null when the card is off screen or the stage is entirely hidden', () => {
    expect(sourceString(input({ card: { x: 700, y: 900, width: 400, height: 100 } }))).toBeNull();
    expect(sourceString(input({ stage: { x: 40, y: 10, width: 600, height: 60 } }))).toBeNull();
  });
});

describe('sourceString property', () => {
  const rect = (maxW: number, maxH: number) =>
    fc.record({
      x: fc.integer({ min: -300, max: 1700 }),
      y: fc.integer({ min: -300, max: 1300 }),
      width: fc.integer({ min: 0, max: maxW }),
      height: fc.integer({ min: 0, max: maxH }),
    });

  it('every returned point lies inside the viewport and below the band', () => {
    fc.assert(
      fc.property(
        rect(600, 400),
        rect(300, 100),
        rect(900, 1400),
        fc.record({ width: fc.integer({ min: 0, max: 1800 }), height: fc.integer({ min: 0, max: 1200 }) }),
        fc.integer({ min: -50, max: 1300 }),
        (c, t, st, vp, band) => {
          const s = sourceString({ card: c, target: t, stage: st, viewport: vp, bandBottom: band });
          if (!s) return;
          const top = Math.max(0, band);
          const points = [s.start, s.end, ...s.controls];
          for (const p of points) {
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.x).toBeLessThanOrEqual(vp.width);
            expect(p.y).toBeGreaterThanOrEqual(top);
            expect(p.y).toBeLessThanOrEqual(vp.height);
          }
          const parsed = parsePath(s.path);
          expect([parsed.start, parsed.end]).toEqual([s.start, s.end]);
          expect(s.marker !== null).toBe(s.clamped);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('imageToScreen', () => {
  it('scales and offsets with xMidYMid meet', () => {
    const viewBox: Rect = { x: 100, y: 200, width: 400, height: 200 };
    // 400x200 shown in 800x600: scale 2, 200px of letterbox above and below.
    const svg: Rect = { x: 10, y: 20, width: 800, height: 600 };
    expect(imageToScreen({ x: 150, y: 250, width: 50, height: 10 }, viewBox, svg)).toEqual({
      x: 10 + 100,
      y: 20 + 100 + 100,
      width: 100,
      height: 20,
    });
    expect(imageToScreen({ x: 0, y: 0, width: 1, height: 1 }, viewBox, { x: 0, y: 0, width: 0, height: 0 })).toBeNull();
  });
});
