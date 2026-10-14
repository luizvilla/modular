'use strict';

// Serializes serial operations per physical board, across extensions.
//
// An OwnTech/Core4 board exposes two USB interfaces: the ThingSet shell (if02)
// and the scope data port (if00). They are separate OS devices, but the same
// firmware serves both -- measured on a real board, while if00 streams a scope
// capture (~1.2s of printk output) the shell stops answering, and every if02
// read issued during the download failed. Keying the queue by USB serial
// number makes those operations wait for each other instead.

const { SerialPort } = require('serialport');

// SerialPort.list() costs ~450ms on Linux (udev scan). The last list is
// served immediately and refreshed in the background once stale, so after
// the first scan no operation waits on one; detect asks for a fresh list.
const PORT_LIST_TTL_MS = 5000;
let cache = null; // { at, ports }
let refreshing = null;

function refreshPorts() {
    if (!refreshing) {
        // MODULAR_SIM_ONLY=1 hides hardware, for deterministic tests and demos
        // on a machine with boards attached.
        const hardware = process.env.MODULAR_SIM_ONLY === '1' ? Promise.resolve([]) : SerialPort.list();
        refreshing = hardware
            .catch(() => [])
            .then((ports) => {
                // Simulated boards (M12) are listed like hardware.
                cache = { at: Date.now(), ports: (ports || []).concat(require('./sim').listSimPorts()) };
                return cache.ports;
            })
            .catch(() => (cache ? cache.ports : []))
            .finally(() => { refreshing = null; });
    }
    return refreshing;
}

// Drops the cached list, e.g. when a simulated board is added or removed.
function invalidatePorts() {
    cache = null;
}

async function listPorts({ fresh = false } = {}) {
    if (fresh || !cache) return refreshPorts();
    if (Date.now() - cache.at > PORT_LIST_TTL_MS) refreshPorts();
    return cache.ports;
}

// On Linux, SerialPort.list() also returns every legacy UART slot the kernel
// reserves (/dev/ttyS0..31) whether or not there is hardware behind it --
// 31 of 34 entries on a typical laptop. Those report nothing at all; a real
// device has at least a vendor, product, PnP id, manufacturer or serial.
function isPhantomPort(port) {
    if (process.platform !== 'linux' || !port) return false;
    return !port.vendorId && !port.productId && !port.pnpId && !port.manufacturer && !port.serialNumber;
}

async function boardKey(path) {
    const ports = await listPorts();
    const match = ports.find((p) => p && p.path === path);
    return match && match.serialNumber ? `usb:${match.serialNumber}` : `path:${path}`;
}

const queues = new Map(); // board key -> Promise (tail of that board's queue)

function runExclusive(key, fn) {
    const prev = queues.get(key) || Promise.resolve();
    const settled = prev.then(fn, fn);
    // The stored tail must never reject, or one failed operation would wedge
    // every later one on this board. Callers still see the real outcome.
    queues.set(key, settled.then(() => {}, () => {}));
    return settled;
}

async function runExclusiveOnBoard(path, fn) {
    return runExclusive(await boardKey(path), fn);
}

// Ports where a ThingSet shell answered the handshake this session, so port
// pickers can say so. Set by the ThingSet extension's sessions, cleared when
// an operation on the port fails.
const respondingShells = new Set();

function markShellResponding(path, responding) {
    if (responding) respondingShells.add(path);
    else respondingShells.delete(path);
}

function isShellResponding(path) {
    return respondingShells.has(path);
}

module.exports = { listPorts, invalidatePorts, isPhantomPort, boardKey, runExclusiveOnBoard, markShellResponding, isShellResponding };
