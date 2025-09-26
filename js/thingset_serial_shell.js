'use strict';

const { SerialPort } = require('serialport');

const PROMPT_RE = /([A-Za-z0-9_-]+):~\$\s/;
const DEFAULT_PREFIX = 'thingset ';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePath(path) {
  if (!path || path === '/') return '';
  return path.replace(/^\/+/, '');
}

function commandPath(path) {
  if (!path || path === '/') return '';
  return normalizePath(path);
}

function parentPath(path) {
  if (!path || path === '/') return '/';
  const trimmed = path.replace(/^\/+|\/+$/g, '');
  if (!trimmed || !trimmed.includes('/')) return '/';
  return '/' + trimmed.slice(0, trimmed.lastIndexOf('/'));
}

function pathDepth(path) {
  if (!path || path === '/') return 0;
  return normalizePath(path).split('/').filter(Boolean).length;
}

function formatId(num) {
  if (num == null || Number.isNaN(num)) return null;
  const n = Number(num);
  if (!Number.isFinite(n)) return null;
  return '0x' + n.toString(16).toUpperCase();
}

function parseIntMaybe(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) return value;
  if (typeof value === 'string') {
    const txt = value.trim();
    if (!txt) return null;
    try {
      return Number.parseInt(txt, txt.startsWith('0x') ? 16 : 10);
    } catch (e) {
      return null;
    }
  }
  return null;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map((v) => sanitize(v));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[String(k)] = sanitize(v);
    return out;
  }
  if (value === undefined) return null;
  return value;
}

function escapeJsonForShell(jsonText) {
  return jsonText.replace(/"/g, '\\"');
}

function formatJsonArgument(value) {
  if (value === undefined) return '';
  if (value === null) return ' null';
  const raw = JSON.stringify(value);
  const needsEscape = raw.includes('"');
  const encoded = needsEscape ? escapeJsonForShell(raw) : raw;
  return ` ${encoded}`;
}

function parseScalarText(text) {
  if (text == null) return { kind: 'str', value: null };
  const v = String(text).trim();
  if (!v) return { kind: 'str', value: '' };
  const lower = v.toLowerCase();
  if (lower === 'true' || lower === 'false') return { kind: 'bool', value: lower === 'true' };
  if (lower === 'null') return { kind: 'null', value: null };
  if (/^0x[0-9a-f]+$/i.test(v)) {
    try { return { kind: 'int', value: Number.parseInt(v, 16) }; } catch {}
  }
  if (/^[+-]?\d+$/.test(v)) {
    try { return { kind: 'int', value: Number.parseInt(v, 10) }; } catch {}
  }
  if (/^[+-]?(\d+\.\d*|\.\d+)([eE][+-]?\d+)?$/.test(v)) {
    try { return { kind: 'float', value: Number.parseFloat(v) }; } catch {}
  }
  return { kind: 'str', value: v };
}

class ThingSetSerialShell {
  constructor({ path, baudRate = 115200, usePrefix = false, commandPrefix = null, verbose = false, existingPort = null } = {}) {
    if (!path && !existingPort) throw new Error('Serial path required');
    this.path = path || existingPort?.path || existingPort?.settings?.path || 'unknown';
    this.baudRate = baudRate;
    const resolvedPrefix = (() => {
      if (typeof commandPrefix === 'string') return commandPrefix;
      if (typeof usePrefix === 'string') return usePrefix;
      return usePrefix ? DEFAULT_PREFIX : '';
    })();
    this.commandPrefix = resolvedPrefix || '';
    this.initialCommandPrefix = this.commandPrefix;
    this.autoPrefixCandidate = DEFAULT_PREFIX;
    this.usePrefix = Boolean(this.commandPrefix);
    this.verbose = verbose;
    this.ownsPort = !existingPort;
    this.port = existingPort || new SerialPort({ path: this.path, baudRate, autoOpen: false });
    this.readBuffer = Buffer.alloc(0);
    this.prompt = null;
    this._onData = this._onData.bind(this);
    this._listening = false;
  }

  _dbg(msg) {
    if (this.verbose) {
      // eslint-disable-next-line no-console
      console.log(`[ThingSetSerial ${this.path}] ${msg}`);
    }
  }

  _dbgBuf(prefix, buf) {
    if (!this.verbose) return;
    // eslint-disable-next-line no-console
    console.log(`[ThingSetSerial ${this.path}] ${prefix} ${JSON.stringify(buf.toString('utf8'))}`);
    // eslint-disable-next-line no-console
    console.log(`[ThingSetSerial ${this.path}] ${prefix} HEX ${buf.toString('hex')}`);
  }

  _onData(chunk) {
    if (!chunk || !chunk.length) return;
    this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
  }

  async open() {
    if (this.ownsPort) {
      if (!this.port.isOpen) {
        await new Promise((resolve, reject) => {
          this.port.open((err) => {
            if (err) return reject(err);
            resolve();
          });
        });
        // Toggling DTR helps wake some CDC devices; ignore failures (e.g., not supported)
        if (typeof this.port.set === 'function') {
          try {
            await new Promise((resolve, reject) => {
              this.port.set({ dtr: false }, (err) => (err ? reject(err) : resolve()));
            });
            await delay(20);
            await new Promise((resolve, reject) => {
              this.port.set({ dtr: true }, (err) => (err ? reject(err) : resolve()));
            });
          } catch {}
        }
      }
    } else if (!this.port.isOpen) {
      throw new Error(`Serial port ${this.path} is not open`);
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
      } catch {
        try { this.port.removeListener('data', this._onData); } catch {}
      }
      this._listening = false;
    }
    if (this.ownsPort && this.port.isOpen) {
      await new Promise((resolve) => {
        this.port.close(() => resolve());
      });
    }
  }

  _findPrompt(buffer) {
    if (!buffer.length) return null;
    const txt = buffer.toString('utf8');
    let match = null;
    let idx = -1;
    let m;
    const regex = new RegExp(PROMPT_RE.source, 'g');
    while ((m = regex.exec(txt)) !== null) {
      match = m;
      idx = m.index;
    }
    if (!match || idx < 0) return null;
    return { start: idx, end: idx + match[0].length };
  }

  async _waitForPrompt(timeoutMs = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = this._findPrompt(this.readBuffer);
      if (found) {
        const data = this.readBuffer.slice(0, found.end);
        this.readBuffer = this.readBuffer.slice(found.end);
        this.prompt = data.slice(found.start, found.end);
        return data;
      }
      const got = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (typeof this.port.off === 'function') this.port.off('data', handler);
          else this.port.removeListener('data', handler);
          resolve(false);
        }, 80);
        const handler = () => {
          clearTimeout(timer);
          if (typeof this.port.off === 'function') this.port.off('data', handler);
          else this.port.removeListener('data', handler);
          resolve(true);
        };
        this.port.once('data', handler);
      });
      if (!got) break;
    }
    const data = this.readBuffer;
    this.readBuffer = Buffer.alloc(0);
    return data;
  }

  async sendCommand(cmd, readTimeout = 2000) {
    if (!this.port.isOpen) throw new Error('Serial port not open');
    let payload = cmd;
    if (!payload.endsWith('\n') && !payload.endsWith('\r')) payload += '\r\n';
    const eolMatch = payload.match(/(\r?\n)$/);
    const eol = eolMatch ? eolMatch[1] : '\r\n';
    const body = eolMatch ? payload.slice(0, -eol.length) : payload;
    const prefix = this.commandPrefix || '';
    let final = body;
    if (prefix && body.trim().length > 0 && !body.startsWith(prefix)) {
      final = `${prefix}${body}`;
    }
    payload = `${final}${eol}`;
    this._dbg(`TX: ${JSON.stringify(payload)}`);
    await new Promise((resolve, reject) => {
      this.port.write(payload, (err) => {
        if (err) return reject(err);
        this.port.drain((drainErr) => {
          if (drainErr) return reject(drainErr);
          resolve();
        });
      });
    });
    const buf = await this._waitForPrompt(readTimeout);
    this._dbgBuf('RX:', buf);
    return buf;
  }

  setCommandPrefix(prefix) {
    this.commandPrefix = prefix ? String(prefix) : '';
    this.usePrefix = Boolean(this.commandPrefix);
  }

  getCommandPrefix() {
    return this.commandPrefix;
  }

  _parseResponseBuffer(buffer) {
    const text = buffer ? buffer.toString('utf8') : '';
    const statusMatch = text.match(/:([0-9A-Fa-f]{2})(?:\s|$)/);
    const statusHex = statusMatch ? statusMatch[1].toUpperCase() : null;
    const status = statusHex != null ? Number.parseInt(statusHex, 16) : null;
    const json = this._extractJson(text);
    let scalarToken = null;
    const tokenMatch = text.match(/:[0-9A-Fa-f]{2,}\s+(.*)/);
    if (tokenMatch) {
      const token = tokenMatch[1].trim().split(/\r?\n/)[0].trim();
      if (token) scalarToken = token;
    }
    return { text, status, statusHex, json, scalarToken };
  }

  _isSuccessStatus(statusHex) {
    if (!statusHex) return false;
    const code = statusHex.toUpperCase();
    return code === '81' || code === '82' || code === '84' || code === '85';
  }

  isSuccessStatus(statusHex) {
    return this._isSuccessStatus(statusHex);
  }

  async get(path, timeout = 1500) {
    const target = commandPath(path);
    const cmd = target ? `?${target}` : '?';
    const buf = await this.sendCommand(cmd, timeout);
    return this._parseResponseBuffer(buf);
  }

  async fetch(path, argument = undefined, timeout = 1500) {
    const target = commandPath(path);
    const suffix = formatJsonArgument(argument);
    const base = target ? `?${target}` : '?';
    const buf = await this.sendCommand(`${base}${suffix}`, timeout);
    return this._parseResponseBuffer(buf);
  }

  async update(path, values, timeout = 2000) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new Error('ThingSet update payload must be a JSON object');
    }
    const target = commandPath(path);
    const base = target ? `=${target}` : '=';
    const buf = await this.sendCommand(`${base}${formatJsonArgument(values)}`, timeout);
    return this._parseResponseBuffer(buf);
  }

  async create(path, value, timeout = 2000) {
    const target = commandPath(path);
    const base = target ? `+${target}` : '+';
    const buf = await this.sendCommand(`${base}${formatJsonArgument(value)}`, timeout);
    return this._parseResponseBuffer(buf);
  }

  async deleteValue(path, value = undefined, timeout = 2000) {
    const target = commandPath(path);
    const base = target ? `-${target}` : '-';
    const buf = await this.sendCommand(`${base}${formatJsonArgument(value)}`, timeout);
    return this._parseResponseBuffer(buf);
  }

  async exec(path, args = undefined, timeout = 2000) {
    const target = commandPath(path);
    const base = target ? `!${target}` : '!';
    let suffix = '';
    if (args !== undefined) {
      const payload = Array.isArray(args) ? args : [args];
      suffix = formatJsonArgument(payload);
    }
    const buf = await this.sendCommand(`${base}${suffix}`, timeout);
    return this._parseResponseBuffer(buf);
  }

  _extractJson(text) {
    if (!text) return null;
    const idx = text.search(/[\[{]/);
    if (idx < 0) return null;
    const stack = [];
    let end = -1;
    for (let i = idx; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '{' || ch === '[') stack.push(ch);
      else if (ch === '}' || ch === ']') {
        if (!stack.length) return null;
        const top = stack.pop();
        if ((top === '{' && ch !== '}') || (top === '[' && ch !== ']')) return null;
        if (!stack.length) {
          end = i + 1;
          break;
        }
      }
    }
    if (end < 0) return null;
    const snippet = text.slice(idx, end);
    try {
      return JSON.parse(snippet);
    } catch (e) {
      return null;
    }
  }

  async enterThingSet() {
    this.readBuffer = Buffer.alloc(0);
    this.prompt = null;
    if (typeof this.port.flush === 'function') {
      try {
        await new Promise((resolve, reject) => {
          this.port.flush((err) => (err ? reject(err) : resolve()));
        });
      } catch {}
    }
    const writeRaw = async (data) => new Promise((resolve, reject) => {
      this.port.write(data, (err) => {
        if (err) return reject(err);
        this.port.drain((drainErr) => {
          if (drainErr) return reject(drainErr);
          resolve();
        });
      });
    });

    for (let i = 0; i < 3; i += 1) {
      try {
        await writeRaw('\r\n');
        await delay(60);
        const found = this._findPrompt(this.readBuffer);
        if (found) {
          this.prompt = this.readBuffer.slice(found.start, found.end);
          this.readBuffer = this.readBuffer.slice(found.end);
          break;
        }
      } catch {}
    }

    const tryProbe = async () => {
      try {
        const out1 = await this.sendCommand('?', 1200);
        if (this._extractJson(out1.toString('utf8')) != null) return true;
      } catch {}
      try {
        const out2 = await this.sendCommand('ls /', 1200);
        if (this._extractJson(out2.toString('utf8')) != null) return true;
      } catch {}
      try {
        await this.sendCommand('select thingset', 1200);
        const out3 = await this.sendCommand('?', 1200);
        if (this._extractJson(out3.toString('utf8')) != null) return true;
      } catch {}
      return false;
    };

    if (await tryProbe()) return true;
    const original = this.getCommandPrefix();
    if (original !== this.autoPrefixCandidate) {
      this._dbg(`Retrying with '${this.autoPrefixCandidate}' prefix`);
      this.setCommandPrefix(this.autoPrefixCandidate);
      const ok = await tryProbe();
      if (ok) return true;
      this.setCommandPrefix(original);
      this._dbg('ThingSet probe still unsuccessful; continuing best-effort');
    }
    // Even if probing failed, keep going so higher-level code can surface richer errors.
    return true;
  }

  async _qNames(path) {
    let response;
    try {
      response = await this.fetch(path, null);
    } catch (err) {
      this._dbg(`_qNames error (${path}): ${err?.message || err}`);
      return null;
    }
    if (!response) return null;
    if (!this._isSuccessStatus(response.statusHex)) return null;
    if (!Array.isArray(response.json)) return null;
    return response.json;
  }

  async _qFetch(path) {
    let response;
    try {
      response = await this.get(path);
    } catch (err) {
      this._dbg(`_qFetch error (${path}): ${err?.message || err}`);
      return null;
    }
    if (!response) return null;
    if (!this._isSuccessStatus(response.statusHex) && !response.json && !response.scalarToken) return null;
    if (response.json !== null && response.json !== undefined) return response.json;
    if (response.scalarToken) return response.scalarToken;
    return null;
  }

  async listNodes() {
    const nodes = [];
    const visited = new Set();

    const joinPath = (p, name) => {
      if (!p || p === '/') return `/${name}`;
      return `${p.replace(/\/+$/, '')}/${name}`;
    };

    const walk = async (p) => {
      if (visited.has(p)) return;
      visited.add(p);
      const names = await this._qNames(p);
      if (Array.isArray(names)) {
        if (p !== '/') {
          const name = p.split('/').filter(Boolean).pop() || '';
          nodes.push({ path: p, name, is_group: true, kind: '' });
        }
        for (const rawName of names) {
          const name = String(rawName);
          const childPath = joinPath(p, name);
          if (name && ['w', 's', 'r', 'x'].includes(name[0])) {
            nodes.push({ path: childPath, name, is_group: false, kind: name[0] });
          } else {
            await walk(childPath);
          }
        }
        return;
      }
      const fetched = await this._qFetch(p);
      if (fetched && typeof fetched === 'object' && !Array.isArray(fetched)) {
        if (p !== '/') {
          const name = p.split('/').filter(Boolean).pop() || '';
          nodes.push({ path: p, name, is_group: true, kind: '' });
        }
        for (const key of Object.keys(fetched)) {
          const name = String(key);
          const childPath = joinPath(p, name);
          if (name && ['w', 's', 'r', 'x'].includes(name[0])) {
            nodes.push({ path: childPath, name, is_group: false, kind: name[0] });
          } else {
            await walk(childPath);
          }
        }
      } else if (Array.isArray(fetched)) {
        if (p !== '/') {
          const name = p.split('/').filter(Boolean).pop() || '';
          nodes.push({ path: p, name, is_group: true, kind: '' });
        }
        for (let i = 0; i < fetched.length; i += 1) {
          await walk(joinPath(p, String(i)));
        }
      } else {
        const name = p.split('/').filter(Boolean).pop() || '';
        const kind = name ? name[0] : '';
        nodes.push({ path: p, name, is_group: false, kind });
      }
    };

    const top = await this._qNames('/');
    if (Array.isArray(top)) {
      for (const key of top) await walk(`/${String(key)}`);
    } else {
      await walk('/');
    }

    const uniq = new Map();
    for (const n of nodes) {
      const key = `${n.path}|${n.is_group ? 'g' : 'l'}`;
      if (!uniq.has(key)) uniq.set(key, n);
    }
    return Array.from(uniq.values());
  }

  async _fetchIdViaFetch(path) {
    const key = normalizePath(path);
    if (!key) return 0;
    const payload = JSON.stringify([key]);
    for (const selector of ['0x16', '22']) {
      const cmd = `fetch ${selector} ${payload}`;
      try {
        const out = await this.sendCommand(cmd, 1500);
        const js = this._extractJson(out.toString('utf8'));
        if (Array.isArray(js) && js.length) {
          const num = parseIntMaybe(js[0]);
          if (num != null) return num;
        }
      } catch (e) {
        // ignore and retry with next selector
      }
    }
    return null;
  }

  async getValue(path, timeout = 1500) {
    let response;
    try {
      response = await this.get(path, timeout);
    } catch (err) {
      return { ok: false, value: null, error: err?.message || String(err) };
    }
    if (!response) return { ok: false, value: null };
    const success = this._isSuccessStatus(response.statusHex) || response.statusHex === null;
    if (!success) return { ok: false, value: null };
    if (response.json !== null && response.json !== undefined) {
      const js = response.json;
      if (js && typeof js === 'object' && !Array.isArray(js)) {
        const vals = Object.values(js);
        return { ok: true, value: vals.length ? vals[0] : js };
      }
      return { ok: true, value: js };
    }
    if (response.scalarToken) {
      return { ok: true, value: parseScalarText(response.scalarToken).value };
    }
    return { ok: false, value: null };
  }

  async setValue(path, value, timeout = 2000) {
    const norm = normalizePath(path);
    let parent = '';
    let leaf = norm;
    const idx = norm.lastIndexOf('/');
    if (idx >= 0) {
      parent = norm.slice(0, idx);
      leaf = norm.slice(idx + 1);
    }
    if (!leaf) throw new Error(`Invalid ThingSet path: ${path}`);
    const body = {};
    body[leaf] = value;
    let response;
    try {
      response = await this.update(parent, body, timeout);
    } catch (err) {
      return { ok: false, raw: err?.message || String(err) };
    }
    const ok = this._isSuccessStatus(response.statusHex);
    return { ok, raw: response.text, status: response.statusHex, json: response.json };
  }

  async inspect(path, caches) {
    const { entryCache, idCache } = caches;
    if (entryCache.has(path)) return entryCache.get(path);
    let nodeId = null;
    let scalar = null;
    let sequence = null;
    let values = {};
    let data = null;
    try {
      data = await this._qFetch(path);
    } catch (e) {
      data = null;
    }
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const copy = { ...data };
      const maybeId = copy._id;
      if (maybeId !== undefined) {
        nodeId = parseIntMaybe(maybeId);
        delete copy._id;
      }
      values = copy;
    } else if (Array.isArray(data)) {
      sequence = data;
    } else if (data != null) {
      scalar = data;
    }
    if (scalar == null && sequence == null && (!values || Object.keys(values).length === 0)) {
      const result = await this.getValue(path);
      if (result.ok) scalar = result.value;
    }
    if (nodeId == null) {
      if (idCache.has(path)) nodeId = idCache.get(path);
      else {
        nodeId = await this._fetchIdViaFetch(path);
        idCache.set(path, nodeId);
      }
    }
    const entry = { nodeId, scalar, sequence, values };
    entryCache.set(path, entry);
    return entry;
  }

  groupValues(path, entry, childMap) {
    if (!entry.values || Object.keys(entry.values).length === 0) return {};
    const children = childMap.get(path) || new Set();
    const out = {};
    for (const [key, val] of Object.entries(entry.values)) {
      if (key.startsWith('_')) continue;
      if (children.has(key)) continue;
      out[key] = sanitize(val);
    }
    return out;
  }

  async createGroup(path, caches, childMap) {
    const entry = await this.inspect(path, caches);
    const node = {};
    const nodeId = entry.nodeId != null ? entry.nodeId : (path === '/' ? 0 : null);
    node.id = formatId(nodeId);
    const norm = normalizePath(path);
    if (norm) node.path = norm;
    const values = this.groupValues(path, entry, childMap);
    node.values = values && Object.keys(values).length ? values : {};
    node.children = {};
    const kids = childMap.get(path);
    const hasKids = kids && kids.size;
    if (entry.scalar != null && !hasKids) node.value = sanitize(entry.scalar);
    else if (entry.sequence != null && !hasKids) node.value = sanitize(entry.sequence);
    return node;
  }

  async createLeaf(path, caches) {
    const entry = await this.inspect(path, caches);
    const node = {};
    node.id = formatId(entry.nodeId);
    node.path = normalizePath(path);
    let value = null;
    if (entry.scalar != null) value = entry.scalar;
    else if (entry.sequence != null) value = entry.sequence;
    else if (entry.values && Object.keys(entry.values).length) {
      if ('value' in entry.values && Object.keys(entry.values).length === 1) value = entry.values.value;
      else {
        const filtered = {};
        for (const [k, v] of Object.entries(entry.values)) {
          if (!String(k).startsWith('_')) filtered[k] = v;
        }
        value = filtered;
      }
    }
    node.value = sanitize(value);
    return node;
  }

  async buildTree() {
    const nodes = await this.listNodes();
    const childMap = new Map();
    for (const node of nodes) {
      const parent = parentPath(node.path);
      if (!childMap.has(parent)) childMap.set(parent, new Set());
      childMap.get(parent).add(node.name);
    }

    const caches = { entryCache: new Map(), idCache: new Map() };
    const treeMap = new Map();
    const root = await this.createGroup('/', caches, childMap);
    treeMap.set('/', root);

    const sorted = [...nodes].sort((a, b) => {
      const depthA = pathDepth(a.path);
      const depthB = pathDepth(b.path);
      if (depthA !== depthB) return depthA - depthB;
      if (a.is_group === b.is_group) return a.path.localeCompare(b.path);
      return a.is_group ? -1 : 1;
    });

    for (const node of sorted) {
      const parent = parentPath(node.path);
      if (!treeMap.has(parent)) {
        const parentObj = await this.createGroup(parent, caches, childMap);
        treeMap.set(parent, parentObj);
        const grand = parentPath(parent);
        if (treeMap.has(grand)) {
          const name = parent.replace(/^\/+/, '').split('/').pop() || parent;
          treeMap.get(grand).children[name] = parentObj;
        }
      }
      const parentObj = treeMap.get(parent);
      if (!parentObj.children) parentObj.children = {};
      if (node.is_group) {
        const grp = await this.createGroup(node.path, caches, childMap);
        parentObj.children[node.name] = grp;
        treeMap.set(node.path, grp);
      } else {
        const leaf = await this.createLeaf(node.path, caches);
        parentObj.children[node.name] = leaf;
        treeMap.set(node.path, leaf);
      }
    }

    return root;
  }

  async readNodeUid() {
    const entry = await this.inspect('/pNodeID', { entryCache: new Map(), idCache: new Map() });
    if (entry.scalar != null) return String(entry.scalar);
    if (entry.values) {
      const val = entry.values.value ?? entry.values.pNodeID;
      if (val != null) return String(val);
    }
    return null;
  }

  async readNodeName() {
    const entry = await this.inspect('/pNodeName', { entryCache: new Map(), idCache: new Map() });
    if (entry.scalar != null) return String(entry.scalar);
    if (entry.values) {
      const val = entry.values.value ?? entry.values.pNodeName;
      if (val != null) return String(val);
    }
    return null;
  }

  async readNodeAddr() {
    const entry = await this.inspect('/Networking/pCANNodeAddr', { entryCache: new Map(), idCache: new Map() });
    let candidate = null;
    if (entry.scalar != null) candidate = parseIntMaybe(entry.scalar);
    if (candidate == null && entry.values) {
      for (const key of ['value', 'pCANNodeAddr']) {
        if (entry.values[key] != null) {
          candidate = parseIntMaybe(entry.values[key]);
          if (candidate != null) break;
        }
      }
    }
    return candidate;
  }
}

module.exports = {
  ThingSetSerialShell,
};
