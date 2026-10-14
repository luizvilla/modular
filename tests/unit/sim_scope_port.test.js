const assert = require('assert');
const registry = require('../../app/js/sim/index.js');
const { OwnTechSimBoard, SCOPE } = require('../../app/js/sim/owntech_board.js');
const { ScopePortSim } = require('../../app/js/sim/scope_port_sim.js');
const { ScopeSerialLink } = require('../../app/extensions/owntech/scope_serial.js');
const transcript = require('../fixtures/core4_shell_transcript.json');

// The simulated scope data port (if00) against Core4's scope_capture.cpp /
// scope_data_port.cpp, downloaded through the app's own ScopeSerialLink.

const IF00 = 'sim://scope-test/if00';
const IF02 = 'sim://scope-test/if02';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setup() {
    const board = new OwnTechSimBoard({ latencyMs: 0 });
    const scope = new ScopePortSim(board, { latencyMs: 0 });
    registry.registerDevice(IF00, scope, {});
    registry.registerDevice(IF02, board.shell, {});
    const link = new ScopeSerialLink({ path: IF00 });
    link.port = registry.createSerialPort({ path: IF00, autoOpen: false }); // step 7 routes this through the factory
    const write = (group, obj) => board.store.update(group, obj);
    const read = (p) => board.store.read(p);
    return { board, scope, link, write, read };
}

async function testBootLogAndProbe() {
    const { link, board } = setup();
    const port = registry.createSerialPort({ path: IF00, autoOpen: false });
    let got = '';
    port.on('data', (d) => { got += d.toString('latin1'); });
    await new Promise((r) => port.open(r));
    await sleep(10);
    assert.strictEqual(got, transcript.if00.raw_probe, 'first open delivers the real 1024-byte boot log');
    port.write('?');
    await sleep(10);
    assert.ok(got.endsWith('for ASCOPE-DATA/1 OK\r\n'), 'the first reply lands on the cut-off boot-log line');
    await new Promise((r) => port.close(r));
    // A fresh boot, through the app's link: its probe resend recovers.
    link.port.removeAllListeners();
    registry.deviceFor(IF00).reboot();
    await link.open();
    await link.probe(300);
    await link.close();
    void board;
}

async function testStateMachine() {
    const { write, read } = setup();
    assert.strictEqual(read('/Debug/Scope/rState'), SCOPE.IDLE);
    write('/Debug/Scope', { wDecimation: 1, wPretriggerRatio: 0.2 });
    write('/Debug/Scope', { wArm: true });
    assert.strictEqual(read('/Debug/Scope/wArm'), false, 'wArm is one-shot');
    assert.strictEqual(read('/Debug/Scope/rState'), SCOPE.ARMED);
    // Locked while armed: accepted, reverted, INVALID_STATE.
    write('/Debug/Scope', { wDecimation: 10 });
    assert.strictEqual(read('/Debug/Scope/wDecimation'), 1);
    assert.strictEqual(read('/Debug/Scope/rLastError'), SCOPE.E_INVALID_STATE);
    write('/Debug/Scope', { wTrigger: true });
    assert.strictEqual(read('/Debug/Scope/wTrigger'), false);
    assert.strictEqual(read('/Debug/Scope/rState'), SCOPE.TRIGGERED);
    await sleep(100); // (1 - 0.2) x 102.4 ms
    assert.strictEqual(read('/Debug/Scope/rState'), SCOPE.READY);
    assert.strictEqual(read('/Debug/Scope/rSamplePeriod_us'), 100);
    // Trigger when not armed: INVALID_STATE.
    write('/Debug/Scope', { wTrigger: true });
    assert.strictEqual(read('/Debug/Scope/rLastError'), SCOPE.E_INVALID_STATE);
    write('/Debug/Scope', { wDecimation: 0 });
    assert.strictEqual(read('/Debug/Scope/rLastError'), SCOPE.E_INVALID_DECIMATION);
    write('/Debug/Scope', { wDecimation: 100 });
    write('/Debug/Scope', { wArm: true });
    assert.strictEqual(read('/Debug/Scope/rCaptureDuration_ms'), 10240, 'duration fixed at arm time');
}

async function testDownloadShowsTheStep() {
    const { board, scope, link, write } = setup();
    scope.bootLogPending = false;
    await link.open();
    // Not ready yet.
    await assert.rejects(() => link.download({ timeoutMs: 500 }), /NOT_READY IDLE/);
    write('/Debug/Scope', { wDecimation: 1, wPretriggerRatio: 0.5 });
    write('/Config', { Mode: 1 });
    write('/Debug/Scope', { wArm: true });
    await sleep(60);
    // Enable leg 1 and trigger at the same instant: the step sits at the trigger.
    write('/Config/Leg1', { wDutyCycle: 0.2, wEnable: true });
    write('/Debug/Scope', { wTrigger: true });
    await sleep(70);
    assert.strictEqual(board.scopeState(), SCOPE.READY);

    // The shell is held while the capture streams, and answers afterwards.
    const shellPort = registry.createSerialPort({ path: IF02, autoOpen: false });
    let shellOut = '';
    shellPort.on('data', (d) => { shellOut += d.toString(); });
    await new Promise((r) => shellPort.open(r));
    await sleep(10);
    const t0 = Date.now();
    const dl = link.download({ timeoutMs: 5000 });
    await sleep(50);
    shellOut = '';
    shellPort.write('thingset ?Config/Mode\r\n');
    await sleep(200);
    assert.ok(!shellOut.includes(':85'), 'no shell answer while streaming');
    assert.strictEqual(board.scopeState(), SCOPE.STREAMING);
    const result = await dl;
    const elapsed = Date.now() - t0;
    assert.ok(elapsed > 900 && elapsed < 2000, `streams at the real rate (~1.15 s), took ${elapsed} ms`);
    await sleep(30);
    assert.ok(shellOut.includes(':85 1'), 'the held request is answered after the download');
    assert.strictEqual(board.scopeState(), SCOPE.READY, 'READY again after streaming');

    assert.deepStrictEqual(result.channels, SCOPE.CHANNELS);
    assert.strictEqual(result.samples.length, 1024);
    assert.strictEqual(result.finalIndex, board.scope.finalIndex);
    const v1 = result.samples.map((row) => row[0]);
    const before = v1.slice(0, 500);
    const after = v1.slice(530);
    assert.ok(Math.max(...before.map(Math.abs)) < 0.2, 'leg off before the trigger');
    const settled = after.reduce((a, b) => a + b, 0) / after.length;
    assert.ok(Math.abs(settled - 0.2 * 30 * 0.9) < 0.15, `5.4 V after the trigger, got ${settled}`);
    assert.ok(result.samples.slice(530).every((row) => Math.abs(row[6] - 0.2) < 1e-6), 'Duty1 channel carries the duty readback');
    await link.close();
    await new Promise((r) => shellPort.close(r));
}

(async () => {
    await testBootLogAndProbe();
    await testStateMachine();
    await testDownloadShowsTheStep();
    console.log('All sim_scope_port tests passed.');
})().catch((err) => { console.error(err); process.exit(1); });
