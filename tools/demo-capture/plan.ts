/**
 * The demo capture plan as data: the six scenes, their target lengths, the fixed holds, the browser
 * settings and the fixed clock. No I/O. The steps of each scene are written in V1c on top of this.
 */

/** CSS pixels. At device scale 1.25 this is 1920x1080 device pixels. */
export const VIEWPORT = { width: 1536, height: 864 } as const;
export const DEVICE_SCALE_FACTOR = 1.25;
/** The size of the MP4 copy (and of the final-frame PNG). */
export const VIDEO_SIZE = { width: 1920, height: 1080 } as const;
export const VIDEO_FPS = 30;

/**
 * A browser set-up for recording. Chrome's screencast sends frames in CSS pixels, whatever the device scale
 * (measured in V1b: 1536x864 frames at device scale 1.25), so `frame` is the size the WebM is recorded at, and
 * the MP4 copy is scaled to VIDEO_SIZE when the two differ. The final-frame PNG is a screenshot at device scale.
 */
export interface View {
  name: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  frame: { width: number; height: number };
}

/** The chosen set-up: the 125% layout. Its frames are 1536x864, and the MP4 copy is scaled up to 1920x1080. */
export const VIEW_125: View = { name: '125', viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE_FACTOR, frame: VIEWPORT };
/** The alternative measured in V1b: the 100% layout at 1920x1080, recorded at its own size. */
export const VIEW_100: View = { name: '100', viewport: VIDEO_SIZE, deviceScaleFactor: 1, frame: VIDEO_SIZE };

/** The site path of the production build (SITE_BASE). */
export const SITE_BASE = '/facsimortis/';

/**
 * The browser's clock is fixed at this time, so every retake shows the same verify time on the Laid to rest
 * panel and in the export. The sample faxes arrive between 09:00 and 09:14 on the demo clock.
 */
export const DEMO_NOW_UTC = '2026-10-01T09:30:00.000Z';

/** Each clip runs to its target plus this share, because the editor can trim a clip but not stretch it. */
export const TARGET_MARGIN = 0.15;

export type SceneId = 'scene-1' | 'scene-2' | 'scene-3' | 'scene-4' | 'scene-5' | 'scene-6';

export interface Scene {
  id: SceneId;
  title: string;
  /** The scene's length in the demo script, in milliseconds. */
  targetMs: number;
}

export const SCENES: readonly Scene[] = [
  { id: 'scene-1', title: 'Boot', targetMs: 12_000 },
  { id: 'scene-2', title: 'Inbox', targetMs: 18_000 },
  { id: 'scene-3', title: 'Source ghost', targetMs: 38_000 },
  { id: 'scene-4', title: 'Resolve and verify', targetMs: 24_000 },
  { id: 'scene-5', title: 'Export', targetMs: 16_000 },
  { id: 'scene-6', title: 'Two readers', targetMs: 24_000 },
];

/** How long a clip should run: the target plus TARGET_MARGIN, rounded to the millisecond. */
export const goalMs = (scene: Scene): number => Math.round(scene.targetMs * (1 + TARGET_MARGIN));

/** The holds named in the demo script, in milliseconds. Pauses after actions come on top (see steps.ts). */
export const HOLD = {
  /** The boot screen moves on by itself 5 s after it appears, so the hold is 3 s. */
  bootScreen: 3_000,
  inboxAfterBoot: 2_000,
  fax0003Arrived: 3_000,
  fax0003Opened: 2_000,
  providerNumberSelected: 5_000,
  laidToRest: 4_000,
} as const;

/** The value typed into the callback phone after Select all. The page reads "555~0151". */
export const TYPED_PHONE = '555-0151';
