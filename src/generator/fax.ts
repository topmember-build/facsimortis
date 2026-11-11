/**
 * Fax builder: wires referral data, header, template, stamp and degradation into
 * one pure function. All randomness comes from a single seeded Rng, consumed in a
 * fixed order. Synthetic data only.
 */
import { REFERENCE_DATE, generateReferral } from './data.js';
import type { Trap } from './data.js';
import {
  LEVEL_PRESETS,
  addSpeckle,
  addStreaks,
  drawFaxHeader,
  mapBox,
  pickSkew,
  placeStamp,
  rotatePage,
} from './degrade.js';
import type { Streak } from './degrade.js';
import { loadSpleen } from './font.js';
import { encodePng } from './png.js';
import { createRng } from './prng.js';
import { Page } from './raster.js';
import type { Box } from './raster.js';
import { FIELD_NAMES, PAGE_HEIGHT, PAGE_WIDTH, drawTemplate } from './templates.js';
import type { FieldName, TemplateName, Word } from './templates.js';

export type Level = 'L1' | 'L2';

export interface FaxSpec {
  id: string;
  seed: number;
  level: Level;
  template: TemplateName;
  trap: Trap;
  stamp: boolean;
}

export interface Truth {
  synthetic: true;
  id: string;
  seed: number;
  level: Level;
  template: TemplateName;
  trap: Trap;
  referenceDate: string;
  page: { width: number; height: number };
  degradation: {
    skewDegrees: number;
    speckleDensity: number;
    speckleCount: number;
    streaks: Streak[];
    stamp: { present: boolean; box: Box | null };
  };
  fields: Array<{ name: FieldName; value: string; wordIds: string[] }>;
  words: Word[];
}

export function buildFax(spec: FaxSpec): { png: Buffer; truth: Truth; truthJson: string } {
  const preset = LEVEL_PRESETS[spec.level];
  const font = loadSpleen();
  const rng = createRng(spec.seed);

  // 1. Content.
  const referral = generateReferral(rng, { trap: spec.trap, referenceDate: REFERENCE_DATE });

  // 2-4. Draw on the unskewed page.
  const page = new Page(PAGE_WIDTH, PAGE_HEIGHT);
  const header = drawFaxHeader(page, font, rng, { firstWordIndex: 1 });
  const tpl = drawTemplate(page, font, spec.template, referral, {
    firstWordIndex: header.length + 1,
  });
  const nextIndex = header.length + tpl.words.length + 1;

  let stampWords: Word[] = [];
  let stampBox: Box | null = null;
  if (spec.stamp) {
    const stamp = placeStamp(page, font, rng, tpl.valueBoxes, { firstWordIndex: nextIndex });
    if (!stamp) {
      throw new Error(`Fax ${spec.id}: no stamp position clears the field values.`);
    }
    stampWords = stamp.words;
    stampBox = stamp.box;
  }

  // 5. Skew, then map every box into final-image coordinates.
  const skew = pickSkew(rng, preset.maxSkewDeg);
  const rotated = rotatePage(page, skew);
  const map = (b: Box): Box => mapBox(b, skew, PAGE_WIDTH, PAGE_HEIGHT);
  const words: Word[] = [...header, ...tpl.words, ...stampWords]
    .map((w) => ({ id: w.id, text: w.text, box: map(w.box) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const mappedStamp = stampBox ? map(stampBox) : null;

  // 6. Noise, kept off the values (and off header/stamp for streaks).
  const valueBoxes = tpl.valueBoxes.map(map);
  const protect = [
    ...valueBoxes,
    ...header.map((w) => map(w.box)),
    ...(mappedStamp ? [mappedStamp] : []),
  ];
  const speckleCount = addSpeckle(rotated, rng, preset.speckleDensity, valueBoxes);
  const streakCount = rng.int(preset.streaks[0], preset.streaks[1]);
  const streaks = addStreaks(rotated, rng, streakCount, protect);

  // 7. Encode.
  const png = encodePng(rotated);

  const truth: Truth = {
    synthetic: true,
    id: spec.id,
    seed: spec.seed,
    level: spec.level,
    template: spec.template,
    trap: spec.trap,
    referenceDate: REFERENCE_DATE,
    page: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
    degradation: {
      skewDegrees: skew,
      speckleDensity: preset.speckleDensity,
      speckleCount,
      streaks,
      stamp: { present: mappedStamp !== null, box: mappedStamp },
    },
    fields: FIELD_NAMES.map((name) => ({
      name,
      value: referral[name],
      wordIds: [...tpl.fieldWordIds[name]],
    })),
    words,
  };
  return { png, truth, truthJson: JSON.stringify(truth, null, 2) + '\n' };
}

/** The three Phase 0 faxes. */
export function phase0Specs(baseSeed = 42): FaxSpec[] {
  return [
    { id: 'fax-0001', seed: baseSeed, level: 'L1', template: 'typed-form', trap: null, stamp: false },
    { id: 'fax-0002', seed: baseSeed + 1, level: 'L2', template: 'table-form', trap: null, stamp: true },
    { id: 'fax-0003', seed: baseSeed + 2, level: 'L2', template: 'typed-form', trap: 'bad-npi', stamp: false },
  ];
}

/** True when every field cites existing words whose joined text equals its value. */
export function citationOk(truth: Truth): boolean {
  const byId = new Map(truth.words.map((w) => [w.id, w.text]));
  return truth.fields.every((f) => {
    if (f.wordIds.length === 0) return false;
    const texts = f.wordIds.map((id) => byId.get(id));
    if (texts.some((t) => t === undefined)) return false;
    return texts.join(' ') === f.value;
  });
}
