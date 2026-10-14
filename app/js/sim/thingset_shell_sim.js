'use strict';

// Simulated Zephyr shell with a ThingSet text-mode backend, as a device for
// SimSerialPort (M12 of docs/GUI/02-navigation_overhaul.md). Framing and
// replies reproduce a Core4 board byte for byte (checked against
// tests/fixtures/core4_shell_transcript.json):
//   - echo of the line, "\r\n", the result, then the ANSI prompt
//     "\x1b[1;32muart:~$ \x1b[m";
//   - root mode: "thingset <request>" runs a request, "select thingset"
//     enters select mode, anything else is "<word>: command not found";
//   - select mode: every line is a request; anything that isn't one
//     (including a "thingset ..." line) prints nothing;
//   - Alt+R (ESC r) restores root mode;
//   - "?path" / "?path null" / "=path {json}" with ":85", ":84", ":A3", ":A4".
//
// The store (ObjectStore below) answers reads and writes; the board wires in
// firmware behaviour and physics.

const PROMPT = '\x1b[1;32muart:~$ \x1b[m';
const RED = '\x1b[1;31m';
const RESET = '\x1b[m';

class ObjectStore {
    // nodes: core4_objects.json's nodes. Hooks:
    //   readers[path] = () => value          live values (physics)
    //   beforeWrite(path, next, prev) -> value | undefined   firmware callbacks
    constructor(nodes) {
        this.nodes = new Map(nodes.map((n) => [n.path, { ...n }]));
        this.values = new Map(nodes.filter((n) => n.kind !== 'group').map((n) => [n.path, n.value]));
        this.readers = {};
        this.writeHooks = [];
        this.afterUpdateHooks = [];
    }

    node(path) { return this.nodes.get(path) || null; }

    read(path) {
        return this.readers[path] ? this.readers[path]() : this.values.get(path);
    }

    // Raw firmware state, bypassing access checks (for the board's own use).
    set(path, value) { this.values.set(path, value); }

    onWrite(fn) { this.writeHooks.push(fn); }

    // Called once per accepted update with the paths written, after the
    // values are in place (e.g. to re-target the power stage at that instant).
    afterUpdate(fn) { this.afterUpdateHooks.push(fn); }

    // Applies {name: value} to a group like a ThingSet update. All-or-nothing:
    // any unknown or read-only item rejects the whole request.
    update(groupPath, obj) {
        const group = this.node(groupPath);
        if (!group || group.kind !== 'group') return { status: 'A4', message: 'Invalid endpoint' };
        for (const name of Object.keys(obj)) {
            const node = this.node(join(groupPath, name));
            if (!node) return { status: 'A4', message: 'Invalid endpoint' };
            if (node.kind === 'group') return { status: 'A4', message: 'Invalid endpoint' };
            if (node.access !== 'rw') return { status: 'A3', message: `Item ${name} is read-only` };
        }
        for (const [name, raw] of Object.entries(obj)) {
            const path = join(groupPath, name);
            const prev = this.values.get(path);
            let next = coerce(this.node(path), raw, prev);
            for (const hook of this.writeHooks) {
                const replaced = hook(path, next, prev);
                if (replaced !== undefined) next = replaced;
            }
            this.values.set(path, next);
        }
        const paths = Object.keys(obj).map((name) => join(groupPath, name));
        this.afterUpdateHooks.forEach((fn) => fn(paths));
        return { status: '84' };
    }
}

function join(parent, name) {
    return parent === '/' ? `/${name}` : `${parent}/${name}`;
}

function coerce(node, raw, prev) {
    switch (node.type) {
        case 'bool': return raw === true || raw === 1 || raw === 'true';
        case 'int': { const n = Math.round(Number(raw)); return Number.isFinite(n) ? n : prev; }
        case 'float': { const n = Number(raw); return Number.isFinite(n) ? n : prev; }
        case 'string': return String(raw);
        default: return raw;
    }
}

// Formats a value the way the firmware prints it (fixed float precision).
function formatValue(node, value) {
    if (!node) return 'null';
    if (node.kind === 'group') return 'null';
    switch (node.type) {
        case 'bool': return value ? 'true' : 'false';
        case 'int': return String(Math.round(Number(value) || 0));
        case 'float': return Number(value || 0).toFixed(node.decimals != null ? node.decimals : 2);
        case 'string': return JSON.stringify(String(value));
        default: return JSON.stringify(value === undefined ? null : value);
    }
}

class ThingSetShellSim {
    constructor(store, { latencyMs = 8 } = {}) {
        this.store = store;
        this.latencyMs = latencyMs;
        this.mode = 'root';
        this.line = '';
        this.lastWasCR = false;
        this.escape = '';
        this.port = null;
        this.outQueue = Promise.resolve();
        // Fault injection: when true, nothing is read or answered (a busy or
        // wedged firmware); the transport's drain() also never completes.
        this.stalled = false;
        this.silent = false;
        // While held (the firmware busy streaming a scope capture on if00),
        // input waits and is answered afterwards -- late, like the board.
        this.held = false;
        this.heldInput = [];
    }

    hold(on) {
        this.held = !!on;
        if (!this.held && this.heldInput.length) {
            const pending = this.heldInput.join('');
            this.heldInput = [];
            for (const ch of pending) this._char(ch);
        }
    }

    // --- SimSerialPort device API ---
    onOpen() {
        // Zephyr redraws the prompt when the host opens the CDC ACM port.
        this._emit(`${RESET}\r\n${PROMPT}`, 5);
    }

    onClose() {
        this.line = '';
        this.escape = '';
    }

    onSignals() {}

    onData(port, buf) {
        if (this.stalled || this.silent) return;
        if (this.held) { this.heldInput.push(buf.toString('utf8')); return; }
        for (const ch of buf.toString('utf8')) this._char(ch);
    }

    // --- line discipline ---
    _char(ch) {
        if (this.escape) {
            this.escape += ch;
            if (this.escape === '\x1br') { this.escape = ''; this._altR(); return; }
            if (this.escape.length >= 3 || /[A-Za-z~]/.test(ch)) this.escape = '';
            return;
        }
        if (ch === '\x1b') { this.escape = ch; return; }
        if (ch === '\n' && this.lastWasCR) { this.lastWasCR = false; return; }
        if (ch === '\r' || ch === '\n') {
            this.lastWasCR = ch === '\r';
            const line = this.line;
            this.line = '';
            this._emit(`${line}\r\n${this._execute(line)}${PROMPT}`, this.latencyMs);
            return;
        }
        this.lastWasCR = false;
        if (ch === '\x7f' || ch === '\b') { this.line = this.line.slice(0, -1); return; }
        if (ch >= ' ') this.line += ch;
    }

    _altR() {
        this.mode = 'root';
        this.line = '';
        this._emit(`\x1b[8D\x1b[J\x1b[1;33mRestored default root commands\r\n${RESET}${PROMPT}`, this.latencyMs);
    }

    _emit(text, delay) {
        const port = this.port;
        if (!port) return;
        this.outQueue = this.outQueue.then(() => new Promise((resolve) => {
            setTimeout(() => { if (port.isOpen) port.push(text); resolve(); }, delay);
        }));
    }

    // Returns the result text (each line ending in \r\n), without the prompt.
    _execute(line) {
        const trimmed = line.trim();
        if (!trimmed) return '';
        if (this.mode === 'select') {
            return isRequest(trimmed) ? this._request(trimmed) : '';
        }
        const word = trimmed.split(/\s+/)[0];
        const rest = trimmed.slice(word.length).trim();
        if (word === 'thingset') return rest ? this._request(rest) : '';
        if (word === 'select') {
            if (rest === 'thingset') { this.mode = 'select'; return ''; }
            return `${RED}select: wrong parameter count\r\n${RESET}`;
        }
        if (word === 'help') {
            return 'Please press the <Tab> button to see all available commands.\r\n'
                + 'You can also use the <Tab> button to prompt or auto-complete all commands or its subcommands\r\n'
                + 'You can try to call commands with <-h> or <--help> parameter for more information.\r\n';
        }
        return `${RED}${word}: command not found\r\n${RESET}`;
    }

    // ThingSet text mode: "?path [null]" and "=path {json}".
    _request(text) {
        const op = text[0];
        const body = text.slice(1);
        const space = body.indexOf(' ');
        const rawPath = space >= 0 ? body.slice(0, space) : body;
        const arg = space >= 0 ? body.slice(space + 1).trim() : '';
        const path = '/' + rawPath.replace(/^\/+|\/+$/g, '');
        const node = this.store.node(path === '/' ? '/' : path);
        if (op === '?') {
            if (!node) return ':A4 "Invalid endpoint"\r\n';
            if (arg === 'null') {
                const names = node.kind === 'group' ? node.children : [];
                return `:85 ${JSON.stringify(names)}\r\n`;
            }
            if (node.kind === 'group') {
                const parts = node.children.map((name) => {
                    const child = this.store.node(join(path, name));
                    const value = child && child.kind !== 'group' ? this.store.read(child.path) : null;
                    return `${JSON.stringify(name)}:${formatValue(child, value)}`;
                });
                return `:85 {${parts.join(',')}}\r\n`;
            }
            return `:85 ${formatValue(node, this.store.read(path))}\r\n`;
        }
        if (op === '=') {
            let obj;
            try { obj = JSON.parse(arg.replace(/\\"/g, '"')); } catch (e) { return ':A0 "Bad Request"\r\n'; }
            if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ':A0 "Bad Request"\r\n';
            const res = this.store.update(path, obj);
            return res.status === '84' ? ':84\r\n' : `:${res.status} ${JSON.stringify(res.message)}\r\n`;
        }
        return ':A5 "Method Not Allowed"\r\n';
    }
}

function isRequest(text) {
    return /^[?=+\-!]/.test(text);
}

module.exports = { ThingSetShellSim, ObjectStore, formatValue, PROMPT };
