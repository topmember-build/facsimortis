/**
 * Static checks on tools/mcp-records: what the files say, and that the lint rules that guard them really fire.
 * server.ts (M1b) is added to the scans by its own tests; this file covers the data and tool code.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const DIR = 'tools/mcp-records';
const CODE_FILES = readdirSync(DIR).filter((name) => name.endsWith('.ts') && name !== 'server.ts');
const KEY = 'tru' + 'th';

function code(name: string): string {
  // Comments may talk about forbidden things; the rules apply to code, so drop comments before looking.
  return readFileSync(`${DIR}/${name}`, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function importsOf(source: string): string[] {
  return [...source.matchAll(/^\s*import\s[^;]*?from\s+'([^']+)'/gm)].map((match) => match[1] ?? '');
}

const ALLOWED_IMPORTS: Record<string, readonly string[]> = {
  'data.ts': ['node:path', 'node:url', '../../src/samples/schema.js', '../../src/scripts/read-guard.js'],
  'tools.ts': [
    'zod',
    '../../src/extract/schema.js',
    '../../src/samples/schema.js',
    '../../src/validators/dob.js',
    '../../src/validators/messages.js',
    '../../src/validators/npi.js',
    '../../src/validators/phone.js',
    './data.js',
  ],
};

describe('the data and tool files', () => {
  it('are the files this test knows about', () => {
    expect(CODE_FILES.sort()).toEqual(['data.ts', 'tools.ts']);
  });

  it.each(CODE_FILES)('%s never mentions the answer-key files, even in a comment', (name) => {
    expect(readFileSync(`${DIR}/${name}`, 'utf8').toLowerCase()).not.toContain(KEY);
  });

  it.each(CODE_FILES)('%s imports only what is allowed', (name) => {
    expect(importsOf(code(name)).sort()).toEqual([...(ALLOWED_IMPORTS[name] ?? [])].sort());
  });

  it.each(CODE_FILES)('%s has no file system, network, process, console.log, write or dynamic code', (name) => {
    const source = code(name);
    const banned: [string, RegExp][] = [
      ['node:fs or fs', /['"](node:)?fs(\/promises)?['"]/],
      ['child_process', /child_process/],
      ['network modules', /['"](node:)?(net|http|https|http2|dgram|dns|tls)['"]/],
      ['fetch', /\bfetch\s*\(/],
      ['process.env', /process\s*\.\s*env/],
      ['process.stdout', /process\s*\.\s*stdout/],
      ['console.log', /console\s*\.\s*(log|info|debug)/],
      ['write APIs', /\b(writeFile|appendFile|createWriteStream|mkdir|unlink|rmSync|rename|copyFile)\w*\s*\(/],
      ['dynamic import', /\bimport\s*\(/],
      ['require', /\brequire\s*\(/],
      ['eval', /\beval\s*\(|new\s+Function\b/],
    ];
    for (const [label, pattern] of banned) expect(pattern.test(source), `${name}: ${label}`).toBe(false);
  });

  it('data.ts reads only through readInput', () => {
    const source = code('data.ts');
    expect(source).toMatch(/import \{[^}]*\breadInput\b[^}]*\} from '\.\.\/\.\.\/src\/scripts\/read-guard\.js'/);
    expect(source).toMatch(/options\.read \?\? readInput/);
    expect(source).not.toMatch(/readFileSync|readFile\b|createReadStream/);
  });

  it('tools.ts is pure: it does not import data access other than the store type and error', () => {
    const source = code('tools.ts');
    expect(source).toMatch(/import \{ SampleDataError, type SampleStore \} from '\.\/data\.js'/);
    expect(source).not.toMatch(/createSampleStore|DEFAULT_SAMPLES_DIR/);
  });
});

describe('the project config includes the tools folder', () => {
  it('tsconfig.json lists tools', () => {
    const config = JSON.parse(readFileSync('tsconfig.json', 'utf8')) as { include: string[] };
    expect(config.include).toContain('tools');
  });
});

describe('the lint rules fire', () => {
  async function messages(text: string, file: string): Promise<string[]> {
    const eslint = new ESLint({ cwd: process.cwd() });
    const [result] = await eslint.lintText(text, { filePath: file });
    return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports' || m.ruleId === 'no-restricted-syntax').map((m) => m.message);
  }

  const TOOLS_FILE = `${DIR}/tools.ts`;
  const DATA_FILE = `${DIR}/data.ts`;

  it.each([
    "import fs from 'node:fs';\nexport default fs;",
    "import fs from 'fs';\nexport default fs;",
    "import { readFileSync } from 'node:fs';\nexport default readFileSync;",
    "import c from 'node:child_process';\nexport default c;",
    "import h from 'node:http';\nexport default h;",
    "import n from 'node:net';\nexport default n;",
    "import p from 'node:path';\nexport default p;",
    "import x from '../../web/src/record.js';\nexport default x;",
    "import x from '../../src/extract/gemini.js';\nexport default x;",
    "import x from '../../src/eval/match.js';\nexport default x;",
    "import x from '../../src/scripts/proof.js';\nexport default x;",
    "import x from 'tesseract.js';\nexport default x;",
    "import x from '@modelcontextprotocol/server';\nexport default x;",
  ])('rejects in tools.ts: %s', async (text) => {
    expect((await messages(text, TOOLS_FILE)).length).toBeGreaterThan(0);
  });

  it.each([
    "import fs from 'node:fs';\nexport default fs;",
    "import c from 'node:child_process';\nexport default c;",
    "import h from 'node:http';\nexport default h;",
    "import o from 'node:os';\nexport default o;",
  ])('rejects in data.ts: %s', async (text) => {
    expect((await messages(text, DATA_FILE)).length).toBeGreaterThan(0);
  });

  it('lets data.ts import node:path and node:url, and tools.ts import the pure modules', async () => {
    expect(await messages("import { join } from 'node:path';\nimport { fileURLToPath } from 'node:url';\nexport default [join, fileURLToPath];", DATA_FILE)).toEqual([]);
    expect(await messages("import { z } from 'zod';\nimport { isValidNpi } from '../../src/validators/npi.js';\nexport default [z, isValidNpi];", TOOLS_FILE)).toEqual([]);
    expect(await messages("import { readInput } from '../../src/scripts/read-guard.js';\nexport default readInput;", DATA_FILE)).toEqual([]);
  });

  it.each([
    ["export const a = fetch('https://example.invalid');", 'fetch'],
    ['export const a = process.env.KEY;', 'process.env'],
    ["export const a = process.stdout.write('x');", 'stdout'],
    ["console.log('x');", 'console.log'],
    ["export const a = await import('node:fs');", 'dynamic import'],
    ["export const a = eval('1');", 'eval'],
    [`export const a = 'fax-0003.${KEY}.json';`, 'answer-key string'],
    [`export const ${KEY}Data = 1;`, 'answer-key name'],
  ])('rejects the code %s (%s)', async (text) => {
    expect((await messages(text, TOOLS_FILE)).length).toBeGreaterThan(0);
  });

  it('allows console.error', async () => {
    expect(await messages("console.error('started');", TOOLS_FILE)).toEqual([]);
  });
});
