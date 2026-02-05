const path = require('path');
const { _electron: electron } = require('playwright/test');

async function pickAppPage(app) {
  const pages = app.windows();
  const appPage = pages.find((p) => !p.url().startsWith('devtools://'));
  if (appPage) return appPage;
  return new Promise((resolve) => {
    app.on('window', (win) => {
      if (!win.url().startsWith('devtools://')) resolve(win);
    });
  });
}

async function launchApp(envOverrides = {}) {
  const env = {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    MOCK_HW: envOverrides.MOCK_HW ?? '1',
    ...envOverrides,
  };
  const app = await electron.launch({ args: ['.'], env });
  const page = await pickAppPage(app);
  const errors = [];
  page.on('pageerror', (err) => errors.push(err));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    errors.push(new Error(msg.text() || 'console.error'));
  });
  return { app, page, errors };
}

async function waitForDashboard(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#app-tabs', { state: 'attached', timeout: 30_000 });
  await page.waitForSelector('#board-content', { state: 'attached', timeout: 30_000 });
}

async function loadDashboard(page, dashboardPath) {
  await page.evaluate((p) => window.api.dashboard.loadDashboardFromPath(p), dashboardPath);
  await page.waitForFunction(() => {
    const fb = window.freeboard || null;
    if (!fb) return false;
    if (typeof fb.getLiveModel !== 'function') return false;
    const model = fb.getLiveModel();
    return model && typeof model.panes === 'function' && model.panes().length > 0;
  });
}

function fixturePath(name) {
  return path.join(process.cwd(), 'tests', 'fixtures', name);
}

module.exports = {
  launchApp,
  waitForDashboard,
  loadDashboard,
  fixturePath,
};
