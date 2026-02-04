const { contextBridge, ipcRenderer } = require('electron');

function on(channel, handler) {
    if (typeof handler !== 'function') return () => {};
    const wrapped = (_event, ...args) => handler(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
}

const api = {
    activity: {
        on: (cb) => on('activity', cb)
    },
    dashboard: {
        openDashboardDialog: () => ipcRenderer.invoke('show-open-dashboard'),
        loadDashboardFromPath: (dashboardPath) => ipcRenderer.invoke('load-dashboard-from-path', { dashboardPath }),
        onMenuLoadDashboard: (cb) => on('menu-load-dashboard', cb),
        onMenuSaveDashboard: (cb) => on('menu-save-dashboard', cb)
    },
    examples: {
        openExampleTab: (id) => ipcRenderer.send('open-example-tab', { id }),
        onOpenExampleTab: (cb) => on('open-example-tab', cb),
        setActiveExampleId: (id) => ipcRenderer.send('example-active-id', { id }),
        onExampleSelect: (cb) => on('example-select', cb),
        onDockPreview: (cb) => on('example-dock-preview', cb),
        undockDocTab: (id) => ipcRenderer.send('undock-doc-tab', { id }),
        getPendingExampleTab: () => ipcRenderer.invoke('get-pending-example-tab')
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
    logger: {
        log: (level, args) => ipcRenderer.send('renderer-log', { level, args })
    }
};

if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('api', api);
} else {
    // Legacy path while renderer still relies on nodeIntegration.
    window.api = api;
}
