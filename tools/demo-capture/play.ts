import type { Browser, BrowserContext } from 'playwright-core';
import { newCaptureContext, PageDriver, startClip } from './browser.js';
import { Pointer } from './cursor.js';
import { faxIcon, nameMatcher } from './labels.js';
import type { OutDir } from './paths.js';
import { goalMs } from './plan.js';
import type { Wait } from './report.js';
import { REST_POINT, type SceneDef, type SceneEnv } from './scenes.js';
import { DEFAULT_MIN_PAUSE_MS, runScene, type SceneRun } from './steps.js';

/**
 * Plays one scene in a fresh browser context: a warm-up page loads the site once so its fonts and images are in
 * the context's cache, then the scene's page runs the set-up at once, the mouse rests, and the steps run. With
 * `record`, the steps are recorded (from the first frame after the set-up) and paced to the scene's goal.
 * Without it (demo:check), nothing is recorded and no step waits.
 */

export interface Played {
  def: SceneDef;
  run: SceneRun;
  waits: Wait[];
  /** Only when recorded: the time from the first frame to the final screenshot. */
  recordedMs: number | null;
}

async function warmUp(context: BrowserContext, siteUrl: string): Promise<void> {
  const page = await context.newPage();
  await page.goto(`${siteUrl}?skipboot`);
  // Only a cache warm-up: if the inbox does not show here, the scene's own set-up stops the run and names the label.
  await page
    .getByRole('button', { name: nameMatcher(faxIcon('fax-0002')) })
    .waitFor({ state: 'visible', timeout: 10_000 })
    .catch(() => {});
  await page.evaluate('document.fonts.ready.then(() => true)');
  await page.close();
}

export async function playScene(
  browser: Browser,
  siteUrl: string,
  out: OutDir,
  def: SceneDef,
  options: { record: boolean },
): Promise<Played> {
  const { record } = options;
  const context = await newCaptureContext(browser);
  try {
    await warmUp(context, siteUrl);
    const page = await context.newPage();
    const env: SceneEnv = {
      sceneId: def.scene.id,
      page,
      siteUrl,
      out,
      pointer: new Pointer(page, REST_POINT, !record),
      fast: !record,
      waits: [],
      currentStep: 'set-up',
    };
    const onFind = (what: string, ms: number) => env.waits.push({ sceneId: env.sceneId, step: env.currentStep, what, ms });

    await runScene({ id: `${def.scene.id} set-up`, goalMs: 0 }, def.setup(env), new PageDriver(page, { skipWaits: true, onFind }), {
      minPauseMs: 0,
      onStep: (number, name) => (env.currentStep = `set-up step ${number} (${name})`),
    });
    await env.pointer.park(REST_POINT);
    if (record) await page.waitForTimeout(400);

    const clip = record ? await startClip(page, out, def.scene.id) : null;
    const run = await runScene(
      { id: def.scene.id, goalMs: record ? goalMs(def.scene) : 0 },
      def.steps(env),
      new PageDriver(page, { skipWaits: !record, onFind }),
      {
        minPauseMs: record ? DEFAULT_MIN_PAUSE_MS : 0,
        onStep: (number, name) => (env.currentStep = `step ${number} (${name})`),
      },
    );
    const recordedMs = clip ? (await clip.finish()).recordedMs : null;
    return { def, run, waits: env.waits, recordedMs };
  } finally {
    await context.close();
  }
}
