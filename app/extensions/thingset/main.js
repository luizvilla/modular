const nodePath = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { SerialPort } = require('serialport');

module.exports = function registerThingSetExtension(context) {
    context.registerManifestContribution();

    const { ipcMain, app } = context;
    if (!ipcMain || !app) return; // Not in main-process context (e.g., unit tests)

    // Lazy-load CAN/ThingSet runtime modules — these are only needed when the extension is active.
    const { createBus } = require('../../js/can_adapter');
    const { ThingSetCAN } = require('../../js/thingset_bin');
    const { scanNodes: scanCanNodes } = require('../../js/scan');
    const { CanBroadcastAggregator } = require('../../js/can_broadcast_aggregator');
    const { exploreId } = require('../../js/query_nodes');
    const { flashCanFirmware } = require('../../js/thingset_dfu_can');
    const { ThingSetSerialShell } = require('../../js/thingset_serial_shell');

    // Internal CAN state — owned entirely by this extension.
    const canBuses = new Map();
    const tsClients = new Map();
    const canAggregators = new Map();
    let canFlashAbortController = null;

    // Proxy helpers — populated by main.js after buildExtensionRuntime returns.
    function emit(evt) {
        if (typeof context.emitActivity === 'function') context.emitActivity(evt);
    }
    function getOpenPort(portPath) {
        return (context.openPorts && context.openPorts.get(portPath)) || null;
    }

    // -------------------------------------------------------------------------
    // Storage: thingset runtime data lives in userData, not the repo root.
    // -------------------------------------------------------------------------
    function getThingsetDir() {
        const userData = app.getPath('userData');
        const dir = nodePath.join(userData, 'extensions', 'thingset');
        fs.mkdirSync(dir, { recursive: true });
        // One-time migration from old repo-root location.
        const legacy = nodePath.join(process.cwd(), 'thingset');
        if (fs.existsSync(legacy)) {
            try {
                for (const name of fs.readdirSync(legacy)) {
                    const src = nodePath.join(legacy, name);
                    const dst = nodePath.join(dir, name);
                    if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
                }
            } catch {}
        }
        return dir;
    }

    // -------------------------------------------------------------------------
    // Serial candidate helpers (used by ts-serial-detect)
    // -------------------------------------------------------------------------
    function orderSerialCandidates(list) {
        const preferred = [];
        const others = [];
        const preferRe = /(ttyACM|ttyUSB|usbserial|usbmodem|cu\.usb|COM\d+)/i;
        for (const entry of list) {
            const p = String(entry || '');
            if (!p) continue;
            if (preferRe.test(p)) preferred.push(p);
            else others.push(p);
        }
        return preferred.concat(others);
    }

    async function collectSerialCandidates(explicitPort = null) {
        if (explicitPort) return [explicitPort];
        try {
            const ports = await SerialPort.list();
            if (!ports || !ports.length) return [];
            return orderSerialCandidates(ports.map((p) => p?.path).filter(Boolean));
        } catch (err) {
            console.warn('Failed to enumerate serial ports for ThingSet detect:', err?.message || err);
            return [];
        }
    }

    function coerceOutputValue(raw) {
        if (raw === null || raw === undefined) return raw;
        if (typeof raw === 'string') {
            const txt = raw.trim();
            if (!txt) return '';
            if (/^(true|false|null)$/i.test(txt)) {
                try { return JSON.parse(txt.toLowerCase()); } catch { return txt; }
            }
            if (
                (txt.startsWith('{') && txt.endsWith('}')) ||
                (txt.startsWith('[') && txt.endsWith(']')) ||
                (txt.startsWith('"') && txt.endsWith('"'))
            ) {
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

    // -------------------------------------------------------------------------
    // ThingSet serial detect
    // -------------------------------------------------------------------------
    ipcMain.handle('ts-serial-detect', async (_event, { port = null, baudRate = 115200, usePrefix = false, verbose = false } = {}) => {
        const candidates = await collectSerialCandidates(port);
        if (!candidates.length) throw new Error('No serial ports found to probe for ThingSet shell');
        const attempts = [];
        const isVerbose = Boolean(verbose) || process.env.TS_SERIAL_DEBUG === '1';
        for (const candidate of candidates) {
            let shell = null;
            try {
                const existingPort = getOpenPort(candidate);
                shell = new ThingSetSerialShell({ path: candidate, baudRate, usePrefix, verbose: isVerbose, existingPort });
                await shell.open();
                await shell.enterThingSet();
                if (!shell.probeSucceeded()) throw new Error('ThingSet prompt not detected');
                const nodeUid = await shell.readNodeUid().catch(() => null);
                const nodeName = await shell.readNodeName().catch(() => null);
                const nodeAddr = await shell.readNodeAddr().catch(() => null);
                const addressHex = Number.isInteger(nodeAddr) ? `0x${nodeAddr.toString(16).toUpperCase().padStart(2, '0')}` : null;
                emit({ id: `serial:${candidate}:detect`, title: candidate, state: 'done', label: 'ThingSet serial detect', detail: nodeUid || addressHex || 'ok' });
                return { port: candidate, baudRate, node_uid: nodeUid, node_name: nodeName, node_addr: nodeAddr, address_hex: addressHex, command_prefix: shell.getCommandPrefix() };
            } catch (err) {
                attempts.push({ port: candidate, error: err?.message || String(err) });
                emit({ id: `serial:${candidate}:detect`, title: candidate, state: 'error', label: 'ThingSet serial detect', detail: err?.message || String(err) });
            } finally {
                if (shell) { try { await shell.close(); } catch {} }
            }
        }
        const detail = attempts.map((t) => `${t.port}: ${t.error}`).join('; ');
        throw new Error(detail || 'ThingSet serial shell not found');
    });

    // -------------------------------------------------------------------------
    // ThingSet serial tree
    // -------------------------------------------------------------------------
    ipcMain.handle('ts-serial-tree', async (_event, { port, baudRate = 115200, usePrefix = false, verbose = false } = {}) => {
        if (!port) throw new Error('port required');
        emit({ id: `serial:${port}:tree`, title: port, state: 'start', label: 'ThingSet serial tree' });
        const existingPort = getOpenPort(port);
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
                    const dir = getThingsetDir();
                    const hex = nodeAddr.toString(16).toUpperCase().padStart(2, '0');
                    const payload = { node_uid: nodeUid || null, address: `0x${hex}`, root };
                    if (nodeName) payload.node_name = nodeName;
                    const treePath = nodePath.join(dir, `node_${hex}_tree.json`);
                    await fs.promises.writeFile(treePath, JSON.stringify(payload, null, 2), 'utf8');
                    savedTreePath = treePath;
                    if (nodeUid) {
                        const mappingPath = nodePath.join(dir, 'nodes.json');
                        let mapping = {};
                        try { mapping = JSON.parse(await fs.promises.readFile(mappingPath, 'utf8')) || {}; } catch {}
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
            emit({ id: `serial:${port}:tree`, title: port, state: 'done', label: 'ThingSet serial tree', detail: addressHex || 'n/a' });
            return { node_uid: nodeUid, node_name: nodeName, address_hex: addressHex, node_addr: nodeAddr, root, saved_tree_path: savedTreePath };
        } catch (err) {
            emit({ id: `serial:${port}:tree`, title: port, state: 'error', label: 'ThingSet serial tree', detail: err?.message || String(err) });
            throw err;
        } finally {
            try { await shell.close(); } catch {}
        }
    });

    // -------------------------------------------------------------------------
    // ThingSet serial value operations
    // -------------------------------------------------------------------------
    ipcMain.handle('ts-serial-set-value', async (_event, { port, path: targetPath, value, baudRate = 115200, usePrefix = false, verbose = false } = {}) => {
        if (!port) throw new Error('port required');
        if (!targetPath) throw new Error('path required');
        const shell = new ThingSetSerialShell({ path: port, baudRate, usePrefix, verbose: Boolean(verbose) || process.env.TS_SERIAL_DEBUG === '1', existingPort: getOpenPort(port) });
        try {
            await shell.open();
            await shell.enterThingSet();
            const coerced = coerceOutputValue(value);
            const resp = await shell.setValue(targetPath, coerced);
            let readBack = null;
            try { const read = await shell.getValue(targetPath); if (read.ok) readBack = read.value; } catch {}
            return { ok: resp.ok, raw: resp.raw, readBack };
        } finally { try { await shell.close(); } catch {} }
    });

    ipcMain.handle('ts-serial-get-value', async (_event, { port, path: targetPath, baudRate = 115200, usePrefix = false, verbose = false } = {}) => {
        if (!port) throw new Error('port required');
        if (!targetPath) throw new Error('path required');
        const shell = new ThingSetSerialShell({ path: port, baudRate, usePrefix, verbose: Boolean(verbose) || process.env.TS_SERIAL_DEBUG === '1', existingPort: getOpenPort(port) });
        try {
            await shell.open();
            await shell.enterThingSet();
            const resp = await shell.getValue(targetPath);
            return { ok: resp.ok, value: resp.value };
        } finally { try { await shell.close(); } catch {} }
    });

    ipcMain.handle('ts-serial-create', async (_event, { port, path: targetPath, value = undefined, baudRate = 115200, usePrefix = false, verbose = false } = {}) => {
        if (!port) throw new Error('port required');
        if (!targetPath) throw new Error('path required');
        const shell = new ThingSetSerialShell({ path: port, baudRate, usePrefix, verbose: Boolean(verbose) || process.env.TS_SERIAL_DEBUG === '1', existingPort: getOpenPort(port) });
        try {
            await shell.open();
            await shell.enterThingSet();
            const resp = await shell.create(targetPath, value);
            return { status: resp.statusHex, ok: shell.isSuccessStatus(resp.statusHex), raw: resp.text, json: resp.json };
        } finally { try { await shell.close(); } catch {} }
    });

    ipcMain.handle('ts-serial-delete', async (_event, { port, path: targetPath, value = undefined, baudRate = 115200, usePrefix = false, verbose = false } = {}) => {
        if (!port) throw new Error('port required');
        if (!targetPath) throw new Error('path required');
        const shell = new ThingSetSerialShell({ path: port, baudRate, usePrefix, verbose: Boolean(verbose) || process.env.TS_SERIAL_DEBUG === '1', existingPort: getOpenPort(port) });
        try {
            await shell.open();
            await shell.enterThingSet();
            const resp = await shell.deleteValue(targetPath, value);
            return { status: resp.statusHex, ok: shell.isSuccessStatus(resp.statusHex), raw: resp.text, json: resp.json };
        } finally { try { await shell.close(); } catch {} }
    });

    ipcMain.handle('ts-serial-exec', async (_event, { port, path: targetPath, args = undefined, baudRate = 115200, usePrefix = false, verbose = false } = {}) => {
        if (!port) throw new Error('port required');
        if (!targetPath) throw new Error('path required');
        const shell = new ThingSetSerialShell({ path: port, baudRate, usePrefix, verbose: Boolean(verbose) || process.env.TS_SERIAL_DEBUG === '1', existingPort: getOpenPort(port) });
        try {
            await shell.open();
            await shell.enterThingSet();
            const resp = await shell.exec(targetPath, args);
            return { status: resp.statusHex, ok: shell.isSuccessStatus(resp.statusHex), raw: resp.text, json: resp.json };
        } finally { try { await shell.close(); } catch {} }
    });

    // -------------------------------------------------------------------------
    // CAN firmware flash
    // -------------------------------------------------------------------------
    ipcMain.handle('start-flash-can', async (event, { channel, filename, target = 0xA0, source = 0x00, targetBus = 0x0, sourceBus = 0x0 }) => {
        if (canFlashAbortController) {
            try { canFlashAbortController.abort(); } catch {}
            canFlashAbortController = null;
        }
        canFlashAbortController = new AbortController();
        const signal = canFlashAbortController.signal;
        (async () => {
            try {
                await flashCanFirmware({ filename, channel, target, source, targetBus, sourceBus, signal }, (msg) => {
                    event.sender.send('flash-progress', String(msg));
                });
            } catch (err) {
                event.sender.send('flash-progress', `Error: ${err?.message ? err.message : String(err)}`);
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

    // -------------------------------------------------------------------------
    // CAN interface discovery
    // -------------------------------------------------------------------------
    ipcMain.handle('get-can-interfaces', async () => {
        try {
            const base = '/sys/class/net';
            const entries = await fs.promises.readdir(base, { withFileTypes: true });
            const names = [];
            for (const e of entries) {
                if (!e.isDirectory()) continue;
                const n = e.name;
                if (!/^v?sl?can\d+/i.test(n) && !/^can\d+/i.test(n)) continue;
                names.push(n);
            }
            if (names.length === 0) {
                const ifs = Object.keys(require('os').networkInterfaces());
                names.push(...ifs.filter((n) => /^v?sl?can\d+/i.test(n) || /^can\d+/i.test(n)));
            }
            if (names.length === 0) names.push('can0');
            return names.map((n) => ({ name: n, value: n }));
        } catch {
            return [{ name: 'can0', value: 'can0' }];
        }
    });

    // -------------------------------------------------------------------------
    // ThingSet nodes persistence
    // -------------------------------------------------------------------------
    ipcMain.handle('get-thingset-nodes', async () => {
        emit({ id: 'can:nodes:list', title: 'ThingSet', state: 'start', label: 'Load discovered nodes' });
        try {
            const file = nodePath.join(getThingsetDir(), 'nodes.json');
            const text = await fs.promises.readFile(file, 'utf8');
            const obj = JSON.parse(text || '{}');
            const out = [];
            for (const [k, v] of Object.entries(obj)) {
                const addr = parseInt(k, 10);
                const hex = '0x' + addr.toString(16).toUpperCase().padStart(2, '0');
                out.push({ name: `${hex} (${v})`, value: addr });
            }
            out.sort((a, b) => a.value - b.value);
            emit({ id: 'can:nodes:list', title: 'ThingSet', state: 'done', label: 'Load discovered nodes', detail: `${out.length} nodes` });
            return out;
        } catch {
            emit({ id: 'can:nodes:list', title: 'ThingSet', state: 'error', label: 'Load discovered nodes', detail: 'not found' });
            return [];
        }
    });

    // -------------------------------------------------------------------------
    // CAN bus lifecycle
    // -------------------------------------------------------------------------
    ipcMain.handle('can-open', async (_event, { channel = 'can0', sourceAddr = 0xEF } = {}) => {
        emit({ id: 'can:open', title: `CAN ${channel}`, state: 'start', label: 'Open CAN bus' });
        if (canBuses.has(channel)) {
            emit({ id: 'can:open', title: `CAN ${channel}`, state: 'done', label: 'CAN already open' });
            return 'already-open';
        }
        const bus = await createBus({ channel });
        canBuses.set(channel, bus);
        tsClients.set(channel, new ThingSetCAN(bus, sourceAddr | 0));
        emit({ id: 'can:open', title: `CAN ${channel}`, state: 'done', label: 'CAN opened' });
        return 'opened';
    });

    ipcMain.handle('can-close', async (_event, { channel = 'can0' } = {}) => {
        emit({ id: 'can:close', title: `CAN ${channel}`, state: 'start', label: 'Close CAN bus' });
        const bus = canBuses.get(channel);
        if (!bus) {
            emit({ id: 'can:close', title: `CAN ${channel}`, state: 'done', label: 'CAN already closed' });
            return 'not-open';
        }
        try { await bus.shutdown(); } finally {
            canBuses.delete(channel);
            tsClients.delete(channel);
            const ag = canAggregators.get(channel);
            if (ag) { try { ag.stop(); } catch {} canAggregators.delete(channel); }
        }
        emit({ id: 'can:close', title: `CAN ${channel}`, state: 'done', label: 'CAN closed' });
        return 'closed';
    });

    ipcMain.handle('can-scan-nodes', async (_event, { channel = 'can0' } = {}) => {
        const dir = getThingsetDir();
        emit({ id: 'can:scan', title: `CAN ${channel}`, state: 'start', label: 'Scanning nodes' });
        try {
            await scanCanNodes(channel);
            const outPath = nodePath.join(dir, 'nodes.json');
            const text = await fs.promises.readFile(outPath, 'utf8');
            const nodes = JSON.parse(text);
            const count = nodes ? Object.keys(nodes).length : 0;
            emit({ id: 'can:scan', title: `CAN ${channel}`, state: 'done', label: 'Scanning nodes', detail: `${count} nodes` });
            return { nodes, path: outPath };
        } catch (e) {
            emit({ id: 'can:scan', title: `CAN ${channel}`, state: 'error', label: 'Scanning nodes', detail: e?.message || String(e) });
            throw new Error(`scan failed: ${e?.message || e}`);
        }
    });

    ipcMain.handle('can-build-trees', async (_event, { channel = 'can0', nodes = null, maxDepth = 16 } = {}) => {
        const dir = getThingsetDir();
        emit({ id: 'can:build', title: `CAN ${channel}`, state: 'start', label: 'Building trees' });
        const bus = await createBus({ channel });
        const results = [];
        try {
            let mapping = nodes;
            if (!mapping) {
                mapping = JSON.parse(await fs.promises.readFile(nodePath.join(dir, 'nodes.json'), 'utf8'));
            }
            for (const [addrStr, nodeUid] of Object.entries(mapping)) {
                const addr = parseInt(addrStr, 10);
                const root = await exploreId(bus, addr, 0x00, 0, maxDepth);
                const tree = { node_uid: nodeUid, address: `0x${addr.toString(16).toUpperCase().padStart(2, '0')}`, root };
                const out = nodePath.join(dir, `node_${addr.toString(16).toUpperCase().padStart(2, '0')}_tree.json`);
                await fs.promises.writeFile(out, JSON.stringify(tree, null, 2), 'utf8');
                results.push({ addr, out });
            }
            emit({ id: 'can:build', title: `CAN ${channel}`, state: 'done', label: 'Building trees', detail: `${results.length} trees` });
        } catch (e) {
            emit({ id: 'can:build', title: `CAN ${channel}`, state: 'error', label: 'Building trees', detail: e?.message || String(e) });
            throw e;
        } finally {
            await bus.shutdown();
        }
        return { written: results };
    });

    // -------------------------------------------------------------------------
    // ThingSet CAN client operations
    // -------------------------------------------------------------------------
    async function getClient(channel = 'can0', sourceAddr = 0xEF) {
        if (!tsClients.has(channel)) {
            const bus = await createBus({ channel });
            canBuses.set(channel, bus);
            tsClients.set(channel, new ThingSetCAN(bus, sourceAddr | 0));
        }
        return tsClients.get(channel);
    }

    ipcMain.handle('ts-get', async (_e, { channel = 'can0', targetAddr, endpoint, timeoutMs = 2000, sourceAddr = 0xEF }) => {
        emit({ id: 'ts:get', title: `CAN ${channel}`, state: 'start', label: `GET ${endpoint}`, detail: `0x${(targetAddr | 0).toString(16).toUpperCase()}` });
        try {
            const ts = await getClient(channel, sourceAddr);
            const resp = await ts.get(targetAddr, endpoint, timeoutMs);
            emit({ id: 'ts:get', title: `CAN ${channel}`, state: 'done', label: `GET ${endpoint}` });
            return resp;
        } catch (e) {
            emit({ id: 'ts:get', title: `CAN ${channel}`, state: 'error', label: `GET ${endpoint}`, detail: e?.message || String(e) });
            throw e;
        }
    });

    ipcMain.handle('ts-fetch', async (_e, { channel = 'can0', targetAddr, endpoint, items = null, timeoutMs = 2000, sourceAddr = 0xEF }) => {
        emit({ id: 'ts:fetch', title: `CAN ${channel}`, state: 'start', label: `FETCH ${endpoint}`, detail: `0x${(targetAddr | 0).toString(16).toUpperCase()}` });
        try {
            const ts = await getClient(channel, sourceAddr);
            const r = await ts.fetch(targetAddr, endpoint, items, timeoutMs);
            emit({ id: 'ts:fetch', title: `CAN ${channel}`, state: 'done', label: `FETCH ${endpoint}` });
            return r;
        } catch (e) {
            emit({ id: 'ts:fetch', title: `CAN ${channel}`, state: 'error', label: `FETCH ${endpoint}`, detail: e?.message || String(e) });
            throw e;
        }
    });

    ipcMain.handle('ts-update', async (_e, { channel = 'can0', targetAddr, endpoint, values, timeoutMs = 2000, sourceAddr = 0xEF }) => {
        emit({ id: 'ts:update', title: `CAN ${channel}`, state: 'start', label: `UPDATE ${endpoint}`, detail: `0x${(targetAddr | 0).toString(16).toUpperCase()}` });
        try {
            const ts = await getClient(channel, sourceAddr);
            const r = await ts.update(targetAddr, endpoint, values, timeoutMs);
            emit({ id: 'ts:update', title: `CAN ${channel}`, state: 'done', label: `UPDATE ${endpoint}` });
            return r;
        } catch (e) {
            emit({ id: 'ts:update', title: `CAN ${channel}`, state: 'error', label: `UPDATE ${endpoint}`, detail: e?.message || String(e) });
            throw e;
        }
    });

    ipcMain.handle('ts-create', async (_e, { channel = 'can0', targetAddr, endpoint, value, timeoutMs = 2000, sourceAddr = 0xEF }) => {
        emit({ id: 'ts:create', title: `CAN ${channel}`, state: 'start', label: `CREATE ${endpoint}`, detail: `0x${(targetAddr | 0).toString(16).toUpperCase()}` });
        try {
            const ts = await getClient(channel, sourceAddr);
            const r = await ts.create(targetAddr, endpoint, value, timeoutMs);
            emit({ id: 'ts:create', title: `CAN ${channel}`, state: 'done', label: `CREATE ${endpoint}` });
            return r;
        } catch (e) {
            emit({ id: 'ts:create', title: `CAN ${channel}`, state: 'error', label: `CREATE ${endpoint}`, detail: e?.message || String(e) });
            throw e;
        }
    });

    ipcMain.handle('ts-delete', async (_e, { channel = 'can0', targetAddr, endpoint, value, timeoutMs = 2000, sourceAddr = 0xEF }) => {
        emit({ id: 'ts:delete', title: `CAN ${channel}`, state: 'start', label: `DELETE ${endpoint}`, detail: `0x${(targetAddr | 0).toString(16).toUpperCase()}` });
        try {
            const ts = await getClient(channel, sourceAddr);
            const r = await ts.delete(targetAddr, endpoint, value, timeoutMs);
            emit({ id: 'ts:delete', title: `CAN ${channel}`, state: 'done', label: `DELETE ${endpoint}` });
            return r;
        } catch (e) {
            emit({ id: 'ts:delete', title: `CAN ${channel}`, state: 'error', label: `DELETE ${endpoint}`, detail: e?.message || String(e) });
            throw e;
        }
    });

    ipcMain.handle('ts-exec', async (_e, { channel = 'can0', targetAddr, endpoint, args = [], timeoutMs = 2000, sourceAddr = 0xEF }) => {
        emit({ id: 'ts:exec', title: `CAN ${channel}`, state: 'start', label: `EXEC ${endpoint}`, detail: `0x${(targetAddr | 0).toString(16).toUpperCase()}` });
        try {
            const ts = await getClient(channel, sourceAddr);
            const r = await ts.exec(targetAddr, endpoint, args, timeoutMs);
            emit({ id: 'ts:exec', title: `CAN ${channel}`, state: 'done', label: `EXEC ${endpoint}` });
            return r;
        } catch (e) {
            emit({ id: 'ts:exec', title: `CAN ${channel}`, state: 'error', label: `EXEC ${endpoint}`, detail: e?.message || String(e) });
            throw e;
        }
    });

    ipcMain.handle('ts-paths-for-ids', async (_e, { channel = 'can0', targetAddr, ids, timeoutMs = 2000, sourceAddr = 0xEF }) => {
        emit({ id: 'ts:paths-for-ids', title: `CAN ${channel}`, state: 'start', label: 'Paths for IDs' });
        try {
            const ts = await getClient(channel, sourceAddr);
            const r = await ts.paths_for_ids(targetAddr, ids, timeoutMs);
            emit({ id: 'ts:paths-for-ids', title: `CAN ${channel}`, state: 'done', label: 'Paths for IDs' });
            return r;
        } catch (e) {
            emit({ id: 'ts:paths-for-ids', title: `CAN ${channel}`, state: 'error', label: 'Paths for IDs', detail: e?.message || String(e) });
            throw e;
        }
    });

    ipcMain.handle('ts-ids-for-paths', async (_e, { channel = 'can0', targetAddr, paths, timeoutMs = 2000, sourceAddr = 0xEF }) => {
        emit({ id: 'ts:ids-for-paths', title: `CAN ${channel}`, state: 'start', label: 'IDs for paths' });
        try {
            const ts = await getClient(channel, sourceAddr);
            const r = await ts.ids_for_paths(targetAddr, paths, timeoutMs);
            emit({ id: 'ts:ids-for-paths', title: `CAN ${channel}`, state: 'done', label: 'IDs for paths' });
            return r;
        } catch (e) {
            emit({ id: 'ts:ids-for-paths', title: `CAN ${channel}`, state: 'error', label: 'IDs for paths', detail: e?.message || String(e) });
            throw e;
        }
    });

    // -------------------------------------------------------------------------
    // CAN broadcast aggregator
    // -------------------------------------------------------------------------
    ipcMain.handle('can-aggregate-start', async (_e, { channel = 'can0' } = {}) => {
        if (!canBuses.has(channel)) {
            const bus = await createBus({ channel });
            canBuses.set(channel, bus);
        }
        let ag = canAggregators.get(channel);
        if (!ag) {
            ag = new CanBroadcastAggregator(canBuses.get(channel), { channel });
            canAggregators.set(channel, ag);
        }
        emit({ id: 'can:agg', title: `CAN ${channel}`, state: 'start', label: 'Starting aggregator' });
        try {
            ag.start();
            emit({ id: 'can:agg', title: `CAN ${channel}`, state: 'done', label: 'Aggregator running' });
            return 'ok';
        } catch (e) {
            emit({ id: 'can:agg', title: `CAN ${channel}`, state: 'error', label: 'Starting aggregator', detail: e?.message || String(e) });
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
        emit({ id: 'can:agg', title: `CAN ${channel}`, state: 'start', label: 'Stopping aggregator' });
        ag.stop();
        canAggregators.delete(channel);
        emit({ id: 'can:agg', title: `CAN ${channel}`, state: 'done', label: 'Aggregator stopped' });
        return 'stopped';
    });

    ipcMain.handle('can-aggregate-snapshot', async (_e, { channel = 'can0' } = {}) => {
        const ag = canAggregators.get(channel);
        if (!ag) return { channel, nodes: {} };
        return ag.getSnapshot();
    });

    // -------------------------------------------------------------------------
    // Linux SocketCAN setup
    // -------------------------------------------------------------------------
    ipcMain.handle('can-setup-linux', async () => {
        if (process.platform !== 'linux') throw new Error('can-setup-linux is only supported on Linux');
        const scriptPath = nodePath.join(__dirname, '..', '..', 'scripts', 'setup_can_linux.sh');
        emit({ id: 'can:setup', title: 'CAN', state: 'start', label: 'Setting up CAN (Linux)' });
        return new Promise((resolve, reject) => {
            const child = spawn('pkexec', ['bash', scriptPath], { env: process.env, stdio: 'ignore' });
            child.on('error', (err) => reject(new Error(`pkexec failed: ${err.message}`)));
            child.on('exit', (code) => {
                if (code === 0) {
                    emit({ id: 'can:setup', title: 'CAN', state: 'done', label: 'CAN setup complete' });
                    resolve('ok');
                } else {
                    emit({ id: 'can:setup', title: 'CAN', state: 'error', label: 'CAN setup failed', detail: `exit ${code}` });
                    reject(new Error(`pkexec exited with code ${code}`));
                }
            });
        });
    });

    ipcMain.handle('can-is-up', async (_e, { channel = 'can0' } = {}) => {
        try {
            const opPath = nodePath.join('/sys/class/net', channel, 'operstate');
            const stat = await fs.promises.stat(opPath).catch(() => null);
            if (!stat) return { exists: false, up: false };
            const state = (await fs.promises.readFile(opPath, 'utf8')).trim();
            return { exists: true, up: state === 'up' };
        } catch {
            return { exists: false, up: false };
        }
    });
};
