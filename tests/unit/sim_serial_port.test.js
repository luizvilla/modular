const assert = require('assert');
const registry = require('../../app/js/sim/index.js');

// A device that echoes what it receives, upper-cased.
function echoDevice() {
    const seen = { opens: 0, closes: 0, signals: [] };
    return {
        seen,
        onOpen() { seen.opens += 1; },
        onClose() { seen.closes += 1; },
        onSignals(port, opts) { seen.signals.push(opts); },
        onData(port, buf) { port.push(buf.toString().toUpperCase()); },
    };
}

const cb = (fn) => new Promise((resolve, reject) => fn((err) => (err ? reject(err) : resolve())));

async function run() {
    const path = 'sim://test/echo';
    const dev = echoDevice();
    registry.registerDevice(path, dev, { manufacturer: 'Test', serialNumber: 'T1', pnpId: 'usb-Test-if00', vendorId: '1234', productId: '5678' });

    assert.ok(registry.isSimPath(path));
    assert.ok(!registry.isSimPath('/dev/ttyACM0'));
    assert.throws(() => registry.registerDevice('/dev/fake', dev), /sim:\/\//);
    assert.deepStrictEqual(registry.listSimPorts(), [{ manufacturer: 'Test', serialNumber: 'T1', pnpId: 'usb-Test-if00', vendorId: '1234', productId: '5678', path }]);

    const port = registry.createSerialPort({ path, baudRate: 115200, autoOpen: false });
    assert.strictEqual(port.constructor.name, 'SimSerialPort');
    assert.strictEqual(port.isOpen, false);
    await cb((done) => port.open(done));
    assert.strictEqual(port.isOpen, true);
    assert.strictEqual(dev.seen.opens, 1);

    // Same exclusivity as a locked real port.
    const second = registry.createSerialPort({ path, autoOpen: false });
    await assert.rejects(cb((done) => second.open(done)), /Cannot lock port/);

    await cb((done) => port.set({ dtr: true }, done));
    assert.deepStrictEqual(dev.seen.signals, [{ dtr: true }]);

    const got = new Promise((resolve) => port.once('data', (d) => resolve(d.toString())));
    await cb((done) => port.write('hello', done));
    await cb((done) => port.drain(done));
    assert.strictEqual(await got, 'HELLO');

    // A stalled device never drains (what ThingSetSerialShell's I/O timeout is for).
    dev.stalled = true;
    let drained = false;
    port.drain(() => { drained = true; });
    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(drained, false);
    dev.stalled = false;

    let closed = false;
    port.on('close', () => { closed = true; });
    await cb((done) => port.close(done));
    assert.strictEqual(port.isOpen, false);
    assert.strictEqual(closed, true);
    assert.strictEqual(dev.seen.closes, 1);
    await assert.rejects(cb((done) => port.write('x', done)), /not open/);

    // Unknown simulated path fails like a missing device.
    const missing = registry.createSerialPort({ path: 'sim://nope', autoOpen: false });
    await assert.rejects(cb((done) => missing.open(done)), /No such file/);

    registry.unregisterDevice(path);
    assert.deepStrictEqual(registry.listSimPorts(), []);
}

run().then(() => console.log('All sim_serial_port tests passed.')).catch((err) => { console.error(err); process.exit(1); });
