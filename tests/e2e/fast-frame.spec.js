const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

test('fast frame plot reloads a csv and supports time and xy modes', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  const csvPath = fixturePath('fast_frame_plot.csv');

  await page.evaluate(async (targetPath) => {
    await window.api.files.writeText(targetPath, [
      'time_ms,V_high,I_in,duty_cycle',
      '0,10,1,0.2',
      '1,11,2,0.3',
      '2,12,3,0.4',
      '3,13,4,0.5',
    ].join('\n'));
  }, csvPath);

  await loadDashboard(page, fixturePath('fast_frame_dashboard.json'));

  await page.waitForSelector('.uplot', { timeout: 15_000 });
  await page.waitForFunction(() => {
    const widget = window.freeboard.getLiveModel().panes()[0].widgets()[0].widgetInstance;
    return widget && widget.plot && widget.plot.data[1][0] === 10;
  });

  await page.evaluate(async (targetPath) => {
    await window.api.files.writeText(targetPath, [
      'time_ms,V_high,I_in,duty_cycle',
      '0,20,5,0.2',
      '1,21,6,0.3',
      '2,22,7,0.4',
      '3,23,8,0.5',
    ].join('\n'));
  }, csvPath);

  await page.waitForFunction(() => {
    const widget = window.freeboard.getLiveModel().panes()[0].widgets()[0].widgetInstance;
    return widget && widget.plot && widget.plot.data[1][0] === 20 && widget.settings.yVariable === 'V_high';
  });

  await page.evaluate(() => {
    const widgetModel = window.freeboard.getLiveModel().panes()[0].widgets()[0];
    widgetModel.settings({
      ...widgetModel.settings(),
      plotMode: 'xy',
      xVariable: 'I_in',
      yVariable: 'V_high'
    });
  });

  await page.waitForFunction(() => {
    const widget = window.freeboard.getLiveModel().panes()[0].widgets()[0].widgetInstance;
    return widget && widget.plot && widget.plot.data[0][0] === 5 && widget.plot.data[1][0] === 20;
  });

  const summary = await page.locator('.fast-frame-plot').textContent();
  expect(summary).toContain('Mode: X vs Y');
  expect(summary).toContain('X: I_in');
  expect(summary).toContain('Y: V_high');

  await app.close();
});

test('fast frame plot detects colon-separated files', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  const csvPath = fixturePath('fast_frame_plot.csv');

  await page.evaluate(async (targetPath) => {
    await window.api.files.writeText(targetPath, [
      'time_ms:V2:I2',
      '0:31.5:-1.55',
      '1:31.6:-1.56',
      '2:31.7:-1.57',
    ].join('\n'));
  }, csvPath);

  await loadDashboard(page, fixturePath('fast_frame_dashboard.json'));

  await page.waitForFunction(() => {
    const widget = window.freeboard.getLiveModel().panes()[0].widgets()[0].widgetInstance;
    return widget && widget.availableColumns && widget.availableColumns.includes('V2') && widget.availableColumns.includes('I2');
  });

  await page.evaluate(() => {
    const widgetModel = window.freeboard.getLiveModel().panes()[0].widgets()[0];
    widgetModel.settings({
      ...widgetModel.settings(),
      plotMode: 'time_series',
      timeColumn: 'time_ms',
      yVariable: 'V2'
    });
  });

  await page.waitForFunction(() => {
    const widget = window.freeboard.getLiveModel().panes()[0].widgets()[0].widgetInstance;
    return widget && widget.plot && widget.plot.data[0][0] === 0 && widget.plot.data[1][0] === 31.5;
  });

  await app.close();
});
