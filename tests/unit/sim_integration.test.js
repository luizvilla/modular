const assert = require('assert');
const path = require('path');

// The app's real ThingSet and OwnTech main-process handlers (no Electron)
// against the simulated demo board (M12): every layer above the transport is
// the production code path. Hardware ports are hidden so the result doesn't
// depend on what's plugged in.
const serialport = require('serialport');
serialport.SerialPort.list = async () => [];

const sim = require('../../app/js/sim');
const boardLock = require('../../app/js/serial_board_lock');

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

function flatten(node, prefix = '', out = {}) {
    for (const [k, c] of Object.entries(node.children || {})) {
        const p = `${prefix}/${k}`;
        if (c.children && Object.keys(c.children).length) flatten(c, p, out);
        else out[p] = c.value;
    }
    return out;
}

(async () => {
    const { board, scope } = sim.enableDemoBoard({ latencyMs: 1 });
    scope.bootLogPending = false;
    let if00Bytes = '';
    const onData = scope.onData.bind(scope);
    scope.onData = (port, buf) => { if00Bytes += buf.toString('latin1'); onData(port, buf); };

    // Listed like a real board's two interfaces.
    const listed = await boardLock.listPorts({ fresh: true });
    assert.deepStrictEqual(listed.map((p) => p.path).sort(), [IF00, IF02]);

    // Detect lands on the shell and never touches the scope port.
    const detected = await call('ts-serial-detect', {});
    assert.strictEqual(detected.port, IF02);
    assert.strictEqual(detected.node_name, 'Demo OwnTech');
    assert.strictEqual(if00Bytes, '', 'no ThingSet bytes ever reach if00');
    await assert.rejects(() => call('ts-serial-tree', { port: IF00 }), /scope data port/);

    // Full walk, then a values refresh with the same variables.
    const full = await call('ts-serial-tree', { port: IF02 });
    const fullVars = flatten(full.root);
    assert.strictEqual(Object.keys(fullVars).length, 81, 'the real Core4 tree');
    const refreshed = await call('ts-serial-tree', { port: IF02, mode: 'values' });
    assert.strictEqual(refreshed.mode, 'values');
    assert.deepStrictEqual(Object.keys(flatten(refreshed.root)).sort(), Object.keys(fullVars).sort());

    // Reads, group reads, writes with readback, rejected writes.
    assert.deepStrictEqual(await call('ts-serial-get-value', { port: IF02, path: 'Config/Mode' }), { ok: true, value: 0 });
    const group = await call('ts-serial-get-value', { port: IF02, path: 'Measurements' });
    assert.strictEqual(Object.keys(group.value).length, 12);
    const w = await call('ts-serial-set-value', { port: IF02, path: 'Config/wBlinkPeriod_s', value: 0.5 });
    assert.strictEqual(w.ok, true);
    assert.strictEqual(w.readBack, 0.5);
    const ro = await call('ts-serial-set-value', { port: IF02, path: 'Measurements/rVHigh_V', value: 1 });
    assert.strictEqual(ro.ok, false, 'read-only rejected');
    const dutyBad = await call('ts-serial-set-value', { port: IF02, path: 'Config/Leg1/wDutyCycle', value: 2 });
    assert.strictEqual(dutyBad.ok, true);
    assert.strictEqual(dutyBad.readBack, 0.1, 'accepted then reverted by the firmware');

    // Physics through the app: POWER_ON + leg 1 enable.
    await call('ts-serial-set-value', { port: IF02, path: 'Config/Mode', value: 1 });
    await call('ts-serial-set-value', { port: IF02, path: 'Config/Leg1/wEnable', value: true });
    await sleep(30);
    const v1 = (await call('ts-serial-get-value', { port: IF02, path: 'Measurements/rV1Low_V' })).value;
    assert.ok(Math.abs(v1 - 2.7) < 0.15, `V1 ~2.7 V on 10 ohm at duty 0.1, got ${v1}`);
    // The values refresh sees it too (the bug fixed in 6337c57 hid such changes).
    const after = flatten((await call('ts-serial-tree', { port: IF02, mode: 'values' })).root);
    assert.strictEqual(after['/Config/Mode'], 1);
    assert.ok(Math.abs(after['/Measurements/rV1Low_V'] - 2.7) < 0.15);

    // Scope: arm, trigger, download; an if02 read issued mid-download waits
    // for it instead of failing.
    await call('owntech-scope-probe', { port: IF00 });
    await call('ts-serial-set-value', { port: IF02, path: 'Debug/Scope/wArm', value: true });
    await call('ts-serial-set-value', { port: IF02, path: 'Debug/Scope/wTrigger', value: true });
    await sleep(120);
    assert.strictEqual((await call('ts-serial-get-value', { port: IF02, path: 'Debug/Scope/rState' })).value, 3);
    const dl = call('owntech-scope-download', { port: IF00 }, { sender: { send() {} } });
    await sleep(20);
    const t0 = Date.now();
    const midRead = await call('ts-serial-get-value', { port: IF02, path: 'Config/Mode' });
    assert.strictEqual(midRead.ok, true, 'read during a download succeeds');
    assert.ok(Date.now() - t0 > 800, 'it waited for the download');
    const capture = await dl;
    assert.strictEqual(capture.samples.length, 1024);
    assert.ok(Math.abs(capture.samples[600][0] - 2.7) < 0.2, 'captured V1 matches the running leg');
    assert.ok(/^\?+D$/.test(if00Bytes), `if00 saw only its own protocol ("?" then "D"): ${JSON.stringify(if00Bytes)}`);

    // Port labels and cleanup.
    await call('owntech-scope-close', { port: IF00 });
    await call('ts-serial-set-value', { port: IF02, path: 'Config/Mode', value: 0 });
    sim.disableDemoBoard();
    assert.deepStrictEqual(await boardLock.listPorts({ fresh: true }), []);
    void board;
    console.log('All sim_integration tests passed.');
    process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
