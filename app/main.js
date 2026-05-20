const { app, BrowserWindow, ipcMain, nativeTheme, dialog, Menu, shell } = require('electron');
const path = require('path');
const { SerialPort } = require('serialport');
const fs = require('fs');
const { flashFirmware, cancelFlash } = require('./flasher');
const { spawn } = require('child_process');
const { buildExtensionRuntime, readInstalledState } = require('./extensions/runtime');
const {
    FIRMWARE_FOCUSED_FILES,
    getFirmwareWorkspaceStatePath,
    listAdvancedWorkspaceEntries,
    listFocusedWorkspaceEntries,
    pickDefaultActiveFile,
    readFirmwareWorkspaceState,
    readWorkspaceTextFile,
    resolveWorkspacePath,
    validateFirmwareWorkspaceRoot,
    writeFirmwareWorkspaceState,
    writeWorkspaceTextFile,
} = require('./firmware/workspace');

const argv = process.argv || [];
const noGpu = argv.includes('--no-gpu') || argv.includes('--disable-gpu');
if (noGpu) {
    // Must be called before app is ready
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu');
}

if (process.env.MODULAR_USER_DATA_DIR) {
    try {
        app.setPath('userData', path.resolve(process.env.MODULAR_USER_DATA_DIR));
    } catch (err) {
        console.warn('Failed to override userData path:', err?.message || err);
    }
}

// Set ENABLE_THINGSET for preload.js detection; extension runtime handles actual enablement.
if (process.env.ENABLE_THINGSET === undefined) {
    process.env.ENABLE_THINGSET = app.isPackaged ? '0' : '1';
}

// Shared context passed to extension main entries. Properties populated below as they become available.
const extensionSharedContext = { ipcMain, app };

// Installed bundles live under userData so they survive app updates.
let installedRoot = null;
try {
    installedRoot = path.join(app.getPath('userData'), 'extensions');
} catch { /* userData unavailable before ready on some platforms — bundles discovered at boot only */ }

const extensionRuntime = buildExtensionRuntime({
    appRoot: __dirname,
    env: process.env,
    logger: console,
    extensionContext: extensionSharedContext,
    installedRoot,
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
        coursewareRoots: extensionRuntime.bootstrap.coursewareRoots.map((entry) => ({ ...entry })),
        dashboardRoots: extensionRuntime.bootstrap.dashboardRoots.map((entry) => ({ ...entry })),
        widgetDocs: extensionRuntime.bootstrap.widgetDocs.map((entry) => ({ ...entry })),
        courseware: extensionRuntime.bootstrap.courseware.map((entry) => ({ ...entry })),
        datasources: extensionRuntime.bootstrap.datasources.map((entry) => ({ ...entry })),
    };
}

let mainWindow; // reference to the main BrowserWindow
let exampleWindow; // dedicated window for docs and lab actions
let firmwareWindow; // dedicated window for firmware editing sessions
let exampleTabRequestTimer; // debounce docs tab requests
let pendingDocTabRequest = null; // last requested docs tab (for late renderer init)
// Track docs window docking previews/selection so popped tabs can be dragged back.
let exampleWindowActiveRef = null;
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

function isFirmwareWorkspaceEnabled() {
    return extensionRuntime.isEnabled('owntech-workspace');
}

function getFirmwareWorkspaceSessionPath() {
    return getFirmwareWorkspaceStatePath(app.getPath('userData'));
}

function readFirmwareSessionState() {
    return readFirmwareWorkspaceState(getFirmwareWorkspaceSessionPath());
}

function writeFirmwareSessionState(patch) {
    const currentState = readFirmwareSessionState();
    const nextState = {
        ...currentState,
        ...(patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}),
    };
    return writeFirmwareWorkspaceState(getFirmwareWorkspaceSessionPath(), nextState);
}

function resolveFirmwareWorkspaceContext(inputState = null) {
    const persistedState = inputState || readFirmwareSessionState();
    if (!persistedState.workspaceRoot) {
        return {
            persistedState,
            workspaceRoot: null,
            invalidWorkspaceRoot: null,
            validationError: null,
            activeFile: null,
        };
    }

    try {
        const workspaceRoot = validateFirmwareWorkspaceRoot(persistedState.workspaceRoot);
        let activeFile = null;
        if (persistedState.activeFile) {
            try {
                const resolved = resolveWorkspacePath(workspaceRoot, persistedState.activeFile);
                if (fs.existsSync(resolved.absolutePath) && fs.statSync(resolved.absolutePath).isFile()) {
                    activeFile = resolved.relativePath;
                }
            } catch { /* fall back to a default file below */ }
        }
        if (!activeFile) {
            activeFile = pickDefaultActiveFile(workspaceRoot);
        }
        return {
            persistedState,
            workspaceRoot,
            invalidWorkspaceRoot: null,
            validationError: null,
            activeFile,
        };
    } catch (err) {
        return {
            persistedState,
            workspaceRoot: null,
            invalidWorkspaceRoot: persistedState.workspaceRoot,
            validationError: err?.message || String(err),
            activeFile: null,
        };
    }
}

function listFirmwareWorkspaceEntries(context) {
    if (!context || !context.workspaceRoot) return [];
    return context.persistedState.advancedMode
        ? listAdvancedWorkspaceEntries(context.workspaceRoot, { maxDepth: 4 })
        : listFocusedWorkspaceEntries(context.workspaceRoot);
}

function emitFirmwareWorkspaceState(nextState = null) {
    if (!firmwareWindow || firmwareWindow.isDestroyed() || !firmwareWindow.webContents) return;
    const state = nextState || getFirmwareWorkspaceState();
    firmwareWindow.webContents.send('firmware-workspace-state', state);
}

function getFirmwareWorkspaceState() {
    const context = resolveFirmwareWorkspaceContext();
    const fileEntries = listFirmwareWorkspaceEntries(context);
    const summary = context.workspaceRoot
        ? `Attached workspace: ${path.basename(context.workspaceRoot)}`
        : 'Attach an existing Core checkout to start editing in Monaco.';
    const placeholderMessage = context.workspaceRoot
        ? 'Session 3 embeds Monaco, multi-tab editing, and Session 2 attached-workspace persistence.'
        : 'Attach an existing firmware workspace to enable Monaco-backed editing.';

    return {
        session: 3,
        extensionId: 'owntech-workspace',
        enabled: isFirmwareWorkspaceEnabled(),
        windowOpen: !!(firmwareWindow && !firmwareWindow.isDestroyed()),
        summary,
        placeholderMessage,
        workspace: {
            mode: context.workspaceRoot ? 'attached' : 'detached',
            root: context.workspaceRoot,
            requestedRoot: context.invalidWorkspaceRoot,
            validationError: context.validationError,
            focusedFiles: FIRMWARE_FOCUSED_FILES.slice(),
            advancedMode: !!context.persistedState.advancedMode,
            activeFile: context.activeFile,
            fileCount: fileEntries.length,
        },
    };
}

function getFirmwareToolchainStatus() {
    return {
        session: 3,
        managed: false,
        status: 'placeholder',
        platformio: {
            status: 'not-installed',
            source: 'none',
        },
        clangd: {
            status: 'not-installed',
            source: 'none',
        },
    };
}

function getFirmwareBuildState() {
    const context = resolveFirmwareWorkspaceContext();
    return {
        session: 3,
        status: 'idle',
        supported: false,
        selectedEnv: null,
        envs: [],
        workspaceAttached: !!context.workspaceRoot,
        actions: {
            installToolchain: false,
            build: false,
            upload: false,
            clean: false,
            reindex: false,
        },
        placeholderMessage: 'Build, upload, and indexing actions remain disabled in Session 3.',
    };
}

function firmwareStubResponse(action) {
    return {
        ok: false,
        session: 3,
        error: `${action} is not implemented in Session 3.`,
    };
}

function openFirmwareWorkspaceWindow() {
    if (!isFirmwareWorkspaceEnabled()) {
        return null;
    }
    if (firmwareWindow && !firmwareWindow.isDestroyed()) {
        if (firmwareWindow.isMinimized()) firmwareWindow.restore();
        firmwareWindow.focus();
        return firmwareWindow;
    }

    firmwareWindow = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 920,
        minHeight: 640,
        title: 'Firmware Workspace',
        icon: path.join(__dirname, 'assets', 'icon.png'),
        backgroundColor: '#0c1320',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            sandbox: false,
            nodeIntegration: false,
            contextIsolation: true,
        }
    });

    if (!app.isPackaged) {
        firmwareWindow.webContents.on('did-fail-load', (_event, code, desc, url) => {
            console.error('[firmware] did-fail-load', code, desc, url);
        });
    }

    firmwareWindow.loadFile(path.join(__dirname, 'firmware', 'index.html'));
    firmwareWindow.on('closed', () => {
        firmwareWindow = null;
    });

    return firmwareWindow;
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

ipcMain.on('set-theme', (_event, theme) => {
    nativeTheme.themeSource = theme === 'light' ? 'light' : 'dark';
});

// App menu is custom: Edit only hosts "Widget Categories" and View/Window are removed.
// ── Documentation menu helpers ────────────────────────────────────────────────

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

function buildExamplesForExtension(extensionId) {
    try {
        const roots = (extensionRuntime.bootstrap.exampleRoots || []).filter(
            (r) => r.extensionId === extensionId
        );
        const readmes = collectReadmesFromRoots(roots);
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
                    items.push({ label: key, submenu: buildMenuFromNode(child) });
                } else if (child.exampleId) {
                    items.push({ label: key, click: () => openExampleTab(child.exampleId) });
                }
            }
            return items;
        };

        return buildMenuFromNode(root);
    } catch (err) {
        console.warn(`Failed to build Examples menu for ${extensionId}:`, err?.message || err);
        return [];
    }
}

function buildWidgetDocsForExtension(extensionId) {
    try {
        const entries = (extensionRuntime.bootstrap.widgetDocs || []).filter((entry) => {
            if (!entry || !entry.type || !entry.title) return false;
            if (entry.compatibilityOnly) return false;
            return entry.extensionId === extensionId;
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
        console.warn(`Failed to build Widgets menu for ${extensionId}:`, err?.message || err);
        return [];
    }
}

function isExtensionEnabled(extensionId) {
    return extensionRuntime.inventory.some((entry) => entry.id === extensionId && entry.enabled);
}

function buildWidgetExtensionsMenuItems() {
    const widgetSections = [
        { extensionId: 'core', label: 'Modular Core Widgets' },
        { extensionId: 'owntech', label: 'OwnTech Widgets' },
        { extensionId: 'thingset', label: 'Thingset Widgets' },
    ];
    const items = [];
    widgetSections.forEach(({ extensionId, label }) => {
        if (!isExtensionEnabled(extensionId)) return;
        const submenu = buildWidgetDocsForExtension(extensionId);
        if (!submenu.length) return;
        items.push({ label, submenu });
    });
    return items.length
        ? items
        : [{ label: 'No widget documentation found', enabled: false }];
}

function buildExamplesMenuItems(extensionId) {
    const items = buildExamplesForExtension(extensionId);
    return items.length
        ? items
        : [{ label: 'No examples found', enabled: false }];
}

function getExtensionDisplayName(extensionId) {
    const entry = extensionRuntime.inventory.find((item) => item.id === extensionId);
    return entry ? entry.displayName : extensionId;
}

function buildCoursewareTree(entries) {
    const root = { groups: new Map(), labs: [] };
    for (const entry of entries) {
        const segments = Array.isArray(entry.menuSegments) ? entry.menuSegments.filter(Boolean) : [];
        const parents = segments.length > 1 ? segments.slice(0, -1) : [];
        let node = root;
        for (const segment of parents) {
            if (!node.groups.has(segment)) node.groups.set(segment, { groups: new Map(), labs: [] });
            node = node.groups.get(segment);
        }
        node.labs.push(entry);
    }

    const toMenu = (node) => {
        const items = [];
        const groupLabels = Array.from(node.groups.keys()).sort((a, b) => a.localeCompare(b));
        for (const label of groupLabels) {
            items.push({
                label,
                submenu: toMenu(node.groups.get(label)),
            });
        }
        node.labs
            .slice()
            .sort((left, right) => {
                if (left.order !== right.order) return left.order - right.order;
                return left.title.localeCompare(right.title);
            })
            .forEach((entry) => {
                items.push({
                    label: entry.title,
                    click: () => openCoursewareTab(entry.id),
                });
            });
        return items;
    };

    return toMenu(root);
}

function buildCoursewareMenuItems() {
    try {
        const entries = Array.isArray(extensionRuntime.bootstrap.courseware)
            ? extensionRuntime.bootstrap.courseware.slice()
            : [];
        if (!entries.length) return [{ label: 'No courseware found', enabled: false }];

        const grouped = new Map();
        for (const entry of entries) {
            if (!entry || !entry.id || !entry.extensionId) continue;
            if (!grouped.has(entry.extensionId)) grouped.set(entry.extensionId, []);
            grouped.get(entry.extensionId).push(entry);
        }

        const extensionIds = Array.from(grouped.keys());
        if (extensionIds.length === 1) {
            return buildCoursewareTree(grouped.get(extensionIds[0]));
        }

        const sections = [];
        for (const extensionId of extensionIds) {
            if (sections.length) sections.push({ type: 'separator' });
            sections.push({ label: getExtensionDisplayName(extensionId), enabled: false });
            sections.push(...buildCoursewareTree(grouped.get(extensionId)));
        }
        return sections.length ? sections : [{ label: 'No courseware found', enabled: false }];
    } catch (err) {
        console.warn(`Failed to build Courseware menu:`, err?.message || err);
        return [{ label: 'No courseware found', enabled: false }];
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
ipcMain.handle('firmware-workspace-open-window', () => {
    const win = openFirmwareWorkspaceWindow();
    if (!win) {
        return {
            ok: false,
            windowOpen: false,
            error: 'OwnTech Firmware Workspace is disabled.',
            state: getFirmwareWorkspaceState(),
        };
    }
    return {
        ok: !!win,
        windowOpen: !!win,
        state: getFirmwareWorkspaceState(),
    };
});
ipcMain.handle('firmware-workspace-get-state', () => getFirmwareWorkspaceState());
ipcMain.handle('firmware-workspace-use-managed', () => firmwareStubResponse('useManagedWorkspace'));
ipcMain.handle('firmware-workspace-attach-existing', async (_event, { workspacePath } = {}) => {
    let selectedPath = typeof workspacePath === 'string' && workspacePath.trim() ? workspacePath.trim() : '';
    if (!selectedPath) {
        const ownerWindow = (firmwareWindow && !firmwareWindow.isDestroyed()) ? firmwareWindow : mainWindow;
        const { canceled, filePaths } = await dialog.showOpenDialog(ownerWindow, {
            title: 'Attach Existing Firmware Workspace',
            defaultPath: process.cwd(),
            properties: ['openDirectory'],
        });
        if (canceled || !filePaths || filePaths.length === 0) {
            return { ok: false, canceled: true, state: getFirmwareWorkspaceState() };
        }
        [selectedPath] = filePaths;
    }

    try {
        const workspaceRoot = validateFirmwareWorkspaceRoot(selectedPath);
        const activeFile = pickDefaultActiveFile(workspaceRoot);
        writeFirmwareSessionState({
            workspaceRoot,
            advancedMode: false,
            activeFile,
        });
        const state = getFirmwareWorkspaceState();
        emitFirmwareWorkspaceState(state);
        return { ok: true, state };
    } catch (err) {
        return {
            ok: false,
            error: err?.message || String(err),
            state: getFirmwareWorkspaceState(),
        };
    }
});
ipcMain.handle('firmware-workspace-list-files', () => {
    const context = resolveFirmwareWorkspaceContext();
    return {
        ok: true,
        session: 3,
        mode: context.persistedState.advancedMode ? 'advanced' : 'focused',
        files: listFirmwareWorkspaceEntries(context),
    };
});
ipcMain.handle('firmware-workspace-read-file', (_event, { relativePath } = {}) => {
    const context = resolveFirmwareWorkspaceContext();
    if (!context.workspaceRoot) {
        return { ok: false, error: context.validationError || 'No attached firmware workspace.' };
    }

    try {
        const targetPath = relativePath || context.activeFile || pickDefaultActiveFile(context.workspaceRoot);
        if (!targetPath) {
            return { ok: false, error: 'No readable file is available in the attached workspace.' };
        }
        const file = readWorkspaceTextFile(context.workspaceRoot, targetPath);
        writeFirmwareSessionState({ activeFile: file.relativePath });
        const state = getFirmwareWorkspaceState();
        emitFirmwareWorkspaceState(state);
        return {
            ok: true,
            session: 3,
            relativePath: file.relativePath,
            content: file.content,
            state,
        };
    } catch (err) {
        return { ok: false, error: err?.message || String(err) };
    }
});
ipcMain.handle('firmware-workspace-write-file', (_event, { relativePath, content } = {}) => {
    const context = resolveFirmwareWorkspaceContext();
    if (!context.workspaceRoot) {
        return { ok: false, error: context.validationError || 'No attached firmware workspace.' };
    }

    try {
        const targetPath = relativePath || context.activeFile;
        if (!targetPath) {
            return { ok: false, error: 'No active file selected.' };
        }
        const file = writeWorkspaceTextFile(context.workspaceRoot, targetPath, content ?? '');
        writeFirmwareSessionState({ activeFile: file.relativePath });
        const state = getFirmwareWorkspaceState();
        emitFirmwareWorkspaceState(state);
        return {
            ok: true,
            session: 3,
            relativePath: file.relativePath,
            state,
        };
    } catch (err) {
        return { ok: false, error: err?.message || String(err) };
    }
});
ipcMain.handle('firmware-workspace-set-advanced-mode', (_event, { enabled } = {}) => {
    writeFirmwareSessionState({ advancedMode: !!enabled });
    const state = getFirmwareWorkspaceState();
    emitFirmwareWorkspaceState(state);
    return { ok: true, state };
});
ipcMain.handle('firmware-toolchain-get-status', () => getFirmwareToolchainStatus());
ipcMain.handle('firmware-toolchain-install', () => firmwareStubResponse('installToolchain'));
ipcMain.handle('firmware-build-get-state', () => getFirmwareBuildState());
ipcMain.handle('firmware-build-list-envs', () => ({ ok: true, session: 3, envs: [] }));
ipcMain.handle('firmware-build-select-env', () => firmwareStubResponse('selectEnv'));
ipcMain.handle('firmware-build-run', (_event, { action } = {}) => firmwareStubResponse(action || 'runBuildAction'));
ipcMain.handle('firmware-build-cancel', () => firmwareStubResponse('cancelBuildAction'));

// ── Extension Manager ──────────────────────────────────────────────────────

function getInstalledRoot() {
    return path.join(app.getPath('userData'), 'extensions');
}

function readManagerState() {
    return readInstalledState(getInstalledRoot());
}

function writeManagerState(state) {
    const dir = getInstalledRoot();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2), 'utf8');
}

function copyDirSync(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDirSync(srcPath, destPath);
        else fs.copyFileSync(srcPath, destPath);
    }
}

ipcMain.handle('extensions-manager-list', () => {
    return extensionRuntime.inventory.map((e) => ({
        ...e,
        source: e.isInstalled ? 'installed' : 'builtin',
    }));
});

ipcMain.handle('extensions-choose-bundle', async () => {
    if (!mainWindow) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Extension Bundle Directory',
        properties: ['openDirectory'],
    });
    if (canceled || !filePaths.length) return null;
    return filePaths[0];
});

ipcMain.handle('extensions-manager-install', async (_event, { bundlePath } = {}) => {
    if (!bundlePath) return { ok: false, error: 'Missing bundle path' };
    try {
        const manifestPath = path.join(bundlePath, 'manifest.json');
        if (!fs.existsSync(manifestPath)) return { ok: false, error: 'No manifest.json found in bundle directory' };
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const id = String(manifest.id || '').trim();
        const version = String(manifest.version || '0.0.0');
        if (!id) return { ok: false, error: 'Bundle manifest is missing an id field' };
        const destDir = path.join(getInstalledRoot(), id, version);
        if (fs.existsSync(destDir)) return { ok: false, error: `Extension ${id}@${version} is already installed` };
        copyDirSync(bundlePath, destDir);
        const state = readManagerState();
        state[id] = { enabled: !!manifest.enabledByDefault, version };
        writeManagerState(state);
        return { ok: true, id, version, requiresRestart: true };
    } catch (err) {
        return { ok: false, error: err?.message || String(err) };
    }
});

ipcMain.handle('extensions-manager-uninstall', (_event, { id } = {}) => {
    if (!id) return { ok: false, error: 'Missing id' };
    try {
        const state = readManagerState();
        const version = state[id]?.version;
        delete state[id];
        writeManagerState(state);
        if (version) {
            const bundleDir = path.join(getInstalledRoot(), id, version);
            if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true, force: true });
            const idDir = path.join(getInstalledRoot(), id);
            if (fs.existsSync(idDir) && !fs.readdirSync(idDir).length) fs.rmdirSync(idDir);
        }
        return { ok: true, requiresRestart: true };
    } catch (err) {
        return { ok: false, error: err?.message || String(err) };
    }
});

ipcMain.handle('extensions-manager-enable', (_event, { id } = {}) => {
    if (!id) return { ok: false, error: 'Missing id' };
    if (id === 'core') return { ok: false, error: 'The core extension cannot be disabled' };
    const state = readManagerState();
    if (!state[id]) state[id] = {};
    state[id].enabled = true;
    writeManagerState(state);
    return { ok: true, requiresRestart: true };
});

ipcMain.handle('extensions-manager-disable', (_event, { id } = {}) => {
    if (!id) return { ok: false, error: 'Missing id' };
    if (id === 'core') return { ok: false, error: 'The core extension cannot be disabled' };
    const state = readManagerState();
    if (!state[id]) state[id] = {};
    state[id].enabled = false;
    writeManagerState(state);
    return { ok: true, requiresRestart: true };
});

// ──────────────────────────────────────────────────────────────────────────────

function setAppMenu() {
    const widgetExtensionsMenu = buildWidgetExtensionsMenuItems();
    const owntechExamplesMenu = buildExamplesMenuItems('owntech-examples');
    const coursewareMenu = buildCoursewareMenuItems();
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
                    label: 'Firmware Workspace',
                    enabled: isExtensionEnabled('owntech-workspace'),
                    click: () => {
                        openFirmwareWorkspaceWindow();
                    }
                },
                { type: 'separator' },
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
                },
                { type: 'separator' },
                {
                    label: 'Extension Manager',
                    click: () => {
                        if (mainWindow && mainWindow.webContents) {
                            mainWindow.webContents.send('open-extension-manager');
                        }
                    }
                }
            ]
        },
        {
            label: 'Widget Extensions',
            submenu: widgetExtensionsMenu
        }
    ];

    if (isExtensionEnabled('owntech-examples')) {
        template.push({
            label: 'OwnTech Examples',
            submenu: owntechExamplesMenu
        });
    }
    if (isExtensionEnabled('courseware')) {
        template.push({
            label: 'Courseware',
            submenu: coursewareMenu
        });
    }

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
extensionSharedContext.emitActivity = emitActivity;

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
extensionSharedContext.openPorts = openPorts;
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

function normalizeDocRequest(kindOrPayload, id) {
    let payload = kindOrPayload;
    if (typeof payload === 'string') {
        payload = { kind: kindOrPayload, id };
    }
    if (!payload || typeof payload !== 'object') return null;
    const kindValue = String(payload.kind || '').trim().toLowerCase();
    const idValue = String(payload.id || '').trim();
    if (!kindValue || !idValue) return null;
    if (!['example', 'courseware'].includes(kindValue)) return null;
    return { kind: kindValue, id: idValue };
}

function emitDocTabOpen(targetWindow, payload) {
    if (!targetWindow || !targetWindow.webContents || !payload) return;
    targetWindow.webContents.send('open-doc-tab', payload);
    if (payload.kind === 'example') {
        targetWindow.webContents.send('open-example-tab', { id: payload.id });
    }
}

function emitDocSelect(targetWindow, payload) {
    if (!targetWindow || !targetWindow.webContents || !payload) return;
    targetWindow.webContents.send('doc-select', payload);
    if (payload.kind === 'example') {
        targetWindow.webContents.send('example-select', { id: payload.id });
    }
}

function emitDockPreview(targetWindow, payload) {
    if (!targetWindow || !targetWindow.webContents) return;
    targetWindow.webContents.send('doc-dock-preview', payload);
    if (payload && payload.kind === 'example') {
        targetWindow.webContents.send('example-dock-preview', {
            id: payload.id,
            active: payload.active,
        });
    } else if (payload && payload.active === false) {
        targetWindow.webContents.send('example-dock-preview', { id: null, active: false });
    }
}

function openDocTab(kindOrPayload, id) {
    const payload = normalizeDocRequest(kindOrPayload, id);
    if (!payload) return;
    pendingDocTabRequest = payload;
    if (mainWindow && mainWindow.webContents) {
        try {
            clearTimeout(exampleTabRequestTimer);
            exampleTabRequestTimer = setTimeout(() => {
                emitDocTabOpen(mainWindow, payload);
            }, 0);
            return;
        } catch {
            // Fall back to a dedicated window if the tab IPC fails.
        }
    }
    openExampleWindow(payload);
}

function openExampleTab(exampleId) {
    openDocTab('example', exampleId);
}

function openCoursewareTab(coursewareId) {
    openDocTab('courseware', coursewareId);
}

ipcMain.on('open-doc-tab', (_event, payload) => {
    openDocTab(payload);
});

ipcMain.on('open-example-tab', (_event, { id } = {}) => {
    openExampleTab(id);
});

ipcMain.handle('get-pending-doc-tab', () => {
    const pending = pendingDocTabRequest ? { ...pendingDocTabRequest } : null;
    pendingDocTabRequest = null;
    return pending;
});

ipcMain.handle('get-pending-example-tab', () => {
    if (!pendingDocTabRequest || pendingDocTabRequest.kind !== 'example') return null;
    const id = pendingDocTabRequest.id;
    pendingDocTabRequest = null;
    return id;
});

// Standalone docs window for offline markdown docs and lab actions.
function openExampleWindow(kindOrPayload, maybeId) {
    const payload = normalizeDocRequest(kindOrPayload, maybeId);
    if (!payload) return;
    if (exampleWindow) {
        exampleWindow.focus();
        emitDocSelect(exampleWindow, payload);
        return;
    }
    exampleWindowActiveRef = payload;
    exampleWindow = new BrowserWindow({
        width: 1100,
        height: 800,
        title: 'Modular Docs',
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            sandbox: false,
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    exampleWindow.loadFile(path.join(__dirname, 'dashboard', 'examples', 'example_viewer.html'), {
        query: { kind: payload.kind, id: payload.id }
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
        const shouldPreview = overlapRatio >= 0.2 && Boolean(exampleWindowActiveRef && exampleWindowActiveRef.id);
        if (shouldPreview !== exampleDockPreviewActive || exampleDockLastOverlap !== shouldPreview) {
            exampleDockPreviewActive = shouldPreview;
            exampleDockLastOverlap = shouldPreview;
            emitDockPreview(mainWindow, {
                kind: exampleWindowActiveRef ? exampleWindowActiveRef.kind : null,
                id: exampleWindowActiveRef ? exampleWindowActiveRef.id : null,
                active: shouldPreview
            });
        }
    };
    const tryDockOnRelease = () => {
        clearTimeout(exampleDockMoveTimer);
        exampleDockMoveTimer = setTimeout(() => {
            if (!exampleWindow || !mainWindow) return;
            if (!exampleDockLastOverlap || !exampleWindowActiveRef || !exampleWindowActiveRef.id) return;
            if (exampleDockingInProgress) return;
            exampleDockingInProgress = true;
            try {
                if (mainWindow && mainWindow.webContents) {
                    emitDockPreview(mainWindow, {
                        kind: exampleWindowActiveRef.kind,
                        id: exampleWindowActiveRef.id,
                        active: false
                    });
                    emitDocTabOpen(mainWindow, exampleWindowActiveRef);
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
        exampleWindowActiveRef = null;
        exampleDockPreviewActive = false;
        exampleDockLastOverlap = false;
        clearTimeout(exampleDockMoveTimer);
        if (mainWindow && mainWindow.webContents) {
            emitDockPreview(mainWindow, { kind: null, id: null, active: false });
        }
        exampleWindow = null;
    });
}

// Allow renderer tabs to be popped out into a dedicated docs window.
ipcMain.on('undock-doc-tab', (_event, payload = {}) => {
    const request = normalizeDocRequest(payload.kind || 'example', payload.id);
    if (request) openExampleWindow(request);
});
// Keep main process updated with the docs window's active selection for docking.
ipcMain.on('doc-active-ref', (_event, payload) => {
    const request = normalizeDocRequest(payload);
    exampleWindowActiveRef = request;
    if (exampleDockPreviewActive && mainWindow && mainWindow.webContents) {
        emitDockPreview(mainWindow, {
            kind: request ? request.kind : null,
            id: request ? request.id : null,
            active: !!(request && request.id)
        });
    }
});

ipcMain.on('example-active-id', (_event, { id } = {}) => {
    if (!id) {
        exampleWindowActiveRef = null;
        return;
    }
    exampleWindowActiveRef = { kind: 'example', id: String(id) };
    if (exampleDockPreviewActive && mainWindow && mainWindow.webContents) {
        emitDockPreview(mainWindow, {
            kind: 'example',
            id: String(id),
            active: true
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
		const vid = String(port.vendorId || '').toLowerCase();
		const pid = String(port.productId || '').toLowerCase();
		return {
			name: port.path,
			value: port.path,
			path: port.path,
			vendorId: port.vendorId || null,
			productId: port.productId || null,
			manufacturer: port.manufacturer || null,
			serialNumber: port.serialNumber || null,
			isOwntech: vid === '2fe3' && pid === '0100',
		};
	});
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
