import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import { builtinModules } from 'node:module'

// The read-only records server (tools/mcp-records). It reads only the committed sample JSON and uses only the pure
// validators: no file system module (reads go through src/scripts/read-guard.ts), no network, no process.env, no
// writing to stdout, nothing that mentions the answer-key files, and nothing from the site or the pipeline.
// `allowedBuiltins` are the only Node built-ins a file may import (data.ts needs path and url to find its folder).
function recordsServerRules({ allowedBuiltins = [], allowProtocolLayer = false } = {}) {
  const bannedBuiltins = builtinModules.filter((name) => !allowedBuiltins.includes(name));
  return {
    'no-restricted-imports': [
      'error',
      {
        paths: [...bannedBuiltins, 'dotenv', 'undici', 'node-fetch', 'axios', 'tesseract.js'].map((name) => ({
          name,
          message: 'The records server may not use this module (no file system, network or process access).',
        })),
        patterns: [
          { group: ['**/eval', '**/eval/*', '**/eval/**'], message: 'src/eval is evaluation code. Production code must not import it.' },
          { group: ['**/proof*'], message: 'The proof is the only script that reads answer-key files. Do not import it here.' },
          {
            regex: allowedBuiltins.length === 0 ? '^node:' : `^node:(?!(${allowedBuiltins.join('|')})$)`,
            message: `The records server may not use Node built-ins${allowedBuiltins.length ? ` except ${allowedBuiltins.join(' and ')}` : ''}.`,
          },
          { regex: '(^|/)web/', message: 'The records server must not import site code.' },
          {
            // The same pure modules the site may import, plus the read guard that every read goes through.
            regex:
              '(^|/)src/(?!((samples|extract)/schema|validators/(npi|dob|phone|messages)|scripts/read-guard)(\\.js|\\.ts)?$)',
            message:
              'The records server may import only src/samples/schema, src/extract/schema, src/validators/{npi,dob,phone,messages} and src/scripts/read-guard.',
          },
          ...(allowProtocolLayer ? [] : [{ group: ['@modelcontextprotocol/*'], message: 'Only server.ts imports the protocol layer.' }]),
        ],
      },
    ],
    'no-restricted-syntax': [
      'error',
      {
        selector: 'Literal[value=/truth/i]',
        message: 'The records server must not mention answer-key files. Every read goes through the read guard.',
      },
      {
        selector: 'TemplateElement[value.raw=/truth/i]',
        message: 'The records server must not mention answer-key files. Every read goes through the read guard.',
      },
      { selector: 'Identifier[name=/truth/i]', message: 'The records server must not use answer-key data.' },
      { selector: "CallExpression[callee.name='fetch']", message: 'The records server never uses the network.' },
      {
        selector: 'NewExpression[callee.name=/^(XMLHttpRequest|WebSocket|EventSource)$/]',
        message: 'The records server never uses the network.',
      },
      { selector: "MemberExpression[object.name='process'][property.name=/^(env|stdout)$/]", message: 'No process.env and no direct stdout: stdout is the protocol channel.' },
      {
        selector: "MemberExpression[object.name='console'][property.name=/^(log|info|debug|table|dir)$/]",
        message: 'console.log writes to stdout, which is the protocol channel. Use console.error.',
      },
      { selector: 'ImportExpression', message: 'No dynamic imports: every import is static and checked.' },
      { selector: "CallExpression[callee.name='eval']", message: 'No eval.' },
      { selector: "NewExpression[callee.name='Function']", message: 'No new Function.' },
    ],
  };
}

export default tseslint.config(
  { ignores: ['node_modules', 'dist', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // src/eval is evaluation code (matching, confidence sweeps). The production
    // pipeline must never depend on it, so nothing under src/ except src/eval itself
    // may import from it. Tests and scripts outside src/ are free to use it.
    files: ['src/**/*.ts'],
    ignores: ['src/eval/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/eval', '**/eval/*', '**/eval/**'],
              message: 'src/eval is evaluation code. Production code must not import it.',
            },
          ],
        },
      ],
    },
  },
  {
    // The sample-data code (precompute script, its library and the shared schema) must
    // never read the answer-key files the fax generator writes, and must not import the
    // proof or evaluation code. Reads go through src/scripts/read-guard.ts, which is
    // outside this block. This block replaces the no-restricted-imports rule above for
    // these files, so the eval pattern is repeated.
    files: ['src/scripts/precompute*.ts', 'src/samples/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/eval', '**/eval/*', '**/eval/**'],
              message: 'src/eval is evaluation code. Production code must not import it.',
            },
            {
              group: ['**/proof*'],
              message: 'The proof is the only script that reads answer-key files. Do not import it here.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/truth/i]',
          message: 'Sample-data code must not mention answer-key files. Use the read guard for every read.',
        },
        {
          selector: 'TemplateElement[value.raw=/truth/i]',
          message: 'Sample-data code must not mention answer-key files. Use the read guard for every read.',
        },
        {
          selector: 'Identifier[name=/truth/i]',
          message: 'Sample-data code must not use answer-key data.',
        },
      ],
    },
  },
  {
    // The static site runs in the browser. From src/ it may import only the pure Zod
    // schema modules and the pure validators listed in the regex below. No Node built-ins, no file readers,
    // no OCR, no readers, no scripts, no evaluation code.
    files: ['web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...builtinModules, 'tesseract.js', 'dotenv'].map((name) => ({
            name,
            message: 'The site runs in the browser. Node-only modules are not allowed here.',
          })),
          patterns: [
            {
              regex: '^node:',
              message: 'The site runs in the browser. Node built-ins are not allowed here.',
            },
            {
              // Anything under a src/ folder except the allowed schema modules and the
              // pure validators.
              regex:
                '(^|/)src/(?!((samples|extract)/schema|validators/(npi|dob|phone|messages))(\\.js|\\.ts)?$)',
              message:
                'The site may import only src/samples/schema, src/extract/schema and src/validators/{npi,dob,phone,messages} from src/.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['tools/mcp-records/**/*.ts'],
    rules: recordsServerRules(),
  },
  {
    files: ['tools/mcp-records/data.ts'],
    rules: recordsServerRules({ allowedBuiltins: ['path', 'url'] }),
  },
)
