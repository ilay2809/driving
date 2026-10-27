/**
 * Screenshot the content dev harness served by `pnpm preview` (http://127.0.0.1:4173/dev/content.html)
 * into test-results/content/dev-content.png and print the loaded counts.
 *
 * Usage: pnpm build && pnpm preview &   then   npx tsx tools/content/screenshot-dev-content.ts
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'test-results/content');
const URL = process.env.DEV_CONTENT_URL ?? 'http://127.0.0.1:4173/dev/content.html';
const gpuArgs = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage'];

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: gpuArgs });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1.5 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  // the preview server may still be starting — retry the first navigation for ~20 s
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(URL);
      break;
    } catch (err) {
      if (attempt >= 40) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await page.waitForSelector('#root[data-ready]', { timeout: 60_000 });
  const ready = await page.getAttribute('#root', 'data-ready');
  const counts = await page.evaluate(() => (window as unknown as { __content?: unknown }).__content);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: join(OUT, 'dev-content.png'), fullPage: false });
  await page.screenshot({ path: join(OUT, 'dev-content-full.png'), fullPage: true });
  await browser.close();
  console.log('ready:', ready, 'counts:', JSON.stringify(counts), 'errors:', errors.length ? errors : 'none');
  if (ready !== '1' || errors.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
