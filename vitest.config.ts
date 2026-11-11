import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    // The local OCR test runs Tesseract once; allow for slow machines.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
