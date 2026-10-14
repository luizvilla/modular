'use strict';

// Simulated OwnTech scope data port (if00) for SimSerialPort (M12 of
// docs/GUI/02-navigation_overhaul.md), reproducing Core4's
// scope_data_port.cpp: console_getchar() reads one character at a time --
//   '?' -> "SCOPE-DATA/1 OK"
//   'D' -> the capture record when READY ("begin record", "#<channels>,",
//          "# <final index>", 8192 big-endian hex floats, "end record"),
//          otherwise "SCOPE-DATA/1 ERROR NOT_READY <state>"
//   anything else (including \r and \n) -> "SCOPE-DATA/1 ERROR UNKNOWN_COMMAND"
// printk output arrives as \r\n line endings. On the first open after boot
// the console's 1024-byte buffer of boot log comes first, cut mid-line, so
// the first reply lands at the end of that line (the real "first probe
// times out" behaviour). A download streams at the real rate (~1.15 s),
// with the scope STREAMING and the board's ThingSet shell held meanwhile.

const { SCOPE } = require('./owntech_board');

const LINES_PER_CHUNK = 256;
const STREAM_MS = 1150;

function hex32(value) {
    const buf = Buffer.alloc(4);
    buf.writeFloatBE(Number(value) || 0, 0);
    return buf.toString('hex');
}

class ScopePortSim {
    constructor(board, { latencyMs = 2 } = {}) {
        this.board = board;
        this.latencyMs = latencyMs;
        this.port = null;
        this.bootLogPending = true;
        this.streaming = null;
        this.out = Promise.resolve();
        // Fault injection.
        this.stalled = false; // the port stops reading (a wedged firmware task)
        this.dropFirstProbe = false; // force the first-probe failure without a boot log
    }

    // A reboot refills the console buffer with boot log.
    reboot() { this.bootLogPending = true; }

    onOpen() {
        if (this.bootLogPending && this.board.bootLog) {
            this.bootLogPending = false;
            this._emit(this.board.bootLog, 1);
        }
    }

    onClose() {
        // printk keeps going on the device side; the stream simply ends
        // unread, and the scope returns to READY like scope_capture_end_stream.
        if (this.streaming) this.streaming.aborted = true;
    }

    onSignals() {}

    onData(port, buf) {
        if (this.stalled) return;
        for (const ch of buf.toString('latin1')) this._command(ch);
    }

    _command(ch) {
        if (ch === '?') {
            if (this.dropFirstProbe) { this.dropFirstProbe = false; return; }
            this._emit('SCOPE-DATA/1 OK\r\n');
            return;
        }
        if (ch === 'D') { this._download(); return; }
        this._emit('SCOPE-DATA/1 ERROR UNKNOWN_COMMAND\r\n');
    }

    _download() {
        const board = this.board;
        const state = board.scopeState();
        if (state !== SCOPE.READY) {
            this._emit(`SCOPE-DATA/1 ERROR NOT_READY ${SCOPE.STATE_NAMES[state] || 'UNKNOWN'}\r\n`);
            return;
        }
        const rows = board.scopeBuffer();
        const lines = ['begin record', `#${SCOPE.CHANNELS.join(',')},`, `# ${board.scope.finalIndex}`];
        for (const row of rows) for (const v of row) lines.push(hex32(v));
        lines.push('end record');
        board.scope.state = SCOPE.STREAMING;
        if (board.shell && board.options.shellHeldDuringDownload !== false) board.shell.hold(true);
        const stream = { aborted: false };
        this.streaming = stream;
        const chunks = [];
        for (let i = 0; i < lines.length; i += LINES_PER_CHUNK) chunks.push(lines.slice(i, i + LINES_PER_CHUNK).join('\r\n') + '\r\n');
        const gap = Math.max(1, Math.round(STREAM_MS / chunks.length));
        chunks.forEach((chunk) => this._emit(chunk, gap, stream));
        this.out = this.out.then(() => {
            if (this.streaming === stream) this.streaming = null;
            board.scope.state = SCOPE.READY;
            if (board.shell) board.shell.hold(false);
        });
    }

    _emit(text, delay = this.latencyMs, stream = null) {
        this.out = this.out.then(() => new Promise((resolve) => {
            setTimeout(() => {
                const port = this.port;
                if (port && port.isOpen && !(stream && stream.aborted)) port.push(text);
                resolve();
            }, delay);
        }));
    }
}

module.exports = { ScopePortSim, hex32 };
