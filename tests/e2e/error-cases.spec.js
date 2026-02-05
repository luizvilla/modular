const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, fixturePath } = require('./helpers');

test('no examples shows empty selector', async () => {
  const { app, page } = await launchApp({ MOCK_NO_EXAMPLES: '1' });
  await waitForDashboard(page);

  const count = await page.evaluate(() => {
    const sel = document.getElementById('doc-example-select');
    return sel ? sel.options.length : -1;
  });
  expect(count).toBe(0);

  await app.close();
});

test('no serial ports shows message', async () => {
  const { app, page } = await launchApp({ MOCK_NO_PORTS: '1' });
  await waitForDashboard(page);

  await page.evaluate(() => window.api.examples.openExampleTab('test_board/test_example'));
  await page.waitForFunction(() => {
    const panel = document.getElementById('doc-panel');
    return panel && panel.hidden === false;
  });

  await page.locator('#doc-refresh-ports-btn').click();
  const label = await page.locator('#doc-port-select option').first().innerText();
  expect(label).toContain('No ports');

  await app.close();
});

test('missing firmware shows upload failure', async () => {
  const { app, page } = await launchApp({ MOCK_FW_MISSING: '1' });
  await waitForDashboard(page);

  await page.evaluate(() => window.api.examples.openExampleTab('test_board/test_example'));
  await page.waitForFunction(() => {
    const panel = document.getElementById('doc-panel');
    return panel && panel.hidden === false;
  });
  await page.locator('#doc-refresh-ports-btn').click();
  await page.selectOption('#doc-port-select', { value: 'COM_MOCK' });
  await page.locator('#doc-upload-firmware-btn').click();
  await page.waitForFunction(() => {
    const status = document.getElementById('doc-status');
    return status && /failed/i.test(status.textContent || '');
  });

  await app.close();
});

test('invalid dashboard json is handled', async () => {
  const { app, page, errors } = await launchApp({
    MOCK_DASHBOARD_PATH: fixturePath('invalid_dashboard.json'),
  });
  await waitForDashboard(page);

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send('menu-load-dashboard');
  });

  await page.waitForTimeout(500);
  const hasError = errors.some((e) => /Menu load dashboard failed|Load dashboard from path failed/i.test(String(e.message || e)));
  expect(hasError).toBe(true);

  await app.close();
});

test('ipc unavailable exposes null api slices', async () => {
  const { app, page } = await launchApp({ MOCK_IPC_UNAVAILABLE: '1' });
  await waitForDashboard(page);

  const apiState = await page.evaluate(() => ({
    serial: window.api.serial,
    flash: window.api.flash,
    can: window.api.can,
    thingset: window.api.thingset,
  }));
  expect(apiState.serial).toBeNull();
  expect(apiState.flash).toBeNull();
  expect(apiState.can).toBeNull();
  expect(apiState.thingset).toBeNull();

  await app.close();
});
