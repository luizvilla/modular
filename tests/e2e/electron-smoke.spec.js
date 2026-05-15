const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard } = require('./helpers');

test('electron app boots and exposes window.api', async ({}, testInfo) => {
  testInfo.setTimeout(60_000);
  const { app, page, errors } = await launchApp();

  await waitForDashboard(page);

  await page.waitForFunction(() => typeof window.api === 'object' && window.api !== null, null, { timeout: 15_000 });
  await page.waitForFunction(() => typeof window.__modularDiagnosticsRuntime === 'object' && window.__modularDiagnosticsRuntime !== null, null, { timeout: 15_000 });

  const diagnostics = await page.evaluate(async () => {
    const inventory = await window.api.extensions.list();
    const bootstrap = await window.api.extensions.getBootstrap();
    const sample = await window.api.diagnostics.captureSnapshot();
    const runtime = window.__modularDiagnosticsRuntime.collectRuntimeSnapshot();
    const managerList = await window.api.extensions.manager.list();
    return {
      hasMainSnapshot: !!(sample && sample.process && sample.process.memory),
      hasRuntimeSnapshot: !!(runtime && runtime.timers && runtime.listeners),
      extensionIds: inventory.map((entry) => entry.id),
      inventoryHasVersionField: inventory.every((e) => typeof e.version === 'string'),
      inventoryHasIsInstalledField: inventory.every((e) => typeof e.isInstalled === 'boolean'),
      managerListIds: managerList.map((e) => e.id),
      managerListSources: managerList.map((e) => e.source),
      hasInstalledInManagerList: managerList.some((e) => e.source === 'installed'),
      hasManagerApi: typeof window.api.extensions.manager === 'object',
      hasCoreScript: bootstrap.rendererScripts.some((entry) => entry.path === 'plugins/fast_frame_plot.widget.js'),
      hasOwntechScript: bootstrap.rendererScripts.some((entry) => entry.path === 'plugins/twist_control.widget.js'),
      hasThingsetScript: bootstrap.rendererScripts.some((entry) => entry.path === 'plugins/ts_device_ui.widget.js'),
      hasWidgetDocsRoots: Array.isArray(bootstrap.widgetDocsRoots) && bootstrap.widgetDocsRoots.length > 0,
      hasExampleRoots: Array.isArray(bootstrap.exampleRoots) && bootstrap.exampleRoots.length > 0,
    };
  });

  expect(diagnostics.hasMainSnapshot).toBe(true);
  expect(diagnostics.hasRuntimeSnapshot).toBe(true);
  expect(diagnostics.extensionIds).toEqual(expect.arrayContaining(['core', 'owntech', 'thingset']));
  expect(diagnostics.inventoryHasVersionField).toBe(true);
  expect(diagnostics.inventoryHasIsInstalledField).toBe(true);
  // Manager list shows all extensions; source-loaded appear as 'builtin'.
  expect(diagnostics.managerListIds).toEqual(expect.arrayContaining(['core', 'owntech', 'thingset']));
  expect(diagnostics.managerListSources.every((s) => s === 'builtin' || s === 'installed')).toBe(true);
  expect(diagnostics.hasInstalledInManagerList).toBe(false);
  expect(diagnostics.hasManagerApi).toBe(true);
  expect(diagnostics.hasCoreScript).toBe(true);
  expect(diagnostics.hasOwntechScript).toBe(true);
  expect(diagnostics.hasThingsetScript).toBe(true);
  expect(diagnostics.hasWidgetDocsRoots).toBe(true);
  expect(diagnostics.hasExampleRoots).toBe(true);

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

test('extension runtime boots cleanly with owntech and thingset disabled', async () => {
  const { app, page, errors } = await launchApp({
    MODULAR_EXTENSION_OWNTECH: '0',
    ENABLE_THINGSET: '0',
  });

  await waitForDashboard(page);

  const snapshot = await page.evaluate(async () => {
    const inventory = await window.api.extensions.list();
    const bootstrap = await window.api.extensions.getBootstrap();
    return {
      owntechEnabled: await window.api.extensions.isEnabled('owntech'),
      thingsetEnabled: await window.api.extensions.isEnabled('thingset'),
      inventory,
      hasFastFrameScript: bootstrap.rendererScripts.some((entry) => entry.path === 'plugins/fast_frame_plot.widget.js'),
      hasTwistScript: bootstrap.rendererScripts.some((entry) => entry.path === 'plugins/twist_control.widget.js'),
      hasThingSetScript: bootstrap.rendererScripts.some((entry) => entry.path === 'plugins/ts_device_ui.widget.js'),
      exampleRoots: bootstrap.exampleRoots.length,
    };
  });

  expect(snapshot.owntechEnabled).toBe(false);
  expect(snapshot.thingsetEnabled).toBe(false);
  expect(snapshot.inventory).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'core', enabled: true }),
    expect.objectContaining({ id: 'owntech', enabled: false }),
    expect.objectContaining({ id: 'thingset', enabled: false }),
  ]));
  expect(snapshot.hasFastFrameScript).toBe(true);
  expect(snapshot.hasTwistScript).toBe(false);
  expect(snapshot.hasThingSetScript).toBe(false);
  expect(snapshot.exampleRoots).toBe(0);

  const filtered = errors.filter((err) => {
    const msg = String(err && err.message ? err.message : err);
    return /Uncaught|ReferenceError|TypeError|window\\.api|preload/i.test(msg);
  });
  expect(filtered).toEqual([]);

  await app.close();
});
