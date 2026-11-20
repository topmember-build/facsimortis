import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Box } from './crop';
import {
  WIDE_LAYOUT_QUERY,
  imageToScreen,
  intersect,
  sourceString,
  type Rect,
  type SourceStringShape,
} from './source-string';

export interface SourceStringOverlayProps {
  /** The selected field, or null. Also names the string (data-source-field). */
  field: string | null;
  /** Changes on every selection, so choosing a field again draws the string again. */
  selectionKey: string;
  /** Same rule as the flag-coloured highlights (isOriginallyFlagged). */
  flagged: boolean;
  /** The first cited word in IMAGE coordinates; null when the field cites no words. */
  word: Box | null;
  /** The viewBox the fax SVG currently shows, in image coordinates. */
  viewBox: Box;
  reducedMotion: boolean;
  svgRef: RefObject<SVGSVGElement | null>;
  sheetRef: RefObject<HTMLDivElement | null>;
  /** The sticky summary bar. Its bottom edge is the forbidden band. */
  barRef: RefObject<HTMLDivElement | null>;
  /** The review panel inside the scrolling field column. */
  panelRef: RefObject<HTMLDivElement | null>;
}

const toRect = (r: DOMRect | Rect): Rect => ({ x: r.x, y: r.y, width: r.width, height: r.height });

/** True while the two-column layout is showing. Without matchMedia (old test DOMs) the layout counts as wide. */
function useWideLayout(): boolean {
  const query = () => (typeof window.matchMedia === 'function' ? window.matchMedia(WIDE_LAYOUT_QUERY) : null);
  const [wide, setWide] = useState(() => query()?.matches ?? true);
  useEffect(() => {
    const list = query();
    if (!list) return;
    const update = () => setWide(list.matches);
    update();
    list.addEventListener?.('change', update);
    return () => list.removeEventListener?.('change', update);
  }, []);
  return wide;
}

const sameShape = (a: SourceStringShape | null, b: SourceStringShape | null) =>
  a === b || (a !== null && b !== null && a.path === b.path && a.marker === b.marker && a.clamped === b.clamped);

/**
 * The source string: one curved line from the selected card to its first cited word.
 * Decoration only. aria-hidden, no pointer events, nothing focusable; the cited words are
 * listed as text in the card and the selection line. The geometry is in source-string.ts;
 * this component only reads rectangles from the page and recomputes when they can change.
 */
export function SourceStringOverlay(props: SourceStringOverlayProps) {
  const { field, selectionKey, flagged, word, viewBox, reducedMotion, svgRef, sheetRef, barRef, panelRef } = props;
  const wide = useWideLayout();
  const [shape, setShape] = useState<SourceStringShape | null>(null);
  const compute = useRef<() => void>(() => {});

  // Reads the page and sets the shape. Replaced on every render so it sees the current props.
  compute.current = () => {
    const svg = svgRef.current;
    const sheet = sheetRef.current;
    const panel = panelRef.current;
    if (!wide || !field || !word || !svg || !sheet || !panel) return setShape(null);
    const item = Array.from(panel.querySelectorAll<HTMLElement>('button[data-field]')).find(
      (b) => b.dataset['field'] === field,
    );
    const li = item?.closest('li');
    if (!li) return setShape(null);
    let card = toRect(li.getBoundingClientRect());
    // The card can be scrolled out of the field column. Only its visible part counts.
    const column = panel.closest('.viewer-side');
    if (column) {
      const clipped = intersect(card, toRect(column.getBoundingClientRect()));
      if (!clipped) return setShape(null);
      card = clipped;
    }
    const doc = document.documentElement;
    const viewport = { width: doc.clientWidth || window.innerWidth, height: doc.clientHeight || window.innerHeight };
    const target = imageToScreen(word, viewBox, toRect(svg.getBoundingClientRect()));
    const bandBottom = barRef.current ? barRef.current.getBoundingClientRect().bottom : 0;
    const next = sourceString({ card, target, stage: toRect(sheet.getBoundingClientRect()), viewport, bandBottom });
    setShape((prev) => (sameShape(prev, next) ? prev : next));
  };

  // Selection, crop, "Show full page" and layout changes recompute straight away.
  const { x: vx, y: vy, width: vw, height: vh } = viewBox;
  useLayoutEffect(() => {
    compute.current();
  }, [field, selectionKey, word?.x, word?.y, word?.width, word?.height, vx, vy, vw, vh, wide]);

  // Resize, scroll (the page and the field column) and size changes are batched into one frame.
  useEffect(() => {
    if (!wide) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        compute.current();
      });
    };
    window.addEventListener('resize', schedule);
    // Scroll events do not bubble; capturing on window also sees the field column and the stage.
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(schedule);
      for (const el of [svgRef.current, sheetRef.current, barRef.current, panelRef.current, panelRef.current?.closest('.viewer-side')]) {
        if (el) observer.observe(el);
      }
    }
    return () => {
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, { capture: true });
      observer?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [wide, svgRef, sheetRef, barRef, panelRef]);

  const className = [
    'ghost-string',
    flagged ? 'ghost-string-flag' : '',
    reducedMotion ? '' : 'ghost-string-draw',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <svg className="source-string-overlay" aria-hidden="true" focusable="false" style={{ pointerEvents: 'none' }}>
      {shape && field && (
        <path
          key={selectionKey}
          className={className}
          data-source-field={field}
          data-clamped={shape.clamped}
          d={shape.marker ? `${shape.path} ${shape.marker}` : shape.path}
          pathLength={1}
          fill="none"
        />
      )}
    </svg>
  );
}
