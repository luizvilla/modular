const fs = require('fs');
const os = require('os');
const path = require('path');
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
  await activeModal(page).locator('#dialog-ok').click();
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

async function expectIntegratedEditor(page) {
  await expect(activeModal(page).locator('header .title')).toHaveText('Edit Widget');
}

async function closeStackedAddFlowModals(page) {
  while (await page.locator('#modal_overlay').count()) {
    const cancelButtons = page.locator('#modal_overlay #dialog-cancel');
    if (!await cancelButtons.count()) break;
    try {
      await cancelButtons.last().click({ timeout: 2_000 });
      await page.waitForTimeout(300);
    } catch {
      break;
    }
  }
  await page.waitForFunction(() => document.querySelectorAll('#modal_overlay').length === 0, null, { timeout: 15_000 });
}

async function configureDatasource(page, datasourceName = 'MockSerial') {
  await activeModal(page)
    .locator('.input-group')
    .filter({ has: page.locator('.input-group-text', { hasText: 'Datasource' }) })
    .locator('select')
    .first()
    .selectOption(datasourceName);
}

async function readSingleGaugeState(page) {
  return page.evaluate(() => {
    const widget = window.freeboard.getLiveModel().panes()[1].widgets()[0];
    return {
      type: widget.type(),
      settings: widget.settings(),
      summary: widget.widgetInstance.summaryEl.text(),
      className: widget.widgetInstance.container.attr('class') || '',
    };
  });
}

test('time plot add flow opens the integrated editor and wrench reopens it', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));
    await enableEditing(page);

    const helperCountsBefore = await getHelperCounts(page);

    await openAddWidgetModal(page, 1);
    await chooseWidgetType(page, 'time_plot_uplot');

    await page.waitForFunction(() => {
      const pane = window.freeboard.getLiveModel().panes()[1];
      return pane.widgets().length === 1 && pane.widgets()[0].type() === 'time_plot_uplot';
    });
    await expectIntegratedEditor(page);
    await closeStackedAddFlowModals(page);

    await reopenWidgetEditor(page, 1, 0);
    await expectIntegratedEditor(page);
    await activeModal(page)
      .locator('.input-group')
      .filter({ has: page.locator('.input-group-text', { hasText: 'Source' }) })
      .locator('select')
      .first()
      .selectOption('MockSerial');
    await activeModal(page).locator('#dialog-ok').click();
    await page.waitForFunction(() => document.querySelectorAll('#modal_overlay').length === 0);

    expect(await getHelperCounts(page)).toEqual(helperCountsBefore);

    const summaryText = await page.evaluate(() => {
      const widget = window.freeboard.getLiveModel().panes()[1].widgets()[0];
      return widget.widgetInstance.summaryHost.text();
    });
    expect(summaryText).toContain('MockSerial /');

    await reopenWidgetEditor(page, 1, 0);
    await expectIntegratedEditor(page);
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
    await expectIntegratedEditor(page);
    await closeStackedAddFlowModals(page);

    await reopenWidgetEditor(page, 1, 0);
    await expectIntegratedEditor(page);
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
    await expectIntegratedEditor(page);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('#modal_overlay').length === 0);

  } finally {
    await app.close();
  }
});

test('fast-frame plot add flow opens the integrated editor and saves source/channel configuration', async () => {
  const csvPath = path.join(os.tmpdir(), `modular-fast-frame-plot-${Date.now()}.csv`);
  const { app, page } = await launchApp({ MOCK_CSV_PATH: csvPath });
  try {
    await waitForDashboard(page);
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
    await expectIntegratedEditor(page);
    await closeStackedAddFlowModals(page);

    await reopenWidgetEditor(page, 1, 0);
    await expectIntegratedEditor(page);
    await activeModal(page).getByRole('button', { name: 'Choose CSV File' }).click();
    const fastFrameYSelect = activeModal(page).locator('.input-group').filter({ has: page.locator('.input-group-text', { hasText: 'Y Variable' }) }).locator('select');
    await expect(fastFrameYSelect.locator('option[value="V_high"]')).toHaveCount(1, { timeout: 15_000 });
    await fastFrameYSelect.selectOption('V_high');
    await activeModal(page).getByRole('button', { name: 'Add channel' }).click();
    await expect(activeModal(page)).toContainText('V_high (V_high)');
    await activeModal(page).locator('#dialog-ok').click();
    await page.waitForFunction(() => document.querySelectorAll('#modal_overlay').length === 0);

    expect(await getHelperCounts(page)).toEqual(helperCountsBefore);

    await page.waitForFunction(() => {
      const widget = window.freeboard.getLiveModel().panes()[1].widgets()[0];
      return widget.widgetInstance.summary.text().includes('V_high (V_high)');
    });
    const summaryText = await page.evaluate(() => window.freeboard.getLiveModel().panes()[1].widgets()[0].widgetInstance.summary.text());
    expect(summaryText).toContain('Source: Fixed CSV');
    expect(summaryText).toContain('V_high (V_high)');

    await reopenWidgetEditor(page, 1, 0);
    await expectIntegratedEditor(page);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('#modal_overlay').length === 0);

  } finally {
    try {
      fs.unlinkSync(csvPath);
    } catch {}
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
    await expectIntegratedEditor(page);
    await closeStackedAddFlowModals(page);

    await reopenWidgetEditor(page, 1, 0);
    await expectIntegratedEditor(page);
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
    await expectIntegratedEditor(page);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('#modal_overlay').length === 0);
  } finally {
    await app.close();
  }
});

for (const gaugeScenario of [
  {
    type: 'horizontal_gauge',
    expectedClass: 'gauge-family--horizontal',
    applyEditorChanges: async (page) => {
      await configureDatasource(page, 'MockSerial');
      await activeModal(page).locator('.input-group').filter({ has: page.locator('.input-group-text', { hasText: 'Fill Direction' }) }).locator('select').selectOption('rtl');
    },
    assertSettings: (settings) => {
      expect(settings.fillDirection).toBe('rtl');
    }
  },
  {
    type: 'radial_arc_gauge',
    expectedClass: 'gauge-family--radial_arc',
    applyEditorChanges: async (page) => {
      await configureDatasource(page, 'MockSerial');
      await activeModal(page).locator('.input-group').filter({ has: page.locator('.input-group-text', { hasText: 'Sweep Size' }) }).locator('select').selectOption('270');
    },
    assertSettings: (settings) => {
      expect(settings.sweepAngle).toBe(270);
    }
  },
  {
    type: 'radial_needle_gauge',
    expectedClass: 'gauge-family--radial_needle',
    applyEditorChanges: async (page) => {
      await configureDatasource(page, 'MockSerial');
      await activeModal(page).locator('.input-group').filter({ has: page.locator('.input-group-text', { hasText: 'Needle Style' }) }).locator('select').selectOption('slim');
      await activeModal(page).locator('.input-group').filter({ has: page.locator('.input-group-text', { hasText: 'Show Hub' }) }).locator('input[type="checkbox"]').uncheck();
    },
    assertSettings: (settings) => {
      expect(settings.needleStyle).toBe('slim');
      expect(settings.showHub).toBe(false);
    }
  },
  {
    type: 'donut_gauge',
    expectedClass: 'gauge-family--donut',
    applyEditorChanges: async (page) => {
      await configureDatasource(page, 'MockSerial');
      await activeModal(page).locator('.input-group').filter({ has: page.locator('.input-group-text', { hasText: 'Ring Thickness' }) }).locator('select').selectOption('thick');
    },
    assertSettings: (settings) => {
      expect(settings.ringThickness).toBe('thick');
    }
  }
]) {
  test(`${gaugeScenario.type} add flow opens the integrated editor and persists family-specific settings`, async () => {
    const { app, page } = await launchApp();
    try {
      await waitForDashboard(page);
      await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));
      await enableEditing(page);

      const helperCountsBefore = await getHelperCounts(page);

      await openAddWidgetModal(page, 1);
      await chooseWidgetType(page, gaugeScenario.type);

      await page.waitForFunction((type) => {
        const pane = window.freeboard.getLiveModel().panes()[1];
        return pane.widgets().length === 1 && pane.widgets()[0].type() === type;
      }, gaugeScenario.type);
      await expectIntegratedEditor(page);
      await closeStackedAddFlowModals(page);

      await reopenWidgetEditor(page, 1, 0);
      await expectIntegratedEditor(page);
      await gaugeScenario.applyEditorChanges(page);
      await activeModal(page).locator('#dialog-ok').click();
      await page.waitForFunction(() => document.querySelectorAll('#modal_overlay').length === 0);

      expect(await getHelperCounts(page)).toEqual(helperCountsBefore);

      const widgetState = await readSingleGaugeState(page);
      expect(widgetState.type).toBe(gaugeScenario.type);
      expect(widgetState.summary).toContain('MockSerial /');
      expect(widgetState.className).toContain(gaugeScenario.expectedClass);
      gaugeScenario.assertSettings(widgetState.settings);
    } finally {
      await app.close();
    }
  });
}

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
