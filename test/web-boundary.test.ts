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
    "import x from 'tesseract.js';",
  ])('rejects %s', async (code) => {
    expect((await lint(`${code}\nexport default x;`)).length).toBeGreaterThan(0);
  });

  it.each([
    "import { SampleIndexSchema } from '../../src/samples/schema.js';",
    "import { FieldSchema } from '../../src/extract/schema.js';",
    "import { z } from 'zod';",
    "import { App } from './App';",
  ])('allows %s', async (code) => {
    expect(await lint(code)).toEqual([]);
  });
});
