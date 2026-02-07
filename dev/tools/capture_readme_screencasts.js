// Capture README screencast frames (plot + gauge + terminal) for GIFs.
const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..');
const outputBase = path.join(repoRoot, 'app', 'docs', 'readme');

const WINDOW_WIDTH = 1920;
const WINDOW_HEIGHT = 1080;
const DURATION_MS = Number(process.env.DURATION_MS) || 4000;
const FPS = Number(process.env.FPS) || 12;
const FRAME_COUNT = Math.max(1, Math.round((DURATION_MS / 1000) * FPS));
const FRAME_DELAY = 1000 / FPS;

function buildReadmeDashboard() {
  return {
    version: 1,
    allow_edit: true,
    plugins: [],
    panes: [
      {
        width: 1,
        row: { 3: 1 },
        col: { 3: 1 },
        col_width: 3,
        widgets: [
          {
            type: 'owntech_plot_uplot',
            settings: {
              title: 'Sine Wave',
              helperWidgets: 'none',
              duration: 20000,
              refreshRate: 200,
              yLabel: 'Value',
              yMin: -1.2,
              yMax: 1.2,
              showLegend: true,
              seriesDefs: [
                {
                  label: '',
                  op: 'identity',
                  param: 0,
                  a: { ds: 'SineGen', type: 'signal_generator_datasource', var: 0 }
                }
              ]
            }
          },
          {
            type: 'vertical_gauge',
            settings: {
              title: 'Warning Gauge',
              helperWidgets: 'none',
              min: 0,
              max: 1.2,
              barColor: 'orange',
              alarmEnabled: true,
              alarmThreshold: 0.7,
              alarmDirection: 'above',
              refreshRate: 200,
              sourceDef: {
                ds: 'WarnGen',
                type: 'signal_generator_datasource',
                var: 0
              }
            }
          },
          {
            type: 'serial_terminal',
            settings: {
              title: 'Serial Terminal',
              datasourceName: 'MockSerial',
              colorize: true,
              autoScroll: true,
              refresh: 200,
              maxLines: 100
            }
          }
        ]
      }
    ],
    datasources: [
      {
        name: 'SineGen',
        type: 'signal_generator_datasource',
        settings: {
          waveform: 'sine',
          amplitude: 1,
          offset: 0,
          frequency: 0.5,
          phase: 0,
          dutyCycle: 50,
          refresh: 100
        }
      },
      {
        name: 'WarnGen',
        type: 'signal_generator_datasource',
        settings: {
          waveform: 'triangle',
          amplitude: 0.8,
          offset: 0.2,
          frequency: 0.08,
          phase: 0,
          dutyCycle: 50,
          refresh: 200
        }
      },
      {
        name: 'MockSerial',
        type: 'serialport_datasource',
        settings: {
          portPath: 'COM_MOCK',
          baudRate: 115200,
          separator: ':',
          eol: '\n',
          refresh: 500
        }
      }
    ],
    columns: 3
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
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
}

async function loadReadmeDashboard(page) {
  const config = buildReadmeDashboard();
  await page.evaluate((cfg) => window.freeboard.loadDashboard(cfg), config);
  await page.waitForFunction(() => {
    const fb = window.freeboard;
    if (!fb || typeof fb.getLiveModel !== 'function') return false;
    const model = fb.getLiveModel();
    return model && typeof model.panes === 'function' && model.panes().length > 0;
  });
}

async function seedTerminalText(page) {
  await page.evaluate(() => {
    const code = document.querySelector('.serial-terminal code');
    if (!code) return;
    code.textContent = [
      'SINE: 0.00',
      'SINE: 0.31',
      'SINE: 0.59',
      'SINE: 0.81',
      'SINE: 0.95',
      'SINE: 1.00'
    ].join('\n');
  });
}

function framePath(dir, index) {
  const name = String(index).padStart(3, '0');
  return path.join(dir, `${name}.png`);
}

async function captureSequence(page, locator, dir) {
  ensureDir(dir);
  for (let i = 0; i < FRAME_COUNT; i += 1) {
    await page.waitForTimeout(FRAME_DELAY);
    if (locator) {
      await locator.scrollIntoViewIfNeeded();
      await locator.screenshot({ path: framePath(dir, i) });
    } else {
      await page.screenshot({ path: framePath(dir, i) });
    }
  }
}

async function run() {
  const env = {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    MOCK_HW: '1',
    ENABLE_THINGSET: '1'
  };

  const app = await electron.launch({ args: ['.'], env });
  const page = await pickAppPage(app);

  await setWindowSize(app);
  await waitForDashboard(page);
  await loadReadmeDashboard(page);

  // Let data flow and UI settle.
  await page.waitForTimeout(1500);
  await seedTerminalText(page);

  const dashboardDir = path.join(outputBase, 'screencast-dashboard');
  const plotDir = path.join(outputBase, 'screencast-plot');
  const gaugeDir = path.join(outputBase, 'screencast-gauge');
  const terminalDir = path.join(outputBase, 'screencast-terminal');

  const plotWidget = page.locator('.sub-section').nth(0);
  const gaugeWidget = page.locator('.sub-section').nth(1);
  const terminalWidget = page.locator('.sub-section').nth(2);

  await captureSequence(page, null, dashboardDir);
  await captureSequence(page, plotWidget, plotDir);
  await captureSequence(page, gaugeWidget, gaugeDir);
  await captureSequence(page, terminalWidget, terminalDir);

  await app.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
