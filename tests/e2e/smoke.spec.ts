import { expect, test } from '@playwright/test';

test('the app boots and renders the shell', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect(page.locator('#ui')).toContainText(/סימולטור/, { timeout: 30_000 });
  expect(errors).toEqual([]);
});
