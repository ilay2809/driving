/**
 * Screenshot the 2-D debug viewer (dev/world-map.html) at a few places of interest
 * with headless Chromium, for visual verification of the pipeline output.
 *
 *   pnpm build && pnpm preview &    # serves dist/ on :4173
 *   tsx tools/world/screenshots.ts  # → test-results/world-map-*.png
 */
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const OUT = 'test-results';

const VIEWS: { name: string; query: string; width?: number; height?: number }[] = [
  { name: 'overview', query: 'world=north-tlv', width: 1400, height: 1000 },
  { name: 'tau-einstein', query: 'world=north-tlv&lon=34.8014&lat=32.1133&zoom=2.4' },
  { name: 'namir-rokach', query: 'world=north-tlv&lon=34.7933&lat=32.0997&zoom=2.4' },
  { name: 'kochav-hatzafon', query: 'world=north-tlv&lon=34.7920&lat=32.1390&zoom=2.4' },
  { name: 'roundabout-reading', query: 'world=north-tlv&lon=34.7946&lat=32.1049&zoom=6' },
  { name: 'roundabout-kedoshei', query: 'world=north-tlv&lon=34.7921&lat=32.1251&zoom=4' },
  { name: 'test-start', query: 'world=north-tlv&lon=34.7965&lat=32.1191&zoom=2.4' },
  { name: 'namir-einstein-signals', query: 'world=north-tlv&lon=34.7925&lat=32.1127&zoom=5' },
  { name: 'training-ground', query: 'world=training-ground&x=120&z=20&zoom=1.6' },
];

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(`${BASE}/dev/world-map.html`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`preview server not reachable at ${BASE} (run: pnpm build && pnpm preview)`);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await waitForServer();
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage'] });
  try {
    for (const v of VIEWS) {
      const page = await browser.newPage({ viewport: { width: v.width ?? 1200, height: v.height ?? 760 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
      });
      const url = `${BASE}/dev/world-map.html?${v.query}`;
      await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
      await page.waitForFunction(() => (window as any).__worldMap?.ready === true, null, { timeout: 180_000 });
      const err = await page.evaluate(() => (window as any).__worldMap?.error);
      await page.waitForTimeout(600);
      const file = `${OUT}/world-map-${v.name}.png`;
      await page.screenshot({ path: file });
      console.log(`${file}${err ? `  ERROR: ${err}` : ''}${errors.length ? `  pageerrors: ${errors.join('; ')}` : ''}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
