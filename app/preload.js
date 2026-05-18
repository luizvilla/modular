const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

function on(channel, handler) {
    if (typeof handler !== 'function') return () => {};
    const wrapped = (_event, ...args) => handler(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
}

function onDocKind(channel, kind, handler) {
    return on(channel, (payload = {}) => {
        if (!payload || payload.kind !== kind) return;
        handler({ id: payload.id });
    });
}

const api = {
    activity: {
        on: (cb) => on('activity', cb),
        onToggle: (cb) => on('activity-toggle', cb),
        getEnabled: () => ipcRenderer.invoke('get-activity-enabled')
    },
    dashboard: {
        openDashboardDialog: () => ipcRenderer.invoke('show-open-dashboard'),
        loadDashboardFromPath: (dashboardPath) => ipcRenderer.invoke('load-dashboard-from-path', { dashboardPath }),
        onLoadDashboardFromPath: (cb) => on('load-dashboard-from-path', cb),
        onMenuLoadDashboard: (cb) => on('menu-load-dashboard', cb),
        onMenuSaveDashboard: (cb) => on('menu-save-dashboard', cb),
        onShowWidgetCategories: (cb) => on('show-widget-categories', cb)
    },
    docs: {
        listReadmes: (baseDir) => ipcRenderer.invoke('docs-list-readmes', { baseDir }),
        readMarkdown: (docPath) => ipcRenderer.invoke('docs-read-markdown', { docPath }),
        openTab: (payload) => ipcRenderer.send('open-doc-tab', payload),
        onOpenTab: (cb) => on('open-doc-tab', cb),
        setActiveTab: (payload) => ipcRenderer.send('doc-active-ref', payload),
        onSelect: (cb) => on('doc-select', cb),
        onDockPreview: (cb) => on('doc-dock-preview', cb),
        undockTab: (payload) => ipcRenderer.send('undock-doc-tab', payload),
        getPendingTab: () => ipcRenderer.invoke('get-pending-doc-tab')
    },
    files: {
        readText: (filePath) => ipcRenderer.invoke('files-read-text', { filePath }),
        listDir: (dirPath) => ipcRenderer.invoke('files-list-dir', { dirPath }),
        writeText: (filePath, content) => ipcRenderer.invoke('files-write-text', { filePath, content }),
        chooseCsvFile: () => ipcRenderer.invoke('choose-csv-file')
    },
    system: {
        openExternal: (url) => ipcRenderer.invoke('open-external-url', { url })
    },
    examples: {
        openExampleTab: (id) => ipcRenderer.send('open-example-tab', { id }),
        onOpenExampleTab: (cb) => on('open-example-tab', cb),
        setActiveExampleId: (id) => ipcRenderer.send('example-active-id', { id }),
        onExampleSelect: (cb) => on('example-select', cb),
        onDockPreview: (cb) => on('example-dock-preview', cb),
        undockDocTab: (id) => ipcRenderer.send('undock-doc-tab', { kind: 'example', id }),
        getPendingExampleTab: () => ipcRenderer.invoke('get-pending-example-tab')
    },
    widgets: {
        // Widget docs tabs can be opened from menus, toolbars, and creation dialogs.
        openDocTab: (type) => ipcRenderer.send('open-widget-doc-tab', { type }),
        onOpenDocTab: (cb) => on('open-widget-doc-tab', cb),
        getPendingDoc: () => ipcRenderer.invoke('get-pending-widget-doc'),
        notifyReady: () => ipcRenderer.send('widget-docs-ready')
    },
    flash: {
        chooseFirmwareFile: () => ipcRenderer.invoke('choose-firmware-file'),
        startFlash: (payload) => ipcRenderer.invoke('start-flash', payload),
        cancelFlash: () => ipcRenderer.send('cancel-flash'),
        startFlashCan: (payload) => ipcRenderer.invoke('start-flash-can', payload),
        cancelFlashCan: () => ipcRenderer.send('cancel-flash-can'),
        onProgress: (cb) => on('flash-progress', cb),
        onComplete: (cb) => on('flash-complete', cb)
    },
    serial: {
        listPorts: () => ipcRenderer.invoke('get-serial-ports'),
        openPort: (payload) => ipcRenderer.invoke('open-serial-port', payload),
        closePort: (path) => ipcRenderer.invoke('close-serial-port', { path }),
        reopenPort: (path) => ipcRenderer.invoke('reopen-serial-port', { path }),
        releasePort: (payload) => ipcRenderer.invoke('release-serial-port', payload),
        isOpen: (path) => ipcRenderer.invoke('is-serial-port-open', { path }),
        write: (path, data) => ipcRenderer.invoke('write-serial-port', { path, data }),
        getBuffer: (path) => ipcRenderer.invoke('get-serial-buffer', { path }),
        getTerminalBuffer: (path) => ipcRenderer.invoke('get-terminal-buffer', { path }),
        getFastDataset: (path) => ipcRenderer.invoke('get-fast-dataset', { path }),
        getFastStatus: (path) => ipcRenderer.invoke('get-fast-frame-status', { path }),
        getHeaders: (path, type) => ipcRenderer.invoke('get-serial-headers', { path, type }),
        setHeaders: (path, headers, type) => ipcRenderer.invoke('set-serial-headers', { path, headers, type }),
        getColors: (path, type) => ipcRenderer.invoke('get-serial-colors', { path, type }),
        setColors: (path, colors, type) => ipcRenderer.invoke('set-serial-colors', { path, colors, type }),
        flush: (path) => ipcRenderer.invoke('flush-serial-buffers', { path }),
        startCsvRecord: (payload) => ipcRenderer.invoke('start-csv-record', payload),
        stopCsvRecord: (path) => ipcRenderer.invoke('stop-csv-record', { path }),
        saveFastCsv: (payload) => ipcRenderer.invoke('save-fast-csv', payload)
    },
    thingsetSerial: {
        detect: (payload) => ipcRenderer.invoke('ts-serial-detect', payload),
        tree: (payload) => ipcRenderer.invoke('ts-serial-tree', payload),
        getValue: (payload) => ipcRenderer.invoke('ts-serial-get-value', payload),
        setValue: (payload) => ipcRenderer.invoke('ts-serial-set-value', payload),
        create: (payload) => ipcRenderer.invoke('ts-serial-create', payload),
        delete: (payload) => ipcRenderer.invoke('ts-serial-delete', payload),
        exec: (payload) => ipcRenderer.invoke('ts-serial-exec', payload)
    },
    can: {
        getInterfaces: () => ipcRenderer.invoke('get-can-interfaces'),
        getThingSetNodes: () => ipcRenderer.invoke('get-thingset-nodes'),
        open: (payload) => ipcRenderer.invoke('can-open', payload),
        close: (payload) => ipcRenderer.invoke('can-close', payload),
        scanNodes: (payload) => ipcRenderer.invoke('can-scan-nodes', payload),
        buildTrees: (payload) => ipcRenderer.invoke('can-build-trees', payload),
        aggregateStart: (payload) => ipcRenderer.invoke('can-aggregate-start', payload),
        aggregateStop: (payload) => ipcRenderer.invoke('can-aggregate-stop', payload),
        aggregateSetDebug: (payload) => ipcRenderer.invoke('can-aggregate-set-debug', payload),
        aggregateSnapshot: (payload) => ipcRenderer.invoke('can-aggregate-snapshot', payload),
        setupLinux: () => ipcRenderer.invoke('can-setup-linux'),
        isUp: (payload) => ipcRenderer.invoke('can-is-up', payload)
    },
    thingset: {
        get: (payload) => ipcRenderer.invoke('ts-get', payload),
        fetch: (payload) => ipcRenderer.invoke('ts-fetch', payload),
        update: (payload) => ipcRenderer.invoke('ts-update', payload),
        create: (payload) => ipcRenderer.invoke('ts-create', payload),
        delete: (payload) => ipcRenderer.invoke('ts-delete', payload),
        exec: (payload) => ipcRenderer.invoke('ts-exec', payload),
        pathsForIds: (payload) => ipcRenderer.invoke('ts-paths-for-ids', payload),
        idsForPaths: (payload) => ipcRenderer.invoke('ts-ids-for-paths', payload)
    },
    paths: {
        dirname: (input) => path.dirname(input),
        resolve: (...parts) => path.resolve(...parts),
        join: (...parts) => path.join(...parts),
        relative: (from, to) => path.relative(from, to),
        isAbsolute: (input) => path.isAbsolute(input),
        sep: path.sep,
        cwd: () => process.cwd(),
        appDir: () => __dirname,
        toFileUrl: (input) => pathToFileURL(input).toString()
    },
    logger: {
        log: (level, args) => ipcRenderer.send('renderer-log', { level, args })
    },
    diagnostics: {
        captureSnapshot: () => ipcRenderer.invoke('diagnostics-capture-snapshot')
    },
    extensions: {
        list: () => ipcRenderer.invoke('extensions-list'),
        isEnabled: (id) => ipcRenderer.invoke('extensions-is-enabled', { id }),
        getBootstrap: () => ipcRenderer.invoke('extensions-get-bootstrap'),
        manager: {
            list: () => ipcRenderer.invoke('extensions-manager-list'),
            install: (bundlePath) => ipcRenderer.invoke('extensions-manager-install', { bundlePath }),
            uninstall: (id) => ipcRenderer.invoke('extensions-manager-uninstall', { id }),
            enable: (id) => ipcRenderer.invoke('extensions-manager-enable', { id }),
            disable: (id) => ipcRenderer.invoke('extensions-manager-disable', { id }),
            chooseBundle: () => ipcRenderer.invoke('extensions-choose-bundle'),
            onOpen: (cb) => on('open-extension-manager', cb),
        }
    }
};

const isMock = process.env.MOCK_HW === '1';
const mockNoPorts = process.env.MOCK_NO_PORTS === '1';
const mockNoExamples = process.env.MOCK_NO_EXAMPLES === '1';
const mockFwMissing = process.env.MOCK_FW_MISSING === '1';
const mockIpcUnavailable = process.env.MOCK_IPC_UNAVAILABLE === '1';
// Feature flag: default enabled in dev, disabled in packaged builds via main.js.
const enableThingset = process.env.ENABLE_THINGSET === undefined
    ? true
    : (process.env.ENABLE_THINGSET === '1' || process.env.ENABLE_THINGSET === 'true');

api.flags = { thingset: enableThingset };

function createEmitter() {
    const listeners = new Map();
    return {
        on(channel, cb) {
            if (typeof cb !== 'function') return () => {};
            if (!listeners.has(channel)) listeners.set(channel, new Set());
            listeners.get(channel).add(cb);
            return () => listeners.get(channel).delete(cb);
        },
        emit(channel, payload) {
            const set = listeners.get(channel);
            if (!set) return;
            for (const cb of set) {
                try { cb(payload); } catch {}
            }
        }
    };
}

if (isMock) {
    const emitter = createEmitter();
    const mockPorts = mockNoPorts ? [] : [
        { name: 'COM_MOCK', value: 'COM_MOCK', path: 'COM_MOCK', vendorId: null, productId: null, manufacturer: null, serialNumber: null, isOwntech: false },
        { name: 'COM_MOCK_2', value: 'COM_MOCK_2', path: 'COM_MOCK_2', vendorId: null, productId: null, manufacturer: null, serialNumber: null, isOwntech: false }
    ];
    const mockSerial = {
        openPorts: new Set(),
        buffers: new Map(),
        terminals: new Map(),
        headers: new Map(),
        colors: new Map(),
        fastDatasets: new Map(),
        fastStatus: new Map()
    };
    const mockFlash = { timer: null, cancel: false };

    function bufferKey(pathStr, type) {
        return `${pathStr || ''}||${type || 'serialport_datasource'}`;
    }

    function ensureArray(map, key, init) {
        if (!map.has(key)) map.set(key, init);
        return map.get(key);
    }

    function addTerminalLine(pathStr, line) {
        const arr = ensureArray(mockSerial.terminals, pathStr, []);
        arr.push(line);
        if (arr.length > 200) arr.shift();
    }

    function getSerialSample(pathStr) {
        const arr = ensureArray(mockSerial.buffers, pathStr, []);
        const next = [Math.random() * 5, Math.random() * 5, Math.random() * 5].map(v => Number(v.toFixed(2)));
        arr.push(next);
        if (arr.length > 1000) arr.shift();
        return arr.slice(-50);
    }

    function makeFastDataset() {
        return {
            timestamps: [0, 1, 2, 3],
            series: [
                [1.1, 1.2, 1.3, 1.4],
                [2.1, 2.2, 2.3, 2.4]
            ]
        };
    }

    function getFastDataset(pathStr) {
        if (!mockSerial.fastDatasets.has(pathStr)) {
            const data = makeFastDataset();
            data.capturedAt = Date.now();
            mockSerial.fastDatasets.set(pathStr, data);
        }
        return mockSerial.fastDatasets.get(pathStr);
    }

    function getFastStatus(pathStr) {
        return mockSerial.fastStatus.get(pathStr) || {
            state: 'idle',
            message: 'No acquisition yet',
            updatedAt: Date.now(),
            completedAt: null,
            datasetPoints: 0
        };
    }

    function startMockFlash() {
        mockFlash.cancel = false;
        const steps = [10, 25, 50, 75, 100];
        let idx = 0;
        const tick = () => {
            if (mockFlash.cancel) return;
            const pct = steps[idx++];
            emitter.emit('flash-progress', `${pct}%`);
            emitter.emit('activity', { id: 'dfu:serial', state: 'progress', detail: `${pct}%` });
            if (pct >= 100) {
                emitter.emit('flash-complete');
                emitter.emit('activity', { id: 'dfu:serial', state: 'done', label: 'Serial DFU complete' });
                return;
            }
            mockFlash.timer = setTimeout(tick, 200);
        };
        emitter.emit('activity', { id: 'dfu:serial', state: 'start', label: 'Serial DFU' });
        mockFlash.timer = setTimeout(tick, 200);
    }

    api.activity.on = (cb) => emitter.on('activity', cb);
    api.flash.onProgress = (cb) => emitter.on('flash-progress', cb);
    api.flash.onComplete = (cb) => emitter.on('flash-complete', cb);

    if (mockNoExamples) {
        api.docs.listReadmes = async () => [];
    }

    if (process.env.MOCK_DASHBOARD_PATH) {
        const dashPath = process.env.MOCK_DASHBOARD_PATH;
        api.dashboard.openDashboardDialog = async () => dashPath;
    }

    if (mockIpcUnavailable) {
        api.serial = null;
        api.flash = null;
        api.can = null;
        api.thingset = null;
        api.thingsetSerial = null;
        api.system = null;
        api.diagnostics = null;
    } else {
        api.system = {
            openExternal: async () => ({ ok: true })
        };
        api.diagnostics = {
            captureSnapshot: async () => ({
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
                    memory: process.memoryUsage()
                },
                renderer: {
                    webContentsId: null,
                    url: null,
                    processMemory: null
                },
                windows: {
                    main: null,
                    example: null
                },
                state: {
                    openPorts: mockSerial.openPorts.size,
                    activeRecordings: 0,
                    serialLocks: 0,
                    portSettings: 0,
                    pendingReopens: 0,
                    serialBuffers: {
                        entries: mockSerial.buffers.size,
                        totalItems: Array.from(mockSerial.buffers.values()).reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0),
                        maxItems: Array.from(mockSerial.buffers.values()).reduce((max, value) => Math.max(max, Array.isArray(value) ? value.length : 0), 0)
                    },
                    terminalBuffers: {
                        entries: mockSerial.terminals.size,
                        totalItems: Array.from(mockSerial.terminals.values()).reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0),
                        maxItems: Array.from(mockSerial.terminals.values()).reduce((max, value) => Math.max(max, Array.isArray(value) ? value.length : 0), 0)
                    },
                    headerBuffers: { entries: mockSerial.headers.size },
                    colorBuffers: { entries: mockSerial.colors.size },
                    fastStates: { entries: 0 },
                    fastBuffers: {
                        entries: mockSerial.fastDatasets.size,
                        totalPoints: Array.from(mockSerial.fastDatasets.values()).reduce((sum, value) => sum + (Array.isArray(value?.timestamps) ? value.timestamps.length : 0), 0),
                        maxPoints: Array.from(mockSerial.fastDatasets.values()).reduce((max, value) => Math.max(max, Array.isArray(value?.timestamps) ? value.timestamps.length : 0), 0)
                    },
                    fastStatus: { entries: mockSerial.fastStatus.size }
                },
                appMetrics: []
            })
        };
        api.files = {
            ...(api.files || {}),
            chooseCsvFile: async () => (
                process.env.MOCK_CSV_PATH
                || path.join(process.cwd(), 'tests', 'fixtures', 'fast_frame_plot.csv')
            )
        };
        api.serial = {
            listPorts: async () => mockPorts,
            openPort: async ({ path: pathStr, type }) => {
                if (pathStr) {
                    mockSerial.openPorts.add(pathStr);
                    if (type === 'fast_frame_datasource') {
                        mockSerial.fastStatus.set(pathStr, {
                            state: 'idle',
                            message: 'Fast frame port ready',
                            updatedAt: Date.now(),
                            completedAt: null,
                            datasetPoints: 0
                        });
                    }
                }
                return 'opened';
            },
            closePort: async (pathStr) => { if (pathStr) mockSerial.openPorts.delete(pathStr); return 'closed'; },
            reopenPort: async (pathStr) => { if (pathStr) mockSerial.openPorts.add(pathStr); return 'reopened'; },
            releasePort: async () => 'released',
            isOpen: async (pathStr) => mockSerial.openPorts.has(pathStr),
            write: async (pathStr, data) => {
                addTerminalLine(pathStr, String(data));
                if (pathStr && mockSerial.openPorts.has(pathStr)) {
                    mockSerial.fastStatus.set(pathStr, {
                        state: 'awaiting_record',
                        message: 'Trigger sent, waiting for fast frame',
                        updatedAt: Date.now(),
                        completedAt: null,
                        datasetPoints: 0
                    });
                    setTimeout(() => {
                        const dataset = makeFastDataset();
                        dataset.capturedAt = Date.now();
                        mockSerial.fastDatasets.set(pathStr, dataset);
                        mockSerial.fastStatus.set(pathStr, {
                            state: 'complete',
                            message: 'Fast frame ready',
                            updatedAt: Date.now(),
                            completedAt: dataset.capturedAt,
                            datasetPoints: dataset.timestamps.length
                        });
                    }, 150);
                }
                return 'ok';
            },
            getBuffer: async (pathStr) => getSerialSample(pathStr),
            getTerminalBuffer: async (pathStr) => ensureArray(mockSerial.terminals, pathStr, []).slice(-50),
            getFastDataset: async (pathStr) => getFastDataset(pathStr),
            getFastStatus: async (pathStr) => getFastStatus(pathStr),
            getHeaders: async (pathStr, type) => ensureArray(mockSerial.headers, bufferKey(pathStr, type), ['ch1', 'ch2', 'ch3']),
            setHeaders: async (pathStr, headers, type) => { mockSerial.headers.set(bufferKey(pathStr, type), headers || []); return 'ok'; },
            getColors: async (pathStr, type) => ensureArray(mockSerial.colors, bufferKey(pathStr, type), ['#ff0000', '#00ff00', '#0000ff']),
            setColors: async (pathStr, colors, type) => { mockSerial.colors.set(bufferKey(pathStr, type), colors || []); return 'ok'; },
            flush: async (pathStr) => { mockSerial.buffers.delete(pathStr); mockSerial.terminals.delete(pathStr); return 'flushed'; },
            startCsvRecord: async () => 'started',
            stopCsvRecord: async () => 'stopped',
            saveFastCsv: async ({ path: pathStr, filePath, useTimestampedFileName }) => {
                const status = getFastStatus(pathStr);
                const resolvedFilePath = useTimestampedFileName
                    ? `${new Date().toISOString().slice(0, 19).replace(/:/g, '-').replace('T', '_')}-${path.basename(filePath || 'fast_frame.csv', path.extname(filePath || 'fast_frame.csv'))}${path.extname(filePath || 'fast_frame.csv') || '.csv'}`
                    : (filePath || 'fast_frame.csv');
                mockSerial.fastStatus.set(pathStr, {
                    ...status,
                    state: 'saved',
                    message: 'Fast frame saved to CSV',
                    updatedAt: Date.now(),
                    filePath: resolvedFilePath
                });
                return { status: 'saved', filePath: resolvedFilePath };
            }
        };

        api.flash = {
            chooseFirmwareFile: async () => {
                if (mockFwMissing) return null;
                // Keep mock mode returning a file path while avoiding the AC_client_server example bias.
                return path.join(__dirname, 'dashboard', 'binaries', 'blinky', 'blinky.mcuboot.bin');
            },
            startFlash: async ({ firmwarePath }) => {
                if (mockFwMissing || !firmwarePath) throw new Error('Missing firmware file');
                startMockFlash();
                return 'started';
            },
            cancelFlash: () => { mockFlash.cancel = true; emitter.emit('flash-complete'); },
            startFlashCan: async () => { startMockFlash(); return 'started'; },
            cancelFlashCan: () => { mockFlash.cancel = true; emitter.emit('flash-complete'); },
            onProgress: (cb) => emitter.on('flash-progress', cb),
            onComplete: (cb) => emitter.on('flash-complete', cb)
        };

        api.can = {
            getInterfaces: async () => [{ name: 'can0', value: 'can0' }],
            getThingSetNodes: async () => [
                { name: '0xA0 - MOCK_NODE', value: 160 },
                { name: '0xA1 - MOCK_NODE_2', value: 161 }
            ],
            open: async () => 'opened',
            close: async () => 'closed',
            scanNodes: async () => ({ nodes: { 160: 'MOCK_NODE' } }),
            buildTrees: async () => ({ written: [{ addr: 160, out: 'mock' }] }),
            aggregateStart: async () => 'ok',
            aggregateStop: async () => 'stopped',
            aggregateSetDebug: async () => 'ok',
            aggregateSnapshot: async ({ channel }) => ({
                channel,
                nodes: {
                    '0xA0': { flat: { 'Config/Leg/0/rV': 1.23, 'Config/Leg/0/rI': 0.45 } }
                }
            }),
            setupLinux: async () => 'ok',
            isUp: async () => ({ exists: true, up: true })
        };

        api.thingset = {
            get: async () => ({ status: 0x80, payload: {} }),
            fetch: async () => ({ status: 0x80, payload: {} }),
            update: async () => ({ status: 0x80 }),
            create: async () => ({ status: 0x80 }),
            delete: async () => ({ status: 0x80 }),
            exec: async () => ({ status: 0x80 }),
            pathsForIds: async () => ({ status: 0x80, payload: [] }),
            idsForPaths: async () => ({ status: 0x80, payload: [1] })
        };

        api.thingsetSerial = {
            detect: async () => ({ port: 'COM_MOCK', node_uid: 'MOCK_UID', node_name: 'Mock' }),
            tree: async () => ({
                port: 'COM_MOCK',
                node_uid: 'MOCK_UID',
                node_name: 'Mock',
                address_hex: '0xA0',
                root: {
                    path: '/',
                    values: { rStatus: 1 },
                    children: {
                        Config: {
                            path: '/Config',
                            values: { rMode: 1, wMode: 0 }
                        }
                    }
                }
            }),
            getValue: async () => ({ ok: true, value: 1 }),
            setValue: async () => ({ ok: true }),
            create: async () => ({ ok: true }),
            delete: async () => ({ ok: true }),
            exec: async () => ({ ok: true })
        };
    }
}

// Extension manager mock — list uses the real IPC (extensions aren't hardware);
// install/uninstall/enable/disable are no-ops since state changes require real disk.
if (isMock) {
    api.extensions.manager = {
        list: () => ipcRenderer.invoke('extensions-manager-list'),
        install: async () => ({ ok: false, error: 'Not available in mock mode' }),
        uninstall: async () => ({ ok: false, error: 'Not available in mock mode' }),
        enable: async () => ({ ok: false, error: 'Not available in mock mode' }),
        disable: async () => ({ ok: false, error: 'Not available in mock mode' }),
        chooseBundle: async () => null,
        onOpen: () => () => {},
    };
}

// If ThingSet is disabled, hide those APIs so the UI matches shipped builds.
if (!enableThingset) {
    api.thingset = null;
    api.thingsetSerial = null;
    if (api.can && typeof api.can.getThingSetNodes === 'function') {
        api.can.getThingSetNodes = async () => [];
    }
}

if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('api', api);
} else {
    // Legacy path while renderer still relies on nodeIntegration.
    window.api = api;
}
