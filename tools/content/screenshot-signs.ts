/**
 * Visual check of the generated sign catalogue: opens public/signs/index.html in headless
 * Chromium (via file://, no server needed) and writes test-results/signs/index.png plus one
 * PNG per category section at 2× scale.
 *
 * Usage: pnpm content:signs && npx tsx tools/content/screenshot-signs.ts
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'test-results/signs');
const gpuArgs = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage'];

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: gpuArgs });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(join(ROOT, 'public/signs/index.html')).href);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: join(OUT, 'index.png'), fullPage: true });
  const sections = page.locator('section');
  const n = await sections.count();
  for (let i = 0; i < n; i++) {
    const sec = sections.nth(i);
    const title = (await sec.locator('h2').innerText()).replace(/\s+/g, ' ').trim();
    await sec.screenshot({ path: join(OUT, `section-${i + 1}.png`) });
    console.log(`section-${i + 1}.png: ${title}`);
  }
  await browser.close();
  console.log(`screenshots in ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
