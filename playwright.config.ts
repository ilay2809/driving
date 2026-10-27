import { defineConfig } from '@playwright/test';
import { createHash } from 'node:crypto';

// Headless Chromium needs software GL for WebGL2 in CI/cloud containers.
const gpuArgs = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--enable-webgl',
  '--disable-dev-shm-usage',
];

// Each checkout (main tree, agent worktrees, CI) gets its own preview port so that
// parallel e2e runs never reuse another checkout's preview server by accident.
// Override with PW_PORT when needed.
const hashedPort = 4300 + (parseInt(createHash('sha1').update(process.cwd()).digest('hex').slice(0, 6), 16) % 400);
export const PREVIEW_PORT = Number(process.env.PW_PORT ?? hashedPort);
const baseURL = `http://127.0.0.1:${PREVIEW_PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL,
    headless: true,
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: gpuArgs },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `pnpm exec vite preview --host 127.0.0.1 --port ${PREVIEW_PORT} --strictPort${process.env.PW_OUT_DIR ? ` --outDir ${process.env.PW_OUT_DIR}` : ''}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
