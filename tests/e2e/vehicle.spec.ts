/**
 * Vehicle module e2e: screenshots of the harness (driver POV with dashboard + mirrors,
 * chase view, night with headlights) and a scripted drive that checks the performance
 * envelope through window.__vehicleDebug (simulation time, so SwiftShader speed is irrelevant).
 */
import { expect, test, type Page } from '@playwright/test';

interface Debug {
  time: number;
  speedKmh: number;
  rpm: number;
  gear: string;
  phase: string;
  throttleStart: number;
  brakeStart: number;
  engineOn: boolean;
  colliders: number;
  fps: number;
  mode: string;
}

const readDebug = (page: Page): Promise<Debug> => page.evaluate(() => (window as unknown as { __vehicleDebug: Debug }).__vehicleDebug);

async function waitForSimTime(page: Page, t: number, timeout = 90_000): Promise<Debug> {
  await page.waitForFunction((target) => ((window as unknown as { __vehicleDebug?: { time: number } }).__vehicleDebug?.time ?? 0) >= target, t, { timeout });
  return readDebug(page);
}

test.use({ viewport: { width: 960, height: 540 } });

test.describe('vehicle harness', () => {
  test('boots, renders the driver POV with dashboard and mirrors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/dev/vehicle.html?engine=1&indicator=left&lights=low');
    const d = await waitForSimTime(page, 1.5);
    expect(d.colliders).toBeGreaterThan(20);
    expect(d.engineOn).toBe(true);
    await page.screenshot({ path: 'test-results/vehicle-pov.png' });
    expect(errors).toEqual([]);
  });

  test('chase camera view', async ({ page }) => {
    await page.goto('/dev/vehicle.html?chase=1&engine=1&lights=low');
    const d = await waitForSimTime(page, 1.0);
    expect(d.mode).toBe('chase');
    await page.screenshot({ path: 'test-results/vehicle-chase.png' });
  });

  test('night view with headlights', async ({ page }) => {
    await page.goto('/dev/vehicle.html?night=1&engine=1&lights=low');
    await waitForSimTime(page, 1.0);
    await page.screenshot({ path: 'test-results/vehicle-night.png' });
    await page.goto('/dev/vehicle.html?night=1&chase=1&engine=1&lights=high');
    await waitForSimTime(page, 1.0);
    await page.screenshot({ path: 'test-results/vehicle-night-chase.png' });
  });

  test('scripted drive: > 40 km/h after 4 s of full throttle, < 2 km/h within 3 s of full braking', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/dev/vehicle.html?autodrive=1&road=1');
    const start = await waitForSimTime(page, 0.1);
    const t4 = await waitForSimTime(page, start.throttleStart + 4.0);
    expect(t4.engineOn).toBe(true);
    expect(t4.gear).toBe('D');
    expect(t4.speedKmh).toBeGreaterThan(40);
    const atBrake = await waitForSimTime(page, start.brakeStart + 0.05);
    expect(atBrake.phase).toBe('brake');
    const t3 = await waitForSimTime(page, start.brakeStart + 3.0);
    expect(Math.abs(t3.speedKmh)).toBeLessThan(2);
    await page.screenshot({ path: 'test-results/vehicle-autodrive.png' });
    expect(errors).toEqual([]);
  });
});
