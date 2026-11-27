import { launchChrome } from './browser.js';
import { outDir } from './paths.js';
import { playScene } from './play.js';
import { longWaits, type Wait } from './report.js';
import { SCENE_DEFS } from './scenes.js';
import { serveSite } from './serve.js';

/**
 * `npm run demo:check` tests the capture without recording: it builds the site with SITE_BASE=/facsimortis/,
 * serves it with vite preview (and checks the page is that build), then runs every scene's set-up and steps in
 * a fresh browser context with no glides, holds or pauses. Every label must be found and every end-state check
 * must pass; the first failure stops the run with an error naming the scene, the step and the label. Only the
 * build (demo-out/site) and scene 5's downloaded file are written.
 */

async function main(): Promise<void> {
  const out = outDir();
  console.log('Building the site with SITE_BASE=/facsimortis/ and starting vite preview…');
  const site = await serveSite(out);
  console.log(`Serving the /facsimortis/ build at ${site.url}`);
  const browser = await launchChrome();
  const waits: Wait[] = [];
  try {
    for (const def of SCENE_DEFS) {
      const start = performance.now();
      const played = await playScene(browser, site.url, out, def, { record: false });
      waits.push(...played.waits);
      console.log(`${def.scene.id} (${def.scene.title}): end state reached in ${Math.round(performance.now() - start)} ms`);
    }
  } finally {
    await browser.close();
    await site.stop();
  }
  const slow = longWaits(waits);
  console.log(slow.length === 0 ? 'No wait took longer than 3 s.' : `Waits longer than 3 s:\n${slow.map((w) => `  ${w.sceneId}, ${w.step}: ${w.what}, ${w.ms} ms`).join('\n')}`);
  console.log('demo:check passed.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
