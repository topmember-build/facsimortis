import type { Locator, Page } from 'playwright-core';

/**
 * Moving the mouse like a person for the recording: a glide with ease-in-out to the middle of the target,
 * then Playwright's own click at that same point, so its checks (visible, enabled, not covered, stable)
 * still apply. The drawn cursor (overlay.ts) follows these real mouse events.
 */

export interface Point {
  x: number;
  y: number;
}

/** About one frame at 60 Hz. */
export const GLIDE_STEP_MS = 16;
/** A glide's length: 450 ms for a short move, up to 900 ms across the screen. */
export const glideMs = (from: Point, to: Point): number =>
  Math.round(Math.min(900, Math.max(450, 450 + Math.hypot(to.x - from.x, to.y - from.y) * 0.35)));

const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Pure. The points of a glide, one per step, ending exactly on `to`. */
export function glidePoints(from: Point, to: Point, durationMs: number, stepMs: number = GLIDE_STEP_MS): Point[] {
  const steps = Math.max(1, Math.round(durationMs / stepMs));
  const points: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = easeInOutCubic(i / steps);
    points.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }
  points[points.length - 1] = { ...to };
  return points;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class Pointer {
  private position: Point;

  constructor(
    private readonly page: Page,
    start: Point,
    /** demo:check: moves straight to the target with no glide. */
    private readonly instant = false,
  ) {
    this.position = start;
  }

  get at(): Point {
    return this.position;
  }

  /** Puts the mouse at a point straight away (before a recording starts). */
  async park(point: Point): Promise<void> {
    await this.page.mouse.move(point.x, point.y);
    this.position = point;
  }

  async glideTo(to: Point, durationMs: number = glideMs(this.position, to)): Promise<void> {
    if (this.instant) {
      await this.page.mouse.move(to.x, to.y);
      this.position = to;
      return;
    }
    for (const point of glidePoints(this.position, to, durationMs)) {
      await this.page.mouse.move(point.x, point.y);
      await sleep(GLIDE_STEP_MS);
    }
    this.position = to;
  }

  /** The middle of the element, after scrolling it into view if needed. */
  async middleOf(target: Locator): Promise<Point> {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error('the element has no box on the page');
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  }

  /** Glides to the element and clicks it there. */
  async click(target: Locator): Promise<void> {
    const middle = await this.middleOf(target);
    await this.glideTo(middle);
    await target.click();
    this.position = middle;
  }
}
