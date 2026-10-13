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
        refreshing = SerialPort.list()
            .then((ports) => {
                cache = { at: Date.now(), ports: ports || [] };
                return cache.ports;
            })
            .catch(() => (cache ? cache.ports : []))
            .finally(() => { refreshing = null; });
    }
    return refreshing;
}

async function listPorts({ fresh = false } = {}) {
    if (fresh || !cache) return refreshPorts();
    if (Date.now() - cache.at > PORT_LIST_TTL_MS) refreshPorts();
    return cache.ports;
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

module.exports = { listPorts, boardKey, runExclusiveOnBoard };
