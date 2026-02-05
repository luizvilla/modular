const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

test('can and thingset api mocks respond', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  const res = await page.evaluate(async () => {
    const ifs = await window.api.can.getInterfaces();
    const opened = await window.api.can.open({ channel: 'can0' });
    const scan = await window.api.can.scanNodes({ channel: 'can0' });
    const snap = await window.api.can.aggregateSnapshot({ channel: 'can0' });
    const ts = await window.api.thingset.update({ channel: 'can0', targetAddr: 160, endpoint: 'Config', values: { wMode: 1 } });
    return { ifs, opened, scan, snap, ts };
  });

  expect(res.ifs.length).toBeGreaterThan(0);
  expect(res.scan).toBeTruthy();
  expect(res.snap.nodes).toBeTruthy();
  expect(res.ts.status).toBe(0x80);

  await app.close();
});

test('thingset widgets render in test dashboard', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  await loadDashboard(page, fixturePath('test_dashboard.json'));

  const widgetTypes = await page.evaluate(() => {
    const model = window.freeboard?.getLiveModel?.();
    if (!model || typeof model.panes !== 'function') return [];
    const types = [];
    model.panes().forEach((p) => p.widgets().forEach((w) => types.push(w.type())));
    return types;
  });

  expect(widgetTypes).toEqual(expect.arrayContaining([
    'thingset_control_panel',
    'thingset_device_ui',
    'thingset_measurements',
    'thingset_mode_button',
    'ts_serial_device_ui',
  ]));

  await app.close();
});
