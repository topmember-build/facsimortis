/** A rectangle in IMAGE coordinates (pixels of the fax PNG). */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageSize {
  width: number;
  height: number;
}

/** Space kept around the text when the page is cropped, in image pixels. */
export const CROP_MARGIN = 40;

export const fullPageBox = (page: PageSize): Box => ({ x: 0, y: 0, width: page.width, height: page.height });

/**
 * The area of the page that holds text: the union of all OCR word boxes ([x0, y0, x1, y1])
 * plus a margin, clamped to the page. No words, or nothing left after clamping, gives the
 * full page. The result is only ever used as an SVG viewBox, so the image and the
 * highlights keep one coordinate system.
 */
export function cropBox(
  words: readonly { readonly box: readonly [number, number, number, number] }[],
  page: PageSize,
  margin: number = CROP_MARGIN,
): Box {
  if (words.length === 0) return fullPageBox(page);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const { box } of words) {
    x0 = Math.min(x0, box[0], box[2]);
    y0 = Math.min(y0, box[1], box[3]);
    x1 = Math.max(x1, box[0], box[2]);
    y1 = Math.max(y1, box[1], box[3]);
  }
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  const left = clamp(x0 - margin, page.width);
  const top = clamp(y0 - margin, page.height);
  const right = clamp(x1 + margin, page.width);
  const bottom = clamp(y1 + margin, page.height);
  if (right - left <= 0 || bottom - top <= 0) return fullPageBox(page);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** True when every rectangle lies inside the box. */
export function boxContains(outer: Box, rects: readonly Box[]): boolean {
  return rects.every(
    (r) =>
      r.x >= outer.x &&
      r.y >= outer.y &&
      r.x + r.width <= outer.x + outer.width &&
      r.y + r.height <= outer.y + outer.height,
  );
}

/**
 * The box the viewer shows: the full page when asked for, or when a highlight to be
 * shown would fall outside the crop; otherwise the crop.
 */
export function viewerBox(
  crop: Box,
  page: PageSize,
  highlights: readonly Box[],
  showFullPage: boolean,
): Box {
  if (showFullPage || !boxContains(crop, highlights)) return fullPageBox(page);
  return crop;
}

export const viewBoxAttr = (box: Box): string => `${box.x} ${box.y} ${box.width} ${box.height}`;
