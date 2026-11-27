# Demo capture

Records the six demo scenes from the real production build, for the demo video (task 4.2). It is a dev tool: nothing here ships in the site, and the site never imports it.

## What you need

- `npm ci` (installs `playwright-core` 1.65.1, a dev dependency; it downloads no browser).
- Google Chrome installed (Playwright drives it with `channel: 'chrome'`, headless).
- `ffmpeg` and `ffprobe` on PATH, for the MP4 copy and the lengths.
- Playwright's own video encoder, found at `%LOCALAPPDATA%\ms-playwright\ffmpeg-<revision>\`. If it is missing, run `npx playwright-core install ffmpeg`.

## Commands

| Command | What it does |
|---|---|
| `npm run demo:check` | Builds the site with `SITE_BASE=/facsimortis/`, serves it with `vite preview` on port 4318 and runs every scene with no recording and no waits. Every label must be found and every end state must be reached. |
| `npm run demo:capture` | The same, recorded and paced: each clip runs to its scene target plus about 15%. `-- --scene scene-3` records one scene. |
| `npm run demo:probe` | The V1b probe: one 10 s clip at the 125% and the 100% layout, with ffprobe numbers and SSIM against the final frame. |

A label it cannot find stops the run with an error that names the scene, the step and the label, for example `scene-5 set-up, step 12 (bring Download JSON into view): could not find the button "Download JSON". The run stopped here.`

## What it writes

Only `demo-out/`, which git ignores:

- `demo-out/site/`: the build it serves.
- `demo-out/scene-N/`: `clip.webm` (Playwright's recording), `clip.mp4` (H.264, 1920x1080, 30 fps, limited range, BT.709; the one to give the editor), `final.png` (the last frame, lossless) and `manifest.json`.
- `demo-out/scene-5/`: also the JSON file the site downloaded, which the export card is drawn from.
- `demo-out/manifest.json` (full runs only): each clip's target, goal and real length (ffprobe), its pauses, and every wait longer than 3 s.

It reads nothing but its own output: no answer-key files and no fixtures (ESLint rules and `test/demo-capture-static.test.ts` enforce this), and every file access goes through `paths.ts`.

## How it records

- A fresh browser context per scene: 1920x1080 at device scale 1 (the 100% layout), motion on, and the clock fixed at 2026-10-01 09:30 UTC, so every retake shows the same verify time.
- Each scene's set-up runs before the recording starts. Recording starts at the first frame after the set-up.
- Chrome's screencast sends frames at CSS pixel size, so the 100% layout gives true 1920x1080 frames. At device scale 1.25 the frames would be 1536x864 (measured in V1b).
- The cursor and click ring are drawn into the page by `overlay.ts`, in a closed shadow root outside the React root, with `pointer-events: none`.
- Clips run 0.2 to 2 s past the paced timeline, because Playwright holds the last frame for at least 1 s when recording stops. Trim in the editor.
