const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

function radialMenu(page) {
  return page.locator('.radial-menu-overlay');
}

async function plotChartHost(page) {
  const chartHost = page.locator('.gs_w').first().locator('.sub-section').nth(6).locator('.uplot-chart-host');
  await expect(chartHost).toBeVisible();
  await chartHost.scrollIntoViewIfNeeded();
  return chartHost;
}

// The category wedge is a near-full-circle donut segment (a single category
// leaves only a small gap near the top) -- its bounding-box center falls in
// the donut's empty inner hole, so Playwright's default center-click misses
// it entirely. `.radial-menu` is a zero-size anchor element positioned at
// the menu's exact (post-clamping) screen position, so offsetting from its
// bounding box lands reliably on the painted wedge regardless of where the
// menu ended up on screen.
async function clickFirstWedge(page) {
  const anchor = await page.locator('.radial-menu').boundingBox();
  await page.mouse.click(anchor.x + 63, anchor.y);
}

test('right-click on the plot area opens the Channels wedge and adds a channel', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const chartHost = await plotChartHost(page);
    const box = await chartHost.boundingBox();

    // Well inside the plot area, away from any axis margin.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await expect(radialMenu(page)).toBeVisible();
    await expect(page.locator('.radial-menu-wedge-label')).toHaveText('Channels');

    await clickFirstWedge(page);
    const addLeaf = page.locator('.radial-menu-leaf', { hasText: '+ Add Channel' });
    await expect(addLeaf).toBeVisible();
    await addLeaf.click();

    await expect(page.locator('#modal_overlay').last().locator('header .title')).toHaveText('Edit Widget');
    await expect(radialMenu(page)).toHaveCount(0);

    await page.keyboard.press('Escape');
    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('right-click near the axis margin opens the Axis wedge and focuses Y Min', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const chartHost = await plotChartHost(page);
    const box = await chartHost.boundingBox();

    // Inside the left-margin axis zone (x < 56px from chartHost's left edge).
    await page.mouse.click(box.x + 10, box.y + box.height / 2, { button: 'right' });
    await expect(radialMenu(page)).toBeVisible();
    await expect(page.locator('.radial-menu-wedge-label')).toHaveText('Axis');

    await clickFirstWedge(page);
    const yMinLeaf = page.locator('.radial-menu-leaf', { hasText: 'Y Min' });
    await expect(yMinLeaf).toBeVisible();
    await yMinLeaf.click();

    const modal = page.locator('#modal_overlay').last();
    await expect(modal.locator('header .title')).toHaveText('Edit Widget');

    // The Y Min input should end up focused (and selected) as the specific
    // field this leaf action targeted, not just the dialog's default state.
    await page.waitForFunction(() => {
      const active = document.activeElement;
      if (!active || active.tagName !== 'INPUT') return false;
      const row = active.closest('.input-group');
      const label = row && row.querySelector('.input-group-text');
      return !!(label && label.textContent.trim() === 'Y Min');
    });

    await page.keyboard.press('Escape');
    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('right-click on the widget chrome (outside the chart) opens the Datasource wedge', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const summaryHost = page.locator('.gs_w').first().locator('.sub-section').nth(6).locator('.uplot-source-summary');
    await expect(summaryHost).toBeVisible();
    await summaryHost.scrollIntoViewIfNeeded();
    const box = await summaryHost.boundingBox();

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await expect(radialMenu(page)).toBeVisible();
    await expect(page.locator('.radial-menu-wedge-label')).toHaveText('Datasource');

    await clickFirstWedge(page);
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

test('Escape and click-outside both dismiss the radial menu without side effects', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const chartHost = await plotChartHost(page);
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
