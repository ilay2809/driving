import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// GitHub Pages serves the site under /<repo>/ — set BASE_PATH=/driving/ in CI.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
  },
  server: { port: 5173, strictPort: false },
  assetsInclude: ['**/*.gz'],
});
