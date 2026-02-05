const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, fixturePath } = require('./helpers');

test('menu load/save and widget categories IPC', async () => {
  const dashPath = fixturePath('test_dashboard.json');
  const { app, page, errors } = await launchApp({
    MOCK_DASHBOARD_PATH: dashPath,
  });
  await waitForDashboard(page);

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send('menu-load-dashboard');
  });

  await page.waitForFunction(() => {
    const fb = window.freeboard || null;
    if (!fb || typeof fb.getLiveModel !== 'function') return false;
    const model = fb.getLiveModel();
    return model && typeof model.panes === 'function' && model.panes().length > 0;
  });

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send('menu-save-dashboard');
    win.webContents.send('show-widget-categories');
  });

  const filtered = errors.filter((err) => /Menu load dashboard failed|saveDashboard|showWidgetCategoryManager/i.test(String(err.message || err)));
  expect(filtered).toEqual([]);

  await app.close();
});
