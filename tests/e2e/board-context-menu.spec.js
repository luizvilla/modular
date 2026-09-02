const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');
const { radialMenu, clickWedgeByLabel } = require('./radial_menu_helpers');

// Milestones 1 & 2 of docs/GUI/02-navigation_overhaul.md: chrome-level radial
// menus one level up from the per-widget radials (uplot's own pilot).

// Panes can be arbitrarily tall (a pane full of stacked widgets easily
// extends thousands of pixels past the viewport), so "below the panes" isn't
// reliably empty board space. Gridster reserves more horizontal room than
// the fixture's populated columns use, though, so the right of the
// rightmost pane always is.
async function emptyBoardPoint(page) {
  return page.evaluate(() => {
    const board = document.querySelector('#board-content').getBoundingClientRect();
    const panes = Array.from(document.querySelectorAll('.gs_w')).map((el) => el.getBoundingClientRect());
    const maxPaneRight = panes.reduce((max, r) => Math.max(max, r.right), board.left);
    return { x: Math.min(maxPaneRight + 40, board.right - 20), y: board.top + 40 };
  });
}

test('right-click empty board space opens Pane / Datasource, Add Pane creates a pane', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const before = await page.evaluate(() => window.freeboard.getLiveModel().panes().length);

    const point = await emptyBoardPoint(page);
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await expect(radialMenu(page)).toBeVisible();
    const labels = (await page.locator('.radial-menu-wedge-label').allTextContents()).sort();
    expect(labels).toEqual(['Datasource', 'Pane']);

    await clickWedgeByLabel(page, 'Pane');
    const leaf = page.locator('.radial-menu-leaf', { hasText: 'Add Pane' });
    await expect(leaf).toBeVisible();
    await leaf.click();

    await expect(radialMenu(page)).toHaveCount(0);
    await page.waitForFunction((n) => window.freeboard.getLiveModel().panes().length > n, before);
    const after = await page.evaluate(() => window.freeboard.getLiveModel().panes().length);
    expect(after).toBe(before + 1);

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('right-click empty board space, Datasource leaf opens the settings step directly (no type grid)', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const point = await emptyBoardPoint(page);
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await clickWedgeByLabel(page, 'Datasource');

    const leaf = page.locator('.radial-menu-leaf', { hasText: 'Serial Port Reader' });
    await expect(leaf).toBeVisible();
    await leaf.click();
    await expect(radialMenu(page)).toHaveCount(0);

    // Straight to the settings form for that type -- no picker grid step.
    const modal = page.locator('#modal_overlay').last();
    await expect(modal).toBeVisible();
    await expect(modal.locator('section')).not.toHaveClass(/datasource-picker-active/);
    await expect(modal.locator('#setting-row-name')).toBeVisible();

    await page.locator('#dialog-cancel').last().click();
    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('right-click empty space inside a pane opens widget categories, quick-add creates the widget', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    // "Target" pane (index 1) has no widgets -- its whole section is empty space.
    const section = page.locator('.gs_w').nth(1).locator('.widget-sort-section');
    await section.scrollIntoViewIfNeeded();
    const box = await section.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + 10, { button: 'right' });
    await expect(radialMenu(page)).toBeVisible();

    const categories = await page.locator('.radial-menu-wedge-label').allTextContents();
    expect(categories).toContain('Plots');

    await clickWedgeByLabel(page, 'Plots');
    // Widget-type leaves show both icon and name stacked (M10, docs/GUI/02-navigation_overhaul.md).
    const leaf = page.locator('.radial-menu-leaf[title="Time Plot Widget"]');
    await expect(leaf).toBeVisible();
    await expect(leaf.locator('i.fa-chart-line')).toBeVisible();
    await expect(leaf.locator('.radial-menu-leaf-text')).toHaveText('Time Plot Widget');
    await leaf.click();

    // time_plot_uplot is an "integrated editor" type -- quick-added with
    // defaults, no settings form, and its scoped editor auto-opens.
    await expect(radialMenu(page)).toHaveCount(0);
    const modal = page.locator('#modal_overlay').last();
    await expect(modal.locator('header .title')).toHaveText('Edit Widget', { timeout: 10_000 });

    const widgets = await page.evaluate(() => window.freeboard.getLiveModel().panes()[1].widgets().map((w) => w.type()));
    expect(widgets).toEqual(['time_plot_uplot']);

    await page.locator('#dialog-cancel').last().click();
    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

// M10 (docs/GUI/02-navigation_overhaul.md): "Gauges" was missing from
// _getDefaultWidgetCategories() even though every gauge widget explicitly
// declares category:'Gauges' -- they were silently landing under "Other"
// in this radial (the widget-picker modal never showed the gap since it
// renders from its own separate, complete category list).
test('gauge widgets appear under their own "Gauges" category, not lumped into "Other"', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const section = page.locator('.gs_w').nth(1).locator('.widget-sort-section');
    await section.scrollIntoViewIfNeeded();
    const box = await section.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + 10, { button: 'right' });
    await expect(radialMenu(page)).toBeVisible();

    const categories = await page.locator('.radial-menu-wedge-label').allTextContents();
    expect(categories).toContain('Gauges');

    await clickWedgeByLabel(page, 'Gauges');
    const leaf = page.locator('.radial-menu-leaf[title="Vertical Gauge"]');
    await expect(leaf).toBeVisible();
    await leaf.click();

    await expect(radialMenu(page)).toHaveCount(0);
    const widgets = await page.evaluate(() => window.freeboard.getLiveModel().panes()[1].widgets().map((w) => w.type()));
    expect(widgets).toEqual(['vertical_gauge']);

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('right-clicking an existing widget does not show the pane or dashboard radial', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    // Pane 0's widget 0 (serial_terminal) has no radial adaptation of its own.
    const widget = page.locator('.gs_w').nth(0).locator('.sub-section').nth(0);
    await widget.scrollIntoViewIfNeeded();
    const box = await widget.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });

    await page.waitForTimeout(300);
    await expect(radialMenu(page)).toHaveCount(0);

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('right-clicking a pane header does not show the dashboard-level radial', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const header = page.locator('.gs_w').nth(0).locator('.pane-header');
    await header.scrollIntoViewIfNeeded();
    const box = await header.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });

    await page.waitForTimeout(300);
    await expect(radialMenu(page)).toHaveCount(0);

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});
