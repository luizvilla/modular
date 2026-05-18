const path = require('path');
const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard } = require('./helpers');

test.setTimeout(60_000);

async function getCoursewareEntries(page) {
  return page.evaluate(async () => {
    const bootstrap = await window.api.extensions.getBootstrap();
    return Array.isArray(bootstrap.courseware) ? bootstrap.courseware : [];
  });
}

async function openCoursewareTab(app, id) {
  await app.evaluate(({ BrowserWindow }, payload) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.webContents.send('open-doc-tab', payload);
  }, { kind: 'courseware', id });
}

async function getDocsWindow(app) {
  const pick = () => app.windows().find((p) => p.url().includes('example_viewer.html'));
  const existing = pick();
  if (existing) return existing;
  return new Promise((resolve) => {
    app.on('window', (win) => {
      if (win.url().includes('example_viewer.html')) resolve(win);
    });
  });
}

test('courseware menu and bootstrap expose built-in labs', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  const entries = await getCoursewareEntries(page);
  expect(entries.length).toBeGreaterThan(0);
  expect(entries[0]).toEqual(expect.objectContaining({
    extensionId: 'courseware',
    figuresDirPath: expect.any(String),
    dashboardPath: expect.any(String),
    binaryPath: expect.any(String),
  }));

  const menuState = await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const courseware = menu && menu.items.find((item) => item.label === 'Courseware');
    return {
      hasCourseware: !!courseware,
      labels: courseware ? courseware.submenu.items.map((item) => item.label) : [],
    };
  });

  expect(menuState.hasCourseware).toBe(true);
  expect(menuState.labels).toEqual(expect.arrayContaining(['Basics']));

  await app.close();
});

test('courseware tab renders markdown and uses packaged dashboard/binary actions', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  const entries = await getCoursewareEntries(page);
  const first = entries[0];
  expect(first).toBeTruthy();

  await openCoursewareTab(app, first.id);
  await page.waitForFunction((title) => {
    const panel = document.getElementById('doc-panel');
    const heading = document.getElementById('doc-title');
    return panel && panel.hidden === false && heading && heading.textContent === title;
  }, first.title);

  const imageCount = await page.evaluate(() => document.querySelectorAll('#doc-content img').length);
  expect(imageCount).toBeGreaterThan(0);

  await page.locator('#doc-refresh-ports-btn').click();
  await page.locator('#doc-port-select option').first().waitFor({ state: 'attached', timeout: 5_000 });
  await page.selectOption('#doc-port-select', { value: 'COM_MOCK' });

  await page.locator('#doc-upload-firmware-btn').click();
  await page.waitForFunction(() => {
    const state = document.getElementById('doc-upload-state');
    return state && state.textContent === 'done';
  }, null, { timeout: 10_000 });

  await page.locator('#doc-load-dashboard-btn').click();
  await page.waitForFunction(() => {
    const status = document.getElementById('doc-status');
    return status && /Dashboard loaded/i.test(status.textContent || '');
  }, null, { timeout: 10_000 });

  await app.close();
});

test('courseware standalone viewer loads and actions work', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  const entries = await getCoursewareEntries(page);
  const first = entries[0];
  expect(first).toBeTruthy();

  const viewerPromise = getDocsWindow(app);
  const preloadPath = path.join(process.cwd(), 'app', 'preload.js');
  const htmlPath = path.join(process.cwd(), 'app', 'dashboard', 'examples', 'example_viewer.html');
  await app.evaluate(({ BrowserWindow }, payload) => {
    const win = new BrowserWindow({
      show: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        preload: payload.preload,
      },
    });
    win.loadFile(payload.html, { query: { kind: 'courseware', id: payload.id } });
  }, { id: first.id, preload: preloadPath, html: htmlPath });

  const viewer = await viewerPromise;
  await viewer.waitForSelector('#example-title', { timeout: 20_000 });
  await expect(viewer.locator('#example-title')).toHaveText(first.title);

  const imageCount = await viewer.evaluate(() => document.querySelectorAll('#doc-content img').length);
  expect(imageCount).toBeGreaterThan(0);

  await viewer.locator('#refresh-ports-btn').click();
  await viewer.locator('#port-select option').first().waitFor({ state: 'attached', timeout: 5_000 });
  await viewer.selectOption('#port-select', { value: 'COM_MOCK' });

  await viewer.locator('#upload-firmware-btn').click();
  await viewer.waitForFunction(() => {
    const state = document.getElementById('upload-state');
    return state && state.textContent === 'done';
  }, null, { timeout: 10_000 });

  await viewer.locator('#load-dashboard-btn').click();
  await viewer.waitForFunction(() => {
    const status = document.getElementById('status-bar');
    return status && /Dashboard loaded/i.test(status.textContent || '');
  }, null, { timeout: 10_000 });

  await app.close();
});
