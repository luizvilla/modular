const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

test.setTimeout(60_000);

test('plots and gauges render', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  await loadDashboard(page, fixturePath('test_dashboard.json'));

  await page.waitForSelector('.uplot', { timeout: 15_000 });
  await page.waitForSelector('.legacy-gauge-widget', { timeout: 15_000 });

  const widgetTypes = await page.evaluate(() => {
    const model = window.freeboard?.getLiveModel?.();
    if (!model || typeof model.panes !== 'function') return [];
    const types = [];
    model.panes().forEach((p) => p.widgets().forEach((w) => types.push(w.type())));
    return types;
  });

  expect(widgetTypes).toEqual(expect.arrayContaining([
    'owntech_plot_uplot',
    'vertical_gauge',
    'gauge',
    'uplot_series_manager',
    'vertical_gauge_manager',
  ]));

  await app.close();
});
