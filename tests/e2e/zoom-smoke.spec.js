const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard } = require('./helpers');

test.setTimeout(60_000);

test('zoom buttons appear and change the zoom level', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await expect(page.locator('#zoom-out-btn')).toBeVisible();
  await expect(page.locator('#zoom-in-btn')).toBeVisible();
  await expect(page.locator('#zoom-level-label')).toHaveText('100%');

  // Zoom out once → 90%
  await page.locator('#zoom-out-btn').click();
  await expect(page.locator('#zoom-level-label')).toHaveText('90%', { timeout: 3_000 });

  // Zoom in twice → 110%
  await page.locator('#zoom-in-btn').click();
  await page.locator('#zoom-in-btn').click();
  await expect(page.locator('#zoom-level-label')).toHaveText('110%', { timeout: 3_000 });

  // Double-click label → reset to 100%
  await page.locator('#zoom-level-label').dblclick();
  await expect(page.locator('#zoom-level-label')).toHaveText('100%', { timeout: 3_000 });

  await app.close();
});
