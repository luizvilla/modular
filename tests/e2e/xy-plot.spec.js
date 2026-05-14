const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

test.setTimeout(60_000);

test('xy plot renders, clears history, and updates sources via manager', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  await loadDashboard(page, fixturePath('xy_plot_dashboard.json'));

  await page.waitForSelector('.uplot', { timeout: 15_000 });
  await page.waitForFunction(() => {
    const model = window.freeboard?.getLiveModel?.();
    if (!model) return false;
    const widget = model.panes().flatMap((p) => p.widgets()).find((w) => w.type() === 'xy_plot_uplot');
    return !!widget && widget.widgetInstance.dataBuffer[0].length >= 3;
  });

  const initialPointCount = await page.evaluate(() => {
    const model = window.freeboard.getLiveModel();
    const widget = model.panes().flatMap((p) => p.widgets()).find((w) => w.type() === 'xy_plot_uplot');
    return widget.widgetInstance.dataBuffer[0].length;
  });
  expect(initialPointCount).toBeGreaterThanOrEqual(3);

  await page.locator('.xy-plot-clear').click();
  const clearedPointCount = await page.evaluate(() => {
    const model = window.freeboard.getLiveModel();
    const widget = model.panes().flatMap((p) => p.widgets()).find((w) => w.type() === 'xy_plot_uplot');
    return widget.widgetInstance.dataBuffer[0].length;
  });
  expect(clearedPointCount).toBeLessThan(initialPointCount);
  expect(clearedPointCount).toBeLessThanOrEqual(2);

  await page.waitForFunction(() => {
    const manager = window.freeboard.getLiveModel().panes()[1]?.widgets?.()[0]?.widgetInstance;
    return manager
      && manager.controls
      && manager.controls.widget
      && manager.controls.widget.val()
      && document.querySelectorAll('.xy-plot-manager select').length >= 6;
  });

  const selects = page.locator('.xy-plot-manager select');
  await selects.nth(5).selectOption('XWave');
  await page.getByRole('button', { name: 'Apply to XY Plot' }).click();
  await page.waitForFunction(() => {
    const model = window.freeboard.getLiveModel();
    const widget = model.panes().flatMap((p) => p.widgets()).find((w) => w.type() === 'xy_plot_uplot');
    const settings = widget.settings();
    return settings.ySourceDef && settings.ySourceDef.ds === 'XWave';
  });
  await app.close();
});
