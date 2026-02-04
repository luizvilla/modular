const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');
const fs = require('fs');
const { flashFirmware, cancelFlash } = require('./flasher');
const { spawn } = require('child_process');
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

function buildExamplesMenuItems() {
    try {
        const baseDir = path.join(__dirname, 'dashboard', 'docs', 'examples');
        const readmes = collectReadmes(baseDir);
        if (!readmes.length) return [];

        const root = { children: new Map(), exampleId: null };
        for (const rm of readmes) {
            const relDir = path.relative(baseDir, path.dirname(rm));
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

function setAppMenu() {
    const examplesMenu = buildExamplesMenuItems();
    const template = [
        {
            label: 'File',
            submenu: [
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
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Emit UI activity events to renderer (used for toasts/indicators)
function emitActivity(evt) {
    try {
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('activity', { ts: Date.now(), scope: 'can', ...evt });
        }
    } catch {}
}

// Path to mcumgr binary, assumes it is bundled alongside the app in a tools folder
const mcumgrBinary = process.platform === 'win32' ? 'mcumgr.exe'
    : process.platform === 'darwin' ? 'mcumgr-mac' : 'mcumgr';
const mcumgrPath = path.join(__dirname, 'tools', mcumgrBinary);

const activeRecordings = new Map(); // Active CSV recordings mapped by port path
const openPorts = new Map(); // key: path, value: SerialPort instance
// Persist last-known serial settings per port so we can auto-reopen later.
const portSettings = new Map(); // key: path, value: { baudRate, separator, eol, type }
// Track pending auto-reopen timers and intent per port.
const pendingReopens = new Map(); // key: path, value: { timer: Timeout|null, settings }
const terminalBuffers = new Map(); // key: path, value: array of raw lines
const serialBuffers = new Map(); // key: path, value: array of parsed data arrays
// header and color buffers keyed by "path||type" to support multiple
// datasources on the same serial port
const headerBuffers = new Map();
const colorBuffers = new Map();
const fastStates = new Map(); // key: path, value: state for fast frame parsing
const fastBuffers = new Map(); // key: path, value: last parsed fast dataset
const FAST_IDLE = 0;
const FAST_RECORD = 1;
const MAX_BUFFER_SIZE = 1000;
const MAX_TERMINAL_LINES = 200;

function dsKey(path, type = 'serialport_datasource') {
    return `${path}||${type}`;
}

function decodeEolToken(token) {
    if (!token || typeof token !== 'string') return '\n';
    let out = token;
    out = out.replace(/\\r/g, '\r');
    out = out.replace(/\\n/g, '\n');
    out = out.replace(/\\t/g, '\t');
    return out;
}



let currentSettings = {
	separator: ":",
	eol: "\n"
};

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

function parseLine(line) {
	const clean = line.trim();
	const rawItems = clean.split(currentSettings.separator).filter(s => s.trim() !== "");
	const values = rawItems.map(v => parseFloat(v)).filter(n => !isNaN(n));
	return values;
}

function parseLineCustom(line, sep) {
        const clean = line.trim();
        return clean.split(sep).map(s => s.trim()).filter(s => s !== "");
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
        return;
    }

    if (line.includes('end record')) {
        st.state = FAST_IDLE;
        const dataset = buildFastDataset(st);
        if (dataset) fastBuffers.set(portPath, dataset);
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
	return ports.map(port => ({
		name: port.path,
		value: port.path
	}));
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
        emitActivity({ id: 'serial:open', title: path, state: 'start', label: 'Open serial port' });
        if (openPorts.has(path)) {
                console.warn(`Port ${path} is already open.`);
                // ensure buffers for this datasource type exist
                const key = dsKey(path, type);
                if (!headerBuffers.has(key)) headerBuffers.set(key, []);
                if (!colorBuffers.has(key)) colorBuffers.set(key, []);
                emitActivity({ id: 'serial:open', title: path, state: 'done', label: 'Serial already open' });
                return;
        }

	currentSettings.separator = separator || ":";
        currentSettings.eol = decodeEolToken(eol);
        // Persist settings so a later auto-reopen uses the same config.
        portSettings.set(path, {
            baudRate: parseInt(baudRate),
            separator: separator || ":",
            eol: decodeEolToken(eol),
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

        port.on("data", chunk => {
                        rawBuffer += chunk.toString();
                        const lines = rawBuffer.split(currentSettings.eol);
                        rawBuffer = lines.pop(); // keep the last (possibly incomplete) line
                        const termBuf = terminalBuffers.get(path) || [];
                        for (const line of lines) {
                                        const parsed = parseLine(line);
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
        const eolStr = eol ? JSON.parse(`"${eol}"`) : '\n';
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
ipcMain.handle('save-fast-csv', async (event, { path, filePath, separator, eol, addHeader = true, timestampMode = 'none' }) => {
        emitActivity({ id: 'csv:save-fast', title: path, state: 'start', label: 'Save fast dataset', detail: filePath });
        const dataset = fastBuffers.get(path);
        if (!dataset || !Array.isArray(dataset.series)) {
                const err = 'no dataset';
                emitActivity({ id: 'csv:save-fast', title: path, state: 'error', label: 'Save fast dataset', detail: err });
                throw new Error(err);
        }
        const headers = headerBuffers.get(dsKey(path, 'fast_frame_datasource')) || [];
        const sep = separator || ',';
        const eolStr = eol ? JSON.parse(`"${eol}"`) : '\n';
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
        await fs.promises.writeFile(filePath, content);
        emitActivity({ id: 'csv:save-fast', title: path, state: 'done', label: 'Saved fast dataset', detail: filePath });
        return 'saved';
});

// 📂 Open a dialog to choose a firmware binary file
ipcMain.handle('choose-firmware-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
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
    emitActivity({ id: 'dfu:serial', title: comPort, state: 'start', label: 'Serial DFU', detail: firmwarePath });
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
            { comPort, firmwarePath, mcumgrPath: userPath || mcumgrPath },
            msg => {
                const m = String(msg);
                event.sender.send('flash-progress', m);
                if (m.toLowerCase().includes('error')) {
                    emitActivity({ id: 'dfu:serial', title: comPort, state: 'error', label: 'Serial DFU', detail: m });
                }
            },
            () => {
                event.sender.send('flash-complete');
                emitActivity({ id: 'dfu:serial', title: comPort, state: 'done', label: 'Serial DFU complete' });
            }
        );
        resolve();
    });
});

// ❌ Cancel flashing
ipcMain.on('cancel-flash', () => {
    cancelFlash();
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
