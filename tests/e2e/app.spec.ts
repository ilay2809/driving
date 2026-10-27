import { expect, test, type Page } from '@playwright/test';

type AppWindow = Window & { __app?: { session: { ctx: { time: number; player: { speed: number; gear: string; engineOn: boolean }; localisation: { laneId?: string } }; worldRenderer: { stats(): { drawCalls: number; triangles: number; tilesLoaded: number } } } | null } };

async function collectErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

test.describe('application flow', () => {
  test('main menu → training ground → drive', async ({ page }) => {
    test.setTimeout(240_000);
    const errors = await collectErrors(page);
    await page.goto('/');
    await expect(page.locator('[data-item="training"]')).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: 'test-results/app-menu.png' });

    await page.locator('[data-item="training"]').click();
    const start = page.locator('button.btn-lg').first();
    await expect(start).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: 'test-results/app-free-setup.png' });
    await start.click();

    // wait until the session runs
    await page.waitForFunction(() => {
      const w = window as unknown as AppWindow;
      return !!w.__app?.session && w.__app.session.ctx.time > 0.5;
    }, undefined, { timeout: 120_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/app-drive-start.png' });

    // seatbelt; brake pressed while starting the engine and shifting to D (as in a real automatic);
    // release the parking brake, then throttle
    await page.keyboard.press('KeyB');
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(400);
    await page.keyboard.press('KeyI');
    await page.waitForTimeout(400);
    await page.keyboard.press('KeyD');
    await page.waitForTimeout(300);
    await page.keyboard.press('Space');
    await page.keyboard.up('ArrowDown');
    await page.waitForTimeout(200);
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(5000);
    await page.keyboard.up('ArrowUp');
    const state = await page.evaluate(() => {
      const w = window as unknown as AppWindow;
      const s = w.__app!.session!;
      return { speed: s.ctx.player.speed, gear: s.ctx.player.gear, engineOn: s.ctx.player.engineOn, lane: s.ctx.localisation.laneId, stats: s.worldRenderer.stats(), time: s.ctx.time };
    });
    console.log('drive state', JSON.stringify(state));
    await page.screenshot({ path: 'test-results/app-driving.png' });
    expect(state.engineOn).toBe(true);
    expect(state.gear).toBe('D');
    expect(state.speed).toBeGreaterThan(3);
    expect(state.lane).toBeDefined();
    expect(errors.filter((e) => !/favicon|DecompressionStream/.test(e))).toEqual([]);
  });
});
