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
      hasCoursewareRoots: Array.isArray(bootstrap.coursewareRoots) && bootstrap.coursewareRoots.length > 0,
      hasCourseware: Array.isArray(bootstrap.courseware) && bootstrap.courseware.length > 0,
      hasTutorialRoots: Array.isArray(bootstrap.tutorialRoots) && bootstrap.tutorialRoots.length > 0,
      hasTutorials: Array.isArray(bootstrap.tutorials) && bootstrap.tutorials.length > 0,
    };
  });
  const menuState = await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const widgetExtensions = menu && menu.items.find((item) => item.label === 'Widget Extensions');
    const tutorials = menu && menu.items.find((item) => item.label === 'Tutorials');
    return {
      widgetLabels: widgetExtensions ? widgetExtensions.submenu.items.map((item) => item.label) : [],
      hasTutorialsMenu: !!tutorials,
    };
  });

  expect(diagnostics.hasMainSnapshot).toBe(true);
  expect(diagnostics.hasRuntimeSnapshot).toBe(true);
  expect(diagnostics.extensionIds).toEqual(expect.arrayContaining(['core', 'courseware', 'tutorials', 'owntech', 'owntech-workspace', 'thingset']));
  expect(diagnostics.inventoryHasVersionField).toBe(true);
  expect(diagnostics.inventoryHasIsInstalledField).toBe(true);
  // Manager list shows all extensions; source-loaded appear as 'builtin'.
  expect(diagnostics.managerListIds).toEqual(expect.arrayContaining(['core', 'courseware', 'tutorials', 'owntech', 'owntech-workspace', 'thingset']));
  expect(diagnostics.managerListSources.every((s) => s === 'builtin' || s === 'installed')).toBe(true);
  expect(diagnostics.hasInstalledInManagerList).toBe(false);
  expect(diagnostics.hasManagerApi).toBe(true);
  expect(diagnostics.hasCoreScript).toBe(true);
  expect(diagnostics.hasOwntechScript).toBe(true);
  expect(diagnostics.hasThingsetScript).toBe(true);
  expect(diagnostics.hasWidgetDocsRoots).toBe(true);
  expect(diagnostics.hasCoursewareRoots).toBe(true);
  expect(diagnostics.hasCourseware).toBe(true);
  expect(diagnostics.hasTutorialRoots).toBe(true);
  expect(diagnostics.hasTutorials).toBe(true);
  expect(menuState.widgetLabels).toEqual(expect.arrayContaining(['Modular Core Widgets', 'OwnTech Widgets', 'Thingset Widgets']));
  expect(menuState.hasTutorialsMenu).toBe(true);

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
    MODULAR_EXTENSION_COURSEWARE: '0',
    MODULAR_EXTENSION_TUTORIALS: '0',
    MODULAR_EXTENSION_OWNTECH: '0',
    ENABLE_THINGSET: '0',
  });

  await waitForDashboard(page);

  const snapshot = await page.evaluate(async () => {
    const inventory = await window.api.extensions.list();
    const bootstrap = await window.api.extensions.getBootstrap();
    const managerList = await window.api.extensions.manager.list();
    return {
      owntechEnabled: await window.api.extensions.isEnabled('owntech'),
      owntechWorkspaceEnabled: await window.api.extensions.isEnabled('owntech-workspace'),
      coursewareEnabled: await window.api.extensions.isEnabled('courseware'),
      tutorialsEnabled: await window.api.extensions.isEnabled('tutorials'),
      thingsetEnabled: await window.api.extensions.isEnabled('thingset'),
      inventory,
      managerCoursewareEnabled: managerList.find((e) => e.id === 'courseware')?.enabled,
      managerOwntechEnabled: managerList.find((e) => e.id === 'owntech')?.enabled,
      managerOwntechWorkspaceEnabled: managerList.find((e) => e.id === 'owntech-workspace')?.enabled,
      managerThingsetEnabled: managerList.find((e) => e.id === 'thingset')?.enabled,
      hasFastFrameScript: bootstrap.rendererScripts.some((entry) => entry.path === 'plugins/fast_frame_plot.widget.js'),
      hasTwistScript: bootstrap.rendererScripts.some((entry) => entry.path === 'plugins/twist_control.widget.js'),
      hasThingSetScript: bootstrap.rendererScripts.some((entry) => entry.path === 'plugins/ts_device_ui.widget.js'),
      exampleRoots: bootstrap.exampleRoots.length,
      coursewareRoots: bootstrap.coursewareRoots.length,
      courseware: bootstrap.courseware.length,
      tutorialRoots: bootstrap.tutorialRoots.length,
      tutorials: bootstrap.tutorials.length,
    };
  });
  const menuState = await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const widgetExtensions = menu && menu.items.find((item) => item.label === 'Widget Extensions');
    const tutorials = menu && menu.items.find((item) => item.label === 'Tutorials');
    return {
      widgetLabels: widgetExtensions ? widgetExtensions.submenu.items.map((item) => item.label) : [],
      hasTutorialsMenu: !!tutorials,
    };
  });

  expect(snapshot.coursewareEnabled).toBe(false);
  expect(snapshot.tutorialsEnabled).toBe(false);
  expect(snapshot.owntechEnabled).toBe(false);
  expect(snapshot.owntechWorkspaceEnabled).toBe(false);
  expect(snapshot.thingsetEnabled).toBe(false);
  expect(snapshot.inventory).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'core', enabled: true }),
    expect.objectContaining({ id: 'courseware', enabled: false }),
    expect.objectContaining({ id: 'tutorials', enabled: false }),
    expect.objectContaining({ id: 'owntech', enabled: false }),
    expect.objectContaining({ id: 'owntech-workspace', enabled: false }),
    expect.objectContaining({ id: 'thingset', enabled: false }),
  ]));
  expect(snapshot.managerCoursewareEnabled).toBe(false);
  expect(snapshot.managerOwntechEnabled).toBe(false);
  expect(snapshot.managerOwntechWorkspaceEnabled).toBe(false);
  expect(snapshot.managerThingsetEnabled).toBe(false);
  expect(snapshot.hasFastFrameScript).toBe(true);
  expect(snapshot.hasTwistScript).toBe(false);
  expect(snapshot.hasThingSetScript).toBe(false);
  expect(snapshot.exampleRoots).toBe(0);
  expect(snapshot.coursewareRoots).toBe(0);
  expect(snapshot.courseware).toBe(0);
  expect(snapshot.tutorialRoots).toBe(0);
  expect(snapshot.tutorials).toBe(0);
  expect(menuState.widgetLabels).toEqual(['Modular Core Widgets']);
  expect(menuState.hasTutorialsMenu).toBe(false);

  const filtered = errors.filter((err) => {
    const msg = String(err && err.message ? err.message : err);
    return /Uncaught|ReferenceError|TypeError|window\\.api|preload/i.test(msg);
  });
  expect(filtered).toEqual([]);

  await app.close();
});
