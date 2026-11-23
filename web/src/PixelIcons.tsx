/* Pixel-art icons for the amber desktop (docs/design-brief-amber.md): inline SVG on a grid of whole
   units with crisp edges, no image files and no icon library. Every icon is decoration (aria-hidden);
   the button or the text next to it carries the meaning. Colours come from styles.css. */

/** A page with its top-right corner folded, on a 12 x 16 grid. */
const PAGE = 'M0 0h9v1H0z M0 0h1v16H0z M0 15h12v1H0z M11 3h1v13h-1z M8 0h1v4H8z M8 3h4v1H8z M9 1h1v1H9z M10 2h1v1h-1z';

/** The frame of a fax icon, drawn over the fax's own thumbnail, with the folded flap filled in. */
export function DocFrame() {
  return (
    <svg className="doc-frame" viewBox="0 0 12 16" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
      <path className="doc-frame-line" d={PAGE} />
      <path className="doc-frame-fold" d="M9 2h1v1H9z" />
    </svg>
  );
}

/** The flag badge on a fax icon: a coral square with a "!" shape, so it is not colour alone. */
export function FlagBadge() {
  return (
    <svg className="doc-badge" viewBox="0 0 5 6" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
      <path className="doc-badge-fill" d="M0 0h5v6H0z" />
      <path className="doc-badge-mark" d="M2 1h1v2H2z M2 4h1v1H2z" />
    </svg>
  );
}

/** The taskbar's Inbox glyph: the same page, with lines of text on it. */
export function InboxGlyph() {
  return (
    <svg className="taskbar-glyph" viewBox="0 0 12 16" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
      <path d={`${PAGE} M3 6h6v1H3z M3 8h6v1H3z M3 10h4v1H3z M3 12h6v1H3z`} />
    </svg>
  );
}
