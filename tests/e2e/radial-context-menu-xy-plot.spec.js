const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');
const { radialMenu, clickWedgeByLabel, plotWidget } = require('./radial_menu_helpers');

// Milestone 3 of docs/GUI/02-navigation_overhaul.md: the pilot's pattern
// adapted for xy_plot_uplot (fixed X/Y sources, two real data axes).

function xyPlotWidget(page, paneIndex = 0) {
  return plotWidget(page, paneIndex, 9);
}

test('right-click the graph drills X Source / Y Source into a ThingSet datasource, quick-sets the source', async () => {
  const { app, page } = await launchApp({ MOCK_THINGSET_MEASUREMENTS: '1' });
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const widget = await xyPlotWidget(page);
    const chartHost = widget.locator('.xy-plot-chart');
    await chartHost.scrollIntoViewIfNeeded();
    const box = await chartHost.boundingBox();

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await expect(radialMenu(page)).toBeVisible();
    const topLabels = (await page.locator('.radial-menu-wedge-label').allTextContents()).sort();
    expect(topLabels).toEqual(['X Source', 'Y Source']);

    await clickWedgeByLabel(page, 'X Source');
    await clickWedgeByLabel(page, 'MockOwnTechThingSet');
    await clickWedgeByLabel(page, 'Measurements');
    const leaf = page.locator('.radial-menu-leaf', { hasText: 'rVHigh_V' });
    await expect(leaf).toBeVisible();
    await leaf.click();

    await expect(radialMenu(page)).toHaveCount(0);
    const xSourceDef = await page.evaluate(() => {
      const w = window.freeboard.getLiveModel().panes()[0].widgets()[9];
      return w.settings().xSourceDef;
    });
    expect(xSourceDef).toMatchObject({ ds: 'MockOwnTechThingSet', var: '/Measurements/rVHigh_V' });

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

    const widget = await xyPlotWidget(page);
    const chartHost = widget.locator('.xy-plot-chart');
    await chartHost.scrollIntoViewIfNeeded();
    const box = await chartHost.boundingBox();

    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    const yPanel = page.locator('.uplot-axis-hover-panel');
    await expect(yPanel).toBeVisible();
    await expect(yPanel).toContainText('Y Label');
    await expect(yPanel).toContainText('Y Min');
    await expect(yPanel).toContainText('Y Max');

    const yMinInput = yPanel.locator('.uplot-axis-hover-panel-row').filter({ hasText: 'Y Min' }).locator('input');
    await yMinInput.fill('-5');
    await yMinInput.press('Enter');
    const yMin = await page.evaluate(() => window.freeboard.getLiveModel().panes()[0].widgets()[9].settings().yMin);
    expect(yMin).toBe(-5);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 5);
    await page.waitForTimeout(250);
    const xPanel = page.locator('.uplot-axis-hover-panel');
    await expect(xPanel).toBeVisible();
    await expect(xPanel).toContainText('X Label');
    await expect(xPanel).toContainText('X Min');
    await expect(xPanel).toContainText('X Max');

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('double-clicking the X readout label renames xLabel; double-clicking the title renames it', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const widget = await xyPlotWidget(page);
    const xItem = widget.locator('.uplot-readout-item[data-axis="x"]');
    await xItem.scrollIntoViewIfNeeded();
    await xItem.locator('.uplot-readout-label').dblclick();

    const input = page.locator('.uplot-floating-input');
    await expect(input).toBeVisible();
    await input.fill('Voltage');
    await input.press('Enter');
    await expect(page.locator('.uplot-floating-input')).toHaveCount(0);

    const xLabel = await page.evaluate(() => window.freeboard.getLiveModel().panes()[0].widgets()[9].settings().xLabel);
    expect(xLabel).toBe('Voltage');

    const title = widget.locator('.u-title');
    await expect(title).toBeVisible();
    await title.dblclick();
    const titleInput = page.locator('.uplot-floating-input');
    await expect(titleInput).toBeVisible();
    await titleInput.fill('Renamed XY');
    await titleInput.press('Enter');
    await expect(page.locator('.uplot-floating-input')).toHaveCount(0);

    const savedTitle = await page.evaluate(() => window.freeboard.getLiveModel().panes()[0].widgets()[9].settings().title);
    expect(savedTitle).toBe('Renamed XY');

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('right-clicking the Y readout swatch opens a 10-color carrousel and sets latestColor', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const widget = await xyPlotWidget(page);
    const yItem = widget.locator('.uplot-readout-item[data-axis="y"]');
    await yItem.scrollIntoViewIfNeeded();
    const swatch = yItem.locator('.uplot-readout-swatch');
    const swatchBox = await swatch.boundingBox();
    await page.mouse.click(swatchBox.x + swatchBox.width / 2, swatchBox.y + swatchBox.height / 2, { button: 'right' });

    await expect(radialMenu(page)).toBeVisible();
    await expect(page.locator('.radial-menu-wedge')).toHaveCount(0);
    const leaves = page.locator('.radial-menu-leaf');
    await expect(leaves).toHaveCount(10);
    const targetColor = await leaves.first().getAttribute('title');
    await leaves.first().click();

    await expect(radialMenu(page)).toHaveCount(0);
    const savedColor = await page.evaluate(() => window.freeboard.getLiveModel().panes()[0].widgets()[9].settings().latestColor);
    expect(savedColor.toLowerCase()).toBe(targetColor.toLowerCase());

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});
