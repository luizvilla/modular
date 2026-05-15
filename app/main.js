const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');
const fs = require('fs');
const { flashFirmware, cancelFlash } = require('./flasher');
const { spawn } = require('child_process');
const { buildExtensionRuntime } = require('./extensions/runtime');
// CAN / ThingSet
const { createBus } = require('./js/can_adapter');
const { ThingSetCAN } = require('./js/thingset_bin');
const { scanNodes: scanCanNodes } = require('./js/scan');
const { CanBroadcastAggregator } = require('./js/can_broadcast_aggregator');
const { exploreId } = require('./js/query_nodes');
const { flashCanFirmware } = require('./js/thingset_dfu_can');
const { ThingSetSerialShell } = require('./js/thingset_serial_shell');

const argv = process.argv || [];
const noGpu = argv.includes('--no-gpu') || argv.includes('--disable-gpu');
if (noGpu) {
    // Must be called before app is ready
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu');
}

// Feature flag: default to enabled in dev, disabled in packaged builds unless explicitly set.
const enableThingset = (() => {
    if (process.env.ENABLE_THINGSET !== undefined) {
        return process.env.ENABLE_THINGSET === '1' || process.env.ENABLE_THINGSET === 'true';
    }
    return !app.isPackaged;
})();
process.env.ENABLE_THINGSET = enableThingset ? '1' : '0';
const extensionRuntime = buildExtensionRuntime({
    appRoot: __dirname,
    env: process.env,
    logger: console,
});

function cloneExtensionInventory() {
    return extensionRuntime.inventory.map((entry) => ({
        ...entry,
        capabilities: Array.isArray(entry.capabilities) ? entry.capabilities.slice() : [],
    }));
}

function cloneExtensionBootstrap() {
    return {
        rendererScripts: extensionRuntime.bootstrap.rendererScripts.map((entry) => ({ ...entry })),
        flags: { ...extensionRuntime.bootstrap.flags },
        extensions: cloneExtensionInventory(),
        widgetDocsRoots: extensionRuntime.bootstrap.widgetDocsRoots.map((entry) => ({ ...entry })),
        exampleRoots: extensionRuntime.bootstrap.exampleRoots.map((entry) => ({ ...entry })),
        dashboardRoots: extensionRuntime.bootstrap.dashboardRoots.map((entry) => ({ ...entry })),
    };
}

let mainWindow; // reference to the main BrowserWindow
let exampleWindow; // dedicated window for example documentation and actions
let exampleTabRequestTimer; // debounce example tab requests
let pendingExampleTabId = null; // last requested example tab (for late renderer init)
// Track example window docking previews/selection so popped tabs can be dragged back.
let exampleWindowActiveId = null;
let exampleDockPreviewActive = false;
let exampleDockMoveTimer = null;
let exampleDockLastOverlap = false;
let exampleDockingInProgress = false;
let pendingWidgetDocType = null; // Track widget doc tab requests before renderer init.

function buildTimestampStamp(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function resolveTimestampedCsvPath(filePath) {
    const target = String(filePath || '').trim();
    if (!target) return target;
    const parsed = path.parse(target);
    const ext = parsed.ext || '.csv';
    const baseName = parsed.name || 'fast_frame';
    return path.join(parsed.dir || '.', `${buildTimestampStamp()}-${baseName}${ext}`);
}

// Menu-driven file open uses main-process dialog to satisfy user activation requirements.
ipcMain.handle('show-open-dashboard', async () => {
    if (!mainWindow) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'Dashboard', extensions: ['json'] }]
    });
    if (canceled || !filePaths || filePaths.length === 0) return null;
    return filePaths[0];
});

ipcMain.handle('choose-csv-file', async () => {
    if (!mainWindow) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        defaultPath: process.cwd(),
        properties: ['openFile'],
        filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (canceled || !filePaths || filePaths.length === 0) return null;
    return filePaths[0];
});

// Bridge renderer logs to the terminal for debugging.
ipcMain.on('renderer-log', (_event, { level = 'log', args = [] } = {}) => {
    const prefix = '[renderer]';
    const payload = Array.isArray(args) ? args : [args];
    if (level === 'error') {
        console.error(prefix, ...payload);
    } else if (level === 'warn') {
        console.warn(prefix, ...payload);
    } else {
        console.log(prefix, ...payload);
    }
});

// App menu is custom: Edit only hosts "Widget Categories" and View/Window are removed.
// Build a nested Examples menu from dashboard/docs/examples/**/README.md.
function collectReadmes(baseDir) {
    const readmes = [];
    if (!fs.existsSync(baseDir)) return readmes;
    const walk = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.isFile() && entry.name.toLowerCase() === 'readme.md') {
                readmes.push(full);
            }
        }
    };
    walk(baseDir);
    return readmes;
}

function collectReadmesFromRoots(rootEntries) {
    const readmes = [];
    for (const rootEntry of rootEntries || []) {
        if (!rootEntry || !rootEntry.path) continue;
        for (const docPath of collectReadmes(rootEntry.path)) {
            readmes.push({ root: rootEntry, docPath });
        }
    }
    return readmes;
}

function buildExamplesMenuItems() {
    try {
        const readmes = collectReadmesFromRoots(extensionRuntime.bootstrap.exampleRoots);
        if (!readmes.length) return [];

        const root = { children: new Map(), exampleId: null };
        for (const entry of readmes) {
            const relDir = path.relative(entry.root.path, path.dirname(entry.docPath));
            const parts = relDir.split(path.sep).filter(Boolean);
            if (!parts.length) continue;
            let node = root;
            for (const part of parts) {
                if (!node.children.has(part)) node.children.set(part, { children: new Map(), exampleId: null });
                node = node.children.get(part);
            }
            node.exampleId = parts.join('/');
        }

        const buildMenuFromNode = (node) => {
            const items = [];
            const keys = Array.from(node.children.keys()).sort((a, b) => a.localeCompare(b));
            for (const key of keys) {
                const child = node.children.get(key);
                if (child.children.size > 0) {
                    items.push({
                        label: key,
                        submenu: buildMenuFromNode(child)
                    });
                } else if (child.exampleId) {
                    items.push({
                        label: key,
                        click: () => openExampleTab(child.exampleId)
                    });
                }
            }
            return items;
        };

        return buildMenuFromNode(root);
    } catch (err) {
        console.warn('Failed to build Examples menu:', err?.message || err);
        return [];
    }
}

// Build a nested Widgets menu from enabled widget docs indexes.
function loadWidgetDocsEntries() {
    const entries = [];
    for (const source of extensionRuntime.bootstrap.widgetDocsRoots) {
        if (!source || !source.indexPath || !source.path) continue;
        if (!fs.existsSync(source.indexPath)) continue;
        try {
            const raw = fs.readFileSync(source.indexPath, 'utf8');
            const parsed = JSON.parse(raw);
            const widgets = Array.isArray(parsed?.widgets) ? parsed.widgets : [];
            for (const entry of widgets) {
                if (!entry || !entry.type || !entry.title || !entry.doc) continue;
                entries.push({
                    ...entry,
                    extensionId: source.extensionId,
                    docPath: path.join(source.path, entry.doc),
                });
            }
        } catch (err) {
            console.warn('Failed to read widget docs index:', source.indexPath, err?.message || err);
        }
    }
    return entries;
}

function buildWidgetDocsMenuItems() {
    try {
        const entries = loadWidgetDocsEntries().filter((entry) => {
            if (!entry) return false;
            if (!entry.type || !entry.title) return false;
            if (entry.compatibilityOnly) return false;
            return true;
        });
        if (!entries.length) return [];

        const grouped = new Map();
        for (const entry of entries) {
            const category = entry.category || 'Other';
            if (!grouped.has(category)) grouped.set(category, []);
            grouped.get(category).push(entry);
        }

        const categories = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
        return categories.map((category) => {
            const widgets = grouped.get(category).slice().sort((a, b) => a.title.localeCompare(b.title));
            return {
                label: category,
                submenu: widgets.map((widget) => ({
                    label: widget.title,
                    click: () => openWidgetDocTab(widget.type)
                }))
            };
        });
    } catch (err) {
        console.warn('Failed to build Widgets menu:', err?.message || err);
        return [];
    }
}

// Renderer-facing docs helpers (used by tabs / example viewer).
ipcMain.handle('docs-list-readmes', async (_event, { baseDir } = {}) => {
    if (!baseDir) return [];
    try {
        return collectReadmes(baseDir);
    } catch (err) {
        console.warn('docs-list-readmes failed:', err?.message || err);
        return [];
    }
});

ipcMain.handle('docs-read-markdown', async (_event, { docPath } = {}) => {
    if (!docPath) return '';
    return fs.promises.readFile(docPath, 'utf8');
});

ipcMain.handle('files-read-text', async (_event, { filePath } = {}) => {
    if (!filePath) return '';
    return fs.promises.readFile(filePath, 'utf8');
});

ipcMain.handle('files-list-dir', async (_event, { dirPath } = {}) => {
    if (!dirPath) return [];
    try {
        return await fs.promises.readdir(dirPath);
    } catch (err) {
        console.warn('files-list-dir failed:', err?.message || err);
        return [];
    }
});

ipcMain.handle('files-write-text', async (_event, { filePath, content } = {}) => {
    if (!filePath) return { ok: false, error: 'Missing filePath' };
    try {
        await fs.promises.writeFile(filePath, content ?? '', 'utf8');
        return { ok: true };
    } catch (err) {
        console.warn('files-write-text failed:', err?.message || err);
        return { ok: false, error: err?.message || String(err) };
    }
});

ipcMain.handle('open-external-url', async (_event, { url } = {}) => {
    if (!url || !/^https?:\/\//i.test(String(url))) {
        return { ok: false, error: 'Invalid external URL' };
    }
    try {
        await shell.openExternal(String(url));
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err?.message || String(err) };
    }
});

// IPC for widget documentation tabs.
function openWidgetDocTab(type) {
    if (!type) return;
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('open-widget-doc-tab', { type });
    } else {
        pendingWidgetDocType = type;
    }
}

ipcMain.on('open-widget-doc-tab', (_event, { type } = {}) => {
    openWidgetDocTab(type);
});

ipcMain.handle('get-pending-widget-doc', () => pendingWidgetDocType);

ipcMain.on('widget-docs-ready', () => {
    if (!pendingWidgetDocType) return;
    const pending = pendingWidgetDocType;
    pendingWidgetDocType = null;
    openWidgetDocTab(pending);
});

ipcMain.handle('extensions-list', () => cloneExtensionInventory());

ipcMain.handle('extensions-is-enabled', (_event, { id } = {}) => {
    if (!id) return false;
    return extensionRuntime.isEnabled(String(id));
});

ipcMain.handle('extensions-get-bootstrap', () => cloneExtensionBootstrap());

function setAppMenu() {
    const examplesMenu = buildExamplesMenuItems();
    const widgetDocsMenu = buildWidgetDocsMenuItems();
    // Activity toggle state (off by default to reduce UI noise).
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Dashboard',
                    click: () => {
                        if (mainWindow && mainWindow.webContents) {
                            mainWindow.webContents.send('menu-new-dashboard');
                        }
                    }
                },
                {
                    label: 'Load Dashboard',
                    click: () => {
                        if (mainWindow && mainWindow.webContents) {
                            mainWindow.webContents.send('menu-load-dashboard');
                        }
                    }
                },
                {
                    label: 'Save Dashboard',
                    click: () => {
                        if (mainWindow && mainWindow.webContents) {
                            mainWindow.webContents.send('menu-save-dashboard');
                        }
                    }
                },
                { type: 'separator' },
                { role: process.platform === 'darwin' ? 'close' : 'quit' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                {
                    label: 'Toggle Activity',
                    type: 'checkbox',
                    checked: activityEnabled,
                    click: (item) => {
                        activityEnabled = !!item.checked;
                        if (mainWindow && mainWindow.webContents) {
                            mainWindow.webContents.send('activity-toggle', { enabled: activityEnabled });
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Widget Categories',
                    click: () => {
                        if (mainWindow && mainWindow.webContents) {
                            mainWindow.webContents.send('show-widget-categories');
                        }
                    }
                }
            ]
        },
        // Examples menu opens standalone example documentation and actions.
        {
            label: 'Examples',
            submenu: examplesMenu.length ? examplesMenu : [{ label: 'No examples found', enabled: false }]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Widgets',
                    submenu: widgetDocsMenu.length ? widgetDocsMenu : [{ label: 'No widget docs found', enabled: false }]
                }
            ]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    // Sync activity toggle state to the renderer on menu build.
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('activity-toggle', { enabled: activityEnabled });
    }
}

// Activity toggle (default off to reduce UI noise).
let activityEnabled = false;

// Emit UI activity events to renderer (used for toasts/indicators)
function emitActivity(evt) {
    try {
        // Respect the activity toggle to avoid spamming the renderer.
        if (activityEnabled && mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('activity', { ts: Date.now(), scope: 'can', ...evt });
        }
    } catch {}
}

// Allow renderer to query the current activity toggle state.
ipcMain.handle('get-activity-enabled', () => ({ enabled: !!activityEnabled }));
ipcMain.handle('diagnostics-capture-snapshot', async () => captureDiagnosticsSnapshot());

// Path to mcumgr binary, assumes it is bundled alongside the app in a tools folder
const mcumgrBinary = process.platform === 'win32' ? 'mcumgr.exe'
    : process.platform === 'darwin' ? 'mcumgr-mac' : 'mcumgr';
const mcumgrPath = path.join(__dirname, 'tools', mcumgrBinary);
let activeFlashId = 0;
let activeFlashSender = null;
let activeFlashPort = null;
let activeFlashCanceled = false;

function resolveMcumgrPath(userPath) {
    if (userPath && typeof userPath === 'string') return userPath;
    if (process.env.MCUMGR_PATH) return process.env.MCUMGR_PATH;
    if (fs.existsSync(mcumgrPath)) return mcumgrPath;
    // Fallback to PATH on Linux when bundled binary is missing.
    return 'mcumgr';
}

const activeRecordings = new Map(); // Active CSV recordings mapped by port path
const openPorts = new Map(); // key: path, value: SerialPort instance
// Track ports that should not be opened (e.g., during flashing).
const serialLocks = new Map(); // key: path, value: { reason, until }
// Persist last-known serial settings per port so we can auto-reopen later.
const portSettings = new Map(); // key: path, value: { baudRate, separator, eol, type }
// Track pending auto-reopen timers and intent per port.
const pendingReopens = new Map(); // key: path, value: { timer: Timeout|null, settings }
const terminalBuffers = new Map(); // key: path, value: array of raw lines
const serialBuffers = new Map(); // key: path, value: array of parsed data arrays
const parserSettings = new Map(); // key: path, value: { separator, eol }
// header and color buffers keyed by "path||type" to support multiple
// datasources on the same serial port
const headerBuffers = new Map();
const colorBuffers = new Map();
const fastStates = new Map(); // key: path, value: state for fast frame parsing
const fastBuffers = new Map(); // key: path, value: last parsed fast dataset
const fastStatus = new Map(); // key: path, value: acquisition status metadata
const fastAcquisitionSeq = new Map(); // key: path, value: monotonically increasing acquisition id
const FAST_IDLE = 0;
const FAST_RECORD = 1;
const MAX_BUFFER_SIZE = 1000;
const MAX_TERMINAL_LINES = 200;

function dsKey(path, type = 'serialport_datasource') {
    return `${path}||${type}`;
}

function summarizeArrayMap(map) {
    let entries = 0;
    let totalItems = 0;
    let maxItems = 0;
    for (const value of map.values()) {
        entries += 1;
        const length = Array.isArray(value) ? value.length : 0;
        totalItems += length;
        if (length > maxItems) maxItems = length;
    }
    return { entries, totalItems, maxItems };
}

function summarizeFastBuffers(map) {
    let entries = 0;
    let totalPoints = 0;
    let maxPoints = 0;
    for (const value of map.values()) {
        entries += 1;
        const points = Array.isArray(value?.timestamps) ? value.timestamps.length : 0;
        totalPoints += points;
        if (points > maxPoints) maxPoints = points;
    }
    return { entries, totalPoints, maxPoints };
}

function summarizeMapEntries(map) {
    return { entries: map.size };
}

async function captureDiagnosticsSnapshot() {
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    const resource = typeof process.resourceUsage === 'function' ? process.resourceUsage() : null;
    const appMetrics = typeof app.getAppMetrics === 'function'
        ? app.getAppMetrics().map((metric) => ({
            pid: metric.pid,
            type: metric.type,
            serviceName: metric.serviceName,
            name: metric.name,
            creationTime: metric.creationTime,
            cpu: metric.cpu ? {
                percentCPUUsage: metric.cpu.percentCPUUsage,
                idleWakeupsPerSecond: metric.cpu.idleWakeupsPerSecond
            } : null,
            memory: metric.memory ? {
                workingSetSize: metric.memory.workingSetSize,
                peakWorkingSetSize: metric.memory.peakWorkingSetSize,
                privateBytes: metric.memory.privateBytes,
                sharedBytes: metric.memory.sharedBytes
            } : null
        }))
        : [];

    let rendererProcessMemory = null;
    try {
        if (mainWindow?.webContents?.getProcessMemoryInfo) {
            rendererProcessMemory = await mainWindow.webContents.getProcessMemoryInfo();
        }
    } catch (err) {
        rendererProcessMemory = { error: err?.message || String(err) };
    }

    return {
        timestamp: Date.now(),
        process: {
            pid: process.pid,
            uptimeSec: process.uptime(),
            platform: process.platform,
            versions: {
                electron: process.versions.electron,
                chrome: process.versions.chrome,
                node: process.versions.node
            },
            memory,
            cpu,
            resource
        },
        renderer: {
            webContentsId: mainWindow?.webContents?.id ?? null,
            url: mainWindow?.webContents?.getURL?.() ?? null,
            processMemory: rendererProcessMemory
        },
        windows: {
            main: mainWindow ? {
                visible: mainWindow.isVisible(),
                focused: mainWindow.isFocused(),
                bounds: mainWindow.getBounds()
            } : null,
            example: exampleWindow ? {
                visible: exampleWindow.isVisible(),
                focused: exampleWindow.isFocused(),
                bounds: exampleWindow.getBounds()
            } : null
        },
        state: {
            openPorts: openPorts.size,
            activeRecordings: activeRecordings.size,
            serialLocks: serialLocks.size,
            portSettings: portSettings.size,
            pendingReopens: pendingReopens.size,
            serialBuffers: summarizeArrayMap(serialBuffers),
            terminalBuffers: summarizeArrayMap(terminalBuffers),
            headerBuffers: summarizeMapEntries(headerBuffers),
            colorBuffers: summarizeMapEntries(colorBuffers),
            fastStates: summarizeMapEntries(fastStates),
            fastBuffers: summarizeFastBuffers(fastBuffers),
            fastStatus: summarizeMapEntries(fastStatus)
        },
        appMetrics
    };
}

function decodeEolToken(token) {
    if (!token || typeof token !== 'string') return '\n';
    let out = token;
    out = out.replace(/\\r/g, '\r');
    out = out.replace(/\\n/g, '\n');
    out = out.replace(/\\t/g, '\t');
    return out;
}

function lockSerialPort(path, reason = 'locked', ttlMs = 30000) {
    if (!path) return;
    const until = ttlMs ? Date.now() + ttlMs : null;
    serialLocks.set(path, { reason, until });
}

function unlockSerialPort(path) {
    if (!path) return;
    serialLocks.delete(path);
}

function isSerialLocked(path) {
    const lock = serialLocks.get(path);
    if (!lock) return false;
    if (lock.until && Date.now() > lock.until) {
        serialLocks.delete(path);
        return false;
    }
    return true;
}

function addToBuffer(portPath, parsedData) {
        if (!Array.isArray(parsedData)) return;
        let buf = serialBuffers.get(portPath);
        if (!buf) {
                buf = [];
                serialBuffers.set(portPath, buf);
        }
        buf.push(parsedData);
        if (buf.length > MAX_BUFFER_SIZE) {
                buf.shift();
        }
}

function parseLine(line, separator = ':') {
	const clean = line.trim();
	const rawItems = clean.split(separator).filter(s => s.trim() !== "");
	const values = rawItems.map(v => parseFloat(v)).filter(n => !isNaN(n));
	return values;
}

function parseLineCustom(line, sep) {
        const clean = line.trim();
        return clean.split(sep).map(s => s.trim()).filter(s => s !== "");
}

function setFastStatus(path, partial = {}) {
    const prev = fastStatus.get(path) || {
        state: 'idle',
        message: '',
        updatedAt: Date.now(),
        completedAt: null,
        datasetPoints: 0,
        acquisitionId: 0
    };
    const next = {
        ...prev,
        ...partial,
        updatedAt: Date.now()
    };
    fastStatus.set(path, next);
    return next;
}

function handleFastLine(portPath, line) {
    let st = fastStates.get(portPath);
    if (!st) {
        st = { state: FAST_IDLE, header: null, idx: null, data: [] };
        fastStates.set(portPath, st);
    }

    if (line.includes('begin record')) {
        st.state = FAST_RECORD;
        st.header = null;
        st.idx = null;
        st.data = [];
        setFastStatus(portPath, {
            state: 'recording',
            message: 'Receiving fast frame',
            completedAt: null,
            datasetPoints: 0
        });
        return;
    }

    if (line.includes('end record')) {
        st.state = FAST_IDLE;
        const dataset = buildFastDataset(st);
        if (dataset) {
            const acquisitionId = fastAcquisitionSeq.get(portPath) || 0;
            dataset.acquisitionId = acquisitionId;
            dataset.capturedAt = Date.now();
            fastBuffers.set(portPath, dataset);
            setFastStatus(portPath, {
                state: 'complete',
                message: 'Fast frame ready',
                completedAt: dataset.capturedAt,
                datasetPoints: Array.isArray(dataset.timestamps) ? dataset.timestamps.length : 0,
                acquisitionId
            });
        } else {
            setFastStatus(portPath, {
                state: 'error',
                message: 'Fast frame ended without valid dataset',
                completedAt: null,
                datasetPoints: 0
            });
        }
        st.header = null;
        st.idx = null;
        st.data = [];
        return;
    }

    if (st.state === FAST_RECORD) {
        if (line.startsWith('#')) {
            if (!st.header) {
                st.header = line.substring(1).trim();
                const hdrs = st.header.split(',').map(h => h.trim()).filter(Boolean);
                headerBuffers.set(dsKey(portPath, 'fast_frame_datasource'), hdrs);
            } else if (st.idx === null) {
                const num = parseInt(line.substring(1).trim());
                st.idx = isNaN(num) ? null : num;
            }
        } else if (line.trim()) {
            st.data.push(line.trim());
        }
    }
}

function buildFastDataset(st) {
    if (!st.header || !st.data.length) return null;
    let names = st.header.split(',').map(n => n.trim());
    if (names[names.length - 1] === '') names.pop();

    const floats = [];
    for (const hex of st.data) {
        try {
            const buf = Buffer.from(hex, 'hex');
            if (buf.length >= 4) floats.push(buf.readFloatBE(0));
        } catch { /* ignore */ }
    }

    const chunk = names.length;
    const rows = [];
    for (let i = 0; i < floats.length; i += chunk) {
        rows.push(floats.slice(i, i + chunk));
    }
    if (!rows.length) return null;

    if (st.idx !== null && st.idx >= 0 && st.idx < rows.length) {
        const shift = (st.idx + 1) % rows.length;
        if (shift) {
            for (let i = 0; i < shift; i++) {
                rows.push(rows.shift());
            }
        }
    }

    const timestamps = rows.map((_, i) => i);
    const series = names.map((_, ci) => rows.map(r => r[ci]));

    return { timestamps, series };
}

function createWindow() {
        mainWindow = new BrowserWindow({
                width: 1280,
                height: 800,
                icon: path.join(__dirname, 'assets', 'icon.png'),
                webPreferences: {
                        preload: path.join(__dirname, 'preload.js'),
                        sandbox: false,
                        nodeIntegration: false,
                        contextIsolation: true
                }
        });
        // Only open DevTools in development.
        if (!app.isPackaged) {
            mainWindow.webContents.openDevTools({ mode: 'detach' });
            mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
                console.error('[main] did-fail-load', code, desc, url);
            });
        }
        setAppMenu();
        mainWindow.loadFile(path.join(__dirname, 'dashboard/index.html'));
        mainWindow.on('closed', () => {
                mainWindow = null;
        });
}

// Route examples to the in-app tab strip when available.
function openExampleTab(exampleId) {
    pendingExampleTabId = exampleId;
    if (mainWindow && mainWindow.webContents) {
        try {
            clearTimeout(exampleTabRequestTimer);
            exampleTabRequestTimer = setTimeout(() => {
                mainWindow.webContents.send('open-example-tab', { id: exampleId });
            }, 0);
            return;
        } catch {
            // Fall back to a dedicated window if the tab IPC fails.
        }
    }
    openExampleWindow(exampleId);
}

// Allow renderer to fetch any pending example tab request.
ipcMain.handle('get-pending-example-tab', () => {
    const id = pendingExampleTabId;
    pendingExampleTabId = null;
    return id;
});

// Standalone examples window for offline markdown docs and example actions.
function openExampleWindow(exampleId) {
    if (exampleWindow) {
        exampleWindow.focus();
        exampleWindow.webContents.send('example-select', { id: exampleId });
        return;
    }
    exampleWindowActiveId = exampleId || null;
    exampleWindow = new BrowserWindow({
        width: 1100,
        height: 800,
        title: 'Modular Examples',
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            sandbox: false,
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    exampleWindow.loadFile(path.join(__dirname, 'dashboard', 'examples', 'example_viewer.html'), {
        query: { id: exampleId || '' }
    });
    // Watch for window moves to show a dock preview and pop the tab back in on release.
    const updateDockPreview = () => {
        if (!exampleWindow || !mainWindow || !mainWindow.webContents) return;
        const eb = exampleWindow.getBounds();
        const mb = mainWindow.getBounds();
        const overlapX = Math.max(0, Math.min(eb.x + eb.width, mb.x + mb.width) - Math.max(eb.x, mb.x));
        const overlapY = Math.max(0, Math.min(eb.y + eb.height, mb.y + mb.height) - Math.max(eb.y, mb.y));
        const overlapArea = overlapX * overlapY;
        const exampleArea = eb.width * eb.height || 1;
        const overlapRatio = overlapArea / exampleArea;
        const shouldPreview = overlapRatio >= 0.2 && Boolean(exampleWindowActiveId);
        if (shouldPreview !== exampleDockPreviewActive || exampleDockLastOverlap !== shouldPreview) {
            exampleDockPreviewActive = shouldPreview;
            exampleDockLastOverlap = shouldPreview;
            mainWindow.webContents.send('example-dock-preview', {
                id: exampleWindowActiveId,
                active: shouldPreview
            });
        }
    };
    const tryDockOnRelease = () => {
        clearTimeout(exampleDockMoveTimer);
        exampleDockMoveTimer = setTimeout(() => {
            if (!exampleWindow || !mainWindow) return;
            if (!exampleDockLastOverlap || !exampleWindowActiveId) return;
            if (exampleDockingInProgress) return;
            exampleDockingInProgress = true;
            try {
                if (mainWindow && mainWindow.webContents) {
                    mainWindow.webContents.send('example-dock-preview', {
                        id: exampleWindowActiveId,
                        active: false
                    });
                    mainWindow.webContents.send('open-example-tab', { id: exampleWindowActiveId });
                }
                if (exampleWindow) exampleWindow.close();
            } finally {
                exampleDockingInProgress = false;
            }
        }, 180);
    };
    exampleWindow.on('move', () => {
        updateDockPreview();
        tryDockOnRelease();
    });
    exampleWindow.on('closed', () => {
        exampleWindowActiveId = null;
        exampleDockPreviewActive = false;
        exampleDockLastOverlap = false;
        clearTimeout(exampleDockMoveTimer);
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('example-dock-preview', { id: null, active: false });
        }
        exampleWindow = null;
    });
}

// Allow renderer tabs to be popped out into a dedicated examples window.
ipcMain.on('undock-doc-tab', (_event, { id } = {}) => {
    if (id) openExampleWindow(id);
});
// Keep main process updated with the example window's active selection for docking.
ipcMain.on('example-active-id', (_event, { id } = {}) => {
    exampleWindowActiveId = id || null;
    if (exampleDockPreviewActive && mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('example-dock-preview', {
            id: exampleWindowActiveId,
            active: !!exampleWindowActiveId
        });
    }
});

// Load a dashboard JSON from a path into the main window Freeboard instance.
ipcMain.handle('load-dashboard-from-path', async (_event, { dashboardPath } = {}) => {
    if (!mainWindow || !dashboardPath) return { ok: false, error: 'Missing dashboard path or main window.' };
    try {
        mainWindow.webContents.send('load-dashboard-from-path', { dashboardPath });
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err?.message || String(err) };
    }
});

app.whenReady().then(createWindow);

// 🔌 List serial ports
ipcMain.handle('get-serial-ports', async () => {
	const ports = await SerialPort.list();
	return ports.map(port => {
		// Keep labels simple; expose OwnTech detection for UI hints.
		const vid = String(port.vendorId || '').toLowerCase();
		const pid = String(port.productId || '').toLowerCase();
		const isOwntech = vid === '2fe3' && pid === '0100';
		return {
			name: port.path,
			value: port.path,
			isOwntech
		};
	});
});

function orderSerialCandidates(list) {
    const preferred = [];
    const others = [];
    const preferRe = /(ttyACM|ttyUSB|usbserial|usbmodem|cu\.usb|COM\d+)/i;
    for (const entry of list) {
        const pathStr = String(entry || '');
        if (!pathStr) continue;
        if (preferRe.test(pathStr)) preferred.push(pathStr);
        else others.push(pathStr);
    }
    return preferred.concat(others);
}

async function collectSerialCandidates(explicitPort = null) {
    if (explicitPort) return [explicitPort];
    try {
        const ports = await SerialPort.list();
        if (!ports || !ports.length) return [];
        const paths = ports.map((p) => p?.path).filter(Boolean);
        return orderSerialCandidates(paths);
    } catch (err) {
        console.warn('Failed to enumerate serial ports for ThingSet detect:', err?.message || err);
        return [];
    }
}

ipcMain.handle('ts-serial-detect', async (_event, { port = null, baudRate = 115200, usePrefix = false, verbose = false } = {}) => {
    if (!enableThingset) return { ok: false, error: 'ThingSet disabled' };
    const candidates = await collectSerialCandidates(port);
    if (!candidates.length) {
        throw new Error('No serial ports found to probe for ThingSet shell');
    }
    const attempts = [];
    const isVerbose = Boolean(verbose) || process.env.TS_SERIAL_DEBUG === '1';
    for (const candidate of candidates) {
        let shell = null;
        try {
            const existingPort = openPorts.get(candidate) || null;
            shell = new ThingSetSerialShell({ path: candidate, baudRate, usePrefix, verbose: isVerbose, existingPort });
            await shell.open();
            await shell.enterThingSet();
            if (!shell.probeSucceeded()) throw new Error('ThingSet prompt not detected');
            const nodeUid = await shell.readNodeUid().catch(() => null);
            const nodeName = await shell.readNodeName().catch(() => null);
            const nodeAddr = await shell.readNodeAddr().catch(() => null);
            const addressHex = Number.isInteger(nodeAddr) ? `0x${nodeAddr.toString(16).toUpperCase().padStart(2, '0')}` : null;
            emitActivity({ id: `serial:${candidate}:detect`, title: candidate, state: 'done', label: 'ThingSet serial detect', detail: nodeUid || addressHex || 'ok' });
            return {
                port: candidate,
                baudRate,
                node_uid: nodeUid,
                node_name: nodeName,
                node_addr: nodeAddr,
                address_hex: addressHex,
                command_prefix: shell.getCommandPrefix(),
            };
        } catch (err) {
            attempts.push({ port: candidate, error: err?.message || String(err) });
            emitActivity({ id: `serial:${candidate}:detect`, title: candidate, state: 'error', label: 'ThingSet serial detect', detail: err?.message || String(err) });
        } finally {
            if (shell) {
                try { await shell.close(); } catch {}
            }
        }
    }
    const detail = attempts.map((t) => `${t.port}: ${t.error}`).join('; ');
    throw new Error(detail || 'ThingSet serial shell not found');
});

// 🚌 List CAN interfaces (Linux heuristic)
ipcMain.handle('get-can-interfaces', async () => {
    try {
        const base = '/sys/class/net';
        const entries = await fs.promises.readdir(base, { withFileTypes: true });
        const names = [];
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            const n = e.name;
            if (!/^v?sl?can\d+/i.test(n) && !/^can\d+/i.test(n)) continue;
            // Be permissive: include likely CAN interface names
            names.push(n);
        }
        // Fallback: try os.networkInterfaces heuristic
        if (names.length === 0) {
            const ifs = Object.keys(require('os').networkInterfaces());
            names.push(...ifs.filter(n => /^v?sl?can\d+/i.test(n) || /^can\d+/i.test(n)));
        }
        // Ensure at least a sensible default
        if (names.length === 0) names.push('can0');
        return names.map(n => ({ name: n, value: n }));
    } catch (e) {
        // On error, still provide a default
        return [{ name: 'can0', value: 'can0' }];
    }
});

// 📖 Read discovered ThingSet nodes from thingset/nodes.json
ipcMain.handle('get-thingset-nodes', async () => {
    if (!enableThingset) return [];
    emitActivity({ id: 'can:nodes:list', title: 'ThingSet', state: 'start', label: 'Load discovered nodes' });
    try {
        const file = path.join(process.cwd(), 'thingset', 'nodes.json');
        const text = await fs.promises.readFile(file, 'utf8');
        const obj = JSON.parse(text || '{}');
        const out = [];
        for (const [k, v] of Object.entries(obj)) {
            const addr = parseInt(k, 10);
            const hex = '0x' + addr.toString(16).toUpperCase().padStart(2, '0');
            const label = typeof v !== 'undefined' ? `${hex} (${v})` : hex;
            out.push({ name: label, value: addr });
        }
        // Sort by address
        out.sort((a, b) => a.value - b.value);
        emitActivity({ id: 'can:nodes:list', title: 'ThingSet', state: 'done', label: 'Load discovered nodes', detail: `${out.length} nodes` });
        return out;
    } catch {
        emitActivity({ id: 'can:nodes:list', title: 'ThingSet', state: 'error', label: 'Load discovered nodes', detail: 'not found' });
        return [];
    }
});

// 🚪 Open serial port with tracking and buffer setup
async function openSerialPortInternal({ path, baudRate, separator, eol, type = 'serialport_datasource' }) {
        if (!path) {
                throw new Error('Serial port path is required');
        }
        emitActivity({ id: 'serial:open', title: path, state: 'start', label: 'Open serial port' });
        const decodedEol = decodeEolToken(eol);
        parserSettings.set(path, {
                separator: separator || ":",
                eol: decodedEol
        });
        if (isSerialLocked(path)) {
                const lock = serialLocks.get(path);
                const reason = lock && lock.reason ? lock.reason : 'locked';
                console.warn(`Port ${path} is locked (${reason}).`);
                emitActivity({ id: 'serial:open', title: path, state: 'error', label: 'Open serial port', detail: `locked (${reason})` });
                return;
        }
        if (openPorts.has(path)) {
                console.warn(`Port ${path} is already open.`);
                // ensure buffers for this datasource type exist
                const key = dsKey(path, type);
                if (!headerBuffers.has(key)) headerBuffers.set(key, []);
                if (!colorBuffers.has(key)) colorBuffers.set(key, []);
                if (type === 'fast_frame_datasource' && !fastStatus.has(path)) {
                        setFastStatus(path, { state: 'idle', message: 'Fast frame port ready', completedAt: null, datasetPoints: 0 });
                }
                emitActivity({ id: 'serial:open', title: path, state: 'done', label: 'Serial already open' });
                return;
        }

        // Persist settings so a later auto-reopen uses the same config.
        portSettings.set(path, {
            baudRate: parseInt(baudRate),
            separator: separator || ":",
            eol: decodedEol,
            type
        });

	const port = new SerialPort({
		path,
		baudRate: parseInt(baudRate),
		autoOpen: false
	});

        port.open(err => {
                if (err) {
                        console.error("Serial open error:", err.message);
                        emitActivity({ id: 'serial:open', title: path, state: 'error', label: 'Open serial port', detail: err.message });
                        return;
                }
                console.log("✅ Serial port opened:", path);
                emitActivity({ id: 'serial:open', title: path, state: 'done', label: 'Serial opened' });
        });

	let rawBuffer = "";

        terminalBuffers.set(path, []);
        serialBuffers.set(path, []);
        headerBuffers.set(dsKey(path, type), []);
        colorBuffers.set(dsKey(path, type), []);
        fastStates.set(path, { state: FAST_IDLE, header: null, idx: null, data: [] });
        fastBuffers.delete(path);
        if (type === 'fast_frame_datasource') {
                setFastStatus(path, { state: 'idle', message: 'Fast frame port ready', completedAt: null, datasetPoints: 0 });
        }

        port.on("data", chunk => {
                        const parser = parserSettings.get(path) || { separator: ':', eol: '\n' };
                        rawBuffer += chunk.toString();
                        const lines = rawBuffer.split(parser.eol);
                        rawBuffer = lines.pop(); // keep the last (possibly incomplete) line
                        const termBuf = terminalBuffers.get(path) || [];
                        for (const line of lines) {
                                        const parsed = parseLine(line, parser.separator);
                                        if (parsed.length) addToBuffer(path, parsed);
                                        handleFastLine(path, line);
                                        termBuf.push(line);
                                        if (termBuf.length > MAX_TERMINAL_LINES) termBuf.shift();
                        }
                        terminalBuffers.set(path, termBuf);
        });

	port.on("error", err => {
		console.error("Serial port error:", err.message);
	});

        port.on("close", () => {
                        console.log(`🔌 Serial port ${path} closed.`);
                        openPorts.delete(path);
                        terminalBuffers.delete(path);
                        serialBuffers.delete(path);
                        for (const key of [...headerBuffers.keys()]) {
                            if (key.startsWith(`${path}||`)) headerBuffers.delete(key);
                        }
                        for (const key of [...colorBuffers.keys()]) {
                            if (key.startsWith(`${path}||`)) colorBuffers.delete(key);
                        }
                        fastStates.delete(path);
                        fastBuffers.delete(path);
                        fastStatus.delete(path);
                        parserSettings.delete(path);
                        emitActivity({ id: 'serial:close', title: path, state: 'done', label: 'Serial closed' });
        });

	openPorts.set(path, port);
}

ipcMain.handle("open-serial-port", async (_event, payload) => {
        return openSerialPortInternal(payload || {});
});

// 📥 Renderer pulls latest parsed data
ipcMain.handle("get-serial-buffer", (event, { path }) => {
        const buf = serialBuffers.get(path) || [];
        return buf.length > 0 ? buf[buf.length - 1] : [];
});

ipcMain.handle('get-fast-dataset', (event, { path }) => {
    return fastBuffers.get(path) || null;
});

ipcMain.handle('get-fast-frame-status', (_event, { path }) => {
    return fastStatus.get(path) || {
        state: 'idle',
        message: 'No acquisition yet',
        updatedAt: Date.now(),
        completedAt: null,
        datasetPoints: 0,
        acquisitionId: 0
    };
});

// 📄 Get terminal lines for a port
ipcMain.handle("get-terminal-buffer", (event, { path }) => {
        return terminalBuffers.get(path) || [];
});

// 🏷️ Get/set headers for a port
ipcMain.handle('get-serial-headers', (_event, { path, type = 'serialport_datasource' }) => {
    return headerBuffers.get(dsKey(path, type)) || [];
});

ipcMain.handle('set-serial-headers', (_event, { path, headers, type = 'serialport_datasource' }) => {
    if (!Array.isArray(headers)) headers = [];
    headerBuffers.set(dsKey(path, type), headers);
    return 'ok';
});

// 🎨 Get/set colors for a port
ipcMain.handle('get-serial-colors', (_event, { path, type = 'serialport_datasource' }) => {
    return colorBuffers.get(dsKey(path, type)) || [];
});

ipcMain.handle('set-serial-colors', (_event, { path, colors, type = 'serialport_datasource' }) => {
    if (!Array.isArray(colors)) colors = [];
    colorBuffers.set(dsKey(path, type), colors);
    return 'ok';
});

ipcMain.handle('ts-serial-tree', async (_event, { port, baudRate = 115200, usePrefix = false, verbose = false } = {}) => {
    if (!enableThingset) return { ok: false, error: 'ThingSet disabled' };
    if (!port) throw new Error('port required');
    emitActivity({ id: `serial:${port}:tree`, title: port, state: 'start', label: 'ThingSet serial tree' });
    const existingPort = openPorts.get(port) || null;
    const isVerbose = Boolean(verbose) || process.env.TS_SERIAL_DEBUG === '1';
    const shell = new ThingSetSerialShell({ path: port, baudRate, usePrefix, verbose: isVerbose, existingPort });
    try {
        await shell.open();
        await shell.enterThingSet();
        const root = await shell.buildTree();
        const nodeUid = await shell.readNodeUid();
        const nodeName = await shell.readNodeName();
        const nodeAddr = await shell.readNodeAddr();
        const addressHex = Number.isInteger(nodeAddr) ? `0x${nodeAddr.toString(16).toUpperCase().padStart(2, '0')}` : null;
        let savedTreePath = null;
        if (Number.isInteger(nodeAddr) && root) {
            try {
                const dir = ensureThingsetDir();
                const hex = nodeAddr.toString(16).toUpperCase().padStart(2, '0');
                const payload = {
                    node_uid: nodeUid || null,
                    address: `0x${hex}`,
                    root,
                };
                if (nodeName) payload.node_name = nodeName;
                const treePath = path.join(dir, `node_${hex}_tree.json`);
                await fs.promises.writeFile(treePath, JSON.stringify(payload, null, 2), 'utf8');
                savedTreePath = treePath;

                if (nodeUid) {
                    const mappingPath = path.join(dir, 'nodes.json');
                    let mapping = {};
                    try {
                        const txt = await fs.promises.readFile(mappingPath, 'utf8');
                        mapping = JSON.parse(txt) || {};
                    } catch {}
                    mapping[String(nodeAddr)] = nodeUid;
                    const ordered = Object.keys(mapping)
                        .filter((k) => Number.isFinite(Number(k)))
                        .sort((a, b) => Number(a) - Number(b))
                        .reduce((acc, key) => { acc[key] = mapping[key]; return acc; }, {});
                    for (const [key, value] of Object.entries(mapping)) {
                        if (!Number.isFinite(Number(key))) ordered[key] = value;
                    }
                    await fs.promises.writeFile(mappingPath, JSON.stringify(ordered, null, 2), 'utf8');
                }
            } catch (persistErr) {
                console.warn('Failed to persist ThingSet serial tree:', persistErr?.message || persistErr);
            }
        }
        emitActivity({ id: `serial:${port}:tree`, title: port, state: 'done', label: 'ThingSet serial tree', detail: addressHex || 'n/a' });
        return {
            node_uid: nodeUid,
            node_name: nodeName,
            address_hex: addressHex,
            node_addr: nodeAddr,
            root,
            saved_tree_path: savedTreePath,
        };
    } catch (err) {
        emitActivity({ id: `serial:${port}:tree`, title: port, state: 'error', label: 'ThingSet serial tree', detail: err?.message || String(err) });
        throw err;
    } finally {
        try { await shell.close(); } catch {}
    }
});

function coerceOutputValue(raw) {
    if (raw === null || raw === undefined) return raw;
    if (typeof raw === 'string') {
        const txt = raw.trim();
        if (!txt) return '';
        if (/^(true|false|null)$/i.test(txt)) {
            try { return JSON.parse(txt.toLowerCase()); } catch { return txt; }
        }
        if ((txt.startsWith('{') && txt.endsWith('}')) || (txt.startsWith('[') && txt.endsWith(']')) || (txt.startsWith('"') && txt.endsWith('"'))) {
            try { return JSON.parse(txt); } catch { return txt; }
        }
        if (/^0x[0-9a-f]+$/i.test(txt)) {
            try { return Number.parseInt(txt, 16); } catch { return txt; }
        }
        const num = Number(txt);
        if (!Number.isNaN(num)) return num;
        return txt;
    }
    return raw;
}

ipcMain.handle('ts-serial-set-value', async (_event, { port, path: targetPath, value, baudRate = 115200, usePrefix = false, verbose = false } = {}) => {
    if (!enableThingset) return { ok: false, error: 'ThingSet disabled' };
    if (!port) throw new Error('port required');
    if (!targetPath) throw new Error('path required');
    const existingPort = openPorts.get(port) || null;
    const isVerbose = Boolean(verbose) || process.env.TS_SERIAL_DEBUG === '1';
    const shell = new ThingSetSerialShell({ path: port, baudRate, usePrefix, verbose: isVerbose, existingPort });
    try {
        await shell.open();
        await shell.enterThingSet();
        const coerced = coerceOutputValue(value);
        const resp = await shell.setValue(targetPath, coerced);
        let readBack = null;
        try {
            const read = await shell.getValue(targetPath);
            if (read.ok) readBack = read.value;
        } catch {}
        return { ok: resp.ok, raw: resp.raw, readBack };
    } finally {
        try { await shell.close(); } catch {}
    }
});

ipcMain.handle('ts-serial-get-value', async (_event, { port, path: targetPath, baudRate = 115200, usePrefix = false, verbose = false } = {}) => {
    if (!enableThingset) return { ok: false, error: 'ThingSet disabled' };
    if (!port) throw new Error('port required');
    if (!targetPath) throw new Error('path required');
    const existingPort = openPorts.get(port) || null;
    const isVerbose = Boolean(verbose) || process.env.TS_SERIAL_DEBUG === '1';
    const shell = new ThingSetSerialShell({ path: port, baudRate, usePrefix, verbose: isVerbose, existingPort });
    try {
        await shell.open();
        await shell.enterThingSet();
        const resp = await shell.getValue(targetPath);
        return { ok: resp.ok, value: resp.value };
    } finally {
        try { await shell.close(); } catch {}
    }
});

ipcMain.handle('ts-serial-create', async (_event, { port, path: targetPath, value = undefined, baudRate = 115200, usePrefix = false, verbose = false } = {}) => {
    if (!enableThingset) return { ok: false, error: 'ThingSet disabled' };
    if (!port) throw new Error('port required');
    if (!targetPath) throw new Error('path required');
    const existingPort = openPorts.get(port) || null;
    const isVerbose = Boolean(verbose) || process.env.TS_SERIAL_DEBUG === '1';
    const shell = new ThingSetSerialShell({ path: port, baudRate, usePrefix, verbose: isVerbose, existingPort });
    try {
        await shell.open();
        await shell.enterThingSet();
        const resp = await shell.create(targetPath, value);
        return { status: resp.statusHex, ok: shell.isSuccessStatus(resp.statusHex), raw: resp.text, json: resp.json };
    } finally {
        try { await shell.close(); } catch {}
    }
});

ipcMain.handle('ts-serial-delete', async (_event, { port, path: targetPath, value = undefined, baudRate = 115200, usePrefix = false, verbose = false } = {}) => {
    if (!enableThingset) return { ok: false, error: 'ThingSet disabled' };
    if (!port) throw new Error('port required');
    if (!targetPath) throw new Error('path required');
    const existingPort = openPorts.get(port) || null;
    const isVerbose = Boolean(verbose) || process.env.TS_SERIAL_DEBUG === '1';
    const shell = new ThingSetSerialShell({ path: port, baudRate, usePrefix, verbose: isVerbose, existingPort });
    try {
        await shell.open();
        await shell.enterThingSet();
        const resp = await shell.deleteValue(targetPath, value);
        return { status: resp.statusHex, ok: shell.isSuccessStatus(resp.statusHex), raw: resp.text, json: resp.json };
    } finally {
        try { await shell.close(); } catch {}
    }
});

ipcMain.handle('ts-serial-exec', async (_event, { port, path: targetPath, args = undefined, baudRate = 115200, usePrefix = false, verbose = false } = {}) => {
    if (!enableThingset) return { ok: false, error: 'ThingSet disabled' };
    if (!port) throw new Error('port required');
    if (!targetPath) throw new Error('path required');
    const existingPort = openPorts.get(port) || null;
    const isVerbose = Boolean(verbose) || process.env.TS_SERIAL_DEBUG === '1';
    const shell = new ThingSetSerialShell({ path: port, baudRate, usePrefix, verbose: isVerbose, existingPort });
    try {
        await shell.open();
        await shell.enterThingSet();
        const resp = await shell.exec(targetPath, args);
        return { status: resp.statusHex, ok: shell.isSuccessStatus(resp.statusHex), raw: resp.text, json: resp.json };
    } finally {
        try { await shell.close(); } catch {}
    }
});

// ❌ Close port
ipcMain.handle("close-serial-port", async (event, { path }) => {
	emitActivity({ id: 'serial:close', title: path, state: 'start', label: 'Close serial port' });
	const port = openPorts.get(path);
	if (port && port.isOpen) {
			return new Promise((resolve, reject) => {
					port.close(err => {
							if (err) return reject(err.message);
                                                        openPorts.delete(path);
                                                        terminalBuffers.delete(path);
                                                        serialBuffers.delete(path);
                                                        for (const key of [...headerBuffers.keys()]) {
                                                            if (key.startsWith(`${path}||`)) headerBuffers.delete(key);
                                                        }
                                                        for (const key of [...colorBuffers.keys()]) {
                                                            if (key.startsWith(`${path}||`)) colorBuffers.delete(key);
                                                        }
                                                        fastStates.delete(path);
                                                        fastBuffers.delete(path);
                                                        emitActivity({ id: 'serial:close', title: path, state: 'done', label: 'Serial closed' });
                                                        resolve("closed");
                                        });
                        });
	} else {
			emitActivity({ id: 'serial:close', title: path, state: 'done', label: 'Serial already closed' });
			return "not open";
	}
});

// 🔁 Release a serial port temporarily and optionally auto-reopen after a delay.
ipcMain.handle("release-serial-port", async (_event, { path, reopen = true, reopenDelayMs = 0 } = {}) => {
        if (!path) throw new Error("path required");
        const port = openPorts.get(path);
        if (!port || !port.isOpen) {
                return { released: false, reason: "not-open" };
        }
        const settings = portSettings.get(path) || null;
        // Close now to free the COM port for external flash tools.
        await new Promise((resolve) => port.close(() => resolve()));
        // Clear any prior pending reopen.
        const pending = pendingReopens.get(path);
        if (pending && pending.timer) {
                clearTimeout(pending.timer);
        }
        pendingReopens.delete(path);
        if (reopen && settings) {
                if (reopenDelayMs > 0) {
                        const timer = setTimeout(() => {
                                // Fire-and-forget reopen using the last-known settings.
                                openSerialPortInternal({
                                        path,
                                        baudRate: settings.baudRate,
                                        separator: settings.separator,
                                        eol: settings.eol,
                                        type: settings.type
                                });
                        }, reopenDelayMs);
                        pendingReopens.set(path, { timer, settings });
                } else {
                        await openSerialPortInternal({
                                path,
                                baudRate: settings.baudRate,
                                separator: settings.separator,
                                eol: settings.eol,
                                type: settings.type
                        });
                }
        }
        return { released: true, reopenScheduled: Boolean(reopen && settings && reopenDelayMs > 0) };
});

// 🔁 Explicitly reopen a port that was previously released.
ipcMain.handle("reopen-serial-port", async (_event, { path } = {}) => {
        if (!path) throw new Error("path required");
        const settings = portSettings.get(path);
        if (!settings) return { reopened: false, reason: "no-settings" };
        const pending = pendingReopens.get(path);
        if (pending && pending.timer) clearTimeout(pending.timer);
        pendingReopens.delete(path);
        await openSerialPortInternal({
                path,
                baudRate: settings.baudRate,
                separator: settings.separator,
                eol: settings.eol,
                type: settings.type
        });
        return { reopened: true };
});

// ➡️ Write data to an open serial port
ipcMain.handle("write-serial-port", async (event, { path, data }) => {
        // Pick specified port or default to the first one
        const targetPort = path ? openPorts.get(path) : openPorts.values().next().value;
        if (targetPort && targetPort.isOpen) {
                if (path && fastStatus.has(path)) {
                        const nextAcquisitionId = (fastAcquisitionSeq.get(path) || 0) + 1;
                        fastAcquisitionSeq.set(path, nextAcquisitionId);
                        setFastStatus(path, {
                                state: 'awaiting_record',
                                message: 'Trigger sent, waiting for fast frame',
                                completedAt: null,
                                datasetPoints: 0,
                                acquisitionId: nextAcquisitionId
                        });
                }
                return new Promise((resolve, reject) => {
                        targetPort.write(data, err => {
                                if (err) return reject(err.message);
                                targetPort.drain(drainErr => {
                                        if (drainErr) return reject(drainErr.message);
                                        resolve("written");
                                });
                        });
                });
        } else {
                throw new Error("No open serial port");
        }
});

// 📂 Start CSV recording for a given port
ipcMain.handle('start-csv-record', async (event, { path, filePath, separator, eol, order = 'old', addHeader = true, timestampMode = 'none', type = 'serialport_datasource' }) => {
        emitActivity({ id: 'csv:record', title: path, state: 'start', label: 'Start CSV recording', detail: filePath });
        const port = openPorts.get(path);
        if (!port) {
                const err = 'port not open';
                emitActivity({ id: 'csv:record', title: path, state: 'error', label: 'Start CSV recording', detail: err });
                throw new Error(err);
        }
        if (activeRecordings.has(path)) {
                emitActivity({ id: 'csv:record', title: path, state: 'done', label: 'Already recording' });
                return 'already recording';
        }
        const sep = separator || ',';
        const eolStr = decodeEolToken(eol);
        const headers = headerBuffers.get(dsKey(path, type)) || [];
        const recording = {
                order,
                addHeader,
                timestampMode,
                lines: [],
                headerLine: null,
                stream: null,
                listener: null,
                startTime: Date.now(),
                headerWritten: false,
                filePath,
                sep,
                eolStr,
                headers
        };

        if (order === 'old') {
                recording.stream = fs.createWriteStream(filePath, { flags: 'a' });
        }

        let buffer = '';
        const listener = chunk => {
                buffer += chunk.toString();
                const lines = buffer.split(eolStr);
                buffer = lines.pop();
                for (const line of lines) {
                        const values = parseLineCustom(line, sep);
                        if (!values.length) continue;

                        if (addHeader && !recording.headerWritten) {
                                const header = [];
                                if (timestampMode !== 'none') {
                                        header.push(timestampMode === 'relative' ? 'time_ms' : 'timestamp');
                                }
                                for (let i = 0; i < values.length; i++) {
                                        const label = recording.headers[i] || `ch${i + 1}`;
                                        header.push(label);
                                }
                                const headerLine = header.join(',');
                                if (order === 'old') {
                                        recording.stream.write(headerLine + '\n');
                                } else {
                                        recording.headerLine = headerLine;
                                }
                                recording.headerWritten = true;
                        }

                        const row = [];
                        if (timestampMode === 'relative') {
                                row.push(String(Date.now() - recording.startTime));
                        } else if (timestampMode === 'absolute') {
                                row.push(new Date().toISOString());
                        }
                        row.push(...values);

                        const lineStr = row.join(',');
                        if (order === 'old') {
                                recording.stream.write(lineStr + '\n');
                        } else {
                                recording.lines.unshift(lineStr);
						}
                }
        };
		recording.listener = listener;
        port.on('data', listener);
        activeRecordings.set(path, recording);
        emitActivity({ id: 'csv:record', title: path, state: 'done', label: 'CSV recording started' });
        return 'started';
});

// 🛑 Stop CSV recording for a port
ipcMain.handle('stop-csv-record', async (event, { path }) => {
        emitActivity({ id: 'csv:record', title: path, state: 'start', label: 'Stop CSV recording' });
        const rec = activeRecordings.get(path);
        if (!rec) {
                emitActivity({ id: 'csv:record', title: path, state: 'done', label: 'Not recording' });
                return 'not recording';
        }
        const port = openPorts.get(path);
        if (port) port.off('data', rec.listener);

        if (rec.order === 'old') {
                await new Promise(res => rec.stream.end(res));
        } else {
                const outLines = [];
                if (rec.headerLine) outLines.push(rec.headerLine);
                outLines.push(...rec.lines);
                const content = outLines.join('\n') + '\n';
                await fs.promises.writeFile(rec.filePath, content);
        }
        activeRecordings.delete(path);
        emitActivity({ id: 'csv:record', title: path, state: 'done', label: 'CSV recording stopped' });
        return 'stopped';
});

// 💾 Save the latest fast frame dataset to CSV
ipcMain.handle('save-fast-csv', async (event, { path, filePath, separator, eol, addHeader = true, timestampMode = 'none', useTimestampedFileName = false }) => {
        emitActivity({ id: 'csv:save-fast', title: path, state: 'start', label: 'Save fast dataset', detail: filePath });
        const dataset = fastBuffers.get(path);
        if (!dataset || !Array.isArray(dataset.series)) {
                const err = 'no dataset';
                emitActivity({ id: 'csv:save-fast', title: path, state: 'error', label: 'Save fast dataset', detail: err });
                throw new Error(err);
        }
        const resolvedFilePath = useTimestampedFileName ? resolveTimestampedCsvPath(filePath) : filePath;
        const headers = headerBuffers.get(dsKey(path, 'fast_frame_datasource')) || [];
        const sep = separator || ',';
        const eolStr = decodeEolToken(eol);
        const out = [];
        if (addHeader) {
                const h = [];
                if (timestampMode !== 'none') {
                        h.push(timestampMode === 'relative' ? 'time_ms' : 'timestamp');
                }
                for (let i = 0; i < dataset.series.length; i++) {
                        h.push(headers[i] || `ch${i + 1}`);
                }
                out.push(h.join(sep));
        }
        for (let i = 0; i < dataset.timestamps.length; i++) {
                const row = [];
                if (timestampMode === 'relative') {
                        row.push(String(dataset.timestamps[i]));
                } else if (timestampMode === 'absolute') {
                        row.push(new Date().toISOString());
                }
                for (let j = 0; j < dataset.series.length; j++) {
                        row.push(String(dataset.series[j][i]));
                }
                out.push(row.join(sep));
        }
        const content = out.join(eolStr) + eolStr;
        await fs.promises.writeFile(resolvedFilePath, content);
        setFastStatus(path, {
                state: 'saved',
                message: 'Fast frame saved to CSV',
                datasetPoints: Array.isArray(dataset.timestamps) ? dataset.timestamps.length : 0,
                filePath: resolvedFilePath
        });
        emitActivity({ id: 'csv:save-fast', title: path, state: 'done', label: 'Saved fast dataset', detail: resolvedFilePath });
        return { status: 'saved', filePath: resolvedFilePath };
});

// 📂 Open a dialog to choose a firmware binary file
ipcMain.handle('choose-firmware-file', async () => {
    const defaultFirmwareDir = path.join(__dirname, 'dashboard', 'binaries');
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        defaultPath: defaultFirmwareDir,
        properties: ['openFile'],
        filters: [{ name: 'Firmware', extensions: ['bin'] }]
    });
    if (canceled || filePaths.length === 0) {
        return null;
    }
    return filePaths[0];
});

// 🔥 Flash firmware to a board over serial
ipcMain.handle('start-flash', async (event, { comPort, firmwarePath, mcumgrPath: userPath }) => {
    const flashId = ++activeFlashId;
    emitActivity({ id: 'dfu:serial', title: comPort, state: 'start', label: 'Serial DFU', detail: firmwarePath });
    // Prevent background serial datasources from reopening the port during flashing.
    lockSerialPort(comPort, 'flash', 60000);
    activeFlashSender = event.sender;
    activeFlashPort = comPort;
    activeFlashCanceled = false;
    const resolvedMcumgr = resolveMcumgrPath(userPath);
    if (resolvedMcumgr !== 'mcumgr' && !fs.existsSync(resolvedMcumgr)) {
        const msg = `Error: mcumgr not found at ${resolvedMcumgr}`;
        event.sender.send('flash-progress', msg);
        emitActivity({ id: 'dfu:serial', title: comPort, state: 'error', label: 'Serial DFU', detail: msg });
        unlockSerialPort(comPort);
        if (activeFlashId === flashId) {
            activeFlashSender = null;
            activeFlashPort = null;
            activeFlashCanceled = false;
        }
        event.sender.send('flash-complete');
        return 'error';
    }
    const existing = openPorts.get(comPort);
    if (existing && existing.isOpen) {
        await new Promise(res => existing.close(err => {
            if (err) {
                console.error('Error closing port before flash:', err.message);
            }
            res();
        }));
    }

    return new Promise(resolve => {
        flashFirmware(
            { comPort, firmwarePath, mcumgrPath: resolvedMcumgr },
            msg => {
                const m = String(msg);
                event.sender.send('flash-progress', m);
                if (m.toLowerCase().includes('error')) {
                    emitActivity({ id: 'dfu:serial', title: comPort, state: 'error', label: 'Serial DFU', detail: m });
                }
            },
            () => {
                if (activeFlashId !== flashId) {
                    unlockSerialPort(comPort);
                    return;
                }
                if (activeFlashSender && !activeFlashSender.isDestroyed()) {
                    activeFlashSender.send('flash-complete');
                }
                if (activeFlashCanceled) {
                    emitActivity({ id: 'dfu:serial', title: comPort, state: 'done', label: 'Serial DFU canceled' });
                } else {
                    emitActivity({ id: 'dfu:serial', title: comPort, state: 'done', label: 'Serial DFU complete' });
                }
                unlockSerialPort(comPort);
                activeFlashSender = null;
                activeFlashPort = null;
                activeFlashCanceled = false;
            }
        );
        resolve();
    });
});

// ❌ Cancel flashing
ipcMain.on('cancel-flash', () => {
    activeFlashCanceled = true;
    cancelFlash();
    if (activeFlashSender && !activeFlashSender.isDestroyed()) {
        activeFlashSender.send('flash-complete');
    }
    if (activeFlashPort) {
        unlockSerialPort(activeFlashPort);
    }
    activeFlashSender = null;
    activeFlashPort = null;
});

// 🔥 Flash firmware to a board over CAN (ThingSet DFU)
let canFlashAbortController = null;
ipcMain.handle('start-flash-can', async (event, { channel, filename, target = 0xA0, source = 0x00, targetBus = 0x0, sourceBus = 0x0 }) => {
    // cancel any ongoing
    if (canFlashAbortController) {
        try { canFlashAbortController.abort(); } catch {}
        canFlashAbortController = null;
    }
    canFlashAbortController = new AbortController();
    const signal = canFlashAbortController.signal;
    // Run async but return immediately
    (async () => {
        try {
            await flashCanFirmware({ filename, channel, target, source, targetBus, sourceBus, signal }, (msg) => {
                event.sender.send('flash-progress', String(msg));
            });
        } catch (err) {
            const m = (err && err.message) ? err.message : String(err);
            event.sender.send('flash-progress', `Error: ${m}`);
        } finally {
            event.sender.send('flash-complete');
        }
    })();
    return 'started';
});

ipcMain.on('cancel-flash-can', () => {
    if (canFlashAbortController) {
        try { canFlashAbortController.abort(); } catch {}
        canFlashAbortController = null;
    }
});

// 🧹 Flush buffers for a serial port
ipcMain.handle('flush-serial-buffers', async (_event, { path }) => {
    terminalBuffers.set(path, []);
    serialBuffers.set(path, []);
    for (const key of [...headerBuffers.keys()]) {
        if (key.startsWith(`${path}||`)) headerBuffers.delete(key);
    }
    for (const key of [...colorBuffers.keys()]) {
        if (key.startsWith(`${path}||`)) colorBuffers.delete(key);
    }
    fastStates.delete(path);
    fastBuffers.delete(path);
    fastStatus.delete(path);
    fastAcquisitionSeq.delete(path);
    return 'flushed';
});

// ❓ Check if a serial port is open
ipcMain.handle('is-serial-port-open', async (_event, { path }) => {
    const port = openPorts.get(path);
    return port ? port.isOpen : false;
});

// =============================
// CAN / ThingSet IPC connectors
// =============================

const canBuses = new Map(); // key: channel name (e.g., 'can0') -> bus
const tsClients = new Map(); // key: channel -> ThingSetCAN (source 0xEF)
const canAggregators = new Map(); // key: channel -> CanBroadcastAggregator

function ensureThingsetDir() {
    const dir = path.join(process.cwd(), 'thingset');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// Open a CAN bus on a given channel and keep it for reuse
ipcMain.handle('can-open', async (_event, { channel = 'can0', sourceAddr = 0xEF } = {}) => {
    emitActivity({ id: 'can:open', title: `CAN ${channel}`, state: 'start', label: 'Open CAN bus' });
    if (canBuses.has(channel)) { emitActivity({ id: 'can:open', title: `CAN ${channel}`, state: 'done', label: 'CAN already open' }); return 'already-open'; }
    const bus = await createBus({ channel });
    canBuses.set(channel, bus);
    tsClients.set(channel, new ThingSetCAN(bus, sourceAddr | 0));
    emitActivity({ id: 'can:open', title: `CAN ${channel}`, state: 'done', label: 'CAN opened' });
    return 'opened';
});

// Close a previously opened CAN bus
ipcMain.handle('can-close', async (_event, { channel = 'can0' } = {}) => {
    emitActivity({ id: 'can:close', title: `CAN ${channel}`, state: 'start', label: 'Close CAN bus' });
    const bus = canBuses.get(channel);
    if (!bus) { emitActivity({ id: 'can:close', title: `CAN ${channel}`, state: 'done', label: 'CAN already closed' }); return 'not-open'; }
    try { await bus.shutdown(); } finally {
        canBuses.delete(channel);
        tsClients.delete(channel);
        const ag = canAggregators.get(channel);
        if (ag) {
            try { ag.stop(); } catch {}
            canAggregators.delete(channel);
        }
    }
    emitActivity({ id: 'can:close', title: `CAN ${channel}`, state: 'done', label: 'CAN closed' });
    return 'closed';
});

// Scan the bus for nodes and return discovered mapping; also writes thingset/nodes.json
ipcMain.handle('can-scan-nodes', async (_event, { channel = 'can0' } = {}) => {
    if (!enableThingset) return { ok: false, error: 'ThingSet disabled' };
    ensureThingsetDir();
    emitActivity({ id: 'can:scan', title: `CAN ${channel}`, state: 'start', label: 'Scanning nodes' });
    try {
        // Use bundled scanner which writes thingset/nodes.json
        await scanCanNodes(channel);
        // Read back the file and return JSON
        const outPath = path.join(process.cwd(), 'thingset', 'nodes.json');
        const text = await fs.promises.readFile(outPath, 'utf8');
        const nodes = JSON.parse(text);
        const count = nodes ? Object.keys(nodes).length : 0;
        emitActivity({ id: 'can:scan', title: `CAN ${channel}`, state: 'done', label: 'Scanning nodes', detail: `${count} nodes` });
        return { nodes, path: outPath };
    } catch (e) {
        emitActivity({ id: 'can:scan', title: `CAN ${channel}`, state: 'error', label: 'Scanning nodes', detail: e?.message || String(e) });
        throw new Error(`scan failed: ${e?.message || e}`);
    }
});

// Build ThingSet tree files for provided nodes or from thingset/nodes.json; returns a summary
ipcMain.handle('can-build-trees', async (_event, { channel = 'can0', nodes = null, maxDepth = 16 } = {}) => {
    if (!enableThingset) return { ok: false, error: 'ThingSet disabled' };
    ensureThingsetDir();
    emitActivity({ id: 'can:build', title: `CAN ${channel}`, state: 'start', label: 'Building trees' });
    // Always use a dedicated bus for tree building to avoid interference
    const bus = await createBus({ channel });
    const results = [];
    try {
        let mapping = nodes;
        if (!mapping) {
            // Fallback: read nodes.json
            const np = path.join(process.cwd(), 'thingset', 'nodes.json');
            mapping = JSON.parse(await fs.promises.readFile(np, 'utf8'));
        }
        for (const [addrStr, nodeUid] of Object.entries(mapping)) {
            const addr = parseInt(addrStr, 10);
            const root = await exploreId(bus, addr, 0x00, 0, maxDepth);
            const tree = {
                node_uid: nodeUid,
                address: `0x${addr.toString(16).toUpperCase().padStart(2, '0')}`,
                root,
            };
            const out = path.join(process.cwd(), 'thingset', `node_${addr.toString(16).toUpperCase().padStart(2, '0')}_tree.json`);
            await fs.promises.writeFile(out, JSON.stringify(tree, null, 2), 'utf8');
            results.push({ addr, out });
        }
        emitActivity({ id: 'can:build', title: `CAN ${channel}`, state: 'done', label: 'Building trees', detail: `${results.length} trees` });
    } catch (e) {
        emitActivity({ id: 'can:build', title: `CAN ${channel}`, state: 'error', label: 'Building trees', detail: e?.message || String(e) });
        throw e;
    } finally {
        await bus.shutdown();
    }
    return { written: results };
});

// Helper to get or create a ThingSet client for a channel
async function getClient(channel = 'can0', sourceAddr = 0xEF) {
    if (!tsClients.has(channel)) {
        const bus = await createBus({ channel });
        canBuses.set(channel, bus);
        tsClients.set(channel, new ThingSetCAN(bus, sourceAddr | 0));
    }
    return tsClients.get(channel);
}

ipcMain.handle('ts-get', async (_e, { channel = 'can0', targetAddr, endpoint, timeoutMs = 2000, sourceAddr = 0xEF }) => {
    if (!enableThingset) return { ok: false, error: 'ThingSet disabled' };
    emitActivity({ id: 'ts:get', title: `CAN ${channel}`, state: 'start', label: `GET ${endpoint}`, detail: `0x${(targetAddr|0).toString(16).toUpperCase()}` });
    try {
        const ts = await getClient(channel, sourceAddr);
        const resp = await ts.get(targetAddr, endpoint, timeoutMs);
        emitActivity({ id: 'ts:get', title: `CAN ${channel}`, state: 'done', label: `GET ${endpoint}` });
        return resp;
    } catch (e) {
        emitActivity({ id: 'ts:get', title: `CAN ${channel}`, state: 'error', label: `GET ${endpoint}`, detail: e?.message || String(e) });
        throw e;
    }
});

ipcMain.handle('ts-fetch', async (_e, { channel = 'can0', targetAddr, endpoint, items = null, timeoutMs = 2000, sourceAddr = 0xEF }) => {
    if (!enableThingset) return { ok: false, error: 'ThingSet disabled' };
    emitActivity({ id: 'ts:fetch', title: `CAN ${channel}`, state: 'start', label: `FETCH ${endpoint}`, detail: `0x${(targetAddr|0).toString(16).toUpperCase()}` });
    try {
        const ts = await getClient(channel, sourceAddr);
        const r = await ts.fetch(targetAddr, endpoint, items, timeoutMs);
        emitActivity({ id: 'ts:fetch', title: `CAN ${channel}`, state: 'done', label: `FETCH ${endpoint}` });
        return r;
    } catch (e) {
        emitActivity({ id: 'ts:fetch', title: `CAN ${channel}`, state: 'error', label: `FETCH ${endpoint}`, detail: e?.message || String(e) });
        throw e;
    }
});

ipcMain.handle('ts-update', async (_e, { channel = 'can0', targetAddr, endpoint, values, timeoutMs = 2000, sourceAddr = 0xEF }) => {
    if (!enableThingset) return { ok: false, error: 'ThingSet disabled' };
    emitActivity({ id: 'ts:update', title: `CAN ${channel}`, state: 'start', label: `UPDATE ${endpoint}`, detail: `0x${(targetAddr|0).toString(16).toUpperCase()}` });
    try {
        const ts = await getClient(channel, sourceAddr);
        const r = await ts.update(targetAddr, endpoint, values, timeoutMs);
        emitActivity({ id: 'ts:update', title: `CAN ${channel}`, state: 'done', label: `UPDATE ${endpoint}` });
        return r;
    } catch (e) {
        emitActivity({ id: 'ts:update', title: `CAN ${channel}`, state: 'error', label: `UPDATE ${endpoint}`, detail: e?.message || String(e) });
        throw e;
    }
});

ipcMain.handle('ts-create', async (_e, { channel = 'can0', targetAddr, endpoint, value, timeoutMs = 2000, sourceAddr = 0xEF }) => {
    if (!enableThingset) return { ok: false, error: 'ThingSet disabled' };
    emitActivity({ id: 'ts:create', title: `CAN ${channel}`, state: 'start', label: `CREATE ${endpoint}`, detail: `0x${(targetAddr|0).toString(16).toUpperCase()}` });
    try {
        const ts = await getClient(channel, sourceAddr);
        const r = await ts.create(targetAddr, endpoint, value, timeoutMs);
        emitActivity({ id: 'ts:create', title: `CAN ${channel}`, state: 'done', label: `CREATE ${endpoint}` });
        return r;
    } catch (e) {
        emitActivity({ id: 'ts:create', title: `CAN ${channel}`, state: 'error', label: `CREATE ${endpoint}`, detail: e?.message || String(e) });
        throw e;
    }
});

ipcMain.handle('ts-delete', async (_e, { channel = 'can0', targetAddr, endpoint, value, timeoutMs = 2000, sourceAddr = 0xEF }) => {
    if (!enableThingset) return { ok: false, error: 'ThingSet disabled' };
    emitActivity({ id: 'ts:delete', title: `CAN ${channel}`, state: 'start', label: `DELETE ${endpoint}`, detail: `0x${(targetAddr|0).toString(16).toUpperCase()}` });
    try {
        const ts = await getClient(channel, sourceAddr);
        const r = await ts.delete(targetAddr, endpoint, value, timeoutMs);
        emitActivity({ id: 'ts:delete', title: `CAN ${channel}`, state: 'done', label: `DELETE ${endpoint}` });
        return r;
    } catch (e) {
        emitActivity({ id: 'ts:delete', title: `CAN ${channel}`, state: 'error', label: `DELETE ${endpoint}`, detail: e?.message || String(e) });
        throw e;
    }
});

ipcMain.handle('ts-exec', async (_e, { channel = 'can0', targetAddr, endpoint, args = [], timeoutMs = 2000, sourceAddr = 0xEF }) => {
    if (!enableThingset) return { ok: false, error: 'ThingSet disabled' };
    emitActivity({ id: 'ts:exec', title: `CAN ${channel}`, state: 'start', label: `EXEC ${endpoint}`, detail: `0x${(targetAddr|0).toString(16).toUpperCase()}` });
    try {
        const ts = await getClient(channel, sourceAddr);
        const r = await ts.exec(targetAddr, endpoint, args, timeoutMs);
        emitActivity({ id: 'ts:exec', title: `CAN ${channel}`, state: 'done', label: `EXEC ${endpoint}` });
        return r;
    } catch (e) {
        emitActivity({ id: 'ts:exec', title: `CAN ${channel}`, state: 'error', label: `EXEC ${endpoint}`, detail: e?.message || String(e) });
        throw e;
    }
});

ipcMain.handle('ts-paths-for-ids', async (_e, { channel = 'can0', targetAddr, ids, timeoutMs = 2000, sourceAddr = 0xEF }) => {
    if (!enableThingset) return { ok: false, error: 'ThingSet disabled' };
    emitActivity({ id: 'ts:paths-for-ids', title: `CAN ${channel}`, state: 'start', label: 'Paths for IDs' });
    try {
        const ts = await getClient(channel, sourceAddr);
        const r = await ts.paths_for_ids(targetAddr, ids, timeoutMs);
        emitActivity({ id: 'ts:paths-for-ids', title: `CAN ${channel}`, state: 'done', label: 'Paths for IDs' });
        return r;
    } catch (e) {
        emitActivity({ id: 'ts:paths-for-ids', title: `CAN ${channel}`, state: 'error', label: 'Paths for IDs', detail: e?.message || String(e) });
        throw e;
    }
});

ipcMain.handle('ts-ids-for-paths', async (_e, { channel = 'can0', targetAddr, paths, timeoutMs = 2000, sourceAddr = 0xEF }) => {
    if (!enableThingset) return { ok: false, error: 'ThingSet disabled' };
    emitActivity({ id: 'ts:ids-for-paths', title: `CAN ${channel}`, state: 'start', label: 'IDs for paths' });
    try {
        const ts = await getClient(channel, sourceAddr);
        const r = await ts.ids_for_paths(targetAddr, paths, timeoutMs);
        emitActivity({ id: 'ts:ids-for-paths', title: `CAN ${channel}`, state: 'done', label: 'IDs for paths' });
        return r;
    } catch (e) {
        emitActivity({ id: 'ts:ids-for-paths', title: `CAN ${channel}`, state: 'error', label: 'IDs for paths', detail: e?.message || String(e) });
        throw e;
    }
});

// =============================
// CAN broadcast aggregator IPC
// =============================

ipcMain.handle('can-aggregate-start', async (_e, { channel = 'can0' } = {}) => {
    // Ensure bus exists
    if (!canBuses.has(channel)) {
        const bus = await createBus({ channel });
        canBuses.set(channel, bus);
    }
    let ag = canAggregators.get(channel);
    if (!ag) {
        ag = new CanBroadcastAggregator(canBuses.get(channel), { channel });
        canAggregators.set(channel, ag);
    }
    emitActivity({ id: 'can:agg', title: `CAN ${channel}`, state: 'start', label: 'Starting aggregator' });
    try {
        ag.start();
        emitActivity({ id: 'can:agg', title: `CAN ${channel}`, state: 'done', label: 'Aggregator running' });
        return 'ok';
    } catch (e) {
        emitActivity({ id: 'can:agg', title: `CAN ${channel}`, state: 'error', label: 'Starting aggregator', detail: e?.message || String(e) });
        throw e;
    }
});

ipcMain.handle('can-aggregate-set-debug', async (_e, { channel = 'can0', enable = true } = {}) => {
    const ag = canAggregators.get(channel);
    if (!ag) return 'not-running';
    ag.setDebug(!!enable);
    return 'ok';
});

ipcMain.handle('can-aggregate-stop', async (_e, { channel = 'can0' } = {}) => {
    const ag = canAggregators.get(channel);
    if (!ag) return 'not-running';
    emitActivity({ id: 'can:agg', title: `CAN ${channel}`, state: 'start', label: 'Stopping aggregator' });
    ag.stop();
    canAggregators.delete(channel);
    emitActivity({ id: 'can:agg', title: `CAN ${channel}`, state: 'done', label: 'Aggregator stopped' });
    return 'stopped';
});

ipcMain.handle('can-aggregate-snapshot', async (_e, { channel = 'can0' } = {}) => {
    const ag = canAggregators.get(channel);
    if (!ag) return { channel, nodes: {} };
    return ag.getSnapshot();
});

// =============================
// Linux-only: setup SocketCAN (can0) via pkexec with GUI auth
ipcMain.handle('can-setup-linux', async () => {
    if (process.platform !== 'linux') {
        throw new Error('can-setup-linux is only supported on Linux');
    }
    const scriptPath = path.join(__dirname, 'scripts', 'setup_can_linux.sh');
    // Use pkexec for GUI privilege escalation; run script through bash to avoid exec-bit requirement
    emitActivity({ id: 'can:setup', title: 'CAN', state: 'start', label: 'Setting up CAN (Linux)' });
    return new Promise((resolve, reject) => {
        const child = spawn('pkexec', ['bash', scriptPath], {
            env: process.env,
            stdio: 'ignore'
        });
        child.on('error', (err) => reject(new Error(`pkexec failed: ${err.message}`)));
        child.on('exit', (code) => {
            if (code === 0) {
                emitActivity({ id: 'can:setup', title: 'CAN', state: 'done', label: 'CAN setup complete' });
                resolve('ok');
            } else {
                emitActivity({ id: 'can:setup', title: 'CAN', state: 'error', label: 'CAN setup failed', detail: `exit ${code}` });
                reject(new Error(`pkexec exited with code ${code}`));
            }
        });
    });
});

// Check if a CAN network interface exists and is up (no privileges required)
ipcMain.handle('can-is-up', async (_e, { channel = 'can0' } = {}) => {
    try {
        const opPath = path.join('/sys/class/net', channel, 'operstate');
        const stat = await fs.promises.stat(opPath).catch(() => null);
        if (!stat) return { exists: false, up: false };
        const state = (await fs.promises.readFile(opPath, 'utf8')).trim();
        return { exists: true, up: state === 'up' };
    } catch (e) {
        // Fallback: assume not up on error
        return { exists: false, up: false };
    }
});
