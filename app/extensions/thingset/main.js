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

    // Diagnostics: timestamped [thingset] logging so serial detect/tree
    // attempts are directly observable in this terminal while testing.
    function tsLog(level, event, detail) {
        const ts = new Date().toISOString();
        const line = `[thingset][${ts}] ${event}${detail ? ' — ' + detail : ''}`;
        if (level === 'error') console.error(line);
        else if (level === 'warn') console.warn(line);
        else console.log(line);
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
    // Deprioritizes (never excludes) "-if00" USB interfaces: confirmed against
    // real OwnTech/Core4 hardware that this is always the scope bulk-transfer
    // side-channel, never a ThingSet shell -- and that probing it with the
    // full ThingSet handshake (multiple commands, each an unrecognized-input
    // error to that port's simple single-character protocol) can wedge its
    // firmware task until a physical reset. ttyACM0 (if00) otherwise sorts
    // before ttyACM1 (if02) on every such board, so without this, a plain
    // path-based scan always tries the risky port first.
    const IF00_SUFFIX_RE = /-if00$/i;

    function isIf00Candidate(port) {
        return IF00_SUFFIX_RE.test(String(port?.pnpId || ''));
    }

    function orderSerialCandidates(ports) {
        const preferRe = /(ttyACM|ttyUSB|usbserial|usbmodem|cu\.usb|COM\d+)/i;
        const rank = (port) => {
            const p = String(port?.path || '');
            if (isIf00Candidate(port)) return 2;
            if (preferRe.test(p)) return 0;
            return 1;
        };
        return ports
            .slice()
            .map((port, index) => ({ port, index }))
            .sort((a, b) => (rank(a.port) - rank(b.port)) || (a.index - b.index))
            .map(({ port }) => port.path);
    }

    // An "-if00" interface is only the scope side-channel when the same USB
    // device (same serialNumber) also exposes another interface -- the
    // OwnTech if00 + if02 layout. A single-interface CDC device also reports
    // "-if00" and is then the shell itself, so it must stay probe-able.
    function isScopeSidePort(port, ports) {
        if (!isIf00Candidate(port) || !port.serialNumber) return false;
        return ports.some((other) => other !== port
            && other.serialNumber === port.serialNumber
            && !isIf00Candidate(other));
    }

    // SerialPort.list() costs ~450ms on Linux (udev scan) -- measured against a
    // real board, uncached it was ~80% of every single ts-serial-get-value.
    // Which path is a scope side-channel only changes on a replug, so a short
    // TTL is plenty; detect still does its own fresh list.
    const SCOPE_SIDE_TTL_MS = 5000;
    let scopeSideCache = null; // { at, promise }

    function listScopeSidePaths() {
        if (!scopeSideCache || Date.now() - scopeSideCache.at > SCOPE_SIDE_TTL_MS) {
            const promise = SerialPort.list()
                .then((ports) => new Set((ports || []).filter((p) => p && p.path && isScopeSidePort(p, ports)).map((p) => p.path)))
                .catch(() => new Set());
            scopeSideCache = { at: Date.now(), promise };
        }
        return scopeSideCache.promise;
    }

    async function collectSerialCandidates(explicitPort = null) {
        if (explicitPort) return [explicitPort];
        try {
            const ports = await SerialPort.list();
            if (!ports || !ports.length) return [];
            const usable = ports.filter((p) => p && p.path && !isScopeSidePort(p, ports));
            return orderSerialCandidates(usable);
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
    // Per-port serialization for every ts-serial-* operation
    // -------------------------------------------------------------------------
    // Each handler below opens its own ephemeral ThingSetSerialShell (its own
    // SerialPort) on a given OS device path. Confirmed against real hardware:
    // if two such operations land on the SAME port at overlapping times (e.g.
    // a widget's tree poll racing a button's write -- an entirely normal
    // thing to happen once a dashboard has multiple OwnTech/ThingSet widgets
    // pointed at one datasource), the OS only lets one open handle exist at a
    // time, so the second SerialPort.open() call fails with "Resource
    // temporarily unavailable ... Cannot lock port". runExclusive() chains
    // same-port operations so each one starts only once the previous one has
    // fully finished, generalizing the same per-port-Promise idea
    // inFlightTreeFetches (below) already used just for concurrent tree
    // fetches to every serial ThingSet operation.
    const portQueues = new Map(); // port -> Promise (tail of that port's queue)

    function runExclusive(port, fn) {
        const prev = portQueues.get(port) || Promise.resolve();
        // Refuse before a single byte goes out: sending the ThingSet
        // handshake to the scope side-channel wedges the board's firmware
        // until it is physically reset (see isScopeSidePort).
        const guarded = async () => {
            if ((await listScopeSidePaths()).has(port)) {
                throw new Error(`${port} is the board's scope data port (if00), not its ThingSet shell -- use the if02 port or enable auto-detect`);
            }
            return fn();
        };
        const settled = prev.then(guarded, guarded);
        // The stored continuation must never reject -- otherwise one failed
        // operation would permanently wedge every later operation on this
        // port. Callers still get the real result/rejection via `settled`.
        portQueues.set(port, settled.then(() => {}, () => {}));
        return settled;
    }

    // -------------------------------------------------------------------------
    // One open, handshaken shell per port, reused across operations
    // -------------------------------------------------------------------------
    // Opening the port, toggling DTR, the ThingSet handshake and closing again
    // cost ~112ms around a ~10ms command (measured on a Core4 board), on every
    // single read or write. A session is dropped on any I/O error or when the
    // port closes (unplug), and closed after SESSION_IDLE_MS of inactivity so
    // other tools can open the port. Always called inside runExclusive(port).
    const SESSION_IDLE_MS = 10000;
    const sessions = new Map(); // port -> { shell, baudRate, idleTimer }

    async function dropSession(port) {
        const session = sessions.get(port);
        if (!session) return;
        sessions.delete(port);
        clearTimeout(session.idleTimer);
        try { await session.shell.close(); } catch {}
    }

    async function withShell(port, { baudRate = 115200, usePrefix = false, verbose = false } = {}, fn) {
        let session = sessions.get(port);
        if (session && (session.baudRate !== baudRate || !session.shell.port.isOpen)) {
            await dropSession(port);
            session = null;
        }
        if (!session) {
            const isVerbose = Boolean(verbose) || process.env.TS_SERIAL_DEBUG === '1';
            const existingPort = getOpenPort(port);
            tsLog('log', `opening session on ${port}`, existingPort ? `reusing already-open handle (isOpen=${existingPort.isOpen})` : 'new handle');
            const shell = new ThingSetSerialShell({ path: port, baudRate, usePrefix, verbose: isVerbose, existingPort });
            try {
                await shell.open();
                await shell.enterThingSet();
                // enterThingSet() is best-effort; working against a dead shell
                // yields empty trees and null reads reported as success.
                if (!shell.probeSucceeded()) throw new Error(`ThingSet shell did not respond on ${port}`);
            } catch (err) {
                try { await shell.close(); } catch {}
                throw err;
            }
            session = { shell, baudRate, idleTimer: null };
            sessions.set(port, session);
        }
        clearTimeout(session.idleTimer);
        session.shell.readBuffer = Buffer.alloc(0);
        try {
            return await fn(session.shell);
        } catch (err) {
            await dropSession(port);
            throw err;
        } finally {
            if (sessions.get(port) === session) {
                session.idleTimer = setTimeout(() => { runExclusive(port, () => dropSession(port)).catch(() => {}); }, SESSION_IDLE_MS);
            }
        }
    }

    // -------------------------------------------------------------------------
    // ThingSet serial detect
    // -------------------------------------------------------------------------
    // Same reasoning as inFlightTreeFetches: a scan across every candidate port
    // is expensive, so two overlapping detect calls (e.g. a duplicated
    // datasource instance and its own auto-detect retry) shouldn't each open
    // and probe every port independently.
    const inFlightDetects = new Map(); // "port or '*'" -> Promise

    ipcMain.handle('ts-serial-detect', async (_event, opts = {}) => {
        const key = opts.port || '*';
        const existing = inFlightDetects.get(key);
        if (existing) {
            tsLog('log', `detect requested (${key})`, 'a detect scan is already in flight — awaiting it instead of starting a second one');
            return existing;
        }
        const attempt = runSerialDetect(opts);
        inFlightDetects.set(key, attempt);
        try {
            return await attempt;
        } finally {
            if (inFlightDetects.get(key) === attempt) inFlightDetects.delete(key);
        }
    });

    async function runSerialDetect({ port = null, baudRate = 115200, usePrefix = false, verbose = false } = {}) {
        const candidates = await collectSerialCandidates(port);
        tsLog('log', 'detect requested', `candidates=[${candidates.join(', ')}]`);
        if (!candidates.length) throw new Error('No serial ports found to probe for ThingSet shell');
        const attempts = [];
        for (const candidate of candidates) {
            try {
                const result = await runExclusive(candidate, async () => {
                    tsLog('log', `probing ${candidate}`);
                    return withShell(candidate, { baudRate, usePrefix, verbose }, async (shell) => {
                        const nodeUid = await shell.readNodeUid().catch(() => null);
                        const nodeName = await shell.readNodeName().catch(() => null);
                        const nodeAddr = await shell.readNodeAddr().catch(() => null);
                        const addressHex = Number.isInteger(nodeAddr) ? `0x${nodeAddr.toString(16).toUpperCase().padStart(2, '0')}` : null;
                        return { node_uid: nodeUid, node_name: nodeName, node_addr: nodeAddr, address_hex: addressHex, command_prefix: shell.getCommandPrefix() };
                    });
                });
                tsLog('log', `probe succeeded on ${candidate}`, result.address_hex || result.node_uid || 'ok');
                emit({ id: `serial:${candidate}:detect`, title: candidate, state: 'done', label: 'ThingSet serial detect', detail: result.node_uid || result.address_hex || 'ok' });
                return { port: candidate, baudRate, ...result };
            } catch (err) {
                tsLog('warn', `probe failed on ${candidate}`, err?.message || String(err));
                attempts.push({ port: candidate, error: err?.message || String(err) });
                emit({ id: `serial:${candidate}:detect`, title: candidate, state: 'error', label: 'ThingSet serial detect', detail: err?.message || String(err) });
            }
        }
        const detail = attempts.map((t) => `${t.port}: ${t.error}`).join('; ');
        tsLog('error', 'detect exhausted all candidates', detail);
        throw new Error(detail || 'ThingSet serial shell not found');
    }

    // -------------------------------------------------------------------------
    // ThingSet serial tree
    // -------------------------------------------------------------------------
    // A full ThingSet tree walk is dozens of round-trip serial commands, not a
    // cheap read. If two callers ask for the same port's tree at once (e.g. a
    // duplicated datasource/widget pair left over from a stale dashboard save,
    // or a widget refresh landing mid-poll), letting both run opens two
    // independent serial handles on the same path and interleaves their
    // command/response traffic — this guard makes the second caller just await
    // the first's in-flight walk instead.
    const inFlightTreeFetches = new Map(); // "port|mode" -> Promise

    // Last full walk per port. mode:'values' refreshes its values in place
    // with one fetch per group (~20 commands) instead of re-walking all ~81
    // nodes (~2.5s on a Core4 board); the walk itself is only needed to
    // discover structure, which doesn't change while a board stays connected.
    const lastTrees = new Map(); // port -> { root, meta }

    ipcMain.handle('ts-serial-tree', async (_event, { port, baudRate = 115200, usePrefix = false, verbose = false, mode = 'full' } = {}) => {
        if (!port) throw new Error('port required');
        const key = `${port}|${mode}`;
        const existing = inFlightTreeFetches.get(key);
        if (existing) {
            tsLog('log', `tree requested for ${port}`, 'a tree fetch is already in flight for this port — awaiting it instead of starting a second one');
            return existing;
        }
        const run = mode === 'values' && lastTrees.has(port)
            ? () => runValuesRefresh({ port, baudRate, usePrefix, verbose })
            : () => runSerialTree({ port, baudRate, usePrefix, verbose });
        const attempt = runExclusive(port, run);
        inFlightTreeFetches.set(key, attempt);
        try {
            return await attempt;
        } finally {
            if (inFlightTreeFetches.get(key) === attempt) inFlightTreeFetches.delete(key);
        }
    });

    async function runValuesRefresh({ port, baudRate, usePrefix, verbose }) {
        const cached = lastTrees.get(port);
        try {
            await withShell(port, { baudRate, usePrefix, verbose }, (shell) => shell.refreshValues(cached.root));
            return { ...cached.meta, root: cached.root, mode: 'values' };
        } catch (err) {
            tsLog('warn', `values refresh failed for ${port}`, `${err?.message || err} — falling back to a full tree walk`);
            lastTrees.delete(port);
        }
        return runSerialTree({ port, baudRate, usePrefix, verbose });
    }

    async function runSerialTree({ port, baudRate, usePrefix, verbose }) {
        tsLog('log', `tree requested for ${port}`);
        emit({ id: `serial:${port}:tree`, title: port, state: 'start', label: 'ThingSet serial tree' });
        try {
            return await withShell(port, { baudRate, usePrefix, verbose }, async (shell) => {
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
                tsLog('log', `tree succeeded for ${port}`, addressHex || 'n/a');
                emit({ id: `serial:${port}:tree`, title: port, state: 'done', label: 'ThingSet serial tree', detail: addressHex || 'n/a' });
                const meta = { node_uid: nodeUid, node_name: nodeName, address_hex: addressHex, node_addr: nodeAddr, saved_tree_path: savedTreePath };
                if (root) lastTrees.set(port, { root, meta });
                return { ...meta, root, mode: 'full' };
            });
        } catch (err) {
            tsLog('error', `tree failed for ${port}`, err?.message || String(err));
            emit({ id: `serial:${port}:tree`, title: port, state: 'error', label: 'ThingSet serial tree', detail: err?.message || String(err) });
            throw err;
        }
    }

    // -------------------------------------------------------------------------
    // ThingSet serial value operations
    // -------------------------------------------------------------------------
    ipcMain.handle('ts-serial-set-value', async (_event, { port, path: targetPath, value, baudRate = 115200, usePrefix = false, verbose = false } = {}) => {
        if (!port) throw new Error('port required');
        if (!targetPath) throw new Error('path required');
        return runExclusive(port, async () => {
            return withShell(port, { baudRate, usePrefix, verbose }, async (shell) => {
                const coerced = coerceOutputValue(value);
                const resp = await shell.setValue(targetPath, coerced);
                let readBack = null;
                try { const read = await shell.getValue(targetPath); if (read.ok) readBack = read.value; } catch {}
                return { ok: resp.ok, raw: resp.raw, readBack };
            });
        });
    });

    ipcMain.handle('ts-serial-get-value', async (_event, { port, path: targetPath, baudRate = 115200, usePrefix = false, verbose = false } = {}) => {
        if (!port) throw new Error('port required');
        if (!targetPath) throw new Error('path required');
        return runExclusive(port, async () => {
            return withShell(port, { baudRate, usePrefix, verbose }, async (shell) => {
                const resp = await shell.getValue(targetPath);
                return { ok: resp.ok, value: resp.value };
            });
        });
    });

    ipcMain.handle('ts-serial-create', async (_event, { port, path: targetPath, value = undefined, baudRate = 115200, usePrefix = false, verbose = false } = {}) => {
        if (!port) throw new Error('port required');
        if (!targetPath) throw new Error('path required');
        return runExclusive(port, async () => {
            return withShell(port, { baudRate, usePrefix, verbose }, async (shell) => {
                const resp = await shell.create(targetPath, value);
                return { status: resp.statusHex, ok: shell.isSuccessStatus(resp.statusHex), raw: resp.text, json: resp.json };
            });
        });
    });

    ipcMain.handle('ts-serial-delete', async (_event, { port, path: targetPath, value = undefined, baudRate = 115200, usePrefix = false, verbose = false } = {}) => {
        if (!port) throw new Error('port required');
        if (!targetPath) throw new Error('path required');
        return runExclusive(port, async () => {
            return withShell(port, { baudRate, usePrefix, verbose }, async (shell) => {
                const resp = await shell.deleteValue(targetPath, value);
                return { status: resp.statusHex, ok: shell.isSuccessStatus(resp.statusHex), raw: resp.text, json: resp.json };
            });
        });
    });

    ipcMain.handle('ts-serial-exec', async (_event, { port, path: targetPath, args = undefined, baudRate = 115200, usePrefix = false, verbose = false } = {}) => {
        if (!port) throw new Error('port required');
        if (!targetPath) throw new Error('path required');
        return runExclusive(port, async () => {
            return withShell(port, { baudRate, usePrefix, verbose }, async (shell) => {
                const resp = await shell.exec(targetPath, args);
                return { status: resp.statusHex, ok: shell.isSuccessStatus(resp.statusHex), raw: resp.text, json: resp.json };
            });
        });
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
