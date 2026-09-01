const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');
const { radialMenu, clickWedgeByLabel } = require('./radial_menu_helpers');

// Milestone 6 of docs/GUI/02-navigation_overhaul.md: one implementation
// (SingleValueGaugeWidget in gauge_family.shared.js) covers all 5 gauge
// types, so this spec is parameterized across them the way
// integrated-plot-editor.spec.js already parameterizes its own gauge tests.

const GAUGE_TYPES = [
  { type: 'vertical_gauge', widgetIndex: 18, colorSelector: '.gauge-track--vertical' },
  { type: 'horizontal_gauge', widgetIndex: 19, colorSelector: '.gauge-track--horizontal' },
  { type: 'radial_arc_gauge', widgetIndex: 20, colorSelector: '.gauge-radial-svg' },
  { type: 'radial_needle_gauge', widgetIndex: 21, colorSelector: '.gauge-radial-svg' },
  { type: 'donut_gauge', widgetIndex: 22, colorSelector: '.gauge-radial-svg' },
];

function gaugeWidget(page, widgetIndex) {
  return page.locator('.gs_w').nth(0).locator('.sub-section').nth(widgetIndex);
}

for (const { type, widgetIndex, colorSelector } of GAUGE_TYPES) {
  test.describe(type, () => {
    test(`${type}: right-click the body drills a datasource and quick-sets sourceDef`, async () => {
      // MockSerial resolves to zero channels in this mock environment (no
      // headers/channel-count configured for it here), so this drills the
      // ThingSet datasource instead -- MOCK_THINGSET_MEASUREMENTS populates
      // its mock tree with real leaf variables to pick from.
      const { app, page } = await launchApp({ MOCK_THINGSET_MEASUREMENTS: '1' });
      try {
        await waitForDashboard(page);
        await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

        const widget = await gaugeWidget(page, widgetIndex);
        const body = widget.locator('.gauge-family');
        await body.scrollIntoViewIfNeeded();
        const box = await body.boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + 10, { button: 'right' });

        await expect(radialMenu(page)).toBeVisible();
        // Unlike the plot widgets (which restrict to relevant datasource
        // types), a gauge has exactly one source and might reasonably point
        // at any datasource type, so all of them show as arcs here.
        const dsLabels = await page.locator('.radial-menu-wedge-label').allTextContents();
        expect(dsLabels).toContain('MockOwnTechThingSet');
        await clickWedgeByLabel(page, 'MockOwnTechThingSet');
        await clickWedgeByLabel(page, 'Measurements');

        const leaf = page.locator('.radial-menu-leaf', { hasText: 'rVHigh_V' });
        await expect(leaf).toBeVisible();
        await leaf.click();
        await expect(radialMenu(page)).toHaveCount(0);

        const sourceDef = await page.evaluate((idx) => window.freeboard.getLiveModel().panes()[0].widgets()[idx].settings().sourceDef, widgetIndex);
        expect(sourceDef).toMatchObject({ ds: 'MockOwnTechThingSet', var: '/Measurements/rVHigh_V' });

        await app.close();
      } catch (e) {
        await app.close();
        throw e;
      }
    });

    test(`${type}: hovering the gauge shows Min/Max/Units`, async () => {
      const { app, page } = await launchApp();
      try {
        await waitForDashboard(page);
        await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

        const widget = await gaugeWidget(page, widgetIndex);
        const body = widget.locator('.gauge-family');
        await body.scrollIntoViewIfNeeded();
        const box = await body.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

        const panel = page.locator('.uplot-axis-hover-panel');
        await expect(panel).toBeVisible();
        await expect(panel).toContainText('Min');
        await expect(panel).toContainText('Max');
        await expect(panel).toContainText('Units');

        const maxInput = panel.locator('.uplot-axis-hover-panel-row').filter({ hasText: 'Max' }).locator('input');
        await maxInput.fill('55');
        await maxInput.press('Enter');
        await expect(panel).toBeVisible();

        const max = await page.evaluate((idx) => window.freeboard.getLiveModel().panes()[0].widgets()[idx].settings().max, widgetIndex);
        expect(Number(max)).toBe(55);

        await app.close();
      } catch (e) {
        await app.close();
        throw e;
      }
    });

    test(`${type}: double-clicking the title renames it`, async () => {
      const { app, page } = await launchApp();
      try {
        await waitForDashboard(page);
        await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

        const widget = await gaugeWidget(page, widgetIndex);
        const title = widget.locator('.gauge-family__title');
        await title.scrollIntoViewIfNeeded();
        await title.dblclick();

        const input = page.locator('.uplot-floating-input');
        await expect(input).toBeVisible();
        await input.fill('Renamed Gauge');
        await input.press('Enter');
        await expect(page.locator('.uplot-floating-input')).toHaveCount(0);

        const savedTitle = await page.evaluate((idx) => window.freeboard.getLiveModel().panes()[0].widgets()[idx].settings().title, widgetIndex);
        expect(savedTitle).toBe('Renamed Gauge');

        await app.close();
      } catch (e) {
        await app.close();
        throw e;
      }
    });

    test(`${type}: right-clicking the color element opens a 10-color carrousel and sets barColor`, async () => {
      const { app, page } = await launchApp();
      try {
        await waitForDashboard(page);
        await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

        const widget = await gaugeWidget(page, widgetIndex);
        const colorEl = widget.locator(colorSelector).first();
        await colorEl.scrollIntoViewIfNeeded();
        const box = await colorEl.boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });

        await expect(radialMenu(page)).toBeVisible();
        await expect(page.locator('.radial-menu-wedge')).toHaveCount(0);
        const leaves = page.locator('.radial-menu-leaf');
        await expect(leaves).toHaveCount(10);
        const targetColor = await leaves.first().getAttribute('title');
        await leaves.first().click();

        const barColor = await page.evaluate((idx) => window.freeboard.getLiveModel().panes()[0].widgets()[idx].settings().barColor, widgetIndex);
        expect(barColor.toLowerCase()).toBe(targetColor.toLowerCase());

        await app.close();
      } catch (e) {
        await app.close();
        throw e;
      }
    });
  });
}
