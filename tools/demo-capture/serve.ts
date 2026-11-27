import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { REPO_ROOT, type OutDir } from './paths.js';
import { SITE_BASE } from './plan.js';

/**
 * The production build, served the way the site is served: `vite build` with SITE_BASE=/facsimortis/ and the
 * site's own config, then `vite preview`. The build goes into demo-out/site (not dist/), so the capture writes
 * nothing outside demo-out/. Vite runs as `node vite.js`, with no shell, and is stopped at the end.
 */

/** Not the site's own preview port (4173), so a preview you already run is left alone. */
export const DEMO_PORT = 4318;
const HOST = '127.0.0.1';
const VITE = path.join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const CONFIG = path.join('web', 'vite.config.ts');

export interface ServedSite {
  /** For example http://127.0.0.1:4318/facsimortis/ */
  url: string;
  stop(): Promise<void>;
}

function vite(args: readonly string[], log: (line: string) => void): ChildProcess {
  const child = spawn(process.execPath, [VITE, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, SITE_BASE },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding('utf8');
    stream?.on('data', (text: string) => text.split(/\r?\n/).filter(Boolean).forEach(log));
  }
  return child;
}

function finished(child: ChildProcess, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${what} exited with code ${code}`))));
  });
}

async function waitForSite(url: string, child: ChildProcess, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = 'no answer yet';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`vite preview stopped with code ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return await response.text();
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The site did not answer at ${url} within ${timeoutMs} ms (${last}).`);
}

/** Pure. Checks that the served page is the SITE_BASE build: its scripts load from /facsimortis/assets/. */
export function checkBuiltForBase(html: string, base: string = SITE_BASE): void {
  if (!html.includes(`src="${base}assets/`)) {
    throw new Error(`The served page is not the ${base} build: no script loads from ${base}assets/.`);
  }
}

export async function serveSite(out: OutDir, log: (line: string) => void = () => {}): Promise<ServedSite> {
  const outDirArg = out.path('site');
  await finished(vite(['build', '--config', CONFIG, '--outDir', outDirArg, '--emptyOutDir'], log), 'vite build');
  const preview = vite(['preview', '--config', CONFIG, '--outDir', outDirArg, '--host', HOST, '--port', String(DEMO_PORT), '--strictPort'], log);
  const stop = async () => {
    if (preview.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => preview.once('exit', () => resolve()));
    preview.kill();
    await exited;
  };
  try {
    const url = `http://${HOST}:${DEMO_PORT}${SITE_BASE}`;
    checkBuiltForBase(await waitForSite(url, preview, 20_000));
    const index = await fetch(`${url}samples/index.json`);
    if (!index.ok) throw new Error(`The sample index did not load (HTTP ${index.status}).`);
    return { url, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
