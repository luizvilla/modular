const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

// The nested ThingSet path picker that replaces the flat Variable dropdown
// and the hand-typed "ThingSet Write Path" fields, against the MOCK_HW tree.

test.setTimeout(90_000);

const modal = (page) => page.locator('#modal_overlay').last();
const panel = (page) => page.locator('.tsp-panel');

async function open(page) {
  await waitForDashboard(page);
  await loadDashboard(page, fixturePath('thingset_path_picker.json'));
  await page.waitForFunction(() => {
    const ds = window.freeboard.getLiveModel().datasources()[0];
    return !!(ds && ds.latestData() && ds.latestData().tree);
  }, null, { timeout: 20_000 });
}

test('+/- button editor: nested Variable and write-path pickers', async () => {
  const { app, page } = await launchApp();
  try {
    await open(page);
    await page.evaluate(() => {
      const w = window.freeboard.getLiveModel().panes()[0].widgets()[0];
      window.freeboard.openIntegratedPlotEditor(w, 'plus_minus_button');
    });
    const fields = modal(page).locator('.tsp-field');
    await expect(fields).toHaveCount(2);
    await expect(fields.nth(0)).toHaveText(/Config › Mode/);

    // Read picker: tree with groups; search narrows; keyboard picks.
    await fields.nth(0).click();
    await expect(panel(page).locator('.tsp-group[data-path="/Config"]')).toBeVisible();
    await expect(panel(page).locator('.tsp-var[data-path="/Config/rMode"]')).toHaveClass(/tsp-selected/);
    await panel(page).locator('.tsp-search').fill('scope state');
    await expect(panel(page).locator('.tsp-var')).toHaveCount(1);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(panel(page)).toHaveCount(0);
    await expect(modal(page)).toBeVisible(); // Enter picked; it didn't also Save the dialog
    await expect(fields.nth(0)).toHaveText(/Debug › Scope › State/);

    // Write picker: only writable variables; a collapsed group expands on click.
    await fields.nth(1).click();
    await expect(panel(page).locator('.tsp-var[data-path="/Config/rMode"]')).toHaveCount(0);
    await expect(panel(page).locator('.tsp-var[data-path="/rStatus"]')).toHaveCount(0);
    await panel(page).locator('.tsp-group[data-path="/Config/Leg2"]').click();
    await panel(page).locator('.tsp-var[data-path="/Config/Leg2/wEnable"]').click();
    await expect(fields.nth(1)).toHaveText(/Config › Leg2 › Enable/);

    await modal(page).locator('#dialog-ok').click();
    const saved = await page.evaluate(() => {
      const s = window.freeboard.getLiveModel().panes()[0].widgets()[0].settings();
      return { variable: s.sourceDef.var, writePath: s.writePath };
    });
    expect(saved).toEqual({ variable: '/Debug/Scope/rState', writePath: '/Config/Leg2/wEnable' });
  } finally {
    await app.close();
  }
});

test('toggle settings form: write-path picker, and a typed path still works', async () => {
  const { app, page } = await launchApp();
  try {
    await open(page);
    await page.locator('.gs_w').first().locator('li.tool-edit').nth(1).click();
    const field = modal(page).locator('.tsp-field');
    await expect(field).toHaveCount(1);
    await field.click();
    await panel(page).locator('.tsp-search').fill('leg1 capa');
    await expect(panel(page).locator('.tsp-var')).toHaveCount(1);
    await page.keyboard.press('Enter'); // the single match is picked
    await expect(field).toHaveText(/Config › Leg1 › Capa/);

    // A path that isn't in the tree can still be typed.
    await field.click();
    await panel(page).locator('.tsp-search').fill('/Config/Leg9/wEnable');
    await expect(panel(page).locator('.tsp-typed')).toContainText('/Config/Leg9/wEnable');
    await page.keyboard.press('Enter');
    await expect(field).toHaveText(/Config › Leg9 › Enable/);

    await modal(page).locator('#dialog-ok').click();
    const writePath = await page.evaluate(() => window.freeboard.getLiveModel().panes()[0].widgets()[1].settings().writePath);
    expect(writePath).toBe('/Config/Leg9/wEnable');
  } finally {
    await app.close();
  }
});
