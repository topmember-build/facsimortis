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
)
