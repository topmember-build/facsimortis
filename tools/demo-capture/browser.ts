import { chromium, errors, type Browser, type BrowserContext, type Locator, type Page } from 'playwright-core';
import { nameMatcher, type Target } from './labels.js';
import { OVERLAY_SCRIPT } from './overlay.js';
import type { OutDir } from './paths.js';
import { DEMO_NOW_UTC, VIDEO_FPS, VIEW_125, type View } from './plan.js';
import type { Driver } from './steps.js';

/**
 * The installed Google Chrome, headless, driven by playwright-core (no browser download). Each scene gets a
 * fresh context: the view's viewport and device scale (VIEW_125 unless told otherwise), motion on, the clock
 * fixed at DEMO_NOW_UTC, and the cursor overlay on every page.
 */

export function launchChrome(): Promise<Browser> {
  return chromium.launch({ channel: 'chrome', headless: true });
}

export async function newCaptureContext(browser: Browser, view: View = VIEW_125): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { ...view.viewport },
    deviceScaleFactor: view.deviceScaleFactor,
    reducedMotion: 'no-preference',
    locale: 'en-US',
    timezoneId: 'UTC',
    acceptDownloads: true,
  });
  await context.clock.setFixedTime(DEMO_NOW_UTC);
  await context.addInitScript({ content: OVERLAY_SCRIPT });
  return context;
}

/** The step runner's Driver over a Playwright page: role queries, exact names unless the target says prefix. */
export class PageDriver implements Driver<Locator> {
  constructor(private readonly page: Page) {}

  locator(target: Target): Locator {
    return this.page.getByRole(target.role, { name: nameMatcher(target), exact: target.match !== 'prefix' });
  }

  async find(target: Target, timeoutMs: number): Promise<Locator | null> {
    const locator = this.locator(target);
    try {
      // Strict: two matches throw (not a timeout), so an ambiguous label stops the run as well.
      await locator.waitFor({ state: 'visible', timeout: timeoutMs });
      return locator;
    } catch (error) {
      if (error instanceof errors.TimeoutError) return null;
      throw error;
    }
  }

  wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  now(): number {
    return performance.now();
  }
}

export interface Clip {
  /** Saves the final frame as a lossless PNG, then stops the recording. Returns the real length in ms. */
  finish(): Promise<{ recordedMs: number }>;
}

/**
 * Starts recording the page into `<name>/clip.webm` (Playwright's VP9 encoder, at the view's frame size, 30 fps)
 * and waits for the first frame, so nothing before the call is in the clip. The final frame goes to
 * `<name>/final.png`, a screenshot at device scale.
 */
export async function startClip(page: Page, out: OutDir, name: string, view: View = VIEW_125): Promise<Clip> {
  let firstFrame: () => void = () => {};
  const gotFrame = new Promise<void>((resolve) => (firstFrame = resolve));
  let frames = 0;
  out.ensureDir(name);
  await page.screencast.start({
    path: out.path(`${name}/clip.webm`),
    size: { ...view.frame },
    fps: VIDEO_FPS,
    quality: 95,
    onFrame: () => {
      frames++;
      firstFrame();
    },
  });
  await Promise.race([
    gotFrame,
    new Promise((_, reject) => setTimeout(() => reject(new Error('The recording sent no frame within 5 s.')), 5_000)),
  ]);
  const started = performance.now();
  return {
    async finish() {
      await page.screenshot({ path: out.path(`${name}/final.png`), scale: 'device', animations: 'allow' });
      const recordedMs = Math.round(performance.now() - started);
      await page.screencast.stop();
      if (frames === 0) throw new Error('The recording received no frames.');
      return { recordedMs };
    },
  };
}
