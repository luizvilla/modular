const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard } = require('./helpers');

test('electron app boots and exposes window.api', async ({}, testInfo) => {
  testInfo.setTimeout(60_000);
  const { app, page, errors } = await launchApp();

  await waitForDashboard(page);

  await page.waitForFunction(() => typeof window.api === 'object' && window.api !== null, null, { timeout: 15_000 });

  const filtered = errors.filter((err) => {
    const msg = String(err && err.message ? err.message : err);
    return /Uncaught|ReferenceError|TypeError|window\\.api|preload/i.test(msg);
  });

  if (filtered.length) {
    // eslint-disable-next-line no-console
    console.error('Renderer errors detected:', filtered.map(e => e.message));
  }
  expect(filtered).toEqual([]);

  await app.close();
});
