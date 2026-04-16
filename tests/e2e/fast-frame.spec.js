const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

test('fast frame control triggers acquisition and saves latest csv', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  await loadDashboard(page, fixturePath('fast_frame_dashboard.json'));

  await page.waitForSelector('.uplot', { timeout: 15_000 });

  await page.getByRole('button', { name: 'Send Trigger' }).click();
  await page.waitForFunction(async () => {
    const status = await window.api.serial.getFastStatus('COM_MOCK');
    return status && status.state === 'complete';
  });

  await page.waitForFunction(() => document.querySelectorAll('.fast-frame-plot .uplot').length > 0);
  const plotCount = await page.locator('.fast-frame-plot .uplot').count();
  expect(plotCount).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Save Latest CSV' }).click();
  await page.waitForFunction(async () => {
    const status = await window.api.serial.getFastStatus('COM_MOCK');
    return status && status.state === 'saved';
  });

  await app.close();
});
