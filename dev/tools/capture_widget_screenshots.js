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
        width: 2,
        row: { 3: 1 },
        col: { 3: 1 },
        col_width: 2,
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
    columns: 2,
  };
}

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
  await page.waitForFunction(() => {
    // Ensure gridster is initialized before loading dashboards.
    if (!window.$) return false;
    const grid = window.$('.gridster ul');
    if (!grid || grid.length === 0) return false;
    return !!grid.data('gridster');
  });
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
  await page.waitForFunction(() => {
    if (!window.$) return false;
    const grid = window.$('.gridster ul');
    return grid && grid.data('gridster') && grid.data('gridster').cols > 0;
  });
}

async function openWidgetDialog(page) {
  await page.click("li[data-bind*=\"operation: 'add'\"][data-bind*=\"type: 'widget'\"]");
  await page.waitForSelector('#modal_overlay', { state: 'visible', timeout: 10_000 });
}

async function selectWidgetType(page, typeName) {
  const selector = '#setting-row-plugin-types select';
  await page.waitForSelector(selector, { state: 'visible' });
  const options = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return [];
    return Array.from(el.options).map((opt) => opt.value).filter(Boolean);
  }, selector);
  if (!options.includes(typeName)) {
    return false;
  }
  await page.selectOption(selector, { value: typeName });
  return true;
}

async function screenshotModal(page, dest) {
  const modal = page.locator('#modal_overlay .modal');
  await modal.waitFor({ state: 'visible' });
  await page.evaluate(() => {
    const overlay = document.getElementById('modal_overlay');
    const dialog = overlay ? overlay.querySelector('.modal') : null;
    if (overlay) {
      overlay.style.opacity = '1';
      overlay.style.transition = 'none';
    }
    if (dialog) {
      dialog.style.opacity = '1';
      dialog.style.transition = 'none';
    }
  });
  await page.waitForFunction(() => {
    const overlay = document.getElementById('modal_overlay');
    const dialog = overlay ? overlay.querySelector('.modal') : null;
    if (!overlay || !dialog) return false;
    const overlayOpacity = parseFloat(getComputedStyle(overlay).opacity || '1');
    const dialogOpacity = parseFloat(getComputedStyle(dialog).opacity || '1');
    return overlayOpacity > 0.98 && dialogOpacity > 0.98;
  });
  await page.waitForTimeout(200);
  await modal.screenshot({ path: dest });
}

async function saveWidget(page) {
  await page.click('#dialog-ok');
  await page.waitForSelector('#modal_overlay', { state: 'hidden', timeout: 10_000 });
}

async function setFirstDatasourceToMockSerial(page) {
  await page.evaluate(() => {
    if (!window.freeboard || typeof window.freeboard.getLiveModel !== 'function') return;
    const model = window.freeboard.getLiveModel();
    if (!model || typeof model.datasources !== 'function') return;
    const datasources = model.datasources();
    if (!datasources || datasources.length === 0) return;
    const first = datasources[0];
    if (!first || typeof first.name !== 'function') return;
    const name = first.name();
    if (name === 'MockSerial') return;
    const settings = first.settings && typeof first.settings === 'function' ? first.settings() : null;
    first.name('MockSerial');
    if (settings && typeof first.settings === 'function') {
      first.settings(settings);
    }
  });
}

async function configureSerialCommandButtons(page) {
  await page.evaluate(() => {
    if (!window.freeboard || typeof window.freeboard.getLiveModel !== 'function') return;
    const model = window.freeboard.getLiveModel();
    if (!model || typeof model.panes !== 'function') return;
    const panes = model.panes();
    if (!panes || panes.length === 0) return;
    const widgets = panes[0].widgets ? panes[0].widgets() : [];
    const target = widgets.find((w) => w && typeof w.type === 'function' && w.type() === 'serial_command_buttons');
    if (!target || typeof target.settings !== 'function') return;
    const settings = target.settings() || {};
    settings.datasource = settings.datasource || 'MockSerial';
    settings.buttons = [
      { label: 'Start', command: 'START' },
      { label: 'Stop', command: 'STOP' },
      { label: 'Reset', command: 'RESET' },
    ];
    target.settings(settings);
  });
}

async function configureSerialTerminal(page) {
  await page.evaluate(() => {
    if (!window.freeboard || typeof window.freeboard.getLiveModel !== 'function') return;
    const model = window.freeboard.getLiveModel();
    if (!model || typeof model.panes !== 'function') return;
    const panes = model.panes();
    if (!panes || panes.length === 0) return;
    const widgets = panes[0].widgets ? panes[0].widgets() : [];
    const target = widgets.find((w) => w && typeof w.type === 'function' && w.type() === 'serial_terminal');
    if (!target || typeof target.settings !== 'function') return;
    const settings = target.settings() || {};
    settings.datasourceName = settings.datasourceName || 'MockSerial';
    target.settings(settings);
  });
}

async function cancelWidgetDialog(page) {
  const cancel = page.locator('#dialog-cancel');
  if (await cancel.count()) {
    await cancel.click();
    await page.waitForSelector('#modal_overlay', { state: 'hidden', timeout: 10_000 });
  }
}

async function screenshotWidget(page, dest) {
  const widget = page.locator('.sub-section').first();
  await widget.waitFor({ state: 'attached' });
  await page.waitForTimeout(150);
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
  const page = await pickAppPage(app);

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
    const found = await selectWidgetType(page, widget.type);
    if (!found) {
      console.warn(`Skipping ${widget.type}: not present in widget selector.`);
      await cancelWidgetDialog(page);
      continue;
    }
    await screenshotModal(page, creationPath);

    await saveWidget(page);
    await setFirstDatasourceToMockSerial(page);
    if (widget.type === 'serial_command_buttons') {
      await configureSerialCommandButtons(page);
    }
    if (widget.type === 'serial_terminal') {
      await configureSerialTerminal(page);
    }
    await screenshotWidget(page, usagePath);
  }

  await app.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
