/**
 * Pages safety for the records server: the SDK is a pinned dev dependency that adds exactly two packages, and
 * nothing in the site refers to it or to tools/, so the static site build cannot pick it up.
 * (The built dist/ folder is checked by hand in a clean clone; the Pages workflow runs the tests before building.)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface LockPackage {
  version?: string;
  license?: string;
  dev?: boolean;
  hasInstallScript?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as { packages: Record<string, LockPackage> };
const SDK = '@modelcontextprotocol/server';
const SDK_PACKAGES = ['node_modules/@modelcontextprotocol/core', 'node_modules/@modelcontextprotocol/server'];

describe('the SDK dependency', () => {
  it('is a dev dependency pinned to exactly 2.4.0', () => {
    expect(pkg.devDependencies?.[SDK]).toBe('2.4.0');
    expect(pkg.dependencies?.[SDK]).toBeUndefined();
    expect(lock.packages['']?.devDependencies?.[SDK]).toBe('2.4.0');
  });

  it('adds exactly two packages to the lock file, both 2.4.0, Apache-2.0, dev only, with no install script', () => {
    const sdkEntries = Object.keys(lock.packages).filter((name) => name.includes('@modelcontextprotocol/'));
    expect(sdkEntries.sort()).toEqual(SDK_PACKAGES);
    for (const name of SDK_PACKAGES) {
      const entry = lock.packages[name];
      expect(entry?.version).toBe('2.4.0');
      expect(entry?.license).toBe('Apache-2.0');
      expect(entry?.dev).toBe(true);
      expect(entry?.hasInstallScript).toBeUndefined();
    }
    expect(Object.keys(lock.packages['node_modules/@modelcontextprotocol/core']?.dependencies ?? {})).toEqual(['zod']);
    expect(Object.keys(lock.packages['node_modules/@modelcontextprotocol/server']?.dependencies ?? {}).sort()).toEqual(['@modelcontextprotocol/core', 'zod']);
  });

  it('shares the one zod the project pins, with no second copy', () => {
    const zodEntries = Object.keys(lock.packages).filter((name) => /(^|\/)node_modules\/zod$/.test(name));
    expect(zodEntries).toEqual(['node_modules/zod']);
    expect(lock.packages['node_modules/zod']?.version).toBe(pkg.dependencies?.zod);
  });

  it('adds no package with an install script (the only ones are the three from before)', () => {
    const withScripts = Object.entries(lock.packages)
      .filter(([, entry]) => entry.hasInstallScript)
      .map(([name]) => name)
      .sort();
    expect(withScripts).toEqual(['node_modules/esbuild', 'node_modules/fsevents', 'node_modules/tesseract.js']);
  });
});

describe('the static site', () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : files(full);
      return /\.(ts|tsx|js|mjs|json|html|css)$/.test(name) ? [full] : [];
    });
  }

  it('never refers to the SDK or to tools/', () => {
    const offenders = files('web').filter((file) => /modelcontextprotocol|mcp-records|(['"/.])tools\//.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('is built by a Pages workflow that does not start the records server', () => {
    const workflow = readFileSync('.github/workflows/pages.yml', 'utf8');
    expect(workflow).toContain('npm ci');
    expect(workflow).not.toMatch(/mcp-records|modelcontextprotocol/);
  });
});
