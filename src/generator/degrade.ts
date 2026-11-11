/**
 * Fax degradation operations. Each one is a pure function of its arguments: the
 * only side effect is drawing into the Page you pass in, and the only randomness
 * comes from the Rng argument. Synthetic data only.
 *
 * Rotation convention (used by mapBox and rotatePage): angles are in degrees and
 * positive means counter-clockwise as seen on screen (y axis points down), about
 * the page centre (width / 2, height / 2). A point to the right of the centre
 * moves up the screen for a positive angle.
 */
import { CELL_H, CELL_W } from './font.js';
import type { BitmapFont } from './font.js';
import { REFERENCE_DATE } from './data.js';
import type { Rng } from './prng.js';
import { Page, drawText } from './raster.js';
import type { Box } from './raster.js';
import { MIN_CLEARANCE } from './templates.js';
import type { Word } from './templates.js';

export interface WordOptions {
  firstWordIndex: number;
}

/** Padding applied around protected boxes before speckle is allowed (pixels). */
export const SPECKLE_PROTECT_PAD = 4;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** '2026-10-01' -> '10/01/2026'. */
function usDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error('date must be YYYY-MM-DD');
  return `${m[2]}/${m[3]}/${m[1]}`;
}

function wordId(index: number): string {
  return `w${String(index).padStart(4, '0')}`;
}

function drawWords(
  page: Page,
  font: BitmapFont,
  text: string,
  x: number,
  y: number,
  scale: number,
  nextIndex: number,
): Word[] {
  return drawText(page, font, text, x, y, scale).map((wb, i) => ({
    id: wordId(nextIndex + i),
    text: wb.text,
    box: wb.box,
  }));
}

/**
 * Fax header line, scale 1, at (40, 40): inside y < 120 so it never touches the
 * template. Draw it BEFORE rotation so it skews with the page.
 * Text: "10/01/2026 09:14 FROM: 555-01NN Page 1/1" (time and NN from rng).
 */
export function drawFaxHeader(
  page: Page,
  font: BitmapFont,
  rng: Rng,
  options: WordOptions,
): Word[] {
  const time = `${pad2(rng.int(6, 18))}:${pad2(rng.int(0, 59))}`;
  const phone = `555-01${pad2(rng.int(0, 99))}`;
  const text = `${usDate(REFERENCE_DATE)} ${time} FROM: ${phone} Page 1/1`;
  return drawWords(page, font, text, 40, 40, 1, options.firstWordIndex);
}

function intersects(a: Box, b: Box): boolean {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

function padBox(box: Box, px: number, py: number): Box {
  return [box[0] - px, box[1] - py, box[2] + px, box[3] + py];
}

const STAMP_BORDER = 4;
const STAMP_PAD = 16;
const STAMP_TITLE = 'RECEIVED';
const STAMP_TITLE_SCALE = 2;
const STAMP_GAP = 8;
const STAMP_W = STAMP_TITLE.length * CELL_W * STAMP_TITLE_SCALE + 2 * (STAMP_PAD + STAMP_BORDER);
const STAMP_H =
  CELL_H * STAMP_TITLE_SCALE + STAMP_GAP + CELL_H + 2 * (STAMP_PAD + STAMP_BORDER);

/**
 * Fixed stamp candidates (top-left corners) on a 1728x2200 page: top right, three
 * in the empty lower page, and two mid-page right/left spots. Tried in an
 * rng-shuffled order; the first whose box padded by MIN_CLEARANCE misses every
 * `avoid` box wins. Candidates that do not fit on the page are skipped.
 */
export const STAMP_CANDIDATES: ReadonlyArray<readonly [x: number, y: number]> = [
  [1340, 140],
  [1340, 1900],
  [100, 1900],
  [720, 1960],
  [1340, 1500],
  [100, 1500],
];

/**
 * Axis-aligned "RECEIVED" stamp (rectangle outline 4 px thick, title at scale 2,
 * date line at scale 1). Draw BEFORE rotation. Returns null when no candidate
 * clears `avoid`; the caller decides what to do.
 */
export function placeStamp(
  page: Page,
  font: BitmapFont,
  rng: Rng,
  avoid: readonly Box[],
  options: WordOptions,
): { box: Box; words: Word[] } | null {
  const order = STAMP_CANDIDATES.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const a = order[i] as (typeof order)[number];
    order[i] = order[j] as (typeof order)[number];
    order[j] = a;
  }
  for (const [x, y] of order) {
    const box: Box = [x, y, x + STAMP_W, y + STAMP_H];
    if (box[2] > page.width || box[3] > page.height) continue;
    const padded = padBox(box, MIN_CLEARANCE, MIN_CLEARANCE);
    if (avoid.some((a) => intersects(padded, a))) continue;

    page.strokeRect(x, y, STAMP_W, STAMP_H, STAMP_BORDER);
    const inner = STAMP_BORDER + STAMP_PAD;
    const titleWords = drawWords(
      page,
      font,
      STAMP_TITLE,
      x + inner,
      y + inner,
      STAMP_TITLE_SCALE,
      options.firstWordIndex,
    );
    const dateWords = drawWords(
      page,
      font,
      usDate(REFERENCE_DATE),
      x + inner,
      y + inner + CELL_H * STAMP_TITLE_SCALE + STAMP_GAP,
      1,
      options.firstWordIndex + titleWords.length,
    );
    return { box, words: [...titleWords, ...dateWords] };
  }
  return null;
}

/** Inverse of the rotation: returns [cos, sin] for the angle (positive = CCW on screen). */
function rotationTerms(angleDeg: number): [number, number] {
  const r = (angleDeg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

/**
 * Bounding box of `box` after rotating the page by angleDeg (positive = CCW on
 * screen) about (width / 2, height / 2): rotate the 4 corners, take floor of the
 * minimum and ceil of the maximum, clamp to the page.
 */
export function mapBox(box: Box, angleDeg: number, width: number, height: number): Box {
  const [c, s] = rotationTerms(angleDeg);
  const cx = width / 2;
  const cy = height / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const corners: ReadonlyArray<readonly [number, number]> = [
    [box[0], box[1]],
    [box[2], box[1]],
    [box[0], box[3]],
    [box[2], box[3]],
  ];
  for (const [px, py] of corners) {
    const dx = px - cx;
    const dy = py - cy;
    const rx = cx + dx * c + dy * s;
    const ry = cy - dx * s + dy * c;
    minX = Math.min(minX, rx);
    maxX = Math.max(maxX, rx);
    minY = Math.min(minY, ry);
    maxY = Math.max(maxY, ry);
  }
  const clampX = (v: number): number => Math.min(width, Math.max(0, v));
  const clampY = (v: number): number => Math.min(height, Math.max(0, v));
  // Every edge is clamped, so a box rotated fully off the page collapses to an
  // empty box on the page edge instead of an inverted one.
  return [clampX(Math.floor(minX)), clampY(Math.floor(minY)), clampX(Math.ceil(maxX)), clampY(Math.ceil(maxY))];
}

/**
 * New white page of the same size holding `page` rotated by angleDeg (same
 * convention as mapBox). Nearest-neighbour: each destination pixel centre is
 * inverse-rotated into the source and the pixel containing it is copied.
 */
export function rotatePage(page: Page, angleDeg: number): Page {
  const out = new Page(page.width, page.height);
  const [c, s] = rotationTerms(angleDeg);
  const cx = page.width / 2;
  const cy = page.height / 2;
  for (let y = 0; y < page.height; y++) {
    for (let x = 0; x < page.width; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const sx = Math.floor(cx + dx * c - dy * s);
      const sy = Math.floor(cy + dx * s + dy * c);
      if (page.getPixel(sx, sy) === 1) out.data[y * page.width + x] = 1;
    }
  }
  return out;
}

function inAnyPadded(x: number, y: number, boxes: readonly Box[], pad: number): boolean {
  for (const b of boxes) {
    if (x >= b[0] - pad && x < b[2] + pad && y >= b[1] - pad && y < b[3] + pad) return true;
  }
  return false;
}

/**
 * Set about density * width * height random single pixels to ink, never inside a
 * protect box padded by 4 px. Returns the number of pixels set (draws that land
 * in a protected zone are skipped, not retried).
 */
export function addSpeckle(
  page: Page,
  rng: Rng,
  density: number,
  protect: readonly Box[],
): number {
  const target = Math.round(density * page.width * page.height);
  let placed = 0;
  for (let i = 0; i < target; i++) {
    const x = rng.int(0, page.width - 1);
    const y = rng.int(0, page.height - 1);
    if (inAnyPadded(x, y, protect, SPECKLE_PROTECT_PAD)) continue;
    page.setPixel(x, y, 1);
    placed++;
  }
  return placed;
}

export interface Streak {
  y: number;
  height: number;
  kind: 'line' | 'dropout';
}

/**
 * Full-width horizontal streaks: 1-2 px ink lines or 2-4 px white dropout bands.
 * A streak only lands on rows [y, y + height) that miss every protect box padded
 * by MIN_CLEARANCE vertically. Up to 20 placements are tried per streak; a streak
 * that cannot be placed is dropped. Returns what was drawn.
 */
export function addStreaks(
  page: Page,
  rng: Rng,
  count: number,
  protect: readonly Box[],
): Streak[] {
  const drawn: Streak[] = [];
  for (let i = 0; i < count; i++) {
    const kind: Streak['kind'] = rng.next() < 0.5 ? 'line' : 'dropout';
    const height = kind === 'line' ? rng.int(1, 2) : rng.int(2, 4);
    for (let attempt = 0; attempt < 20; attempt++) {
      const y = rng.int(0, page.height - height);
      const clear = protect.every(
        (b) => y + height <= b[1] - MIN_CLEARANCE || y >= b[3] + MIN_CLEARANCE,
      );
      if (!clear) continue;
      page.fillRect(0, y, page.width, height, kind === 'line' ? 1 : 0);
      drawn.push({ y, height, kind });
      break;
    }
  }
  return drawn;
}

export interface LevelPreset {
  /** Skew is drawn uniformly from [-maxSkewDeg, +maxSkewDeg]. */
  maxSkewDeg: number;
  /** Fraction of page pixels turned to speckle. */
  speckleDensity: number;
  /** Inclusive [min, max] number of streaks to attempt. */
  streaks: readonly [min: number, max: number];
}

/**
 * L1: mild. Up to 1 degree of skew, 0.05% speckle, no streaks.
 * L2: rough. Up to 3 degrees of skew, 0.2% speckle, 3 to 5 streaks.
 */
export const LEVEL_PRESETS = {
  L1: { maxSkewDeg: 1, speckleDensity: 0.0005, streaks: [0, 0] },
  L2: { maxSkewDeg: 3, speckleDensity: 0.002, streaks: [3, 5] },
} as const satisfies Record<string, LevelPreset>;

/** Random skew in [-maxSkewDeg, maxSkewDeg], rounded to 0.01 degree (never -0). */
export function pickSkew(rng: Rng, maxSkewDeg: number): number {
  const r = Math.round((rng.next() * 2 - 1) * maxSkewDeg * 100) / 100;
  return r === 0 ? 0 : r;
}
