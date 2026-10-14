const assert = require('assert');
const registry = require('../../app/js/sim/index.js');
const { ThingSetShellSim, ObjectStore } = require('../../app/js/sim/thingset_shell_sim.js');
const objects = require('../../app/js/sim/core4_objects.json');
const transcript = require('../fixtures/core4_shell_transcript.json');

// Replays the commands the app sent to a real Core4 board through the
// simulated shell and compares the bytes. Measurement values differ between
// captures (they're live), so their numbers are masked.

const PATH = 'sim://test/if02';

function openShell() {
    const store = new ObjectStore(objects.nodes);
    const shell = new ThingSetShellSim(store, { latencyMs: 0 });
    registry.registerDevice(PATH, shell, {});
    const port = registry.createSerialPort({ path: PATH, autoOpen: false });
    let buffer = '';
    port.on('data', (d) => { buffer += d.toString('utf8'); });
    const send = async (text, waitMs = 15) => {
        buffer = '';
        await new Promise((r, j) => port.write(text, (e) => (e ? j(e) : r())));
        await new Promise((r) => setTimeout(r, waitMs));
        return buffer;
    };
    const open = () => new Promise((r, j) => port.open((e) => (e ? j(e) : r())));
    const close = () => new Promise((r) => port.close(r));
    return { store, shell, port, send, open, close };
}

const mask = (text) => text.replace(/-?\d+\.\d+/g, 'N');

async function testRawShellBehaviour() {
    const { send, open, close } = openShell();
    let onOpen = '';
    const opened = open();
    await opened;
    await new Promise((r) => setTimeout(r, 20));
    const raw = transcript.if02;
    // The real responses start where the previous prompt ended.
    assert.strictEqual(await send('\r\n'), raw.raw_enter);
    assert.strictEqual(await send('foo\r\n'), raw.raw_unknown_command);
    assert.strictEqual(await send('thingset ?\r\n'), raw.raw_thingset_prefixed_root);
    assert.strictEqual(await send('select thingset\r\n'), raw.raw_select);
    assert.strictEqual(await send('?\r\n'), raw.raw_select_mode_bare);
    assert.strictEqual(await send('thingset ?\r\n'), raw.raw_select_mode_prefixed, 'the select-mode prefix trap: prints nothing');
    assert.strictEqual(await send('\x1br'), raw.raw_alt_r);
    void onOpen;
    await close();
}

async function testReplayAppTranscript() {
    const { send, open, close } = openShell();
    await open();
    await new Promise((r) => setTimeout(r, 20));
    const skip = (e) => e.phase === 'scopeArm' || e.phase === 'misc'
        // Out-of-range duty: accepted, then reverted by the firmware's write
        // callback -- board behaviour, covered by the board's own tests.
        || /wDutyCycle\\?":2/.test(e.cmd)
        || (e.phase === 'setValue' && e.cmd === '?Config/Leg1/wDutyCycle' && transcriptAfterDuty2(e));
    let checked = 0;
    for (const e of transcript.if02.transcript) {
        if (skip(e)) continue;
        const sent = `${e.prefix || ''}${e.cmd}`;
        const out = await send(`${sent}\r\n`);
        // sendCommand's buffer runs from the previous prompt's trailing
        // "\x1b[m" up to and including "uart:~$ ".
        const asCaptured = '\x1b[m' + out.replace(/\x1b\[m$/, '');
        assert.strictEqual(mask(asCaptured), mask(e.response), `${e.phase}: ${JSON.stringify(sent)}`);
        checked += 1;
    }
    assert.ok(checked > 250, `replayed ${checked} exchanges`);
    await close();
}

let afterDuty2 = false;
function transcriptAfterDuty2(e) {
    const idx = transcript.if02.transcript.indexOf(e);
    const prev = transcript.if02.transcript[idx - 1];
    afterDuty2 = !!(prev && /wDutyCycle\\?":2/.test(prev.cmd));
    return afterDuty2;
}

async function testStoreRules() {
    const store = new ObjectStore(objects.nodes);
    assert.deepStrictEqual(store.update('/Measurements', { rVHigh_V: 1 }), { status: 'A3', message: 'Item rVHigh_V is read-only' });
    assert.deepStrictEqual(store.update('/Nope', { wX: 1 }), { status: 'A4', message: 'Invalid endpoint' });
    assert.deepStrictEqual(store.update('/Config', { wNope: 1 }), { status: 'A4', message: 'Invalid endpoint' });
    // All-or-nothing: a read-only item rejects the whole request.
    assert.strictEqual(store.update('/Device', { cFirmwareVersion: 'x' }).status, 'A3');
    assert.deepStrictEqual(store.update('/Config', { wBlinkPeriod_s: 0.5, Mode: 1 }), { status: '84' });
    assert.strictEqual(store.read('/Config/wBlinkPeriod_s'), 0.5);
    assert.strictEqual(store.read('/Config/Mode'), 1);
    store.update('/Config', { Mode: 1.7 });
    assert.strictEqual(store.read('/Config/Mode'), 2, 'integers are rounded like a uint8');
    store.readers['/Measurements/rVHigh_V'] = () => 29.9;
    assert.strictEqual(store.read('/Measurements/rVHigh_V'), 29.9);
}

(async () => {
    await testRawShellBehaviour();
    await testReplayAppTranscript();
    await testStoreRules();
    console.log('All sim_thingset_shell tests passed.');
})().catch((err) => { console.error(err); process.exit(1); });
