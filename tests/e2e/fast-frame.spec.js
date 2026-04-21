const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

test('fast frame plot reloads a csv and supports multiple y channels', async () => {
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

  await page.evaluate(async () => {
    const manager = window.freeboard.getLiveModel().panes()[1].widgets()[1].widgetInstance;
    manager.controls.target.val('Fast Plot');
    manager.syncTargetState();
    await manager.populateVariables();
    manager.controls.yVariable.val('I_in');
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

  await page.evaluate(async () => {
    const manager = window.freeboard.getLiveModel().panes()[1].widgets()[1].widgetInstance;
    manager.controls.target.val('Fast Plot');
    manager.syncTargetState();
    await manager.populateVariables();
    manager.controls.xVariable.val('time_ms');
    manager.controls.yVariable.val('V2');
    manager.controls.label.val('V2');
    manager.addChannel();
  });

  await page.waitForFunction(() => {
    const widget = window.freeboard.getLiveModel().panes()[0].widgets()[0].widgetInstance;
    return widget && widget.plot && widget.plot.data[0][0] === 0 && widget.plot.data[1][0] === 31.5;
  });

  await app.close();
});

test('fast frame channel manager refreshes variables immediately after csv selection', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  const csvPath = fixturePath('fast_frame_plot.csv');

  await page.evaluate(async (targetPath) => {
    await window.api.files.writeText(targetPath, [
      'sample,alpha,beta',
      '0,1,2',
      '1,3,4',
    ].join('\n'));
  }, csvPath);

  await loadDashboard(page, fixturePath('fast_frame_dashboard.json'));

  await page.waitForFunction(() => {
    const widget = window.freeboard.getLiveModel().panes()[0].widgets()[0].widgetInstance;
    return widget && widget.availableColumns && widget.availableColumns.includes('alpha');
  });

  await page.evaluate(async (targetPath) => {
    const manager = window.freeboard.getLiveModel().panes()[1].widgets()[1].widgetInstance;
    manager.controls.target.val('Fast Plot');
    manager.syncTargetState();
    manager.selectedCsvPath = targetPath;
    manager.controls.csvName.text('fast_frame_plot.csv');
    await manager._loadColumnsForPath(targetPath);
    manager.applySource();
    await manager.populateVariables();
  }, csvPath);

  await page.waitForFunction(() => {
    const manager = window.freeboard.getLiveModel().panes()[1].widgets()[1].widgetInstance;
    const xOptions = manager.controls.xVariable.find('option').toArray().map((option) => option.value);
    const yOptions = manager.controls.yVariable.find('option').toArray().map((option) => option.value);
    return xOptions.includes('sample') && xOptions.includes('alpha') && yOptions.includes('beta');
  });

  await app.close();
});

test('fast frame plots auto-spawn helper widgets', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await loadDashboard(page, fixturePath('fast_frame_helpers_dashboard.json'));

  await page.waitForFunction(() => {
    const panes = window.freeboard.getLiveModel().panes();
    return panes.some((pane) => pane.widgets().some((widget) => widget.type() === 'fast_frame_plot_ui'))
      && panes.some((pane) => pane.widgets().some((widget) => widget.type() === 'fast_frame_channel_manager'));
  });

  await page.waitForFunction(() => {
    const panes = window.freeboard.getLiveModel().panes();
    const plotUiCount = panes.flatMap((pane) => pane.widgets()).filter((widget) => widget.type() === 'fast_frame_plot_ui').length;
    const managerCount = panes.flatMap((pane) => pane.widgets()).filter((widget) => widget.type() === 'fast_frame_channel_manager').length;
    return plotUiCount === 1 && managerCount === 1;
  });

  await app.close();
});

test('fast frame plot can follow the latest timestamped csv in a directory', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  const olderCsvPath = fixturePath('2026-04-20_10-00-00-fast_frame_plot.csv');
  const latestCsvPath = fixturePath('2026-04-20_10-00-01-fast_frame_plot.csv');

  await page.evaluate(async ({ olderPath, latestPath }) => {
    await window.api.files.writeText(olderPath, [
      'time_ms,V_high',
      '0,10',
      '1,11',
    ].join('\n'));
    await window.api.files.writeText(latestPath, [
      'time_ms,V_high',
      '0,20',
      '1,21',
    ].join('\n'));
  }, { olderPath: olderCsvPath, latestPath: latestCsvPath });

  await loadDashboard(page, fixturePath('fast_frame_dashboard.json'));

  await page.evaluate(async (olderPath) => {
    const manager = window.freeboard.getLiveModel().panes()[1].widgets()[1].widgetInstance;
    manager.controls.target.val('Fast Plot');
    manager.syncTargetState();
    manager.controls.sourceMode.val('latest');
    manager.selectedCsvPath = olderPath;
    manager.applySource();
    await manager.populateVariables();
  }, olderCsvPath);

  await page.waitForFunction(() => {
    const widget = window.freeboard.getLiveModel().panes()[0].widgets()[0].widgetInstance;
    return widget
      && widget.plot
      && widget.plot.data[1][0] === 20
      && widget.summary.text().includes('Latest CSV');
  });

  await app.close();
});
