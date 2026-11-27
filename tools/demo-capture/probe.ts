import type { Browser, Locator } from 'playwright-core';
import { launchChrome, newCaptureContext, PageDriver, startClip } from './browser.js';
import { Pointer } from './cursor.js';
import { BUTTON, button, faxHeading, faxIcon, fieldCard, type Target } from './labels.js';
import { compareArgs, greyBandShare, lastFrameArgs, mp4Args, parseProbe, parseSimilarity, pngSize, probeArgs, run } from './media.js';
import { outDir, type OutDir } from './paths.js';
import { VIDEO_SIZE, VIEW_100, VIEW_125, type View } from './plan.js';
import { serveSite, type ServedSite } from './serve.js';
import { runScene, type Step } from './steps.js';

/**
 * V1b probe: a clip of about 10 s from the production build, to check the recorder before the six scenes are
 * written. It opens the inbox, brings in fax-0003, opens it and selects the Provider number card (small text,
 * the source ghost and the source string), then saves the WebM, the MP4 copy, the final frame, the ffprobe
 * numbers and how close the last video frame is to the lossless final frame (SSIM, PSNR).
 *
 * It records the same clip twice: probe-125 with the chosen 125% layout (1536x864 at device scale 1.25; Chrome
 * sends 1536x864 frames, so the MP4 copy is scaled up to 1920x1080) and probe-100 with the 100% layout at
 * 1920x1080, which records at full size. Run with `npm run demo:probe`. Everything goes into demo-out/.
 */

const GOAL_MS = 10_000;

async function probe(browser: Browser, site: ServedSite, out: OutDir, view: View) {
  const name = `probe-${view.name}`;
  const context = await newCaptureContext(browser, view);
  const page = await context.newPage();
  const driver = new PageDriver(page);
  const pointer = new Pointer(page, { x: 0, y: 0 });

  // Set-up, before the recording starts.
  await page.goto(`${site.url}?skipboot`);
  // Written as text: the root project has no browser types.
  await page.evaluate('document.fonts.ready.then(() => true)');
  if (!(await driver.find(faxIcon('fax-0002'), 10_000))) throw new Error(`${name} set-up: the inbox did not show fax-0002.`);
  await pointer.park({ x: Math.round(view.viewport.width * 0.62), y: Math.round(view.viewport.height * 0.55) });
  await page.waitForTimeout(500);

  const clip = await startClip(page, out, name, view);
  const click = (stepName: string, target: Target): Step<Locator> => ({
    name: stepName,
    plannedMs: 900,
    action: true,
    run: async (ctx) => pointer.click(await ctx.need(target)),
  });
  const waitFor = (stepName: string, target: Target): Step<Locator> => ({
    name: stepName,
    plannedMs: 300,
    action: false,
    run: async (ctx) => void (await ctx.need(target)),
  });
  const sceneRun = await runScene<Locator>(
    { id: name, goalMs: GOAL_MS },
    [
      { name: 'hold the inbox', plannedMs: 800, action: false, run: (ctx) => ctx.hold(800) },
      click('click Incoming fax', button(BUTTON.incomingFax)),
      waitFor('wait for fax-0003', faxIcon('fax-0003')),
      click('open fax-0003', faxIcon('fax-0003')),
      waitFor('wait for the fax', faxHeading('fax-0003')),
      click('select the Provider number card', fieldCard('npi')),
      { name: 'hold the source ghost', plannedMs: 2_500, action: false, run: (ctx) => ctx.hold(2_500) },
    ],
    driver,
  );
  const { recordedMs } = await clip.finish();
  await context.close();

  const webm = out.path(`${name}/clip.webm`);
  const mp4 = out.path(`${name}/clip.mp4`);
  const finalPng = out.path(`${name}/final.png`);
  const scaled = view.frame.width !== VIDEO_SIZE.width || view.frame.height !== VIDEO_SIZE.height;
  await run('ffmpeg', mp4Args(webm, mp4, scaled ? VIDEO_SIZE : undefined));
  const checks: Record<string, unknown> = {};
  for (const [kind, file] of [['webm', webm], ['mp4', mp4]] as const) {
    const lastName = `${name}/last-frame-${kind}.png`;
    await run('ffmpeg', lastFrameArgs(file, out.path(lastName)));
    const similarity = parseSimilarity((await run('ffmpeg', compareArgs(out.path(lastName), finalPng, VIDEO_SIZE))).stderr);
    const last = out.read(lastName);
    const size = pngSize(last);
    checks[kind] = {
      lastFrame: size,
      ...similarity,
      // The right and bottom fifth of the frame: all grey if the picture had been padded.
      greyPaddingShare: greyBandShare(last, { width: Math.round(size.width * 0.8), height: Math.round(size.height * 0.8) }),
    };
  }
  return {
    clip: name,
    view,
    goalMs: GOAL_MS,
    run: sceneRun,
    recordedMs,
    finalPng: pngSize(out.read(`${name}/final.png`)),
    webm: parseProbe((await run('ffprobe', probeArgs(webm))).stdout),
    mp4: { ...parseProbe((await run('ffprobe', probeArgs(mp4))).stdout), scaledFrom: scaled ? view.frame : null },
    lastFrameAgainstFinalPng: checks,
    files: { webm, mp4, finalPng },
  };
}

async function main(): Promise<void> {
  const out = outDir();
  console.log('Building the site with SITE_BASE=/facsimortis/ and starting vite preview…');
  const site = await serveSite(out);
  const browser = await launchChrome();
  try {
    for (const view of [VIEW_125, VIEW_100]) {
      const manifest = await probe(browser, site, out, view);
      out.write(`${manifest.clip}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
      console.log(JSON.stringify(manifest, null, 2));
    }
  } finally {
    await browser.close();
    await site.stop();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
