const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard } = require('./helpers');

test('electron app boots and exposes window.api', async ({}, testInfo) => {
  testInfo.setTimeout(60_000);
  const { app, page, errors } = await launchApp();

  await waitForDashboard(page);

  await page.waitForFunction(() => typeof window.api === 'object' && window.api !== null, null, { timeout: 15_000 });
  await page.waitForFunction(() => typeof window.__modularDiagnosticsRuntime === 'object' && window.__modularDiagnosticsRuntime !== null, null, { timeout: 15_000 });

  const diagnostics = await page.evaluate(async () => {
    const sample = await window.api.diagnostics.captureSnapshot();
    const runtime = window.__modularDiagnosticsRuntime.collectRuntimeSnapshot();
    return {
      hasMainSnapshot: !!(sample && sample.process && sample.process.memory),
      hasRuntimeSnapshot: !!(runtime && runtime.timers && runtime.listeners),
    };
  });

  expect(diagnostics).toEqual({
    hasMainSnapshot: true,
    hasRuntimeSnapshot: true,
  });

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
