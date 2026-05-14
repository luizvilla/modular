const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

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

test('add-widget modal renders the icon grid and hides compatibility widgets from normal add flow', async () => {
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
    expect(sectionTitles[0].trim()).toBe('OwnTech');
    expect(sectionTitles.map((title) => title.trim())).not.toContain('Python Communication Protocol');
    expect(sectionTitles.map((title) => title.trim())).not.toContain('Vertical gauge');

    const firstSection = widgetPicker.locator('.widget-picker-section').first();
    await expect(firstSection).toHaveClass(/owntech/);

    const autoSelection = await page.evaluate(() => {
      const tiles = Array.from(document.querySelectorAll('#modal_overlay .widget-tile'));
      return {
        firstTileSelected: tiles[0]?.classList.contains('selected') ?? false,
        selectedCount: tiles.filter((tile) => tile.classList.contains('selected')).length,
        selectedType: document.querySelector('#modal_overlay .widget-tile.selected')?.getAttribute('data-type') || null,
      };
    });

    expect(autoSelection.firstTileSelected).toBe(true);
    expect(autoSelection.selectedCount).toBe(1);
    expect(autoSelection.selectedType).not.toBeNull();

    const initialSettingRows = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#modal_overlay .form-row[id^="setting-row-"]')).map((row) => row.id)
    );
    expect(initialSettingRows.length).toBeGreaterThan(1);

    await expect(widgetPicker.locator('.widget-tile[data-type="uplot_config_panel"]')).toHaveCount(0);
    await expect(widgetPicker.locator('.widget-tile[data-type="uplot_series_manager"]')).toHaveCount(0);
    await expect(widgetPicker.locator('.widget-tile[data-type="xy_plot_source_manager"]')).toHaveCount(0);
    await expect(widgetPicker.locator('.widget-tile[data-type="vertical_gauge_config_panel"]')).toHaveCount(0);
    await expect(widgetPicker.locator('.widget-tile[data-type="vertical_gauge_manager"]')).toHaveCount(0);
    await expect(widgetPicker.locator('.widget-tile[data-type="fast_frame_plot_ui"]')).toHaveCount(0);
    await expect(widgetPicker.locator('.widget-tile[data-type="fast_frame_channel_manager"]')).toHaveCount(0);

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
