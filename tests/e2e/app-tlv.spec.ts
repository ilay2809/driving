import { expect, test } from '@playwright/test';

type AppWindow = Window & { __app?: { session: { ctx: { time: number; player: { pos: [number, number] }; localisation: { laneId?: string; roadId?: string } }; world: { name: string; lanes: unknown[] }; worldRenderer: { stats(): { drawCalls: number; triangles: number; tilesLoaded: number } } } | null } };

test('free drive loads the real North Tel Aviv world', async ({ page }) => {
  test.setTimeout(400_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  await page.goto('/');
  await page.locator('[data-item="free"]').click({ timeout: 60_000 });
  const start = page.locator('button.btn-lg').first();
  await expect(start).toBeVisible({ timeout: 120_000 });
  await page.screenshot({ path: 'test-results/tlv-setup.png' });
  const t0 = Date.now();
  await start.click();
  await page.waitForFunction(() => {
    const w = window as unknown as AppWindow;
    return !!w.__app?.session && w.__app.session.ctx.time > 0.5;
  }, undefined, { timeout: 300_000 });
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(2000);
  const info = await page.evaluate(() => {
    const w = window as unknown as AppWindow;
    const s = w.__app!.session!;
    return { world: s.world.name, lanes: s.world.lanes.length, pos: s.ctx.player.pos, lane: s.ctx.localisation.laneId, road: s.ctx.localisation.roadId, stats: s.worldRenderer.stats() };
  });
  console.log('tlv session', loadMs, 'ms', JSON.stringify(info));
  await page.screenshot({ path: 'test-results/tlv-driving.png' });
  expect(info.world).toBe('north-tlv');
  expect(info.lane).toBeDefined();
  expect(errors.filter((e) => !/favicon/.test(e))).toEqual([]);
});
