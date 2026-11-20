/**
 * The source string: geometry only. Pure functions, no DOM access. The caller reads
 * rectangles from the page and converts them to viewport (screen) coordinates first.
 *
 * Rules (see docs/design-brief.md, "The signature: the source string"):
 * - Target: the FIRST cited word's box (the caller picks it). A single word box is always on real
 *   page text; the union box of a multi-line value would put the end point on blank paper.
 * - Start: the vertical middle of the card edge that faces the target (left edge when the target is
 *   to the left of the card centre, else right edge), kept inside the visible part of the card.
 * - End: the middle of the target box edge that faces the start. If that point is outside the
 *   visible part of the fax sheet, the end is moved to the nearest point of the sheet, inset a few
 *   pixels, `clamped` is true and `marker` is a small chevron pointing towards the hidden words.
 * - Curve: one cubic Bezier with horizontal tangents at both ends (an S shape). Both control points
 *   share the y of their end point and are clamped into the viewport, so by the convex hull
 *   property no point of the curve leaves the viewport or enters the forbidden band.
 * - Forbidden band: everything above `bandBottom` (page header, sticky summary bar). Nothing is
 *   drawn there. A card entirely inside the band gives null.
 */

/** The viewport width at which the two-column layout starts. Keep in step with styles.css (a test checks it). */
export const WIDE_LAYOUT_QUERY = '(min-width: 60rem)';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface SourceStringInput {
  /** The selected card, in viewport coordinates (already clipped to its scroll container by the caller). */
  card: Rect;
  /** The target word box in viewport coordinates, or null when the field cites no words. */
  target: Rect | null | undefined;
  /** The fax sheet in viewport coordinates. The part of it inside the viewport and below the band is the visible stage. */
  stage: Rect;
  viewport: Viewport;
  /** Bottom edge of the page header / sticky summary bar. Nothing is drawn above it. */
  bandBottom: number;
}

export interface SourceStringShape {
  /** SVG path data: one cubic Bezier from `start` to `end`. */
  path: string;
  start: Point;
  end: Point;
  /** The two Bezier control points. */
  controls: [Point, Point];
  /** True when the end was moved to the edge of the visible stage because the words are out of view. */
  clamped: boolean;
  /** Path data for a small chevron at the end, pointing to the hidden words. Null unless clamped. */
  marker: string | null;
}

/** Distance kept between a clamped end and the stage edge, so the marker stays inside it. */
export const EDGE_INSET = 6;
/** Chevron arm length. sqrt(2) * MARKER_SIZE is below EDGE_INSET. */
export const MARKER_SIZE = 4;
/** Shortest horizontal reach of a curve end, in pixels. */
export const MIN_REACH = 48;

const right = (r: Rect) => r.x + r.width;
const bottom = (r: Rect) => r.y + r.height;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function isValid(r: Rect): boolean {
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height) &&
    r.width > 0 &&
    r.height > 0
  );
}

/** The overlap of two rectangles, or null when it has no area. */
export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(right(a), right(b)) - x;
  const h = Math.min(bottom(a), bottom(b)) - y;
  return w > 0 && h > 0 ? { x, y, width: w, height: h } : null;
}

/**
 * Maps a rectangle in image coordinates to screen coordinates for an SVG with the given viewBox
 * drawn into `svg` (a client rectangle) with preserveAspectRatio="xMidYMid meet".
 */
export function imageToScreen(box: Rect, viewBox: Rect, svg: Rect): Rect | null {
  if (!isValid(viewBox) || !isValid(svg)) return null;
  const scale = Math.min(svg.width / viewBox.width, svg.height / viewBox.height);
  const offsetX = svg.x + (svg.width - viewBox.width * scale) / 2;
  const offsetY = svg.y + (svg.height - viewBox.height * scale) / 2;
  return {
    x: offsetX + (box.x - viewBox.x) * scale,
    y: offsetY + (box.y - viewBox.y) * scale,
    width: box.width * scale,
    height: box.height * scale,
  };
}

/** The string from the card to the target, or null when there is nothing sensible to draw. */
export function sourceString(input: SourceStringInput): SourceStringShape | null {
  const { card, target, stage, viewport, bandBottom } = input;
  if (!target || !isValid(card) || !isValid(target) || !isValid(stage)) return null;
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || !Number.isFinite(bandBottom)) return null;
  if (viewport.width <= 0 || viewport.height <= 0) return null;

  const top = Math.max(0, bandBottom);
  const view: Rect = { x: 0, y: top, width: viewport.width, height: viewport.height - top };
  const visibleCard = intersect(card, view); // null: the card is under the bar or off screen
  const visibleStage = intersect(stage, view);
  if (!visibleCard || !visibleStage) return null;
  if (visibleStage.width < 2 * EDGE_INSET || visibleStage.height < 2 * EDGE_INSET) return null;

  // Start: the card edge that faces the target.
  const targetCentre: Point = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const cardCentreX = card.x + card.width / 2;
  const facesLeft = targetCentre.x < cardCentreX;
  const start: Point = {
    x: facesLeft ? visibleCard.x : right(visibleCard),
    y: clamp(card.y + card.height / 2, visibleCard.y, bottom(visibleCard)),
  };

  // End: the target edge that faces the start.
  const raw: Point = { x: start.x >= targetCentre.x ? right(target) : target.x, y: targetCentre.y };
  const inside =
    raw.x >= visibleStage.x && raw.x <= right(visibleStage) && raw.y >= visibleStage.y && raw.y <= bottom(visibleStage);
  const end: Point = inside
    ? raw
    : {
        x: clamp(raw.x, visibleStage.x + EDGE_INSET, right(visibleStage) - EDGE_INSET),
        y: clamp(raw.y, visibleStage.y + EDGE_INSET, bottom(visibleStage) - EDGE_INSET),
      };

  // Curve: horizontal tangents, control points clamped into the viewport, below the band.
  const dir = end.x > start.x ? 1 : end.x < start.x ? -1 : facesLeft ? -1 : 1;
  const reach = Math.max(Math.abs(end.x - start.x) / 2, MIN_REACH);
  const c1: Point = { x: clamp(start.x + dir * reach, 0, viewport.width), y: start.y };
  const c2: Point = { x: clamp(end.x - dir * reach, 0, viewport.width), y: end.y };

  const path = `M ${start.x} ${start.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`;
  return { path, start, end, controls: [c1, c2], clamped: !inside, marker: inside ? null : chevron(end, raw) };
}

/** A chevron with its tip at `tip`, pointing towards `towards`. */
function chevron(tip: Point, towards: Point): string {
  const dx = towards.x - tip.x;
  const dy = towards.y - tip.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const s = MARKER_SIZE;
  const a: Point = { x: tip.x - ux * s - uy * s, y: tip.y - uy * s + ux * s };
  const b: Point = { x: tip.x - ux * s + uy * s, y: tip.y - uy * s - ux * s };
  return `M ${a.x} ${a.y} L ${tip.x} ${tip.y} L ${b.x} ${b.y}`;
}
