const { _electron: electron, test, expect } = require('playwright/test');

test('electron app boots and exposes window.api', async ({}, testInfo) => {
  testInfo.setTimeout(60_000);
  const errors = [];
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
  });

  const pickAppPage = async () => {
    const pages = app.windows();
    const appPage = pages.find((p) => !p.url().startsWith('devtools://'));
    if (appPage) return appPage;
    return new Promise((resolve) => {
      app.on('window', (win) => {
        if (!win.url().startsWith('devtools://')) resolve(win);
      });
    });
  };

  const page = await pickAppPage();
  page.on('pageerror', (err) => errors.push(err));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text() || '';
    errors.push(new Error(text));
  });

  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('body', { state: 'attached', timeout: 30_000 });
  try {
    await page.waitForSelector('#app-tabs', { state: 'attached', timeout: 20_000 });
    await page.waitForSelector('#board-content', { state: 'attached', timeout: 20_000 });
  } catch (err) {
    const url = page.url();
    const title = await page.title().catch(() => '');
    const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 500) : '');
    const allUrls = app.windows().map((p) => p.url());
    // eslint-disable-next-line no-console
    console.error('Smoke debug:', { url, title, bodyText, allUrls });
    throw err;
  }

  let hasApi = false;
  try {
    await page.waitForFunction(() => typeof window.api === 'object' && window.api !== null, null, { timeout: 15_000 });
    hasApi = true;
  } catch (err) {
    const url = page.url();
    const title = await page.title().catch(() => '');
    const apiKeys = await page.evaluate(() => Object.keys(window).filter(k => k.toLowerCase().includes('api')).slice(0, 20));
    // eslint-disable-next-line no-console
    console.error('Smoke api debug:', { url, title, apiKeys, hasApi: typeof window.api });
  }
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
