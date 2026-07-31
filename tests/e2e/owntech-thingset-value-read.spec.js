const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

test('a +/- Button pointed at a ThingSet path reads the mocked value', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  await loadDashboard(page, fixturePath('owntech_thingset_value_read.json'));

  // MOCK_HW's thingsetSerial.tree() mock exposes /Config/rMode = 1 (see
  // app/preload.js). The +/- Button polls every 500ms once its datasource
  // sourceDef resolves to a thingset type, so this can take a couple of
  // cycles to settle after the datasource's own first poll completes.
  await page.waitForFunction(() => {
    const el = document.querySelector('.plus-minus-value');
    return !!(el && el.textContent.trim() === '1');
  }, null, { timeout: 15_000 });

  const text = await page.evaluate(() => document.querySelector('.plus-minus-value').textContent.trim());
  expect(text).toBe('1');

  await app.close();
});
