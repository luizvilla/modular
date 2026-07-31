const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

test('Toggle Button, +/- Button, and Push Buttons send ThingSet writes when pointed at a ThingSet datasource', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  await loadDashboard(page, fixturePath('owntech_thingset_write.json'));

  // Wait for the datasource's first auto-poll so getDatasourceSettings().portPath
  // is populated (mutated in place by the auto-detect flow) -- every write path
  // below bails out silently without it.
  await page.waitForFunction(() => {
    const model = window.freeboard?.getLiveModel?.();
    const ds = model?.datasources().find((d) => d.name() === 'MockOwnTechThingSet');
    const settings = window.freeboard?.getDatasourceSettings?.('MockOwnTechThingSet');
    return !!(ds && settings && settings.portPath);
  }, null, { timeout: 15_000 });

  // Toggle Button: first click flips ON, should write writePath=/Config/wMode, value=true.
  await page.click('.toggle-switch');
  await page.waitForFunction(() => {
    const calls = window.api?.thingsetSerial?.getMockSetValueCalls?.() || [];
    return calls.some((c) => c.path === '/Config/wMode' && c.value === true);
  }, null, { timeout: 10_000 });

  // +/- Button: wait for its first read (mocked /Config/rMode = 1) to settle,
  // then click "+" -- should write writePath=/Config/rMode, value=2 (1 + step 1).
  await page.waitForFunction(() => {
    const el = document.querySelector('.plus-minus-value');
    return !!(el && el.textContent.trim() === '1');
  }, null, { timeout: 15_000 });
  await page.click('.plus-minus-btn:last-of-type');
  await page.waitForFunction(() => {
    const calls = window.api?.thingsetSerial?.getMockSetValueCalls?.() || [];
    return calls.some((c) => c.path === '/Config/rMode' && c.value === 2);
  }, null, { timeout: 10_000 });

  // Push Buttons: buttonTargets has one entry (/Config/wEnable = true).
  await page.click('.serial-command-buttons .btn');
  await page.waitForFunction(() => {
    const calls = window.api?.thingsetSerial?.getMockSetValueCalls?.() || [];
    return calls.some((c) => c.path === '/Config/wEnable' && c.value === true);
  }, null, { timeout: 10_000 });

  const calls = await page.evaluate(() => window.api.thingsetSerial.getMockSetValueCalls().map((c) => ({ port: c.port, path: c.path, value: c.value })));
  expect(calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ port: 'COM_MOCK', path: '/Config/wMode', value: true }),
    expect.objectContaining({ port: 'COM_MOCK', path: '/Config/rMode', value: 2 }),
    expect.objectContaining({ port: 'COM_MOCK', path: '/Config/wEnable', value: true }),
  ]));

  await app.close();
});
