module.exports = function registerOwntechExtension(context) {
    if (!context || typeof context.registerManifestContribution !== 'function') {
        throw new Error('OwnTech extension requires registerManifestContribution()');
    }
    context.registerManifestContribution();

    const { ipcMain } = context;
    if (!ipcMain) return; // Not in main-process context (e.g., unit tests)

    // Lazy-loaded (mirrors thingset/main.js): scope_serial.js pulls in the
    // 'serialport' native module, only needed once this extension is
    // actually active in a real Electron main process.
    const { ScopeSerialLink } = require('./scope_serial');
    // Shared with the ThingSet extension: the board's shell (if02) stops
    // answering while this port streams a capture, so both queue per board.
    const boardLock = require('../../js/serial_board_lock');

    function emit(evt) {
        if (typeof context.emitActivity === 'function') context.emitActivity(evt);
    }

    // Owned entirely by this extension -- deliberately separate from the
    // core `openPorts` map and the ThingSet datasource's port, since if00
    // (this scope side-channel) and if02 (the ThingSet shell) are always
    // different OS device paths on the same board and never contend for
    // the same handle.
    //
    // No idle-timeout eviction here (M7 follow-up, decided rather than
    // deferred): this mirrors thingset/main.js's canBuses/tsClients, which
    // have never had one either -- every port/link pool in this codebase
    // stays open until its owner explicitly closes it (widget dispose, an
    // explicit close IPC, or app shutdown), and there's no observed
    // port-exhaustion problem motivating a change to that pattern here.
    // Revisit only if one actually shows up, and treat it as shared debt
    // across all these pools together, not OwnTech-specific.
    const scopeLinks = new Map(); // path -> ScopeSerialLink

    async function getOrOpenLink(port, baudRate) {
        const existing = scopeLinks.get(port);
        if (existing) return existing;
        const link = new ScopeSerialLink({ path: port, baudRate });
        await link.open();
        scopeLinks.set(port, link);
        return link;
    }

    async function closeLink(port) {
        const link = scopeLinks.get(port);
        if (!link) return;
        scopeLinks.delete(port);
        try { await link.close(); } catch (e) { /* ignore */ }
    }

    ipcMain.handle('owntech-scope-probe', async (_event, { port, baudRate = 115200 } = {}) => {
        if (!port) throw new Error('port required');
        emit({ id: `scope:${port}:probe`, title: port, state: 'start', label: 'OwnTech scope probe' });
        try {
            await boardLock.runExclusiveOnBoard(port, async () => {
                const link = await getOrOpenLink(port, baudRate);
                await link.probe();
            });
            emit({ id: `scope:${port}:probe`, title: port, state: 'done', label: 'OwnTech scope probe' });
            return { ok: true, port };
        } catch (err) {
            await closeLink(port);
            emit({ id: `scope:${port}:probe`, title: port, state: 'error', label: 'OwnTech scope probe', detail: err?.message || String(err) });
            throw err;
        }
    });

    ipcMain.handle('owntech-scope-download', async (event, { port, baudRate = 115200, timeoutMs = 25000 } = {}) => {
        if (!port) throw new Error('port required');
        emit({ id: `scope:${port}:download`, title: port, state: 'start', label: 'OwnTech scope download' });
        try {
            const result = await boardLock.runExclusiveOnBoard(port, async () => (await getOrOpenLink(port, baudRate)).download({
                timeoutMs,
                onProgress: (progress) => {
                    try { event.sender.send('owntech-scope-progress', { port, ...progress }); } catch (e) { /* window may be closing */ }
                },
            }));
            emit({ id: `scope:${port}:download`, title: port, state: 'done', label: 'OwnTech scope download' });
            return result;
        } catch (err) {
            // A failed download likely means the link is out of sync with the
            // protocol's tiny state machine -- drop it so the next attempt
            // reopens and re-probes cleanly instead of retrying mid-record.
            await closeLink(port);
            emit({ id: `scope:${port}:download`, title: port, state: 'error', label: 'OwnTech scope download', detail: err?.message || String(err) });
            throw err;
        }
    });

    ipcMain.handle('owntech-scope-close', async (_event, { port } = {}) => {
        if (!port) return { ok: true };
        await closeLink(port);
        return { ok: true };
    });
};
