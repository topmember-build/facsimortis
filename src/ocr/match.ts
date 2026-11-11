import type { Box, OcrWord } from './types.js';

/** Pure measurement helpers. No I/O. Reusable by the evaluation script. */

export interface TruthWord {
  id: string;
  text: string;
  box: Box;
}

export interface WordMismatch {
  truthId: string;
  truthText: string;
  /** Text of the best-overlapping OCR word, or null when nothing overlaps. */
  ocrText: string | null;
  iou: number;
}

export interface MatchReport {
  truthCount: number;
  ocrCount: number;
  /** Truth words whose best OCR word has IoU >= 0.5. */
  boxMatched: number;
  /** Box matched AND text equal after trimming (case-sensitive). */
  textMatched: number;
  /** textMatched / truthCount (0 when there are no truth words). */
  textMatchRate: number;
  /** Mean IoU over box-matched words (0 when none). */
  meanIoU: number;
  /** Every truth word that is not a text match. */
  mismatches: WordMismatch[];
}

export interface MatchResult extends MatchReport {
  /** Same measures restricted to the words used by field values. */
  fieldValues: MatchReport;
}

export const IOU_THRESHOLD = 0.5;

/** Intersection over union of two boxes (x1/y1 exclusive). */
export function iou(a: Box, b: Box): number {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const areaA = (a[2] - a[0]) * (a[3] - a[1]);
  const areaB = (b[2] - b[0]) * (b[3] - b[1]);
  const union = areaA + areaB - inter;
  return union <= 0 ? 0 : inter / union;
}

function report(ocrWords: OcrWord[], truthWords: TruthWord[]): MatchReport {
  let boxMatched = 0;
  let textMatched = 0;
  let iouSum = 0;
  const mismatches: WordMismatch[] = [];

  for (const t of truthWords) {
    let best: OcrWord | undefined;
    let bestIou = 0;
    for (const o of ocrWords) {
      const v = iou(o.box, t.box);
      if (v > bestIou) {
        bestIou = v;
        best = o;
      }
    }
    const boxOk = best !== undefined && bestIou >= IOU_THRESHOLD;
    if (boxOk) {
      boxMatched += 1;
      iouSum += bestIou;
    }
    if (boxOk && best !== undefined && best.text.trim() === t.text.trim()) {
      textMatched += 1;
    } else {
      mismatches.push({
        truthId: t.id,
        truthText: t.text,
        ocrText: best === undefined ? null : best.text,
        iou: bestIou,
      });
    }
  }

  return {
    truthCount: truthWords.length,
    ocrCount: ocrWords.length,
    boxMatched,
    textMatched,
    textMatchRate: truthWords.length === 0 ? 0 : textMatched / truthWords.length,
    meanIoU: boxMatched === 0 ? 0 : iouSum / boxMatched,
    mismatches,
  };
}

/**
 * For each truth word, find the OCR word with the highest box IoU. It is a text
 * match when IoU >= 0.5 and the trimmed texts are equal.
 * `fieldWordIds` are the truth word IDs used by field values (truth.fields[].wordIds).
 */
export function matchWords(
  ocrWords: OcrWord[],
  truthWords: TruthWord[],
  fieldWordIds: Iterable<string> = [],
): MatchResult {
  const ids = new Set(fieldWordIds);
  return {
    ...report(ocrWords, truthWords),
    fieldValues: report(
      ocrWords,
      truthWords.filter((t) => ids.has(t.id)),
    ),
  };
}
