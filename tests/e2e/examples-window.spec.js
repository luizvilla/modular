const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard } = require('./helpers');

async function getExampleWindow(app) {
  const pick = () => app.windows().find((p) => p.url().includes('example_viewer.html'));
  const existing = pick();
  if (existing) return existing;
  return new Promise((resolve) => {
    app.on('window', (win) => {
      if (win.url().includes('example_viewer.html')) resolve(win);
    });
  });
}

test('example viewer window loads and actions work', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await page.evaluate(() => window.api.examples.openExampleTab('test_board/test_example'));
  await page.evaluate(() => window.api.examples.undockDocTab('test_board/test_example'));

  const exPage = await getExampleWindow(app);
  await exPage.waitForSelector('#example-title', { timeout: 20_000 });

  const title = await exPage.locator('#example-title').innerText();
  expect(title.toLowerCase()).toContain('test_example');

  await exPage.locator('#refresh-ports-btn').click();
  await exPage.waitForSelector('#port-select option', { timeout: 5_000 });
  await exPage.selectOption('#port-select', { label: 'COM_MOCK' }).catch(async () => {
    await exPage.selectOption('#port-select', { value: 'COM_MOCK' });
  });

  await exPage.locator('#upload-firmware-btn').click();
  await exPage.waitForFunction(() => {
    const state = document.getElementById('upload-state');
    return state && state.textContent === 'done';
  }, null, { timeout: 10_000 });

  await exPage.locator('#load-dashboard-btn').click();
  await exPage.waitForFunction(() => {
    const status = document.getElementById('status-bar');
    return status && /Dashboard loaded/i.test(status.textContent || '');
  }, null, { timeout: 10_000 });

  await app.close();
});
