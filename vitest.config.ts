import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The local OCR test runs Tesseract once; allow for slow machines.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        // Site tests only. jsdom is used here and nowhere else.
        extends: true,
        plugins: [react()],
        test: {
          name: 'web',
          include: ['web/src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['web/src/test-setup.ts'],
        },
      },
    ],
  },
})
