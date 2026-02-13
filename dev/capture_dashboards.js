#!/usr/bin/env node
/*
 * Capture screenshots of all dashboards under app/dashboard/dashboards.
 * Output: dev/dashboard_screenshots/<example>.png
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = process.cwd();
const dashboardsRoot = path.join(repoRoot, 'app', 'dashboard', 'dashboards');
const outDir = path.join(repoRoot, 'dev', 'dashboard_screenshots');

function listDashboardFiles(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const file = path.join(full, `${entry.name}.json`);
      if (fs.existsSync(file)) out.push(file);
      else out.push(...listDashboardFiles(full));
    }
  }
  return out;
}

async function waitForDashboard(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#app-tabs', { state: 'attached', timeout: 30_000 });
  await page.waitForSelector('#board-content', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => window.freeboard && typeof window.freeboard.loadDashboard === 'function');
}

async function loadDashboard(page, dashboardJson) {
  await page.evaluate((cfg) => window.freeboard.loadDashboard(cfg), dashboardJson);
  await page.waitForFunction(() => {
    const fb = window.freeboard || null;
    if (!fb) return false;
    if (typeof fb.getLiveModel !== 'function') return false;
    const model = fb.getLiveModel();
    return model && typeof model.panes === 'function' && model.panes().length > 0;
  });
}

async function main() {
  if (!fs.existsSync(dashboardsRoot)) {
    console.error(`Dashboards root not found: ${dashboardsRoot}`);
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const dashboards = listDashboardFiles(dashboardsRoot);
  if (!dashboards.length) {
    console.error('No dashboards found to capture.');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const fakeSeries = Array.from({ length: 16 }, (_, i) => i + 1);
    const fakeTerminal = [
      '1:2:3:4:5:6:7:8',
      '2:3:4:5:6:7:8:9'
    ];
    window.api = {
      flags: { thingset: false },
      serial: {
        listPorts: async () => [{ value: 'MOCK' }],
        openPort: async () => ({}),
        closePort: async () => ({}),
        isOpen: async () => true,
        write: async () => ({}),
        getBuffer: async () => fakeSeries,
        getTerminalBuffer: async () => fakeTerminal,
        getFastDataset: async () => ({ timestamps: [0, 1], series: [fakeSeries] }),
        getHeaders: async () => [],
        getColors: async () => []
      },
      dashboard: {}
    };
  });

  const indexPath = path.join(repoRoot, 'app', 'dashboard', 'index.html');
  await page.goto(`file://${indexPath}`);
  await waitForDashboard(page);
  await page.setViewportSize({ width: 1400, height: 900 });

  for (const dashboardPath of dashboards) {
    const exampleName = path.basename(dashboardPath, '.json');
    const dashboardJson = JSON.parse(fs.readFileSync(dashboardPath, 'utf8'));
    await loadDashboard(page, dashboardJson);
    await page.waitForTimeout(500);
    const target = page.locator('#board-content');
    const outPath = path.join(outDir, `${exampleName}.png`);
    await target.screenshot({ path: outPath });
    console.log(`Captured ${exampleName}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
