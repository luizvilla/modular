const assert = require('assert');
const path = require('path');

// Regression tests for the hardware bugs found 2026-10-12..14
// (docs/GUI/02-navigation_overhaul.md), each reproduced on the simulated
// board (M12) and run through the app's real main-process handlers.
const serialport = require('serialport');
serialport.SerialPort.list = async () => [];

const sim = require('../../app/js/sim');
const { ThingSetSerialShell } = require('../../app/js/thingset_serial_shell');

const handlers = {};
const ctx = {
    registerManifestContribution() {},
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; }, on() {} },
    app: { getPath: () => require('os').tmpdir() },
    openPorts: new Map(),
    emitActivity() {},
};
require(path.resolve(__dirname, '../../app/extensions/thingset/main.js'))(ctx);
require(path.resolve(__dirname, '../../app/extensions/owntech/main.js'))(ctx);
const call = (name, args, event = {}) => handlers[name](event, args);

const IF02 = `${sim.DEMO.base}/if02`;
const IF00 = `${sim.DEMO.base}/if00`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timed = async (fn) => { const t0 = Date.now(); try { return { value: await fn(), ms: Date.now() - t0 }; } catch (error) { return { error, ms: Date.now() - t0 }; } };

async function fresh() {
    sim.disableDemoBoard();
    const demo = sim.enableDemoBoard({ latencyMs: 1 });
    demo.scope.bootLogPending = false;
    await sleep(5);
    return demo;
}

const tests = {
    // ca22323: a saved portPath pinned detect to if00 and the ThingSet
    // handshake wedged the board until a replug.
    async 'ThingSet operations on the scope port are refused before a byte goes out'() {
        const { scope } = await fresh();
        let seen = '';
        const orig = scope.onData.bind(scope);
        scope.onData = (p, b) => { seen += b.toString('latin1'); orig(p, b); };
        await assert.rejects(() => call('ts-serial-detect', { port: IF00 }), /scope data port/);
        await assert.rejects(() => call('ts-serial-tree', { port: IF00 }), /scope data port/);
        await assert.rejects(() => call('ts-serial-get-value', { port: IF00, path: 'Config/Mode' }), /scope data port/);
        assert.strictEqual(seen, '', 'if00 never received a byte');
    },

    // ...and what the guard prevents is real: the handshake wedges if00.
    async 'a ThingSet handshake really wedges the simulated scope port'() {
        const { scope } = await fresh();
        const shell = new ThingSetSerialShell({ path: IF00 });
        await shell.open();
        await shell.enterThingSet(); // best-effort: returns, probe failed
        assert.strictEqual(shell.probeSucceeded(), false);
        assert.ok(scope.stalled, 'the scope task is wedged');
        // Once wedged, the next command must time out, not hang (5539a69).
        const r = await timed(() => shell.sendCommand('?'));
        await shell.close().catch(() => {});
        assert.ok(r.error && /timed out/.test(r.error.message), `the wedge surfaces as a timeout (${r.error ? r.error.message : 'resolved'})`);
        assert.ok(r.ms < 5000, `bounded (${r.ms} ms)`);
        await assert.rejects(() => call('owntech-scope-probe', { port: IF00 }), /timed out/);
        scope.reboot();
        await call('owntech-scope-close', { port: IF00 });
        await call('owntech-scope-probe', { port: IF00 });
    },

    // 5539a69: no write/drain timeout -- a board that stopped reading hung
    // the tree fetch and everything queued behind it, silently.
    async 'a board that stops reading gives an error, not a hang'() {
        const { board } = await fresh();
        board.shell.stalled = true;
        const r = await timed(() => call('ts-serial-tree', { port: IF02 }));
        assert.ok(r.error, 'rejected');
        assert.ok(/timed out|did not respond/.test(r.error.message), r.error.message);
        assert.ok(r.ms < 10000, `bounded (${r.ms} ms)`);
        board.shell.stalled = false;
        const after = await call('ts-serial-get-value', { port: IF02, path: 'Config/Mode' });
        assert.deepStrictEqual(after, { ok: true, value: 0 }, 'recovers once the board answers again');
    },

    // 5539a69: a dead shell walked to an empty root reported as success.
    async 'a shell that answers nothing is an error, not an empty tree'() {
        const { board } = await fresh();
        board.shell.silent = true;
        const r = await timed(() => call('ts-serial-tree', { port: IF02 }));
        assert.ok(r.error && /did not respond|timed out/.test(r.error.message), r.error ? r.error.message : 'resolved');
        board.shell.silent = false;
    },

    // 5539a69: after a probe left the shell in "select thingset" mode, a
    // prefixed command printed nothing, and usePrefix:true got an empty tree.
    async 'the select-mode prefix trap still yields the full tree'() {
        await fresh();
        await call('ts-serial-get-value', { port: IF02, path: 'Config/Mode' }); // leaves the shell in select mode
        const r = await call('ts-serial-tree', { port: IF02, usePrefix: true });
        assert.ok(Object.keys(r.root.children).length >= 10, 'full tree with the prefix setting on');
        assert.strictEqual(r.node_name, 'Demo OwnTech');
    },

    // a1ada7a: the first "?" after boot lands on the cut-off boot-log line.
    async 'the first scope probe after boot recovers by resending'() {
        const { scope } = await fresh();
        await call('owntech-scope-close', { port: IF00 });
        scope.reboot(); // boot log pending again
        await call('owntech-scope-probe', { port: IF00 });
        await call('owntech-scope-close', { port: IF00 });
        scope.dropFirstProbe = true;
        await call('owntech-scope-probe', { port: IF00 });
    },

    // 72fbb68: if02 reads failed while if00 streamed a capture.
    async 'an if02 read during a scope download waits and succeeds'() {
        await fresh();
        await call('ts-serial-set-value', { port: IF02, path: 'Debug/Scope/wArm', value: true });
        await call('ts-serial-set-value', { port: IF02, path: 'Debug/Scope/wTrigger', value: true });
        await sleep(120);
        const dl = call('owntech-scope-download', { port: IF00 }, { sender: { send() {} } });
        await sleep(30);
        const r = await timed(() => call('ts-serial-get-value', { port: IF02, path: 'Config/Mode' }));
        assert.deepStrictEqual(r.value, { ok: true, value: 0 });
        assert.ok(r.ms > 700, `it waited for the download (${r.ms} ms)`);
        assert.strictEqual((await dl).samples.length, 1024);
        await call('owntech-scope-close', { port: IF00 });
    },

    // A cached scope link whose port closed (unplug/replug) was reused, and
    // every later download failed "Port is not open".
    async 'a scope link whose port closed is reopened'() {
        await call('owntech-scope-probe', { port: IF00 });
        const { scope } = await fresh(); // the board goes away and comes back
        scope.bootLogPending = false;
        await call('owntech-scope-probe', { port: IF00 });
    },

    // 6337c57: leaves the walk returns with empty children (Config/Mode,
    // pNodeID, Device/c*) were never refreshed after the first walk.
    async 'a values refresh picks up changes to leaves with empty children'() {
        const { board } = await fresh();
        await call('ts-serial-tree', { port: IF02 });
        board.store.set('/Config/Mode', 2); // changed behind the app's back
        board.store.set('/Config/Frequency_Hz', 180000);
        const r = await call('ts-serial-tree', { port: IF02, mode: 'values' });
        assert.strictEqual(r.root.children.Config.children.Mode.value, 2);
        assert.strictEqual(r.root.children.Config.children.Frequency_Hz.value, 180000);
    },

    // 9d1f671: a group read returned only its first value.
    async 'a group read returns the whole object'() {
        await fresh();
        const r = await call('ts-serial-get-value', { port: IF02, path: 'Config/Leg1' });
        assert.strictEqual(r.ok, true);
        assert.strictEqual(Object.keys(r.value).length, 11);
    },
};

(async () => {
    for (const [name, fn] of Object.entries(tests)) {
        try { await fn(); } catch (err) { console.error(`FAIL: ${name}`); throw err; }
    }
    sim.disableDemoBoard();
    console.log(`All sim_regressions tests passed (${Object.keys(tests).length}).`);
    process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
