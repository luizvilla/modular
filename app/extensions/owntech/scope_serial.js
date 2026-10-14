'use strict';

// Client for the OwnTech/Core4 scope bulk-transfer side-channel (if00) --
// a small, fixed, non-ThingSet ASCII protocol, completely separate from the
// ThingSet Text Mode shell (if02) that the rest of this extension talks to.
// Ported line-for-line from the verified reference implementation at
// Core4/src/tools/scope_serial.py (ScopeSerial) and cross-checked against
// the firmware side at Core4/src/scope_data_port.cpp -- including the
// "8-digit hex line -> big-endian 32-bit float" byte format, which the
// migration plan had flagged as unconfirmed pending hardware/firmware
// access; both are now available in this environment and confirm big-endian.

// Real port, or the simulated board's for a sim:// path (M12).
const { createSerialPort } = require('../../js/sim');

const SCOPE_BAUDRATE = 115200;
const SCOPE_SAMPLE_COUNT = 1024;
const SCOPE_CHANNEL_NAMES = [
    'V1Low_V', 'V2Low_V', 'VHigh_V',
    'I1Low_A', 'I2Low_A', 'IHigh_A',
    'Duty1', 'Duty2',
];

const PROBE_RESPONSE = 'SCOPE-DATA/1 OK';
const BEGIN_RECORD = 'begin record';
const END_RECORD = 'end record';
const FINAL_INDEX_RE = /^# (\d+)$/;
const HEX_VALUE_RE = /^[0-9A-Fa-f]{8}$/;

class ScopeSerialError extends Error {}

// Pure helpers, extracted so they're unit-testable without a real serial
// port -- both directly cross-check the two things the migration plan
// flagged as the biggest hardware-verification unknowns for this milestone
// (byte format/endianness, and rotation correctness).
function parseHexFloat(line) {
    return Buffer.from(line, 'hex').readFloatBE(0);
}

function rotateToChronological(rows, finalIndex) {
    const total = rows.length;
    if (!total) return rows.slice();
    const firstIndex = ((finalIndex + 1) % total + total) % total;
    return rows.slice(firstIndex).concat(rows.slice(0, firstIndex));
}

class ScopeSerialLink {
    constructor({ path, baudRate = SCOPE_BAUDRATE } = {}) {
        if (!path) throw new Error('scope port path required');
        this.path = path;
        this.baudRate = baudRate;
        this.port = createSerialPort({ path, baudRate, autoOpen: false });
        this.readBuffer = Buffer.alloc(0);
        this._onData = this._onData.bind(this);
        this._listening = false;
    }

    _onData(chunk) {
        if (!chunk || !chunk.length) return;
        this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
    }

    async open() {
        if (!this.port.isOpen) {
            await new Promise((resolve, reject) => {
                this.port.open((err) => (err ? reject(err) : resolve()));
            });
        }
        if (!this._listening) {
            this.port.on('data', this._onData);
            this._listening = true;
        }
        this.readBuffer = Buffer.alloc(0);
    }

    async close() {
        if (this._listening) {
            try {
                this.port.off('data', this._onData);
            } catch (e) {
                try { this.port.removeListener('data', this._onData); } catch (e2) { /* ignore */ }
            }
            this._listening = false;
        }
        if (this.port.isOpen) {
            await new Promise((resolve) => { this.port.close(() => resolve()); });
        }
    }

    async _write(text) {
        await new Promise((resolve, reject) => {
            this.port.write(Buffer.from(text, 'ascii'), (err) => (err ? reject(err) : resolve()));
        });
    }

    // Reads one newline-terminated ASCII line out of this.readBuffer,
    // waking on the port's 'data' event the same way ThingSetSerialShell's
    // _waitForPrompt() does, rather than fixed-interval polling.
    async _readLine(deadline, maxLength = 256) {
        for (;;) {
            const idx = this.readBuffer.indexOf(0x0a);
            if (idx >= 0) {
                let line = this.readBuffer.slice(0, idx);
                this.readBuffer = this.readBuffer.slice(idx + 1);
                if (line.length && line[line.length - 1] === 0x0d) line = line.slice(0, -1);
                if (line.length > maxLength) {
                    throw new ScopeSerialError(`scope line exceeds ${maxLength} bytes`);
                }
                return line.toString('ascii');
            }
            if (this.readBuffer.length > maxLength) {
                throw new ScopeSerialError(`scope line exceeds ${maxLength} bytes`);
            }
            if (Date.now() >= deadline) {
                throw new ScopeSerialError('scope data-port response timed out');
            }
            await new Promise((resolve) => {
                const timer = setTimeout(() => {
                    try { this.port.off('data', handler); } catch (e) { /* ignore */ }
                    resolve();
                }, 80);
                const handler = () => {
                    clearTimeout(timer);
                    try { this.port.off('data', handler); } catch (e) { /* ignore */ }
                    resolve();
                };
                this.port.once('data', handler);
            });
        }
    }

    // Sends '?', expects a single line exactly "SCOPE-DATA/1 OK". Distinct
    // from (and not to be confused with) ThingSetSerialShell.enterThingSet()
    // -- this is a different port, a different protocol, no relation.
    //
    // The first probe after the link opens can go unanswered -- seen on a
    // real Core4 board right after app start, answered on the very next
    // try. It is resent once on the same open link: closing and reopening
    // right after a timeout caused a ~1 minute "Cannot lock port" storm (M8).
    async probe(timeoutMs = 1500, attempts = 2) {
        let lastErr = null;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            try {
                return await this._probeOnce(timeoutMs);
            } catch (err) {
                lastErr = err;
                if (!(err instanceof ScopeSerialError) || !/timed out/.test(err.message)) throw err;
            }
        }
        throw lastErr;
    }

    async _probeOnce(timeoutMs) {
        await this._write('?');
        const deadline = Date.now() + timeoutMs;
        for (let i = 0; i < 32; i += 1) {
            const line = await this._readLine(deadline);
            if (line === PROBE_RESPONSE) return;
            if (line.startsWith('SCOPE-DATA/1 ERROR')) {
                throw new ScopeSerialError(`scope probe rejected: ${line}`);
            }
        }
        throw new ScopeSerialError(`scope probe mismatch: "${PROBE_RESPONSE}" was not received`);
    }

    // Sends 'D', reads "begin record" / "#<channel names>" / "# <final
    // index>" / 1024*8 hex-encoded big-endian float lines / "end record",
    // then rotates the ring-buffer-ordered rows so the sample right after
    // the final index becomes index 0 (chronological order). onProgress(),
    // if given, fires periodically with { received, total } while the
    // 8192-line payload streams in -- captures take 1.3-20s depending on
    // decimation, so this is what drives a UI progress bar.
    async download({ onProgress, timeoutMs = 25000 } = {}) {
        await this._write('D');
        const deadline = Date.now() + timeoutMs;

        let sawBegin = false;
        for (let i = 0; i < 16; i += 1) {
            const line = await this._readLine(deadline);
            if (line === BEGIN_RECORD) { sawBegin = true; break; }
            if (line.startsWith('SCOPE-DATA/1 ERROR')) throw new ScopeSerialError(line);
        }
        if (!sawBegin) throw new ScopeSerialError('scope record start marker was not received');

        const channelLine = await this._readLine(deadline);
        if (!channelLine.startsWith('#')) throw new ScopeSerialError('scope channel header is malformed');
        const channelNames = channelLine.slice(1).split(',').filter(Boolean);
        const channelsMatch = channelNames.length === SCOPE_CHANNEL_NAMES.length
            && channelNames.every((name, index) => name === SCOPE_CHANNEL_NAMES[index]);
        if (!channelsMatch) {
            throw new ScopeSerialError(
                `scope channel header mismatch: expected [${SCOPE_CHANNEL_NAMES.join(',')}], got [${channelNames.join(',')}]`
            );
        }

        const finalIndexLine = await this._readLine(deadline);
        const match = FINAL_INDEX_RE.exec(finalIndexLine);
        if (!match) throw new ScopeSerialError('scope final-index line is malformed');
        const finalIndex = parseInt(match[1], 10);
        if (!(finalIndex >= 0 && finalIndex < SCOPE_SAMPLE_COUNT)) {
            throw new ScopeSerialError(`scope final index ${finalIndex} is out of range`);
        }

        const valueCount = SCOPE_SAMPLE_COUNT * channelNames.length;
        const values = new Array(valueCount);
        for (let index = 0; index < valueCount; index += 1) {
            const line = await this._readLine(deadline, 16);
            if (line === END_RECORD) {
                throw new ScopeSerialError(`scope payload is truncated at ${index}/${valueCount} values`);
            }
            if (!HEX_VALUE_RE.test(line)) {
                throw new ScopeSerialError(`scope payload value ${index} is not 8-digit hexadecimal`);
            }
            values[index] = parseHexFloat(line);
            if (typeof onProgress === 'function' && (index % 256 === 0 || index === valueCount - 1)) {
                onProgress({ received: index + 1, total: valueCount });
            }
        }

        const terminator = await this._readLine(deadline, 16);
        if (terminator !== END_RECORD) {
            if (HEX_VALUE_RE.test(terminator)) {
                throw new ScopeSerialError(`scope payload contains more than ${valueCount} values`);
            }
            throw new ScopeSerialError('scope record end marker is malformed');
        }

        const rows = [];
        for (let offset = 0; offset < valueCount; offset += channelNames.length) {
            rows.push(values.slice(offset, offset + channelNames.length));
        }
        const samples = rotateToChronological(rows, finalIndex);

        return { ok: true, channels: channelNames, samples, finalIndex };
    }
}

module.exports = {
    ScopeSerialLink,
    ScopeSerialError,
    parseHexFloat,
    rotateToChronological,
    SCOPE_BAUDRATE,
    SCOPE_SAMPLE_COUNT,
    SCOPE_CHANNEL_NAMES,
};
