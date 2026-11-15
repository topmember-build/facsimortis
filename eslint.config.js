import js from '@eslint/js'
import tseslint from 'typescript-eslint'

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
)
