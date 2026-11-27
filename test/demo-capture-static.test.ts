import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// V1a. Static checks on tools/demo-capture: it never mentions answer-key or fixture files, imports only what
// it needs, touches files only through paths.ts, and nothing the site ships imports it.

const DIR = 'tools/demo-capture';
const CODE_FILES = readdirSync(DIR).filter((name) => name.endsWith('.ts'));
const KEY = 'tru' + 'th';
const FIXTURES = 'fix' + 'tures';

function code(name: string): string {
  return readFileSync(`${DIR}/${name}`, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function importsOf(source: string): string[] {
  return [...source.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((match) => match[1] ?? '');
}

const ALLOWED_IMPORTS: Record<string, readonly string[]> = {
  'export-card.ts': ['zod'],
  'labels.ts': [],
  'paths.ts': ['node:fs', 'node:path', 'node:url'],
  'plan.ts': [],
  'steps.ts': ['./labels.js'],
};

describe('the demo capture files', () => {
  it('are the files this test knows about', () => {
    expect(CODE_FILES.sort()).toEqual(Object.keys(ALLOWED_IMPORTS).sort());
  });

  it.each(CODE_FILES)('%s never mentions answer-key or fixture files, even in a comment', (name) => {
    const text = readFileSync(`${DIR}/${name}`, 'utf8').toLowerCase();
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(FIXTURES);
  });

  it.each(CODE_FILES)('%s imports only what is allowed', (name) => {
    expect(importsOf(code(name)).sort()).toEqual([...(ALLOWED_IMPORTS[name] ?? [])].sort());
  });

  it.each(CODE_FILES.filter((name) => name !== 'paths.ts'))('%s has no file access, dynamic import, require or eval', (name) => {
    const source = code(name);
    const banned: [string, RegExp][] = [
      ['fs', /['"](node:)?fs(\/promises)?['"]/],
      ['file APIs', /\b(readFile|writeFile|appendFile|createReadStream|createWriteStream|mkdir|unlink|rmSync|rename|copyFile)\w*\s*\(/],
      ['dynamic import', /\bimport\s*\(/],
      ['require', /\brequire\s*\(/],
      ['eval', /\beval\s*\(|new\s+Function\b/],
    ];
    for (const [label, pattern] of banned) expect(pattern.test(source), `${name}: ${label}`).toBe(false);
  });
});

describe('nothing the site ships imports the capture tool', () => {
  function siteFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return siteFiles(full);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !/^test-/.test(name) ? [full] : [];
    });
  }

  it('no site source file outside the tests mentions tools/', () => {
    const files = siteFiles('web/src');
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) expect(readFileSync(file, 'utf8'), file).not.toMatch(/tools\//);
  });

  it('the site build config does not mention the capture tool', () => {
    expect(readFileSync('web/vite.config.ts', 'utf8')).not.toContain('demo-capture');
    expect(readFileSync('web/index.html', 'utf8')).not.toContain('demo-capture');
  });
});

describe('the lint rules for the capture tool fire', () => {
  async function messages(text: string, file: string): Promise<string[]> {
    const eslint = new ESLint({ cwd: process.cwd() });
    const [result] = await eslint.lintText(text, { filePath: file });
    return (result?.messages ?? [])
      .filter((m) => m.ruleId === 'no-restricted-imports' || m.ruleId === 'no-restricted-syntax')
      .map((m) => m.message);
  }

  const ANY_FILE = `${DIR}/scene-x.ts`;
  const PATHS_FILE = `${DIR}/paths.ts`;

  it.each([
    "import fs from 'node:fs';\nexport default fs;",
    "import { readFileSync } from 'fs';\nexport default readFileSync;",
    "import fs from 'node:fs/promises';\nexport default fs;",
    "import x from '../../web/src/record.js';\nexport default x;",
    "import x from '../../src/samples/schema.js';\nexport default x;",
    "import x from '../../src/eval/match.js';\nexport default x;",
    "import x from '../../src/scripts/proof.js';\nexport default x;",
    `export const p = 'fax-0003.${KEY}.json';`,
    `export const p = '${FIXTURES}/faxes/fax-0003.png';`,
    'export const p = `${"a"}' + FIXTURES + '/x`;',
    `export const ${KEY}Value = 1;`,
    "export const m = await import('./x.js');",
  ])('rejects in a capture file: %s', async (text) => {
    expect((await messages(text, ANY_FILE)).length).toBeGreaterThan(0);
  });

  it('lets paths.ts use the file system, and only paths.ts', async () => {
    const text = "import { readFileSync } from 'node:fs';\nexport default readFileSync;";
    expect(await messages(text, PATHS_FILE)).toEqual([]);
    expect((await messages(text, ANY_FILE)).length).toBeGreaterThan(0);
  });

  it('still rejects answer-key mentions in paths.ts', async () => {
    expect((await messages(`export const p = 'x.${KEY}.json';`, PATHS_FILE)).length).toBeGreaterThan(0);
  });
});
