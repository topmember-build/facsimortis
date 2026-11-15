import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const webRoot = fileURLToPath(new URL('.', import.meta.url));

// A static site. The base is relative by default so the built folder works from any
// subpath. Set SITE_BASE (for example "/facsimortis/") to build for a fixed path.
export default defineConfig({
  root: webRoot,
  base: process.env['SITE_BASE'] ?? './',
  plugins: [react()],
  // web/public holds samples/ (written by `npm run precompute`); the build copies it.
  publicDir: 'public',
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // The site imports the shared Zod schemas from ../src, one level above web/.
    fs: { allow: ['..'] },
  },
  preview: { port: 4173 },
});