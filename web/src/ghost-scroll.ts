/**
 * R6.1: when a field is selected, bring its first cited ghost into view, but only when it is not already fully
 * visible. Nearest-edge scrolling (block and inline "nearest"), so the page moves as little as it can. Smooth by
 * default, instant when the person has asked for reduced motion. The stylesheet gives ghost rectangles the same
 * scroll margin as the buttons on the fax screen, so a ghost does not end up under the sticky summary bar.
 */

/** The part of the window where something counts as visible, in viewport coordinates. */
export interface VisibleArea {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

type Edges = Pick<DOMRect, 'top' | 'left' | 'bottom' | 'right'>;

/** True when the whole rectangle is inside the visible area (touching an edge counts as inside). */
export function isFullyVisible(rect: Edges, area: VisibleArea): boolean {
  return rect.top >= area.top && rect.left >= area.left && rect.bottom <= area.bottom && rect.right <= area.right;
}

/** The scroll options for a ghost: nearest edge, smooth, or instant under reduced motion. */
export function ghostScrollOptions(reducedMotion: boolean): ScrollIntoViewOptions {
  return { block: 'nearest', inline: 'nearest', behavior: reducedMotion ? 'instant' : 'smooth' };
}

/**
 * The visible area of the fax screen: the window below the sticky summary bar. Before the page scrolls, the bar is
 * above the fax anyway, so its bottom edge is a safe top line in both cases.
 */
export function faxScreenArea(bar: Element | null): VisibleArea {
  const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
  return { top: Math.max(0, barBottom), left: 0, bottom: window.innerHeight, right: window.innerWidth };
}

/** Scrolls `target` into view if it is not fully visible. Returns whether it asked the browser to scroll. */
export function scrollGhostIntoView(target: Element | null | undefined, area: VisibleArea, reducedMotion: boolean): boolean {
  if (!target || typeof target.scrollIntoView !== 'function') return false;
  if (isFullyVisible(target.getBoundingClientRect(), area)) return false;
  target.scrollIntoView(ghostScrollOptions(reducedMotion));
  return true;
}
