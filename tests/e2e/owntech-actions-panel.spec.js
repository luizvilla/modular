const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

async function waitForDatasourceReady(page) {
  await page.waitForFunction(() => {
    const model = window.freeboard?.getLiveModel?.();
    const ds = model?.datasources().find((d) => d.name() === 'MockOwnTechThingSet');
    return !!(ds && ds.latestData() && ds.latestData().status === 'ok');
  }, null, { timeout: 15_000 });
}

test('owntech_actions_panel discovers leg groups and boolean toggles from the mocked tree (2 legs)', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  await loadDashboard(page, fixturePath('owntech_actions_panel.json'));
  await waitForDatasourceReady(page);

  await page.waitForFunction(() => document.querySelectorAll('.twist-toggle-item').length > 0, null, { timeout: 15_000 });

  const legBadges = await page.locator('.badge').allTextContents();
  expect(legBadges).toEqual(['Leg1', 'Leg2']);

  // 4 boolean action leaves (wEnable, wCapa, wDriver, sFault) per leg * 2 legs.
  await expect(page.locator('.twist-toggle-item')).toHaveCount(8);

  // wEnable starts true (checked) in the mock tree; clicking its label flips
  // it to false and should write /Config/Leg1/wEnable = false.
  await page.locator('.twist-toggle-item', { hasText: 'wEnable' }).first().locator('.onoffswitch-label').click();
  await page.waitForFunction(() => {
    const calls = window.api?.thingsetSerial?.getMockSetValueCalls?.() || [];
    return calls.some((c) => c.path === '/Config/Leg1/wEnable' && c.value === false);
  }, null, { timeout: 10_000 });

  // Power controls write the /Config/Mode enum directly.
  await page.click('button:has-text("POWER ON")');
  await page.waitForFunction(() => {
    const calls = window.api?.thingsetSerial?.getMockSetValueCalls?.() || [];
    return calls.some((c) => c.path === '/Config/Mode' && c.value === 1);
  }, null, { timeout: 10_000 });

  await app.close();
});

test('owntech_actions_panel discovers a 3rd leg group with zero widget/discovery code changes', async () => {
  const { app, page } = await launchApp({ MOCK_THINGSET_LEG3: '1' });
  await waitForDashboard(page);
  await loadDashboard(page, fixturePath('owntech_actions_panel.json'));
  await waitForDatasourceReady(page);

  await page.waitForFunction(() => document.querySelectorAll('.twist-toggle-item').length > 0, null, { timeout: 15_000 });

  const legBadges = await page.locator('.badge').allTextContents();
  expect(legBadges).toEqual(['Leg1', 'Leg2', 'Leg3']);
  await expect(page.locator('.twist-toggle-item')).toHaveCount(12);

  await app.close();
});
