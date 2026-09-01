const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');
const { radialMenu, clickWedgeByLabel } = require('./radial_menu_helpers');

// Milestone 7 of docs/GUI/02-navigation_overhaul.md: action-first widgets --
// the radial's job here is picking the write target, not editing a
// displayed value.

function widgetAt(page, widgetIndex) {
  return page.locator('.gs_w').nth(0).locator('.sub-section').nth(widgetIndex);
}

test('toggle_button: right-click drills a ThingSet datasource and sets datasource + writePath', async () => {
  const { app, page } = await launchApp({ MOCK_THINGSET_MEASUREMENTS: '1' });
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const widget = widgetAt(page, 4); // toggle_button
    const body = widget.locator('.toggle-button-widget');
    await body.scrollIntoViewIfNeeded();
    const box = await body.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });

    await expect(radialMenu(page)).toBeVisible();
    await clickWedgeByLabel(page, 'MockOwnTechThingSet');
    await clickWedgeByLabel(page, 'Measurements');
    const leaf = page.locator('.radial-menu-leaf', { hasText: 'rVHigh_V' });
    await expect(leaf).toBeVisible();
    await leaf.click();
    await expect(radialMenu(page)).toHaveCount(0);

    const settings = await page.evaluate(() => window.freeboard.getLiveModel().panes()[0].widgets()[4].settings());
    expect(settings.datasource).toBe('MockOwnTechThingSet');
    expect(settings.writePath).toBe('/Measurements/rVHigh_V');

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('plus_minus_button: separate right-click zones for read source and write target; hover shows Step', async () => {
  const { app, page } = await launchApp({ MOCK_THINGSET_MEASUREMENTS: '1' });
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const widget = widgetAt(page, 3); // plus_minus_button
    const valueWrapper = widget.locator('.plus-minus-value-wrapper');
    await valueWrapper.scrollIntoViewIfNeeded();
    let box = await valueWrapper.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await expect(radialMenu(page)).toBeVisible();
    await clickWedgeByLabel(page, 'MockOwnTechThingSet');
    await clickWedgeByLabel(page, 'Measurements');
    await page.locator('.radial-menu-leaf', { hasText: 'rVHigh_V' }).click();
    await expect(radialMenu(page)).toHaveCount(0);

    let sourceDef = await page.evaluate(() => window.freeboard.getLiveModel().panes()[0].widgets()[3].settings().sourceDef);
    expect(sourceDef).toMatchObject({ ds: 'MockOwnTechThingSet', var: '/Measurements/rVHigh_V' });

    const plusBtn = widget.locator('.plus-minus-btn').last();
    box = await plusBtn.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await expect(radialMenu(page)).toBeVisible();
    await clickWedgeByLabel(page, 'MockOwnTechThingSet');
    await clickWedgeByLabel(page, 'Measurements');
    await page.locator('.radial-menu-leaf', { hasText: 'rVHigh_V' }).click();
    await expect(radialMenu(page)).toHaveCount(0);

    const settings = await page.evaluate(() => window.freeboard.getLiveModel().panes()[0].widgets()[3].settings());
    expect(settings.datasource).toBe('MockOwnTechThingSet');
    expect(settings.writePath).toBe('/Measurements/rVHigh_V');

    box = await valueWrapper.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const panel = page.locator('.uplot-axis-hover-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Step');
    const stepInput = panel.locator('.uplot-axis-hover-panel-row').filter({ hasText: 'Step' }).locator('input');
    await stepInput.fill('5');
    await stepInput.press('Enter');
    const step = await page.evaluate(() => window.freeboard.getLiveModel().panes()[0].widgets()[3].settings().step);
    expect(Number(step)).toBe(5);

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('serial_command_buttons: right-click empty space quick-adds a button; double-click renames it', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const widget = widgetAt(page, 2); // serial_command_buttons, starts with buttons: []
    const container = widget.locator('.serial-command-buttons');
    await container.scrollIntoViewIfNeeded();
    const box = await container.boundingBox();
    // Empty (buttons: []), so the button list itself collapses to zero
    // height -- click near the widget's bottom edge, below the datasource
    // row, which is exactly why this zone is bound on the whole widget.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 2, { button: 'right' });

    await expect(radialMenu(page)).toBeVisible();
    await expect(page.locator('.radial-menu-wedge')).toHaveCount(0);
    const leaf = page.locator('.radial-menu-leaf', { hasText: 'Add Button' });
    await expect(leaf).toBeVisible();
    await leaf.click();
    await expect(radialMenu(page)).toHaveCount(0);

    await page.waitForFunction(() => window.freeboard.getLiveModel().panes()[0].widgets()[2].settings().buttons.length === 1);

    const newButton = widget.locator('.serial-command-buttons button').first();
    await expect(newButton).toBeVisible();
    await newButton.dblclick();
    const input = page.locator('.uplot-floating-input');
    await expect(input).toBeVisible();
    await input.fill('Fire');
    await input.press('Enter');
    await expect(page.locator('.uplot-floating-input')).toHaveCount(0);

    const buttons = await page.evaluate(() => window.freeboard.getLiveModel().panes()[0].widgets()[2].settings().buttons);
    expect(buttons[0].label).toBe('Fire');

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});
