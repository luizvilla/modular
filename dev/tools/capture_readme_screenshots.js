// Capture README dashboard screenshots (plot + gauge + terminal).
const fs = require('fs');
const path = require('path');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..');
const outputDir = path.join(repoRoot, 'app', 'docs', 'readme');

const WINDOW_WIDTH = 1920;
const WINDOW_HEIGHT = 1080;

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

async function screenshotWidget(page, index, dest) {
  const widget = page.locator('.sub-section').nth(index);
  await widget.waitFor({ state: 'attached' });
  await widget.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await widget.screenshot({ path: dest });
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });

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

  const fullPath = path.join(outputDir, 'readme-dashboard.png');
  await page.screenshot({ path: fullPath });

  const plotPath = path.join(outputDir, 'readme-plot.png');
  const gaugePath = path.join(outputDir, 'readme-gauge.png');
  const terminalPath = path.join(outputDir, 'readme-terminal.png');

  await screenshotWidget(page, 0, plotPath);
  await screenshotWidget(page, 1, gaugePath);
  await screenshotWidget(page, 2, terminalPath);

  await app.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
