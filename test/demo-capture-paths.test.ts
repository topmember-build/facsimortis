import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { DEMO_OUT, OutsideOutputError, REPO_ROOT, outDir } from '../tools/demo-capture/paths.js';

// V1a. The capture script's only file access: plain relative names inside its output folder.

const scratch = mkdtempSync(path.join(tmpdir(), 'demo-capture-paths-'));
const out = outDir(path.join(scratch, 'demo-out'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const inside = (full: string): boolean => {
  const back = path.relative(out.dir, full);
  return back !== '' && !back.startsWith('..') && !path.isAbsolute(back);
};

describe('the output folder', () => {
  it('is demo-out/ at the repository root', () => {
    expect(DEMO_OUT).toBe(path.join(REPO_ROOT, 'demo-out'));
    expect(existsSync(path.join(REPO_ROOT, 'package.json'))).toBe(true);
  });

  it('is ignored by git, and .kiro is not', () => {
    const lines = readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8').split(/\r?\n/);
    expect(lines).toContain('demo-out/');
    expect(lines.filter((line) => line.includes('.kiro'))).toEqual([]);
  });
});

describe('outDir', () => {
  it('writes, reads and creates folders inside the folder', () => {
    const file = out.write('scene-1/manifest.json', '{"ok":true}\n');
    expect(file).toBe(path.join(out.dir, 'scene-1', 'manifest.json'));
    expect(out.read('scene-1/manifest.json').toString('utf8')).toBe('{"ok":true}\n');
    const folder = out.ensureDir('scene-2/frames');
    expect(existsSync(folder)).toBe(true);
    expect(out.path('scene-3/clip.webm')).toBe(path.join(out.dir, 'scene-3', 'clip.webm'));
  });

  it.each([
    ['', 'empty'],
    ['..', 'parent'],
    ['../outside.txt', 'parent then a file'],
    ['scene-1/../../outside.txt', 'climbing out'],
    ['./clip.webm', 'a dot part'],
    ['/etc/passwd', 'absolute with a slash'],
    ['C:/Windows/win.ini', 'a drive'],
    ['C:clip.webm', 'a drive-relative name'],
    ['clip.webm:stream', 'an alternate data stream'],
    ['scene-1\\clip.webm', 'a backslash'],
    ['scene-1//clip.webm', 'an empty part'],
    ['scene 1/clip.webm', 'a space'],
    ['.hidden', 'a leading dot'],
    ['\0', 'a NUL'],
  ])('refuses %j (%s)', (relative) => {
    expect(() => out.path(relative)).toThrow(OutsideOutputError);
    expect(() => out.write(relative, 'x')).toThrow(OutsideOutputError);
    expect(() => out.read(relative)).toThrow(OutsideOutputError);
  });

  it('names the refused path in the error', () => {
    expect(() => out.write('../x.txt', 'x')).toThrow('Refusing the output path "../x.txt"');
  });

  it('either refuses a name or resolves it inside the folder, for any name', () => {
    const piece = fc.constantFrom('..', '.', '', 'a', 'scene-1', 'C:', '\\', '/', ':', ' ', 'clip.webm', '~', '%2e%2e');
    const name = fc.array(piece, { minLength: 1, maxLength: 6 }).map((parts) => parts.join(''));
    fc.assert(
      fc.property(fc.oneof(name, fc.string()), (relative) => {
        let resolved: string;
        try {
          resolved = out.path(relative);
        } catch (error) {
          return error instanceof OutsideOutputError;
        }
        return inside(resolved);
      }),
      { numRuns: 2_000 },
    );
  });
});
