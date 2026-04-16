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

  const plotPointCount = await page.evaluate(() => {
    const model = window.freeboard.getLiveModel();
    const widget = model.panes().flatMap((p) => p.widgets()).find((w) => w.type() === 'owntech_plot_uplot');
    return widget.widgetInstance.dataBuffer[0].length;
  });
  expect(plotPointCount).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Save Latest CSV' }).click();
  await page.waitForFunction(async () => {
    const status = await window.api.serial.getFastStatus('COM_MOCK');
    return status && status.state === 'saved';
  });

  await app.close();
});
