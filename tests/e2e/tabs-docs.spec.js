const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard } = require('./helpers');

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
