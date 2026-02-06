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

  const exampleId = 'SPIN/DAC/signal_generation';
  const exPagePromise = getExampleWindow(app);
  // Use app/ paths after runtime move to keep tests aligned with packaged layout.
  const preloadPath = require('path').join(process.cwd(), 'app', 'preload.js');
  const htmlPath = require('path').join(process.cwd(), 'app', 'dashboard', 'examples', 'example_viewer.html');
  await app.evaluate(({ BrowserWindow }, { id, preload, html }) => {
    const win = new BrowserWindow({
      show: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        preload,
      },
    });
    win.loadFile(html, { query: { id } });
  }, { id: exampleId, preload: preloadPath, html: htmlPath });

  const exPage = await exPagePromise;
  await exPage.waitForSelector('#example-title', { timeout: 20_000 });

  const title = await exPage.locator('#example-title').innerText();
  expect(title.toLowerCase()).toContain('signal_generation');

  await exPage.locator('#refresh-ports-btn').click();
  await exPage.locator('#port-select option').first().waitFor({ state: 'attached', timeout: 5_000 });
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
