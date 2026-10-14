'use strict';

// In-process stand-in for serialport's SerialPort, for simulated devices
// (M12 of docs/GUI/02-navigation_overhaul.md). It implements the subset the
// app's serial clients use -- ThingSetSerialShell and ScopeSerialLink --
// so everything above the transport runs its real code path:
//   open(cb), set({dtr}, cb), write(data, cb), drain(cb), flush(cb),
//   close(cb), isOpen, path, and 'data' / 'close' events.
//
// A device attaches to a path in the registry (./index.js) and implements:
//   onOpen(port), onClose(port), onData(port, Buffer), onSignals(port, opts)
// and answers by calling port.push(bytes).

const { EventEmitter } = require('events');

class SimSerialPort extends EventEmitter {
    constructor({ path, baudRate = 115200, autoOpen = true } = {}, openCallback) {
        super();
        this.path = path;
        this.baudRate = baudRate;
        this.isOpen = false;
        this._device = null;
        this.settings = { path, baudRate };
        if (autoOpen) this.open(openCallback);
    }

    open(cb) {
        const registry = require('./index');
        const device = registry.deviceFor(this.path);
        setImmediate(() => {
            if (!device) {
                const err = new Error(`Error: No such file or directory, cannot open ${this.path}`);
                if (cb) cb(err); else this.emit('error', err);
                return;
            }
            // Same exclusivity as a real port opened with the default lock.
            if (device.port && device.port !== this && device.port.isOpen) {
                const err = new Error('Error Resource temporarily unavailable Cannot lock port');
                if (cb) cb(err); else this.emit('error', err);
                return;
            }
            this._device = device;
            device.port = this;
            this.isOpen = true;
            this.emit('open');
            if (cb) cb(null);
            if (typeof device.onOpen === 'function') device.onOpen(this);
        });
    }

    set(opts, cb) {
        if (this._device && typeof this._device.onSignals === 'function') this._device.onSignals(this, opts || {});
        setImmediate(() => cb && cb(null));
    }

    write(data, encodingOrCb, maybeCb) {
        const cb = typeof encodingOrCb === 'function' ? encodingOrCb : maybeCb;
        if (!this.isOpen) {
            const err = new Error('Port is not open');
            setImmediate(() => (cb ? cb(err) : this.emit('error', err)));
            return false;
        }
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
        const device = this._device;
        setImmediate(() => {
            if (cb) cb(null);
            if (device && this.isOpen && typeof device.onData === 'function') device.onData(this, buf);
        });
        return true;
    }

    drain(cb) {
        // A wedged device never drains -- the timeout handling in
        // ThingSetSerialShell exists for exactly that (fault injection).
        if (this._device && this._device.stalled) return;
        setImmediate(() => cb && cb(null));
    }

    flush(cb) {
        setImmediate(() => cb && cb(null));
    }

    close(cb) {
        const device = this._device;
        const wasOpen = this.isOpen;
        this.isOpen = false;
        this._device = null;
        if (device && device.port === this) device.port = null;
        setImmediate(() => {
            if (wasOpen) {
                if (device && typeof device.onClose === 'function') device.onClose(this);
                this.emit('close');
            }
            if (cb) cb(null);
        });
    }

    // Called by the device: bytes from the device to the app.
    push(bytes) {
        if (!this.isOpen) return;
        this.emit('data', Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8'));
    }
}

module.exports = { SimSerialPort };
