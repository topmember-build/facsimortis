import { launchChrome } from './browser.js';
import { mp4Args, parseProbe, probeArgs, run } from './media.js';
import { outDir } from './paths.js';
import { playScene } from './play.js';
import { DEMO_NOW_UTC, SCENE_VIEW, VIDEO_FPS, VIDEO_SIZE, type SceneId } from './plan.js';
import { lengthNote, longWaits, reachesGoal, type ClipEntry, type Wait } from './report.js';
import { SCENE_DEFS } from './scenes.js';
import { serveSite } from './serve.js';

/**
 * `npm run demo:capture` records the six scenes from the SITE_BASE=/facsimortis/ production build. For each scene,
 * demo-out/<scene>/ gets clip.webm (Playwright's recording), clip.mp4 (the H.264 copy for the editor), final.png
 * and manifest.json; a full run also writes demo-out/manifest.json with every clip's target, goal and real length,
 * and the waits that took longer than 3 s. `npm run demo:capture -- --scene scene-3` records one scene.
 * A label that cannot be found stops the run with an error naming it.
 */

function chosenScenes(args: readonly string[]): typeof SCENE_DEFS {
  const index = args.indexOf('--scene');
  if (index === -1) return SCENE_DEFS;
  const id = args[index + 1];
  const def = SCENE_DEFS.find((candidate) => candidate.scene.id === id);
  if (!def) throw new Error(`Unknown scene "${id ?? ''}". Use one of: ${SCENE_DEFS.map((d) => d.scene.id).join(', ')}.`);
  return [def];
}

async function main(): Promise<void> {
  const defs = chosenScenes(process.argv.slice(2));
  const out = outDir();
  console.log('Building the site with SITE_BASE=/facsimortis/ and starting vite preview…');
  const site = await serveSite(out);
  const browser = await launchChrome();
  const clips: ClipEntry[] = [];
  const waits: Wait[] = [];
  try {
    for (const def of defs) {
      const id: SceneId = def.scene.id;
      console.log(`Recording ${id} (${def.scene.title})…`);
      const played = await playScene(browser, site.url, out, def, { record: true });
      const webm = out.path(`${id}/clip.webm`);
      const mp4 = out.path(`${id}/clip.mp4`);
      const scaled = SCENE_VIEW.frame.width !== VIDEO_SIZE.width || SCENE_VIEW.frame.height !== VIDEO_SIZE.height;
      await run('ffmpeg', mp4Args(webm, mp4, scaled ? VIDEO_SIZE : undefined));
      const probe = parseProbe((await run('ffprobe', probeArgs(mp4))).stdout);
      const entry: ClipEntry = {
        sceneId: id,
        title: def.scene.title,
        targetMs: def.scene.targetMs,
        goalMs: played.run.goalMs,
        realMs: Math.round(probe.durationS * 1000),
        timelineMs: Math.round(played.run.elapsedMs),
        pausesMs: played.run.pausesMs,
        finalHoldMs: Math.round(played.run.finalHoldMs),
        files: { webm, mp4, finalPng: out.path(`${id}/final.png`) },
      };
      out.write(`${id}/manifest.json`, `${JSON.stringify({ ...entry, mp4: probe, longWaits: longWaits(played.waits) }, null, 2)}\n`);
      clips.push(entry);
      waits.push(...played.waits);
      console.log(`  real ${(entry.realMs / 1000).toFixed(1)} s, target ${(entry.targetMs / 1000).toFixed(1)} s, goal ${(entry.goalMs / 1000).toFixed(1)} s (${lengthNote(entry)})`);
    }
  } finally {
    await browser.close();
    await site.stop();
  }

  const slow = longWaits(waits);
  if (defs.length === SCENE_DEFS.length) {
    const manifest = {
      view: SCENE_VIEW,
      fps: VIDEO_FPS,
      fixedClockUtc: DEMO_NOW_UTC,
      clips,
      longWaits: slow,
    };
    out.write('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const short = clips.filter((clip) => !reachesGoal(clip));
  console.log(short.length === 0 ? '\nEvery clip reaches its goal.' : `\nShorter than the goal: ${short.map((c) => c.sceneId).join(', ')}`);
  console.log(slow.length === 0 ? 'No wait took longer than 3 s.' : `Waits longer than 3 s:\n${slow.map((w) => `  ${w.sceneId}, ${w.step}: ${w.what}, ${w.ms} ms`).join('\n')}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
