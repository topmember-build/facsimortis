import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The only place the capture script touches files. Every read and write goes through an OutDir, which
 * accepts only plain relative names inside its folder (for example "scene-1/clip.webm"), so the script
 * cannot write outside demo-out/ and cannot read anything that is not its own output.
 */

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The capture output folder. git ignores it (.gitignore). */
export const DEMO_OUT = path.join(REPO_ROOT, 'demo-out');

/**
 * One part of a relative name: starts with a letter or digit, then letters, digits, dot, dash or
 * underscore. This rules out "..", ".", drive letters, colons (Windows alternate streams), slashes and
 * backslashes, spaces and empty parts.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export class OutsideOutputError extends Error {
  constructor(relative: string, reason: string) {
    super(`Refusing the output path ${JSON.stringify(relative)}: ${reason}`);
    this.name = 'OutsideOutputError';
  }
}

export interface OutDir {
  /** The folder, as an absolute path. */
  readonly dir: string;
  /** The absolute path of `relative` inside the folder. Nothing is created. */
  path(relative: string): string;
  /** Creates the folder `relative` (and its parents) inside the folder. */
  ensureDir(relative: string): string;
  /** Writes a file inside the folder, creating its parent folders. Returns the absolute path. */
  write(relative: string, data: string | Uint8Array): string;
  /** Reads a file the script wrote inside the folder. */
  read(relative: string): Buffer;
}

export function outDir(dir: string = DEMO_OUT): OutDir {
  const root = path.resolve(dir);

  function resolveInside(relative: string): string {
    if (typeof relative !== 'string' || relative.length === 0) {
      throw new OutsideOutputError(String(relative), 'the name is empty');
    }
    const parts = relative.split('/');
    for (const part of parts) {
      if (!SEGMENT.test(part)) {
        throw new OutsideOutputError(relative, `"${part}" is not a plain file or folder name`);
      }
    }
    const full = path.resolve(root, ...parts);
    const back = path.relative(root, full);
    // Checked again after resolving, so a rule change above can never let a path escape.
    if (back === '' || back.startsWith('..') || path.isAbsolute(back)) {
      throw new OutsideOutputError(relative, 'it is not inside the output folder');
    }
    return full;
  }

  return {
    dir: root,
    path: resolveInside,
    ensureDir(relative) {
      const full = resolveInside(relative);
      mkdirSync(full, { recursive: true });
      return full;
    },
    write(relative, data) {
      const full = resolveInside(relative);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, data);
      return full;
    },
    read(relative) {
      return readFileSync(resolveInside(relative));
    },
  };
}
