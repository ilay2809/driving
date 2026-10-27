import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Dev harness pages (dev/*.html) are built alongside the app so modules can be
// developed and screenshot-tested in isolation: /dev/<name>.html
const devPages = Object.fromEntries(
  readdirSync(resolve(__dirname, 'dev'), { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.html'))
    .map((d) => [`dev-${d.name.replace(/\.html$/, '')}`, resolve(__dirname, 'dev', d.name)]),
);

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
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), ...devPages } },
  },
  server: { port: 5173, strictPort: false },
  assetsInclude: ['**/*.gz'],
});
