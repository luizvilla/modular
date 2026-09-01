const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');
const { radialMenu, plotWidget } = require('./radial_menu_helpers');

// Milestone 4 of docs/GUI/02-navigation_overhaul.md: fast_frame_plot has no
// live datasource to drill through -- channels come straight from the
// loaded CSV's own columns, so right-click skips the arc step entirely.

function fastFramePlotWidget(page, paneIndex = 0) {
  return plotWidget(page, paneIndex, 11);
}

test('right-click the graph shows a flat list of CSV columns; quick-add appends a channel', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const widget = await fastFramePlotWidget(page);
    const chartHost = widget.locator('.fast-frame-plot-host');
    await chartHost.scrollIntoViewIfNeeded();
    // Wait for the CSV to load -- the two configured channels' readouts appear.
    await expect(widget.locator('.uplot-readout-item')).toHaveCount(2, { timeout: 10_000 });

    const box = await chartHost.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await expect(radialMenu(page)).toBeVisible();
    // No category arcs -- straight to the leaf ring of column names.
    await expect(page.locator('.radial-menu-wedge')).toHaveCount(0);
    const leaves = (await page.locator('.radial-menu-leaf').allTextContents());
    expect(leaves).toContain('column_1');

    await page.locator('.radial-menu-leaf', { hasText: 'column_1' }).click();
    await expect(radialMenu(page)).toHaveCount(0);

    await page.waitForFunction(() => {
      const w = window.freeboard.getLiveModel().panes()[0].widgets()[11];
      return (w.settings().seriesDefs || []).length === 3;
    });
    const seriesDefs = await page.evaluate(() => window.freeboard.getLiveModel().panes()[0].widgets()[11].settings().seriesDefs);
    expect(seriesDefs[2]).toMatchObject({ variable: 'column_1', label: 'column_1' });

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('hovering the Y-axis margin shows Y Label/Min/Max; hovering the X-axis margin shows X Label/Min/Max', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const widget = await fastFramePlotWidget(page);
    const chartHost = widget.locator('.fast-frame-plot-host');
    await chartHost.scrollIntoViewIfNeeded();
    await expect(widget.locator('.uplot-readout-item')).toHaveCount(2, { timeout: 10_000 });
    const box = await chartHost.boundingBox();

    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    const yPanel = page.locator('.uplot-axis-hover-panel');
    await expect(yPanel).toBeVisible();
    await expect(yPanel).toContainText('Y Label');

    const yMinInput = yPanel.locator('.uplot-axis-hover-panel-row').filter({ hasText: 'Y Min' }).locator('input');
    await yMinInput.fill('-4');
    await yMinInput.press('Enter');
    const yMin = await page.evaluate(() => window.freeboard.getLiveModel().panes()[0].widgets()[11].settings().yMin);
    expect(yMin).toBe(-4);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 5);
    await page.waitForTimeout(250);
    const xPanel = page.locator('.uplot-axis-hover-panel');
    await expect(xPanel).toBeVisible();
    await expect(xPanel).toContainText('X Label');

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('double-clicking a readout label renames the channel; right-clicking its swatch opens the color carrousel', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const widget = await fastFramePlotWidget(page);
    const item0 = widget.locator('.uplot-readout-item[data-idx="0"]');
    await expect(item0).toBeVisible({ timeout: 10_000 });
    await item0.scrollIntoViewIfNeeded();

    await item0.locator('.uplot-readout-label').dblclick();
    const input = page.locator('.uplot-floating-input');
    await expect(input).toBeVisible();
    await input.fill('Current 1');
    await input.press('Enter');
    await expect(page.locator('.uplot-floating-input')).toHaveCount(0);

    const label0 = await page.evaluate(() => window.freeboard.getLiveModel().panes()[0].widgets()[11].settings().seriesDefs[0].label);
    expect(label0).toBe('Current 1');

    const swatch = item0.locator('.uplot-readout-swatch');
    const swatchBox = await swatch.boundingBox();
    await page.mouse.click(swatchBox.x + swatchBox.width / 2, swatchBox.y + swatchBox.height / 2, { button: 'right' });
    await expect(radialMenu(page)).toBeVisible();
    const leaves = page.locator('.radial-menu-leaf');
    await expect(leaves).toHaveCount(10);
    const targetColor = await leaves.first().getAttribute('title');
    await leaves.first().click();

    const color0 = await page.evaluate(() => window.freeboard.getLiveModel().panes()[0].widgets()[11].settings().seriesDefs[0].color);
    expect(color0.toLowerCase()).toBe(targetColor.toLowerCase());

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});
