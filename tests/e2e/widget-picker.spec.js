const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

async function openWidgetPicker(page) {
    await page.evaluate(() => window.freeboard.setEditing(true));
    await page.waitForTimeout(400);
    await page.evaluate(() => {
        document.querySelector('.gs_w .pane-tools li[title="Add widget"]')?.click();
    });
    await expect(page.locator('#modal_overlay .widget-picker')).toBeVisible();
    return page.locator('#modal_overlay .widget-picker');
}

test.setTimeout(90_000);

async function getPaneWidgetState(page, paneIndex = 0) {
  return page.evaluate((index) => {
    const model = window.freeboard.getLiveModel();
    const pane = model.panes()[index];
    const widgets = pane.widgets();
    return {
      widgetCount: widgets.length,
      serialFlasherCount: widgets.filter((widget) => widget.type() === 'serial_flasher').length,
    };
  }, paneIndex);
}

test('add-widget modal renders the icon grid and keeps control helpers available in the picker', async () => {
  const { app, page } = await launchApp();

  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    await page.evaluate(() => window.freeboard.setEditing(true));
    await page.waitForTimeout(400);

    const before = await getPaneWidgetState(page, 0);

    const addWidgetButton = page
      .locator('.gs_w')
      .nth(0)
      .locator('.pane-tools li[title="Add widget"]');

    await expect(addWidgetButton).toBeVisible();
    await page.evaluate(() => {
      document.querySelector('.gs_w .pane-tools li[title="Add widget"]')?.click();
    });

    const widgetPicker = page.locator('#modal_overlay .widget-picker');
    await expect(widgetPicker).toBeVisible();

    const typeLabelState = await page.evaluate(() => {
      const label = document.querySelector('#setting-row-plugin-types .form-label');
      if (!label) return { present: false };
      const style = getComputedStyle(label);
      return {
        present: true,
        text: label.textContent?.trim() || '',
        display: style.display,
        visibility: style.visibility,
        offsetWidth: label.offsetWidth,
        offsetHeight: label.offsetHeight,
      };
    });
    expect(typeLabelState.present).toBe(true);
    expect(typeLabelState.display).toBe('none');

    const sectionTitles = await widgetPicker.locator('.widget-picker-section-title').allTextContents();
    expect(sectionTitles.length).toBeGreaterThan(0);
    expect(sectionTitles[0].trim()).toBe('Plots');
    expect(sectionTitles.map((title) => title.trim())).not.toContain('Python Communication Protocol');
    expect(sectionTitles.map((title) => title.trim())).not.toContain('Vertical gauge');

    const initialSettingRows = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#modal_overlay .form-row[id^="setting-row-"]')).map((row) => row.id)
    );
    expect(initialSettingRows).toContain('setting-row-plugin-types');

    await expect(widgetPicker.locator('.widget-tile[data-type="uplot_config_panel"]')).toBeVisible();
    await expect(widgetPicker.locator('.widget-tile[data-type="uplot_series_manager"]')).toBeVisible();
    await expect(widgetPicker.locator('.widget-tile[data-type="xy_plot_source_manager"]')).toBeVisible();
    await expect(widgetPicker.locator('.widget-tile[data-type="fft_spectrum_plot"]')).toBeVisible();
    await expect(widgetPicker.locator('.widget-tile[data-type="vertical_gauge_config_panel"]')).toHaveCount(0);
    await expect(widgetPicker.locator('.widget-tile[data-type="vertical_gauge_manager"]')).toBeVisible();
    await expect(widgetPicker.locator('.widget-tile[data-type="gauge"]')).toHaveCount(0);
    await expect(widgetPicker.locator('.widget-tile[data-type="fast_frame_plot_ui"]')).toHaveCount(0);
    await expect(widgetPicker.locator('.widget-tile[data-type="fast_frame_channel_manager"]')).toBeVisible();

    const plotTileTypes = await page.evaluate(() => {
      const sections = Array.from(document.querySelectorAll('#modal_overlay .widget-picker-section'));
      const plotSection = sections.find((section) => section.querySelector('.widget-picker-section-title')?.textContent?.trim() === 'Plots');
      if (!plotSection) return [];
      return Array.from(plotSection.querySelectorAll('.widget-tile')).map((tile) => tile.getAttribute('data-type'));
    });
    expect(plotTileTypes.slice(0, 4)).toEqual([
      'time_plot_uplot',
      'xy_plot_uplot',
      'fast_frame_plot',
      'fft_spectrum_plot',
    ]);

    await expect(widgetPicker.locator('.widget-tile[data-type="horizontal_gauge"]')).toBeVisible();
    await expect(widgetPicker.locator('.widget-tile[data-type="radial_arc_gauge"]')).toBeVisible();
    await expect(widgetPicker.locator('.widget-tile[data-type="radial_needle_gauge"]')).toBeVisible();
    await expect(widgetPicker.locator('.widget-tile[data-type="donut_gauge"]')).toBeVisible();

    const serialFlasherTile = widgetPicker.locator('.widget-tile[data-type="serial_flasher"]');
    await expect(serialFlasherTile).toBeVisible();
    await serialFlasherTile.click();
    await expect(serialFlasherTile).toHaveClass(/selected/);

    await page.waitForFunction(() => {
      const rows = Array.from(document.querySelectorAll('#modal_overlay .form-row[id^="setting-row-"]')).map((row) => row.id);
      return rows.includes('setting-row-plugin-types') && rows.includes('setting-row-title');
    });

    await page.locator('#dialog-ok').click();
    await page.waitForFunction((expected) => {
      const pane = window.freeboard.getLiveModel().panes()[0];
      const widgets = pane.widgets();
      const widgetCount = widgets.length;
      const serialFlasherCount = widgets.filter((widget) => widget.type() === 'serial_flasher').length;
      return widgetCount === expected.widgetCount && serialFlasherCount === expected.serialFlasherCount;
    }, {
      widgetCount: before.widgetCount + 1,
      serialFlasherCount: before.serialFlasherCount + 1,
    });

    const after = await getPaneWidgetState(page, 0);
    expect(after.widgetCount).toBe(before.widgetCount + 1);
    expect(after.serialFlasherCount).toBe(before.serialFlasherCount + 1);
  } finally {
    await app.close();
  }
});

test('picker shows OwnTech and ThingSet sections when extensions are enabled', async () => {
  const { app, page } = await launchApp({ ENABLE_THINGSET: '1' });
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));
    const picker = await openWidgetPicker(page);
    const sectionTitles = await picker.locator('.widget-picker-section-title').allTextContents();
    const titles = sectionTitles.map((t) => t.trim());
    expect(titles).toContain('OwnTech');
    expect(titles).toContain('ThingSet');
    await expect(picker.locator('.widget-tile[data-type="twist_actions_panel"]')).toBeVisible();
    await expect(picker.locator('.widget-tile[data-type="thingset_device_ui"]')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('picker hides OwnTech section and tiles when owntech extension is disabled', async () => {
  const { app, page } = await launchApp({ MODULAR_EXTENSION_OWNTECH: '0', ENABLE_THINGSET: '0' });
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));
    const picker = await openWidgetPicker(page);
    const sectionTitles = await picker.locator('.widget-picker-section-title').allTextContents();
    const titles = sectionTitles.map((t) => t.trim());
    expect(titles).not.toContain('OwnTech');
    expect(titles).not.toContain('ThingSet');
    await expect(picker.locator('.widget-tile[data-type="twist_actions_panel"]')).toHaveCount(0);
    await expect(picker.locator('.widget-tile[data-type="thingset_device_ui"]')).toHaveCount(0);
    // Core widgets remain
    expect(titles[0]).toBe('Plots');
    await expect(picker.locator('.widget-tile[data-type="serial_flasher"]')).toBeVisible();
  } finally {
    await app.close();
  }
});
