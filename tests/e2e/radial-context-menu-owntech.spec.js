const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');
const { radialMenu } = require('./radial_menu_helpers');

// Milestone 8 of docs/GUI/02-navigation_overhaul.md -- explicitly lower
// priority: this widget is already direct-manipulation (one click per leg
// toggle / power button), so the only broadly useful zone is reassigning
// the linked datasource, right-clicking the status/summary line.

test('owntech_actions_panel: right-click the status line reassigns the linked datasource', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('owntech_actions_panel_radial.json'));

    const widget = page.locator('.gs_w').nth(0).locator('.sub-section').nth(0);
    const statusLine = widget.locator('.small.text-muted.flex-fill');
    await statusLine.scrollIntoViewIfNeeded();
    const box = await statusLine.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });

    await expect(radialMenu(page)).toBeVisible();
    // No category arcs -- a flat list of the 2-3 ThingSet datasources.
    await expect(page.locator('.radial-menu-wedge')).toHaveCount(0);
    const leaf = page.locator('.radial-menu-leaf', { hasText: 'MockThingSetSerial' });
    await expect(leaf).toBeVisible();
    await leaf.click();
    await expect(radialMenu(page)).toHaveCount(0);

    const datasource = await page.evaluate(() => window.freeboard.getLiveModel().panes()[0].widgets()[0].settings().datasource);
    expect(datasource).toBe('MockThingSetSerial');

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});
