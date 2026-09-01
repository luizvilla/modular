const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');
const { radialMenu, clickWedgeByLabel, plotWidget } = require('./radial_menu_helpers');

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
    // Config's own direct scalars (rMode/wMode) share a "General" wedge,
    // separate from the per-leg groups (Leg1/Leg2) -- M10 fix: their leaf
    // names (wEnable, wCapa, ...) used to collapse to the same label across
    // legs, rendering as visually duplicate circles for different paths.
    const level4 = (await page.locator('.radial-menu-wedge-label').allTextContents()).sort();
    expect(level4).toEqual(['General', 'Leg1', 'Leg2']);

    await clickWedgeByLabel(page, 'General');
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

// M10 (docs/GUI/02-navigation_overhaul.md): real per-leg boards (Leg1, Leg2,
// ...) each have their own identically-named leaves (wEnable, wCapa,
// wDriver, sFault) -- these used to collapse to the same last-path-segment
// label regardless of which leg they came from, rendering as visually
// duplicate circles for genuinely different paths.
test('same-named leaves under different legs render as distinct circles, not duplicates', async () => {
  const { app, page } = await launchApp();
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
    await clickWedgeByLabel(page, 'Config');

    const configWedges = (await page.locator('.radial-menu-wedge-label').allTextContents()).sort();
    expect(configWedges).toEqual(['General', 'Leg1', 'Leg2']);

    await clickWedgeByLabel(page, 'Leg1');
    const leg1Leaves = (await page.locator('.radial-menu-leaf').allTextContents()).sort();
    expect(leg1Leaves).toEqual(['sFault', 'wCapa', 'wDriver', 'wEnable']);
    const leg1Leaf = page.locator('.radial-menu-leaf', { hasText: 'wEnable' });
    await leg1Leaf.click();

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await clickWedgeByLabel(page, 'MockOwnTechThingSet');
    await clickWedgeByLabel(page, 'Others');
    await clickWedgeByLabel(page, 'Config');
    await clickWedgeByLabel(page, 'Leg2');
    const leg2Leaves = (await page.locator('.radial-menu-leaf').allTextContents()).sort();
    expect(leg2Leaves).toEqual(['sFault', 'wCapa', 'wDriver', 'wEnable']);
    await page.locator('.radial-menu-leaf', { hasText: 'wEnable' }).click();

    const seriesDefs = await page.evaluate(() => {
      const w = window.freeboard.getLiveModel().panes()[0].widgets()[0];
      return w.settings().seriesDefs;
    });
    expect(seriesDefs).toHaveLength(2);
    expect(seriesDefs[0].a).toMatchObject({ var: '/Config/Leg1/wEnable' });
    expect(seriesDefs[1].a).toMatchObject({ var: '/Config/Leg2/wEnable' });

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('hovering the Y-axis margin shows an inline quick-edit panel, no right-click needed', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const widget = await plotWidget(page);
    const chartHost = widget.locator('.uplot-chart-host');
    await chartHost.scrollIntoViewIfNeeded();
    const box = await chartHost.boundingBox();

    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    const panel = page.locator('.uplot-axis-hover-panel');
    await expect(panel).toBeVisible();
    const rows = panel.locator('.uplot-axis-hover-panel-row');
    await expect(rows).toHaveCount(3);
    await expect(panel).toContainText('Y Label');
    await expect(panel).toContainText('Y Min');
    await expect(panel).toContainText('Y Max');

    // The panel is meant to stay open across edits while the cursor is
    // still on the margin/panel -- it's not a one-shot popup that closes
    // after a single field, since "hovering it" is the whole affordance.
    const yMinInput = rows.filter({ hasText: 'Y Min' }).locator('input');
    await yMinInput.fill('-2');
    await yMinInput.press('Enter');
    await expect(panel).toBeVisible();
    const yMin = await page.evaluate(() => {
      const w = window.freeboard.getLiveModel().panes()[0].widgets()[6];
      return w.settings().yMin;
    });
    expect(yMin).toBe(-2);

    // Moving away (past the hide debounce) closes it. yMin is in the
    // needsReset list, so the plot -- and chartHost's layout -- may have
    // shifted after the commit; re-measure before moving. The panel is
    // anchored near the left edge and can be wide enough to cover the
    // chart's horizontal center, so move to the far right edge instead --
    // genuinely outside both the panel and the y-axis margin.
    const freshBox = await chartHost.boundingBox();
    await page.mouse.move(freshBox.x + freshBox.width - 10, freshBox.y + freshBox.height / 2);
    await page.waitForTimeout(400);
    await expect(page.locator('.uplot-axis-hover-panel')).toHaveCount(0);

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

// M10 (docs/GUI/02-navigation_overhaul.md): the hide-debounce used to be
// 200ms, which read as a noticeable lag between "mouse left the axis" and
// "panel actually gone." Shortened to 80ms -- this proves it disappears
// promptly rather than lingering, without asserting an exact timing that'd
// make the test brittle.
test('the axis hover panel disappears promptly after the mouse leaves, not with a long lag', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const widget = await plotWidget(page);
    const chartHost = widget.locator('.uplot-chart-host');
    await chartHost.scrollIntoViewIfNeeded();
    const box = await chartHost.boundingBox();

    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    const panel = page.locator('.uplot-axis-hover-panel');
    await expect(panel).toBeVisible();

    await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2);
    // A short poll window well under the old 200ms delay -- if the fix
    // regressed back to a long lag, this would time out and fail.
    await expect(page.locator('.uplot-axis-hover-panel')).toHaveCount(0, { timeout: 200 });

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('hovering the X-axis margin shows Duration/Refresh Rate inline, no right-click needed', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const widget = await plotWidget(page);
    const chartHost = widget.locator('.uplot-chart-host');
    await chartHost.scrollIntoViewIfNeeded();
    const box = await chartHost.boundingBox();

    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 5);
    const panel = page.locator('.uplot-axis-hover-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Duration');
    await expect(panel).toContainText('Refresh Rate');

    const durationInput = panel.locator('.uplot-axis-hover-panel-row').filter({ hasText: 'Duration' }).locator('input');
    await durationInput.fill('9000');
    await durationInput.press('Enter');
    await expect(panel).toBeVisible();

    const duration = await page.evaluate(() => {
      const w = window.freeboard.getLiveModel().panes()[0].widgets()[6];
      return w.settings().duration;
    });
    expect(duration).toBe(9000);

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('moving from the axis margin into its panel keeps the panel open (hover bridge)', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const widget = await plotWidget(page);
    const chartHost = widget.locator('.uplot-chart-host');
    await chartHost.scrollIntoViewIfNeeded();
    const box = await chartHost.boundingBox();

    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    const panel = page.locator('.uplot-axis-hover-panel');
    await expect(panel).toBeVisible();

    const panelBox = await panel.boundingBox();
    await page.mouse.move(panelBox.x + panelBox.width / 2, panelBox.y + panelBox.height / 2);
    // Give the 200ms hide-debounce time to fire if the bridge were broken.
    await page.waitForTimeout(400);
    await expect(panel).toBeVisible();

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('hovering the plot area shows the "Add Channel" hint; axis margins show no hint (the panel is the affordance)', async () => {
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
    await expect(hint).toContainText('Add Channel');

    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await expect(hint).toBeHidden();
    await expect(page.locator('.uplot-axis-hover-panel')).toBeVisible();

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

async function addMeasurementsChannel(page) {
  const widget = await plotWidget(page, 0, 0);
  const chartHost = widget.locator('.uplot-chart-host');
  await chartHost.scrollIntoViewIfNeeded();
  const box = await chartHost.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await clickWedgeByLabel(page, 'MockOwnTechThingSet');
  await clickWedgeByLabel(page, 'Measurements');
  await page.locator('.radial-menu-leaf', { hasText: 'rVHigh_V' }).click();
  const readoutItem = widget.locator('.uplot-readout-item[data-idx="0"]');
  await expect(readoutItem).toBeVisible({ timeout: 10_000 });
  return { widget, readoutItem };
}

test('double-clicking a channel\'s readout label renames it', async () => {
  const { app, page } = await launchApp({ MOCK_THINGSET_MEASUREMENTS: '1' });
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('radial_context_menu_plot.json'));

    const { readoutItem } = await addMeasurementsChannel(page);
    const label = readoutItem.locator('.uplot-readout-label');
    await label.dblclick();

    const input = page.locator('.uplot-floating-input');
    await expect(input).toBeVisible();
    await input.fill('High Side V');
    await input.press('Enter');

    await expect(page.locator('.uplot-floating-input')).toHaveCount(0);
    await expect(label).toHaveText('High Side V');
    const savedLabel = await page.evaluate(() => {
      const w = window.freeboard.getLiveModel().panes()[0].widgets()[0];
      return w.settings().seriesDefs[0].label;
    });
    expect(savedLabel).toBe('High Side V');

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('Escape while renaming a channel cancels without saving', async () => {
  const { app, page } = await launchApp({ MOCK_THINGSET_MEASUREMENTS: '1' });
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('radial_context_menu_plot.json'));

    const { readoutItem } = await addMeasurementsChannel(page);
    await readoutItem.locator('.uplot-readout-label').dblclick();
    const input = page.locator('.uplot-floating-input');
    await expect(input).toBeVisible();
    await input.fill('Should Not Save');
    await input.press('Escape');

    await expect(page.locator('.uplot-floating-input')).toHaveCount(0);
    const savedLabel = await page.evaluate(() => {
      const w = window.freeboard.getLiveModel().panes()[0].widgets()[0];
      return w.settings().seriesDefs[0].label;
    });
    expect(savedLabel).toBe('');

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('renaming a channel survives readout refresh ticks without losing what was typed', async () => {
  // Regression test: _renderReadouts() used to rebuild the label the input
  // lived inside on every poll tick (refreshRate: 500ms here), destroying
  // the input -- and the keystrokes in it -- mid-edit. The floating input
  // now lives outside readoutHost entirely, so it must survive several
  // ticks untouched.
  const { app, page } = await launchApp({ MOCK_THINGSET_MEASUREMENTS: '1' });
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('radial_context_menu_plot.json'));

    const { readoutItem } = await addMeasurementsChannel(page);
    await readoutItem.locator('.uplot-readout-label').dblclick();
    const input = page.locator('.uplot-floating-input');
    await expect(input).toBeVisible();
    await input.type('Slow ', { delay: 30 });

    // Span several 500ms refresh ticks while sitting mid-edit.
    await page.waitForTimeout(1300);
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('Slow ');

    await input.type('Typist');
    await input.press('Enter');

    await expect(page.locator('.uplot-floating-input')).toHaveCount(0);
    const savedLabel = await page.evaluate(() => {
      const w = window.freeboard.getLiveModel().panes()[0].widgets()[0];
      return w.settings().seriesDefs[0].label;
    });
    expect(savedLabel).toBe('Slow Typist');

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('double-clicking the chart title renames it', async () => {
  const { app, page } = await launchApp();
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    const widget = await plotWidget(page);
    const title = widget.locator('.u-title');
    await expect(title).toBeVisible();
    await expect(title).toHaveText('Plot');
    await title.dblclick();

    const input = page.locator('.uplot-floating-input');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('Plot');
    await input.fill('Renamed Plot');
    await input.press('Enter');

    await expect(page.locator('.uplot-floating-input')).toHaveCount(0);
    const savedTitle = await page.evaluate(() => {
      const w = window.freeboard.getLiveModel().panes()[0].widgets()[6];
      return w.settings().title;
    });
    expect(savedTitle).toBe('Renamed Plot');

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  }
});

test('right-clicking a channel\'s color swatch opens a 10-color carrousel with no category step', async () => {
  const { app, page } = await launchApp({ MOCK_THINGSET_MEASUREMENTS: '1' });
  try {
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('radial_context_menu_plot.json'));

    const { readoutItem } = await addMeasurementsChannel(page);
    const swatch = readoutItem.locator('.uplot-readout-swatch');
    const swatchBox = await swatch.boundingBox();
    await page.mouse.click(swatchBox.x + swatchBox.width / 2, swatchBox.y + swatchBox.height / 2, { button: 'right' });

    await expect(radialMenu(page)).toBeVisible();
    // No arcs at all -- straight to the leaf ring, since colors have nothing
    // to categorize.
    await expect(page.locator('.radial-menu-wedge')).toHaveCount(0);
    const leaves = page.locator('.radial-menu-leaf');
    await expect(leaves).toHaveCount(10);

    const targetColor = await leaves.first().getAttribute('title');
    await leaves.first().click();

    await expect(radialMenu(page)).toHaveCount(0);
    const savedColor = await page.evaluate(() => {
      const w = window.freeboard.getLiveModel().panes()[0].widgets()[0];
      return w.settings().seriesDefs[0].color;
    });
    expect(savedColor.toLowerCase()).toBe(targetColor.toLowerCase());

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
