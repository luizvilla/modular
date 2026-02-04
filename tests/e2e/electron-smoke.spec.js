const { _electron: electron, test, expect } = require('playwright/test');

test('electron app boots and exposes window.api', async () => {
  const errors = [];
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
  });

  const page = await app.firstWindow();
  page.on('pageerror', (err) => errors.push(err));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text() || '';
    errors.push(new Error(text));
  });

  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => document.readyState === 'complete' || document.readyState === 'interactive');
  await page.waitForSelector('#app-tabs', { state: 'attached', timeout: 30_000 });
  await page.waitForSelector('#board-content', { state: 'attached', timeout: 30_000 });

  const hasApi = await page.evaluate(() => typeof window.api === 'object' && window.api !== null);
  expect(hasApi).toBe(true);

  const filtered = errors.filter((err) => {
    const msg = String(err && err.message ? err.message : err);
    return /Uncaught|ReferenceError|TypeError|window\\.api|preload/i.test(msg);
  });

  if (filtered.length) {
    // Surface likely-fatal errors in test output.
    // eslint-disable-next-line no-console
    console.error('Renderer errors detected:', filtered.map(e => e.message));
  }
  expect(filtered).toEqual([]);

  await app.close();
});
