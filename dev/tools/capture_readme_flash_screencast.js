// Capture a firmware upload mockup screencast for README GIF usage.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { _electron: electron } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..');
const outputDir = path.join(repoRoot, 'app', 'docs', 'readme');
const framesDir = path.join(outputDir, 'screencast-flash');
const gifPath = path.join(outputDir, 'readme-flash.gif');
const palettePath = path.join(outputDir, '.palette-flash.png');

const WINDOW_WIDTH = 1400;
const WINDOW_HEIGHT = 900;
const DURATION_MS = Number(process.env.DURATION_MS) || 4000;
const FPS = Number(process.env.FPS) || 12;
const FRAME_COUNT = Math.max(1, Math.round((DURATION_MS / 1000) * FPS));
const FRAME_DELAY = 1000 / FPS;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function buildFlashDashboard() {
  return {
    version: 1,
    allow_edit: true,
    plugins: [],
    panes: [
      {
        width: 1,
        row: { 3: 1 },
        col: { 3: 1 },
        col_width: 2,
        widgets: [
          {
            type: 'serial_flasher',
            settings: { title: 'Firmware Upload' }
          }
        ]
      }
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
          refresh: 500
        }
      }
    ],
    columns: 2
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

async function loadDashboard(page) {
  const config = buildFlashDashboard();
  await page.evaluate((cfg) => window.freeboard.loadDashboard(cfg), config);
  await page.waitForFunction(() => {
    const fb = window.freeboard;
    if (!fb || typeof fb.getLiveModel !== 'function') return false;
    const model = fb.getLiveModel();
    return model && typeof model.panes === 'function' && model.panes().length > 0;
  });
}

async function primeFlasherUI(page) {
  await page.evaluate(() => {
    const widget = document.querySelector('.sub-section');
    if (!widget) return;
    // Force a mock file name and port selection in the UI.
    const fileInput = widget.querySelector('input[readonly]');
    if (fileInput) fileInput.value = 'firmware.mcuboot.bin';
    const portSelect = widget.querySelector('select');
    if (portSelect && !portSelect.options.length) {
      const opt = document.createElement('option');
      opt.value = 'COM_MOCK';
      opt.textContent = 'COM_MOCK';
      portSelect.appendChild(opt);
      portSelect.value = 'COM_MOCK';
    }
    // Show log area for the mockup.
    const logBtn = widget.querySelector('button.btn-outline-secondary');
    if (logBtn && logBtn.textContent && logBtn.textContent.includes('Show log')) {
      logBtn.click();
    }
    // Inject a mock progress bar.
    if (!widget.querySelector('.flash-mock-bar')) {
      const wrap = document.createElement('div');
      wrap.className = 'flash-mock-wrap';
      wrap.style.cssText = 'background:#1f2937;border:1px solid #334155;border-radius:6px;height:18px;overflow:hidden;margin-top:8px;';
      const bar = document.createElement('div');
      bar.className = 'flash-mock-bar';
      bar.style.cssText = 'height:100%;width:0%;background:#3b82f6;transition:width 0.1s linear;';
      wrap.appendChild(bar);
      const label = document.createElement('div');
      label.className = 'flash-mock-label';
      label.style.cssText = 'margin-top:6px;font-size:12px;color:#cbd5f5;';
      label.textContent = 'Uploading: 0%';
      widget.appendChild(wrap);
      widget.appendChild(label);
    }
  });
}

async function setProgress(page, pct) {
  await page.evaluate((val) => {
    const bar = document.querySelector('.flash-mock-bar');
    const label = document.querySelector('.flash-mock-label');
    if (bar) bar.style.width = `${val}%`;
    if (label) label.textContent = `Uploading: ${Math.round(val)}%`;
  }, pct);
}

function framePath(index) {
  return path.join(framesDir, `${String(index).padStart(3, '0')}.png`);
}

function buildGif() {
  execFileSync('ffmpeg', [
    '-y',
    '-framerate', String(FPS),
    '-i', path.join(framesDir, '%03d.png'),
    '-vf', 'scale=1280:-1:flags=lanczos,palettegen',
    palettePath
  ], { stdio: 'ignore' });

  execFileSync('ffmpeg', [
    '-y',
    '-framerate', String(FPS),
    '-i', path.join(framesDir, '%03d.png'),
    '-i', palettePath,
    '-lavfi', 'scale=1280:-1:flags=lanczos [x]; [x][1:v] paletteuse',
    gifPath
  ], { stdio: 'ignore' });
}

async function run() {
  ensureDir(outputDir);
  ensureDir(framesDir);

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
  await loadDashboard(page);
  await page.waitForTimeout(1200);
  await primeFlasherUI(page);

  const widget = page.locator('.sub-section').first();
  await widget.waitFor({ state: 'attached' });

  for (let i = 0; i < FRAME_COUNT; i += 1) {
    const pct = (i / (FRAME_COUNT - 1)) * 100;
    await setProgress(page, pct);
    await page.waitForTimeout(FRAME_DELAY);
    await widget.screenshot({ path: framePath(i) });
  }

  await app.close();
  buildGif();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
