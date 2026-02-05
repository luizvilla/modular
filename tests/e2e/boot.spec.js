const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard } = require('./helpers');

test('app boots and main window loads dashboard', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  const url = page.url();
  expect(url.includes('dashboard/index.html')).toBe(true);

  const hasDevtools = app.windows().some((p) => p.url().startsWith('devtools://'));
  expect(hasDevtools).toBe(true);

  await app.close();
});

test('window.api surface exists and window.require is undefined', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  const result = await page.evaluate(() => ({
    hasApi: typeof window.api === 'object' && window.api !== null,
    hasRequire: typeof window.require !== 'undefined',
  }));

  expect(result.hasApi).toBe(true);
  expect(result.hasRequire).toBe(false);

  await app.close();
});
