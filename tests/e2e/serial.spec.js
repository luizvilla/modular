const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

test('serial api mocks respond', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  const result = await page.evaluate(async () => {
    const ports = await window.api.serial.listPorts();
    await window.api.serial.openPort({ path: ports[0].value, baudRate: 115200 });
    const open = await window.api.serial.isOpen(ports[0].value);
    await window.api.serial.write(ports[0].value, 'hello');
    const buf = await window.api.serial.getBuffer(ports[0].value);
    const term = await window.api.serial.getTerminalBuffer(ports[0].value);
    const fast = await window.api.serial.getFastDataset(ports[0].value);
    await window.api.serial.closePort(ports[0].value);
    return { ports, open, bufLen: buf.length, termLen: term.length, fastOk: !!fast.timestamps };
  });

  expect(result.ports.length).toBeGreaterThan(0);
  expect(result.open).toBe(true);
  expect(result.bufLen).toBeGreaterThan(0);
  expect(result.termLen).toBeGreaterThan(0);
  expect(result.fastOk).toBe(true);

  await app.close();
});

test('serial widgets render in test dashboard', async () => {
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
    'serial_terminal',
    'serial_command_buttons',
    'serial_port_control',
    'serial_csv_recorder',
    'serial_header_editor',
    'serial_flasher',
  ]));

  await app.close();
});
