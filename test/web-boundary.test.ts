import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// The site must only use pure schema modules from src/ and nothing Node-only.
async function lint(code: string, file = 'web/src/probe.ts') {
  const eslint = new ESLint({ cwd: process.cwd() });
  const [result] = await eslint.lintText(code, { filePath: file });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports');
}

describe('web/src import boundary', () => {
  it.each([
    "import fs from 'node:fs';",
    "import { readFileSync } from 'fs';",
    "import path from 'path';",
    "import x from '../../src/scripts/precompute.js';",
    "import x from '../../src/ocr/local.js';",
    "import x from '../../src/eval/match.js';",
    "import x from '../../src/extract/gemini.js';",
    "import x from '../../src/extract/recorded.js';",
    "import x from '../../src/extract/model.js';",
    "import x from '../../src/extract/index.js';",
    "import x from '../../src/extract/checks.js';",
    "import x from '../../src/generator/data.js';",
    "import x from '../../src/validators/other.js';",
    "import x from 'tesseract.js';",
  ])('rejects %s', async (code) => {
    expect((await lint(`${code}\nexport default x;`)).length).toBeGreaterThan(0);
  });

  it.each([
    "import { SampleIndexSchema } from '../../src/samples/schema.js';",
    "import { FieldSchema } from '../../src/extract/schema.js';",
    "import { isValidNpi } from '../../src/validators/npi.js';",
    "import { dobProblem } from '../../src/validators/dob.js';",
    "import { isValidPhone } from '../../src/validators/phone.js';",
    "import { NPI_FLAG } from '../../src/validators/messages.js';",
    "import { z } from 'zod';",
    "import { App } from './App';",
  ])('allows %s', async (code) => {
    expect(await lint(code)).toEqual([]);
  });
});

describe('validators used by the site', () => {
  // The site bundles these, so they must be pure and browser-safe.
  it.each(['npi', 'dob', 'phone', 'messages'])('src/validators/%s.ts has no imports from node or extract', (name) => {
    const source = readFileSync(`src/validators/${name}.ts`, 'utf8');
    const specifiers = [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    for (const specifier of specifiers) {
      expect(specifier.startsWith('node:')).toBe(false);
      expect(builtinModules).not.toContain(specifier);
      expect(specifier).not.toMatch(/extract|generator|scripts|ocr/);
    }
    expect(source).not.toMatch(/\b(process|require|Buffer)\b/);
  });
});
