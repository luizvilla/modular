const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard } = require('./helpers');

test('tabs open example and render docs', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await page.evaluate(() => window.api.examples.openExampleTab('test_board/test_example'));

  await page.waitForFunction(() => {
    const panel = document.getElementById('doc-panel');
    return panel && panel.hidden === false;
  });

  const optionLabels = await page.evaluate(() => {
    const sel = document.getElementById('doc-example-select');
    if (!sel) return [];
    return Array.from(sel.options).map((o) => o.textContent || '');
  });
  expect(optionLabels.join(' ')).toContain('test_board');

  const hasDocsMode = await page.evaluate(() => document.body.classList.contains('docs-mode'));
  expect(hasDocsMode).toBe(true);

  await page.locator('[data-tab-id="dashboard"]').click();
  await page.waitForFunction(() => document.body.classList.contains('dashboard-mode'));

  const title = await page.locator('#doc-title').innerText();
  expect(title.toLowerCase()).toContain('test_example');

  const hasHeading = await page.locator('#doc-content h1').innerText();
  expect(hasHeading).toContain('Test Example');

  const codeBlock = await page.locator('#doc-content pre code').innerText();
  expect(codeBlock).toContain('const msg');

  const imgSrc = await page.evaluate(() => {
    const img = document.querySelector('#doc-content img');
    return img ? img.getAttribute('src') : '';
  });
  expect(imgSrc.includes('asset.svg')).toBe(true);

  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send('example-dock-preview', { id: 'test_board/test_example', active: true });
  });
  await page.waitForSelector('.tab-dock-preview', { timeout: 5_000 });
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.send('example-dock-preview', { id: 'test_board/test_example', active: false });
  });
  await page.waitForFunction(() => !document.querySelector('.tab-dock-preview'));

  await app.close();
});
