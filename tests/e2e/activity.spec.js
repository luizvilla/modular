const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard } = require('./helpers');

test('activity center updates from flash progress', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  // Activity center is disabled by default — enable it so the badge element
  // is created and flash events update the count.
  await page.evaluate(() => window.ActivityToasts.setEnabled(true));

  await page.evaluate(async () => {
    const fw = await window.api.flash.chooseFirmwareFile();
    await window.api.flash.startFlash({ comPort: 'COM_MOCK', firmwarePath: fw });
  });

  await page.waitForSelector('#activity-center-badge', { timeout: 10_000 });
  await page.waitForFunction(() => {
    const badge = document.getElementById('activity-center-badge');
    return badge && parseInt(badge.textContent || '0', 10) > 0;
  }, null, { timeout: 10_000 });

  const count = await page.locator('#activity-center-badge').innerText();
  expect(parseInt(count, 10)).toBeGreaterThan(0);

  await app.close();
});
