const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, fixturePath } = require('./helpers');

test.setTimeout(60_000);

async function getExampleIds(page, limit = 10) {
  await page.waitForFunction(() => {
    const sel = document.getElementById('doc-example-select');
    return sel && sel.options.length > 0;
  });
  return page.evaluate((max) => {
    const sel = document.getElementById('doc-example-select');
    if (!sel) return [];
    return Array.from(sel.options)
      .map((o) => o.value)
      .filter(Boolean)
      .slice(0, max);
  }, limit);
}

async function openExampleTabs(app, ids) {
  for (const id of ids) {
    await app.evaluate(({ BrowserWindow }, exampleId) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.webContents.send('open-example-tab', { id: exampleId });
    }, id);
  }
}

async function waitForTabCount(page, count) {
  await page.waitForFunction((expected) => {
    const tabs = document.querySelectorAll('[data-tab-id^="doc:"]');
    return tabs.length === expected;
  }, count);
}

test('open up to 10 example tabs', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  const ids = await getExampleIds(page, 10);
  expect(ids.length).toBeGreaterThan(0);

  await openExampleTabs(app, ids);
  await waitForTabCount(page, ids.length);

  await app.close();
});

test('widget docs bootstrap contains merged entries from enabled extensions', async () => {
  const { app, page } = await launchApp({ ENABLE_THINGSET: '1' });
  await waitForDashboard(page);

  const result = await page.evaluate(async () => {
    const bootstrap = await window.api.extensions.getBootstrap();
    const docs = Array.isArray(bootstrap.widgetDocs) ? bootstrap.widgetDocs : [];
    return {
      hasTimePlot: docs.some((e) => e.type === 'time_plot_uplot'),
      hasTwistActions: docs.some((e) => e.type === 'twist_actions_panel'),
      hasThingsetDeviceUi: docs.some((e) => e.type === 'thingset_device_ui'),
      timePlotCategory: (docs.find((e) => e.type === 'time_plot_uplot') || {}).category,
      twistExtensionId: (docs.find((e) => e.type === 'twist_actions_panel') || {}).extensionId,
    };
  });

  expect(result.hasTimePlot).toBe(true);
  expect(result.hasTwistActions).toBe(true);
  expect(result.hasThingsetDeviceUi).toBe(true);
  expect(result.timePlotCategory).toBe('Plots');
  expect(result.twistExtensionId).toBe('owntech');

  await app.close();
});

test('widget docs bootstrap excludes disabled extension entries', async () => {
  const { app, page } = await launchApp({ MODULAR_EXTENSION_OWNTECH: '0', ENABLE_THINGSET: '0' });
  await waitForDashboard(page);

  const result = await page.evaluate(async () => {
    const bootstrap = await window.api.extensions.getBootstrap();
    const docs = Array.isArray(bootstrap.widgetDocs) ? bootstrap.widgetDocs : [];
    return {
      hasTimePlot: docs.some((e) => e.type === 'time_plot_uplot'),
      hasTwistActions: docs.some((e) => e.type === 'twist_actions_panel'),
      hasThingsetDeviceUi: docs.some((e) => e.type === 'thingset_device_ui'),
    };
  });

  expect(result.hasTimePlot).toBe(true);
  expect(result.hasTwistActions).toBe(false);
  expect(result.hasThingsetDeviceUi).toBe(false);

  await app.close();
});

test('serialport_datasource is in core and available when owntech is disabled', async () => {
  const { app, page } = await launchApp({ MODULAR_EXTENSION_OWNTECH: '0', ENABLE_THINGSET: '0' });
  await waitForDashboard(page);

  const result = await page.evaluate(async () => {
    const bootstrap = await window.api.extensions.getBootstrap();
    const ds = Array.isArray(bootstrap.datasources) ? bootstrap.datasources : [];
    const sp = ds.find((e) => e.type === 'serialport_datasource');
    return {
      hasSerialport: !!sp,
      extensionId: sp ? sp.extensionId : null,
      icon: sp ? sp.icon : null,
    };
  });

  expect(result.hasSerialport).toBe(true);
  expect(result.extensionId).toBe('core');
  expect(result.icon).toBe('plug');

  await app.close();
});

test('serial port metadata includes vendorId and productId fields', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  const ports = await page.evaluate(async () => window.api.serial.listPorts());
  expect(ports.length).toBeGreaterThan(0);
  const port = ports[0];
  expect(Object.prototype.hasOwnProperty.call(port, 'vendorId')).toBe(true);
  expect(Object.prototype.hasOwnProperty.call(port, 'productId')).toBe(true);
  expect(Object.prototype.hasOwnProperty.call(port, 'manufacturer')).toBe(true);
  expect(Object.prototype.hasOwnProperty.call(port, 'serialNumber')).toBe(true);

  await app.close();
});

test('undock and re-dock up to 10 example tabs', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  const ids = await getExampleIds(page, 10);
  expect(ids.length).toBeGreaterThan(0);

  await openExampleTabs(app, ids);
  await waitForTabCount(page, ids.length);

  for (const id of ids) {
    await app.evaluate(({ BrowserWindow }, exampleId) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.webContents.send('undock-doc-tab', { id: exampleId });
    }, id);
    await page.locator(`[data-tab-id="doc:${id}"] .tab-close`).click().catch(() => {});
  }

  await waitForTabCount(page, 0);

  await openExampleTabs(app, ids);
  await waitForTabCount(page, ids.length);

  await app.close();
});

/**
 * Regression: edits made to a dashboard tab (e.g. adding/renaming a
 * datasource) must survive navigating away to a doc tab and back.
 *
 * The bug: switchToDashboardTab only ever refreshed a dashboard tab's saved
 * snapshot when leaving *another* dashboard tab. Doc-tab navigation calls
 * setActiveTab directly and never touches window.freeboard's live state (it
 * just hides the board with CSS), so the live model kept accumulating edits
 * -- but returning to the dashboard tab unconditionally reloaded the stale
 * snapshot from tab-creation time, silently discarding everything done since,
 * and duplicated every pane/widget in the DOM in the process (fadeOut-based
 * pane removal racing the synchronous rebuild).
 *
 * The fix tracks which dashboard tab's data is actually live in
 * window.freeboard; returning to that same tab is a no-op (view toggle only,
 * no reload), and any other dashboard's live state gets saved into the
 * right tab regardless of what was active in between.
 */
test('editing a dashboard, visiting a doc tab, and returning preserves the edit', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await page.evaluate((p) => window.dashboardTabs.openFile(p), fixturePath('drag_drop_dashboard.json'));
  await page.waitForFunction(() => {
    const model = window.freeboard && window.freeboard.getLiveModel && window.freeboard.getLiveModel();
    return !!(model && model.datasources && model.datasources().length > 0);
  });

  await page.evaluate(() => window.freeboard.getLiveModel().datasources()[0].name('LIVE_EDIT_SURVIVES'));

  const gridItemsBefore = await page.locator('.gridster > ul > li, .gridster > li').count();

  const ids = await getExampleIds(page, 1);
  expect(ids.length).toBeGreaterThan(0);
  await openExampleTabs(app, ids);
  await waitForTabCount(page, 1);

  await page.locator('.tab[data-tab-id^="dashboard:"]').first().click();
  await page.waitForTimeout(300);

  const name = await page.evaluate(() => window.freeboard.getLiveModel().datasources()[0].name());
  expect(name).toBe('LIVE_EDIT_SURVIVES');

  const gridItemsAfter = await page.locator('.gridster > ul > li, .gridster > li').count();
  expect(gridItemsAfter).toBe(gridItemsBefore);

  await app.close();
});
