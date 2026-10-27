// Screenshot runner for dev/world-viewer.html with headless Chromium (SwiftShader WebGL).
//
//   pnpm build && pnpm preview &          # serves http://127.0.0.1:4173
//   node src/dev/worldViewer.shots.mjs [shot ...]   # default: every training-ground shot
//
// PNGs land in test-results/ (git-ignored) and the renderer stats of each shot are printed.
/* global console, fetch, process, setTimeout, document */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = process.env.OUT ?? 'test-results';
mkdirSync(OUT, { recursive: true });
const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage'];
const base = process.env.BASE ?? 'http://127.0.0.1:4173/dev/world-viewer.html';

const ALL = {
  birdseye: '?world=training-ground&view=orbit&signals=cycle',
  'n11-driver': '?view=driver&x=-62&z=1.65&h=0',
  'n11-close': '?view=driver&x=-24&z=1.65&h=0',
  roundabout: '?view=driver&x=262&z=1.65&h=0',
  oneway: '?view=driver&x=-119&z=120&h=0',
  'stop-n12': '?view=driver&x=-1.5&z=70&h=1.5707963',
  night: '?view=driver&x=-62&z=1.65&h=0&hour=22',
  rain: '?view=driver&x=-62&z=1.65&h=0&weather=rain',
  'high-shadows': '?view=driver&x=-62&z=1.65&h=0&quality=high&hour=15',
  'signal-close': '?view=driver&x=-19&z=5.5&h=0.4',
  'roundabout-close': '?view=driver&x=284&z=1.65&h=0',
  'kerb-redwhite': '?view=driver&x=12&z=-118.5&h=0',
  'busstop-bump': '?view=driver&x=-100&z=120&h=0',
  'name-plates': '?view=driver&x=-8&z=-6&h=-0.6',
  'tlv-bird': '?world=north-tlv&view=orbit',
  'tlv-driver': '?world=north-tlv&view=driver&x=0&z=0&h=0',
  'stress-driver': '?world=stress&view=driver&x=-50&z=1.65&h=0',
  'stress-bird': '?world=stress&view=orbit',
  'stress-block': '?world=stress&view=orbit&x=55&z=55&alt=160',
  'stress-stream': '?world=stress&view=driver&x=-50&z=1.65&h=0',
  'stress-night': '?world=stress&view=driver&x=-50&z=1.65&h=0&hour=21',
  'name-close': '?view=driver&x=-10.86&z=6.74&h=2.586&y=2.6&ty=2.72&td=2.4',
  raised: '?world=stress&view=driver&x=-737&z=-658.4&h=0',
  'svg-sign': '?view=driver&x=-1.5&z=95&h=1.5707963',
};
// shots with a second phase after the page is ready (e.g. warm streaming measurements)
const AFTER = {
  // preload around the spawn, then jump 700 m east and stream the new tiles with the per-frame budget
  'stress-stream': async (page) => {
    await page.evaluate(() => {
      const v = globalThis.__worldViewer;
      v.resetStats();
      v.setView('driver', 650, 1.65, 0);
    });
    await page.waitForFunction(() => globalThis.__worldViewer.stats().tilesPending === 0 && globalThis.__worldViewer.stats().frames > 40, null, { timeout: 240_000 });
    await page.waitForTimeout(500);
  },
};
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ALL).filter((k) => !k.startsWith('tlv') && !k.startsWith('stress'));

// wait for the preview server
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(base);
    if (r.ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({ args, headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[console.${m.type()}] ${m.text()}`);
});
for (const name of names) {
  const q = ALL[name];
  if (!q) {
    console.log(`unknown shot ${name}`);
    continue;
  }
  const t0 = Date.now();
  await page.goto(base + q, { waitUntil: 'load', timeout: 180_000 });
  try {
    await page.waitForFunction(() => (globalThis.__worldViewer && globalThis.__worldViewer.ready) || document.querySelector('#message.show'), null, { timeout: 240_000 });
  } catch {
    const msg = await page.locator('#message').textContent().catch(() => '');
    console.log(`${name}: not ready (${msg})`);
  }
  await page.waitForTimeout(1500);
  if (AFTER[name]) await AFTER[name](page);
  const stats = await page.evaluate(() => (globalThis.__worldViewer ? globalThis.__worldViewer.stats() : null));
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`${name}: ${JSON.stringify(stats)} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (process.env.DISPOSE) {
    // dispose() must leave an (almost) empty scene and throw nothing
    const after = await page.evaluate(() => {
      const v = globalThis.__worldViewer;
      v.dispose();
      v.renderOnce();
      return { calls: v.renderer.info.render.calls, triangles: v.renderer.info.render.triangles, children: v.scene.children.length };
    });
    console.log(`${name}: after dispose ${JSON.stringify(after)}`);
  }
}
if (errors.length) console.log('page errors/warnings:\n' + errors.join('\n'));
await browser.close();
