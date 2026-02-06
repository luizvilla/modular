// Capture widget creation + usage screenshots for documentation.
const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..');
const docsIndexPath = path.join(repoRoot, 'app', 'docs', 'widgets', 'index.json');
const outputBase = path.join(repoRoot, 'app', 'docs', 'widgets');

const WINDOW_WIDTH = 2560;
const WINDOW_HEIGHT = 1440;

function readWidgetIndex() {
  const raw = fs.readFileSync(docsIndexPath, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.widgets) ? parsed.widgets : [];
}

function buildEmptyDashboard() {
  return {
    version: 1,
    allow_edit: true,
    plugins: [],
    panes: [
      {
        width: 1,
        row: { 3: 1 },
        col: { 3: 1 },
        col_width: 1,
        widgets: [],
      },
    ],
    datasources: [
      {
        name: 'MockSerial',
        type: 'serialport_datasource',
        settings: {
          portPath: 'COM_MOCK',
          baudRate: 115200,
          separator: ':',
          eol: '\n',
          refresh: 500,
        },
      },
      {
        name: 'MockFast',
        type: 'fast_frame_datasource',
        settings: {
          portPath: 'COM_MOCK',
          baudRate: 115200,
          separator: ':',
          eol: '\n',
          refresh: 500,
        },
      },
      {
        name: 'MockThingSetSerial',
        type: 'thingset_serial_datasource',
        settings: {
          autoDetect: true,
          portPath: 'COM_MOCK',
          baudRate: 115200,
          usePrefix: false,
          refresh: 1000,
          debug: false,
        },
      },
      {
        name: 'MockCan',
        type: 'can_datasource',
        settings: {
          channel: 'can0',
          device: 'auto',
          refresh: 500,
          debug: false,
        },
      },
    ],
    columns: 1,
  };
}

async function setWindowSize(app) {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return;
      win.setSize(size.width, size.height);
      win.setContentSize(size.width, size.height);
      win.center();
    },
    { width: WINDOW_WIDTH, height: WINDOW_HEIGHT }
  );
}

async function waitForDashboard(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('#board-content', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => !!window.freeboard);
}

async function loadEmptyDashboard(page) {
  const config = buildEmptyDashboard();
  await page.evaluate((cfg) => window.freeboard.loadDashboard(cfg), config);
  await page.waitForFunction(() => {
    const fb = window.freeboard;
    if (!fb || typeof fb.getLiveModel !== 'function') return false;
    const model = fb.getLiveModel();
    return model && typeof model.panes === 'function' && model.panes().length > 0;
  });
}

async function openWidgetDialog(page) {
  await page.click("li[data-bind*=\"operation: 'add'\"][data-bind*=\"type: 'widget'\"]");
  await page.waitForSelector('#modal_overlay', { state: 'visible', timeout: 10_000 });
}

async function selectWidgetType(page, typeName) {
  const selector = '#setting-row-plugin-types select';
  await page.waitForSelector(selector, { state: 'attached' });
  await page.selectOption(selector, { value: typeName });
}

async function screenshotModal(page, dest) {
  const modal = page.locator('#modal_overlay .modal');
  await modal.waitFor({ state: 'visible' });
  await modal.screenshot({ path: dest });
}

async function saveWidget(page) {
  await page.click('#dialog-ok');
  await page.waitForSelector('#modal_overlay', { state: 'hidden', timeout: 10_000 });
}

async function screenshotWidget(page, dest) {
  const widget = page.locator('.sub-section').first();
  await widget.waitFor({ state: 'attached' });
  await widget.scrollIntoViewIfNeeded();
  await widget.screenshot({ path: dest });
}

async function run() {
  const widgets = readWidgetIndex();
  if (!widgets.length) {
    console.error('No widgets found in index.json');
    process.exit(1);
  }

  const env = {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    MOCK_HW: '1',
    ENABLE_THINGSET: '1',
  };

  const app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow();

  await setWindowSize(app);
  await waitForDashboard(page);

  for (const widget of widgets) {
    if (!widget || !widget.type || !widget.doc) continue;
    const docDir = path.join(outputBase, path.dirname(widget.doc));
    const creationPath = path.join(docDir, 'creation.png');
    const usagePath = path.join(docDir, 'usage.png');

    fs.mkdirSync(docDir, { recursive: true });
    await loadEmptyDashboard(page);

    await openWidgetDialog(page);
    await selectWidgetType(page, widget.type);
    await screenshotModal(page, creationPath);

    await saveWidget(page);
    await screenshotWidget(page, usagePath);
  }

  await app.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
