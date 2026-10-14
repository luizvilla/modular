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

// --- the demo OwnTech board ---
const DEMO = { base: 'sim://owntech-demo', serialNumber: 'SIM00000001' };
let demo = null; // { board, scope }

// Adds a simulated OwnTech/Core4 board: its ThingSet shell (if02) and scope
// data port (if00), listed like a real board's two USB interfaces.
function enableDemoBoard(options = {}) {
    if (demo) return demo;
    const { OwnTechSimBoard } = require('./owntech_board');
    const { ScopePortSim } = require('./scope_port_sim');
    const board = new OwnTechSimBoard({ serialNumber: DEMO.serialNumber, ...options });
    const scope = new ScopePortSim(board);
    const info = (iface) => ({
        manufacturer: 'OwnTech Technologies',
        serialNumber: DEMO.serialNumber,
        pnpId: `usb-OwnTech_Technologies_Demo_${DEMO.serialNumber}-if${iface}`,
        vendorId: '2fe3',
        productId: '0100',
        simulated: true,
    });
    registerDevice(`${DEMO.base}/if02`, board.shell, info('02'));
    registerDevice(`${DEMO.base}/if00`, scope, info('00'));
    demo = { board, scope };
    invalidateListedPorts();
    return demo;
}

function disableDemoBoard() {
    if (!demo) return;
    unregisterDevice(`${DEMO.base}/if02`);
    unregisterDevice(`${DEMO.base}/if00`);
    demo = null;
    invalidateListedPorts();
}

function demoBoard() {
    return demo;
}

function invalidateListedPorts() {
    try { require('../serial_board_lock').invalidatePorts(); } catch (e) { /* not loaded */ }
}

// MODULAR_SIM_BOARD=1 enables the demo board at startup (scripts, CI);
// "loadOhm=10,vHigh=30" style values override the defaults.
function enableFromEnv(env = process.env) {
    const raw = String(env.MODULAR_SIM_BOARD || '').trim();
    if (!raw || raw === '0' || raw === 'false') return null;
    const options = {};
    raw.split(',').forEach((part) => {
        const [k, v] = part.split('=').map((x) => x && x.trim());
        if (k === 'vHigh' && Number.isFinite(Number(v))) options.vHigh = Number(v);
        if (k === 'loadOhm' && Number.isFinite(Number(v))) options.loadsOhm = [Number(v), Infinity];
    });
    return enableDemoBoard(options);
}

module.exports = {
    SIM_PREFIX, isSimPath, registerDevice, unregisterDevice, deviceFor, listSimPorts, createSerialPort,
    DEMO, enableDemoBoard, disableDemoBoard, demoBoard, enableFromEnv,
};
