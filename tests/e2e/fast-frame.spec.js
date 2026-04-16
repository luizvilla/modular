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

  await page.evaluate(() => {
    const manager = window.freeboard.getLiveModel().panes()[1].widgets()[1].widgetInstance;
    manager.controls.target.val('Fast Plot');
    manager.syncTargetState();
    manager.populateVariables();
    manager.controls.variable.val('I_in');
    manager.controls.label.val('Input current');
    manager.controls.color.val('#ff0000');
    manager.addChannel();
  });

  await page.waitForFunction(() => {
    const widget = window.freeboard.getLiveModel().panes()[0].widgets()[0].widgetInstance;
    return widget && widget.plot && widget.plot.data.length === 3;
  });

  await page.evaluate(() => {
    const ui = window.freeboard.getLiveModel().panes()[1].widgets()[0].widgetInstance;
    ui.controls.target.val('Fast Plot');
    ui.syncFromSelectedWidget();
    ui.controls.yLabel.val('Measured value');
    ui.controls.title.val('Fast Plot Updated');
    ui.applySettings();
  });

  await page.waitForFunction(() => {
    const widgetModel = window.freeboard.getLiveModel().panes()[0].widgets()[0];
    return widgetModel.settings().title === 'Fast Plot Updated' && widgetModel.settings().yLabel === 'Measured value';
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
    return widget && widget.plot && widget.plot.data[1][0] === 20 && widget.plot.data[2][0] === 5;
  });

  await page.evaluate(() => {
    const manager = window.freeboard.getLiveModel().panes()[1].widgets()[1].widgetInstance;
    manager.controls.target.val('Fast XY Plot');
    manager.syncTargetState();
    manager.controls.xVariable.val('I_in');
    manager.controls.yVariable.val('V_high');
    manager.applySource();
  });

  await page.waitForFunction(() => {
    const widget = window.freeboard.getLiveModel().panes()[2].widgets()[0].widgetInstance;
    return widget && widget.plot && widget.plot.data[0][0] === 5 && widget.plot.data[1][0] === 20;
  });

  const summary = await page.locator('.fast-frame-plot').textContent();
  expect(summary).toContain('Input current');

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
    const manager = window.freeboard.getLiveModel().panes()[1].widgets()[1].widgetInstance;
    manager.controls.target.val('Fast Plot');
    manager.syncTargetState();
    manager.controls.timeColumn.val('time_ms');
    manager.populateVariables();
    manager.controls.variable.val('V2');
    manager.controls.label.val('V2');
    manager.addChannel();
  });

  await page.waitForFunction(() => {
    const widget = window.freeboard.getLiveModel().panes()[0].widgets()[0].widgetInstance;
    return widget && widget.plot && widget.plot.data[0][0] === 0 && widget.plot.data[1][0] === 31.5;
  });

  await app.close();
});
