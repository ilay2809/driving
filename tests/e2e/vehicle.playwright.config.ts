/**
 * Private Playwright config for the vehicle spec: serves THIS checkout's dist/ on its own
 * port so a preview server left running by another worktree on :4173 cannot answer.
 *   pnpm build && npx playwright test --config tests/e2e/vehicle.playwright.config.ts
 */
import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const port = Number(process.env.VEHICLE_E2E_PORT ?? 4181);

const gpuArgs = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage'];

export default defineConfig({
  testDir: here,
  testMatch: /vehicle\.spec\.ts$/,
  timeout: 240_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: resolve(root, 'test-results'),
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    viewport: { width: 960, height: 540 },
    launchOptions: { args: gpuArgs },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npx vite preview --port ${port} --strictPort`,
    cwd: root,
    url: `http://127.0.0.1:${port}/dev/vehicle.html`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
