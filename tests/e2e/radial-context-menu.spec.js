const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

const OUTER_R = 92;
const INNER_R = 34;
const WEDGE_GAP_DEG = 4;
const WEDGE_MID_RADIUS = (INNER_R + OUTER_R) / 2;

function radialMenu(page) {
  return page.locator('.radial-menu-overlay');
}

// The category wedge is an SVG donut segment -- for a small N its
// bounding-box center can land in the donut's empty inner hole (Playwright's
// default click target), so this computes a point that's actually painted,
// picking the wedge by its label rather than assuming position/order.
async function clickWedgeByLabel(page, label) {
  const labels = await page.locator('.radial-menu-wedge-label').allTextContents();
  const index = labels.indexOf(label);
  if (index === -1) throw new Error(`wedge label "${label}" not found among ${JSON.stringify(labels)}`);
  const n = labels.length;
  const step = 360 / n;
  const start = step * index + WEDGE_GAP_DEG / 2;
  const end = step * (index + 1) - WEDGE_GAP_DEG / 2;
  const mid = (start + end) / 2;
  const rad = (mid - 90) * Math.PI / 180;
  const dx = WEDGE_MID_RADIUS * Math.cos(rad);
  const dy = WEDGE_MID_RADIUS * Math.sin(rad);
  const anchor = await page.locator('.radial-menu').boundingBox();
  await page.mouse.click(anchor.x + dx, anchor.y + dy);
}

async function plotWidget(page, paneIndex = 0, widgetIndex = 6) {
  const el = page.locator('.gs_w').nth(paneIndex).locator('.sub-section').nth(widgetIndex);
  await expect(el).toBeVisible();
  return el;
}

test('right-click on the plot area drills into a ThingSet datasource\'s Measurements group and quick-adds a channel', async () => {
  const { app, page } = await launchApp({ MOCK_THINGSET_MEASUREMENTS: '1' });
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('radial_context_menu_plot.json'));

    const widget = await plotWidget(page, 0, 0);
    const chartHost = widget.locator('.uplot-chart-host');
    await chartHost.scrollIntoViewIfNeeded();
    const box = await chartHost.boundingBox();

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await expect(radialMenu(page)).toBeVisible();
    await expect(page.locator('.radial-menu-wedge-label')).toHaveText('MockOwnTechThingSet');

    await clickWedgeByLabel(page, 'MockOwnTechThingSet');
    await expect(page.locator('.radial-menu-wedge-label')).toHaveCount(2);
    const level2 = await page.locator('.radial-menu-wedge-label').allTextContents();
    expect(level2.sort()).toEqual(['Measurements', 'Others']);

    await clickWedgeByLabel(page, 'Measurements');
    const leaf = page.locator('.radial-menu-leaf', { hasText: 'rVHigh_V' });
    await expect(leaf).toBeVisible();
    await leaf.click();

    // Quick-add: no dialog opens, the channel lands directly in settings
    // with the identity op and the next palette color.
    await expect(radialMenu(page)).toHaveCount(0);
    await expect(page.locator('#modal_overlay')).toHaveCount(0);
    const seriesDefs = await page.evaluate(() => {
      const w = window.freeboard.getLiveModel().panes()[0].widgets()[0];
      return w.settings().seriesDefs;
    });
    expect(seriesDefs).toHaveLength(1);
    expect(seriesDefs[0].a).toMatchObject({ ds: 'MockOwnTechThingSet', var: '/Measurements/rVHigh_V' });
    expect(seriesDefs[0].op).toBe('identity');
    expect(seriesDefs[0].color).toBeTruthy();

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('right-click on the plot area drills through Others into Config and quick-adds a channel', async () => {
  const { app, page } = await launchApp({ MOCK_THINGSET_MEASUREMENTS: '1' });
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('radial_context_menu_plot.json'));

    const widget = await plotWidget(page, 0, 0);
    const chartHost = widget.locator('.uplot-chart-host');
    await chartHost.scrollIntoViewIfNeeded();
    const box = await chartHost.boundingBox();

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await clickWedgeByLabel(page, 'MockOwnTechThingSet');
    await clickWedgeByLabel(page, 'Others');

    const level3 = (await page.locator('.radial-menu-wedge-label').allTextContents()).sort();
    expect(level3).toEqual(['Config', 'Debug']);

    await clickWedgeByLabel(page, 'Config');
    const leaf = page.locator('.radial-menu-leaf', { hasText: 'rMode' });
    await expect(leaf).toBeVisible();
    await leaf.click();

    const seriesDefs = await page.evaluate(() => {
      const w = window.freeboard.getLiveModel().panes()[0].widgets()[0];
      return w.settings().seriesDefs;
    });
    expect(seriesDefs).toHaveLength(1);
    expect(seriesDefs[0].a).toMatchObject({ ds: 'MockOwnTechThingSet', var: '/Config/rMode' });

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('right-click near the axis margin sets Y Min inline, with no dialog', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const widget = await plotWidget(page);
    const chartHost = widget.locator('.uplot-chart-host');
    await chartHost.scrollIntoViewIfNeeded();
    const box = await chartHost.boundingBox();

    await page.mouse.click(box.x + 10, box.y + box.height / 2, { button: 'right' });
    await expect(radialMenu(page)).toBeVisible();
    await expect(page.locator('.radial-menu-wedge-label')).toHaveText('Axis');

    await clickWedgeByLabel(page, 'Axis');
    const yMinLeaf = page.locator('.radial-menu-leaf', { hasText: 'Y Min' });
    await expect(yMinLeaf).toBeVisible();
    await yMinLeaf.click();

    const input = page.locator('.radial-menu-leaf-input');
    await expect(input).toBeVisible();
    await input.fill('-5');
    await input.press('Enter');

    await expect(radialMenu(page)).toHaveCount(0);
    await expect(page.locator('#modal_overlay')).toHaveCount(0);
    const yMin = await page.evaluate(() => {
      const w = window.freeboard.getLiveModel().panes()[0].widgets()[6];
      return w.settings().yMin;
    });
    expect(yMin).toBe(-5);

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('right-click on the widget chrome still opens the full editor for Datasource', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const widget = await plotWidget(page);
    const summaryHost = widget.locator('.uplot-source-summary');
    await expect(summaryHost).toBeVisible();
    await summaryHost.scrollIntoViewIfNeeded();
    const box = await summaryHost.boundingBox();

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await expect(radialMenu(page)).toBeVisible();
    await expect(page.locator('.radial-menu-wedge-label')).toHaveText('Datasource');

    await clickWedgeByLabel(page, 'Datasource');
    const chooseLeaf = page.locator('.radial-menu-leaf', { hasText: 'Choose Datasource' });
    await expect(chooseLeaf).toBeVisible();
    await chooseLeaf.click();

    await expect(page.locator('#modal_overlay').last().locator('header .title')).toHaveText('Edit Widget');

    await page.keyboard.press('Escape');
    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('hovering each zone shows the matching plain-text action hint before right-clicking', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const widget = await plotWidget(page);
    const chartHost = widget.locator('.uplot-chart-host');
    await chartHost.scrollIntoViewIfNeeded();
    const box = await chartHost.boundingBox();

    const hint = page.locator('.uplot-radial-hover-hint');

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(hint).toContainText('Channel');

    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await expect(hint).toContainText('Axis');

    const summaryHost = widget.locator('.uplot-source-summary');
    await summaryHost.scrollIntoViewIfNeeded();
    const sbox = await summaryHost.boundingBox();
    await page.mouse.move(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2);
    await expect(hint).toContainText('Datasource');

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('Escape and click-outside both dismiss the radial menu without side effects', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const widget = await plotWidget(page);
    const chartHost = widget.locator('.uplot-chart-host');
    await chartHost.scrollIntoViewIfNeeded();
    const box = await chartHost.boundingBox();

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await expect(radialMenu(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(radialMenu(page)).toHaveCount(0);
    await expect(page.locator('#modal_overlay')).toHaveCount(0);

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await expect(radialMenu(page)).toBeVisible();
    // Click well outside the menu's radius, still inside the overlay backdrop.
    await page.mouse.click(20, 20);
    await expect(radialMenu(page)).toHaveCount(0);

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});
