'use strict';

// Registry of simulated serial devices (M12 of
// docs/GUI/02-navigation_overhaul.md). Simulated paths use a "sim://" scheme,
// so they can never collide with a real device. Serial clients create their
// port through createSerialPort(): a SimSerialPort for a simulated path, the
// real serialport otherwise.

const SIM_PREFIX = 'sim://';
const devices = new Map(); // path -> { device, info }

function isSimPath(path) {
    return typeof path === 'string' && path.startsWith(SIM_PREFIX);
}

// info: the entry SerialPort.list() would return for it (pnpId, vendorId,
// productId, manufacturer, serialNumber), so port pickers and auto-detect
// treat it like hardware.
function registerDevice(path, device, info = {}) {
    if (!isSimPath(path)) throw new Error(`simulated paths must start with ${SIM_PREFIX}`);
    devices.set(path, { device, info: { ...info, path } });
}

function unregisterDevice(path) {
    const entry = devices.get(path);
    if (!entry) return;
    devices.delete(path);
    if (entry.device.port && entry.device.port.isOpen) entry.device.port.close(() => {});
}

function deviceFor(path) {
    const entry = devices.get(path);
    return entry ? entry.device : null;
}

function listSimPorts() {
    return Array.from(devices.values()).map((entry) => ({ ...entry.info }));
}

function createSerialPort(opts, openCallback) {
    if (opts && isSimPath(opts.path)) {
        const { SimSerialPort } = require('./sim_serial_port');
        return new SimSerialPort(opts, openCallback);
    }
    const { SerialPort } = require('serialport');
    return new SerialPort(opts, openCallback);
}

module.exports = { SIM_PREFIX, isSimPath, registerDevice, unregisterDevice, deviceFor, listSimPorts, createSerialPort };
