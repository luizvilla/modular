const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

test.setTimeout(90_000);

async function enableEditing(page) {
  await page.evaluate(() => window.freeboard.setEditing(true));
  await page.waitForTimeout(400);
}

async function getHelperCounts(page) {
  return page.evaluate(() => {
    const widgets = window.freeboard.getLiveModel().panes().flatMap((pane) => pane.widgets());
    return {
      uplotConfigPanel: widgets.filter((widget) => widget.type() === 'uplot_config_panel').length,
      uplotSeriesManager: widgets.filter((widget) => widget.type() === 'uplot_series_manager').length,
      xyPlotSourceManager: widgets.filter((widget) => widget.type() === 'xy_plot_source_manager').length,
      fastFramePlotUi: widgets.filter((widget) => widget.type() === 'fast_frame_plot_ui').length,
      fastFrameChannelManager: widgets.filter((widget) => widget.type() === 'fast_frame_channel_manager').length,
      verticalGaugeConfigPanel: widgets.filter((widget) => widget.type() === 'vertical_gauge_config_panel').length,
      verticalGaugeManager: widgets.filter((widget) => widget.type() === 'vertical_gauge_manager').length,
    };
  });
}

async function openAddWidgetModal(page, paneIndex = 1) {
  await page.evaluate((index) => {
    document.querySelectorAll('.gs_w')[index]?.querySelector('.pane-tools li[title="Add widget"]')?.click();
  }, paneIndex);
  await expect(page.locator('#modal_overlay .widget-picker')).toBeVisible();
}

async function chooseWidgetType(page, typeName) {
  const tile = page.locator(`#modal_overlay .widget-tile[data-type="${typeName}"]`);
  await expect(tile).toBeVisible();
  await tile.click();
  await expect(tile).toHaveClass(/selected/);
  await page.locator('#dialog-ok').click();
}

async function reopenWidgetEditor(page, paneIndex, widgetIndex) {
  const pane = page.locator('.gs_w').nth(paneIndex);
  const subSection = pane.locator('.sub-section').nth(widgetIndex);
  await subSection.hover();
  const editButton = subSection.locator('.tool-edit');
  await expect(editButton).toBeVisible();
  await editButton.click();
}

function activeModal(page) {
  return page.locator('#modal_overlay').last();
}

async function closeStackedAddFlowModals(page) {
  await activeModal(page).locator('#dialog-cancel').click();
  await page.waitForTimeout(300);
  while (await page.locator('#modal_overlay').count()) {
    try {
      await activeModal(page).locator('#dialog-cancel').click({ timeout: 500 });
      await page.waitForTimeout(300);
    } catch {
      break;
    }
  }
  await page.waitForFunction(() => document.querySelectorAll('#modal_overlay').length === 0);
}

test('owntech plot add flow opens the integrated editor and wrench reopens it', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));
    await enableEditing(page);

    const helperCountsBefore = await getHelperCounts(page);

    await openAddWidgetModal(page, 1);
    await chooseWidgetType(page, 'owntech_plot_uplot');

    await page.waitForFunction(() => {
      const pane = window.freeboard.getLiveModel().panes()[1];
      return pane.widgets().length === 1 && pane.widgets()[0].type() === 'owntech_plot_uplot';
    });
    await expect(activeModal(page).locator('header .title')).toHaveText('Edit owntech_plot_uplot');
    await closeStackedAddFlowModals(page);

    await reopenWidgetEditor(page, 1, 0);
    await expect(activeModal(page).locator('header .title')).toHaveText('Edit owntech_plot_uplot');
    await activeModal(page).locator('.input-group').filter({ has: page.locator('.input-group-text', { hasText: 'Source X' }) }).locator('select').first().selectOption('MockSerial');
    await activeModal(page).locator('#dialog-ok').click();
    await page.waitForFunction(() => document.querySelectorAll('#modal_overlay').length === 0);

    expect(await getHelperCounts(page)).toEqual(helperCountsBefore);

    const summaryText = await page.evaluate(() => {
      const widget = window.freeboard.getLiveModel().panes()[1].widgets()[0];
      return widget.widgetInstance.summaryHost.text();
    });
    expect(summaryText).toContain('MockSerial /');

    await reopenWidgetEditor(page, 1, 0);
    await expect(activeModal(page).locator('header .title')).toHaveText('Edit owntech_plot_uplot');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('#modal_overlay').length === 0);

  } finally {
    await app.close();
  }
});

test('xy plot add flow opens the integrated editor and saves bound sources without spawning helpers', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));
    await enableEditing(page);

    const helperCountsBefore = await getHelperCounts(page);

    await openAddWidgetModal(page, 1);
    await chooseWidgetType(page, 'xy_plot_uplot');

    await page.waitForFunction(() => {
      const pane = window.freeboard.getLiveModel().panes()[1];
      return pane.widgets().length === 1 && pane.widgets()[0].type() === 'xy_plot_uplot';
    });
    await expect(activeModal(page).locator('header .title')).toHaveText('Edit xy_plot_uplot');
    await closeStackedAddFlowModals(page);

    await reopenWidgetEditor(page, 1, 0);
    await expect(activeModal(page).locator('header .title')).toHaveText('Edit xy_plot_uplot');
    const datasourceRows = activeModal(page).locator('.input-group').filter({ has: page.locator('.input-group-text', { hasText: 'Datasource' }) });
    await datasourceRows.nth(0).locator('select').selectOption('MockSerial');
    await datasourceRows.nth(1).locator('select').selectOption('MockSerial');
    await activeModal(page).locator('#dialog-ok').click();
    await page.waitForFunction(() => document.querySelectorAll('#modal_overlay').length === 0);

    expect(await getHelperCounts(page)).toEqual(helperCountsBefore);

    const statusText = await page.evaluate(() => {
      const widget = window.freeboard.getLiveModel().panes()[1].widgets()[0];
      return widget.widgetInstance.status.text();
    });
    expect(statusText).toContain('X: MockSerial / Channel');
    expect(statusText).toContain('Y: MockSerial / Channel');

    await reopenWidgetEditor(page, 1, 0);
    await expect(activeModal(page).locator('header .title')).toHaveText('Edit xy_plot_uplot');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('#modal_overlay').length === 0);

  } finally {
    await app.close();
  }
});

test('fast-frame plot add flow opens the integrated editor and saves source/channel configuration', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    const csvPath = fixturePath('fast_frame_plot.csv');
    await page.evaluate(async (targetPath) => {
      await window.api.files.writeText(targetPath, [
        'time_ms,V_high,I_in',
        '0,10,1',
        '1,11,2',
        '2,12,3',
      ].join('\n'));
    }, csvPath);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));
    await enableEditing(page);

    const helperCountsBefore = await getHelperCounts(page);

    await openAddWidgetModal(page, 1);
    await chooseWidgetType(page, 'fast_frame_plot');

    await page.waitForFunction(() => {
      const pane = window.freeboard.getLiveModel().panes()[1];
      return pane.widgets().length === 1 && pane.widgets()[0].type() === 'fast_frame_plot';
    });
    await expect(activeModal(page).locator('header .title')).toHaveText('Edit fast_frame_plot');
    await closeStackedAddFlowModals(page);

    await reopenWidgetEditor(page, 1, 0);
    await expect(activeModal(page).locator('header .title')).toHaveText('Edit fast_frame_plot');
    await activeModal(page).getByRole('button', { name: 'Choose CSV File' }).click();
    const fastFrameYSelect = activeModal(page).locator('.input-group').filter({ has: page.locator('.input-group-text', { hasText: 'Y Variable' }) }).locator('select');
    await expect(fastFrameYSelect.locator('option[value="V_high"]')).toHaveCount(1, { timeout: 15_000 });
    await fastFrameYSelect.selectOption('V_high');
    await activeModal(page).getByRole('button', { name: 'Add channel' }).click();
    await expect(activeModal(page)).toContainText('V_high (V_high)');
    await activeModal(page).locator('#dialog-ok').click();
    await page.waitForFunction(() => document.querySelectorAll('#modal_overlay').length === 0);

    expect(await getHelperCounts(page)).toEqual(helperCountsBefore);

    const summaryText = await page.evaluate(() => {
      const widget = window.freeboard.getLiveModel().panes()[1].widgets()[0];
      return widget.widgetInstance.summary.text();
    });
    expect(summaryText).toContain('Source: Fixed CSV');
    expect(summaryText).toContain('V_high (V_high)');

    await reopenWidgetEditor(page, 1, 0);
    await expect(activeModal(page).locator('header .title')).toHaveText('Edit fast_frame_plot');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('#modal_overlay').length === 0);

  } finally {
    await app.close();
  }
});

test('vertical gauge add flow opens the integrated editor and saves bound source configuration', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));
    await enableEditing(page);

    const helperCountsBefore = await getHelperCounts(page);

    await openAddWidgetModal(page, 1);
    await chooseWidgetType(page, 'vertical_gauge');

    await page.waitForFunction(() => {
      const pane = window.freeboard.getLiveModel().panes()[1];
      return pane.widgets().length === 1 && pane.widgets()[0].type() === 'vertical_gauge';
    });
    await expect(activeModal(page).locator('header .title')).toHaveText('Edit vertical_gauge');
    await closeStackedAddFlowModals(page);

    await reopenWidgetEditor(page, 1, 0);
    await expect(activeModal(page).locator('header .title')).toHaveText('Edit vertical_gauge');
    await activeModal(page).locator('.input-group').filter({ has: page.locator('.input-group-text', { hasText: 'Datasource' }) }).locator('select').first().selectOption('MockSerial');
    await activeModal(page).locator('#dialog-ok').click();
    await page.waitForFunction(() => document.querySelectorAll('#modal_overlay').length === 0);

    expect(await getHelperCounts(page)).toEqual(helperCountsBefore);

    const summaryText = await page.evaluate(() => {
      const widget = window.freeboard.getLiveModel().panes()[1].widgets()[0];
      return widget.widgetInstance.sourceSummaryEl.text();
    });
    expect(summaryText).toContain('MockSerial /');
    expect(summaryText).not.toBe('Configure source.');

    await reopenWidgetEditor(page, 1, 0);
    await expect(activeModal(page).locator('header .title')).toHaveText('Edit vertical_gauge');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('#modal_overlay').length === 0);
  } finally {
    await app.close();
  }
});

test('non-plot widgets still use the generic plugin editor', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));
    await enableEditing(page);

    await reopenWidgetEditor(page, 0, 3);
    await expect(page.locator('#modal_overlay .integrated-plot-editor')).toHaveCount(0);
    await expect(page.locator('#setting-row-title')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('#modal_overlay').length === 0);
  } finally {
    await app.close();
  }
});
