(function () {
  const api = window.api || null;
  const thingsetApi = api && api.thingset ? api.thingset : null;
  const filesApi = api && api.files ? api.files : null;
  const paths = api && api.paths ? api.paths : null;
  const ipc = !api && window.require ? window.require('electron')?.ipcRenderer : null;
  const fs = !api && window.require ? window.require('fs') : null;
  const path = !api && window.require ? window.require('path') : null;

  function thingsetDir() {
    try {
      if (paths && paths.cwd && paths.join) return paths.join(paths.cwd(), 'thingset');
      return path.join(process.cwd(), 'thingset');
    } catch {
      return null;
    }
  }

  async function readJsonSafe(fp) {
    try {
      if (filesApi && filesApi.readText) {
        const txt = await filesApi.readText(fp);
        return JSON.parse(txt);
      }
      if (fs) {
        const txt = fs.readFileSync(fp, 'utf8');
        return JSON.parse(txt);
      }
    } catch {
      return null;
    }
  }

  async function writeJsonSafe(fp, obj) {
    try {
      const content = JSON.stringify(obj, null, 2);
      if (filesApi && filesApi.writeText) {
        const res = await filesApi.writeText(fp, content);
        return !!res?.ok;
      }
      if (fs) {
        fs.writeFileSync(fp, content, 'utf8');
        return true;
      }
    } catch {}
    return false;
  }

  async function listDevices() {
    const dir = thingsetDir();
    if (!dir) return [];
    const byAddr = new Map();
    const nodesPath = (paths && paths.join) ? paths.join(dir, 'nodes.json') : path.join(dir, 'nodes.json');
    const mapping = await readJsonSafe(nodesPath) || {};
    for (const [addrStr, uid] of Object.entries(mapping)) {
      const addr = parseInt(addrStr, 10);
      if (!Number.isFinite(addr)) continue;
      byAddr.set(addr, { addr, uid });
    }
    try {
      const files = (filesApi && filesApi.listDir ? await filesApi.listDir(dir) : fs.readdirSync(dir))
        .filter(f => /^node_[0-9A-Fa-f]{2}_tree\.json$/.test(f));
      for (const f of files) {
        const m = f.match(/^node_([0-9A-Fa-f]{2})_tree\.json$/);
        if (!m) continue;
        const addr = parseInt(m[1], 16);
        if (!Number.isFinite(addr)) continue;
        const tree = await readJsonSafe((paths && paths.join) ? paths.join(dir, f) : path.join(dir, f)) || {};
        const uid = tree.node_uid || tree?.root?.node_uid || (byAddr.get(addr)?.uid);
        if (!byAddr.has(addr)) byAddr.set(addr, { addr, uid });
        else if (!byAddr.get(addr).uid && uid) byAddr.get(addr).uid = uid;
      }
    } catch {}
    const out = [...byAddr.values()];
    out.sort((a, b) => a.addr - b.addr);
    return out;
  }

  async function readTreeForAddr(addr) {
    const dir = thingsetDir();
    if (!dir) return null;
    const hex = addr.toString(16).toUpperCase().padStart(2, '0');
    const fp = (paths && paths.join) ? paths.join(dir, `node_${hex}_tree.json`) : path.join(dir, `node_${hex}_tree.json`);
    return readJsonSafe(fp);
  }

  async function writeTreeForAddr(addr, treeObj) {
    try {
      const dir = thingsetDir();
      if (!dir) return false;
      const hex = addr.toString(16).toUpperCase().padStart(2, '0');
      const fp = (paths && paths.join) ? paths.join(dir, `node_${hex}_tree.json`) : path.join(dir, `node_${hex}_tree.json`);
      return await writeJsonSafe(fp, treeObj);
    } catch {
      return false;
    }
  }

  async function setSubscriptionState(addr, pathStr, subscribed) {
    try {
      const tree = await readTreeForAddr(addr);
      if (!tree || !tree.root) return false;
      tree.root._ui = tree.root._ui || {};
      tree.root._ui.subscriptions = tree.root._ui.subscriptions || {};
      if (subscribed) tree.root._ui.subscriptions[pathStr] = true;
      else delete tree.root._ui.subscriptions[pathStr];
      return await writeTreeForAddr(addr, tree);
    } catch {
      return false;
    }
  }

  async function setReportingFlag(addr, enabled) {
    try {
      const tree = await readTreeForAddr(addr);
      if (!tree || !tree.root) return false;
      tree.root._ui = tree.root._ui || {};
      tree.root._ui.reporting = tree.root._ui.reporting || {};
      tree.root._ui.reporting.sEnable = !!enabled;
      const repNode = findNodeByPath(tree.root, '_Reporting/mLive/sEnable');
      if (repNode) repNode.value = !!enabled;
      return await writeTreeForAddr(addr, tree);
    } catch {
      return false;
    }
  }

  async function tsCreate(payload) {
    if (thingsetApi && thingsetApi.create) return thingsetApi.create(payload);
    if (ipc) return ipc.invoke('ts-create', payload);
    return null;
  }

  async function tsDelete(payload) {
    if (thingsetApi && thingsetApi.delete) return thingsetApi.delete(payload);
    if (ipc) return ipc.invoke('ts-delete', payload);
    return null;
  }

  async function tsIdsForPaths(payload) {
    if (thingsetApi && thingsetApi.idsForPaths) return thingsetApi.idsForPaths(payload);
    if (ipc) return ipc.invoke('ts-ids-for-paths', payload);
    return null;
  }

  async function tsUpdate(payload) {
    if (thingsetApi && thingsetApi.update) return thingsetApi.update(payload);
    if (ipc) return ipc.invoke('ts-update', payload);
    return null;
  }

  function findNodeByPath(root, pathStr) {
    if (!root || !pathStr) return null;
    const segs = String(pathStr).split('/').filter(Boolean);
    let cur = root;
    for (const seg of segs) {
      if (!cur.children || typeof cur.children !== 'object') return null;
      cur = cur.children[seg];
      if (!cur) return null;
    }
    return cur;
  }

  function collectMeasurements(root) {
    if (!root || typeof root !== 'object') return [];
    const measNode = findNodeByPath(root, 'Measurements');
    const entries = [];
    if (measNode && measNode.children) {
      for (const [name, child] of Object.entries(measNode.children)) {
        if (!child || !name) continue;
        if (name.toLowerCase() === 'rvalues' || name[0] === 'r') continue;
        const rValueNode = child.children && child.children.rValue;
        if (rValueNode && rValueNode.path) {
          entries.push({
            path: rValueNode.path,
            label: name,
            value: rValueNode.value
          });
        }
      }
      if (entries.length) {
        entries.sort((a, b) => a.label.localeCompare(b.label));
        return entries;
      }
    }
    const out = [];
    const seen = new Set();
    const pushEntry = (pathStr, label, value) => {
      if (!pathStr || seen.has(pathStr)) return;
      seen.add(pathStr);
      out.push({
        path: pathStr,
        label: label || pathStr.split('/').pop() || pathStr,
        value
      });
    };
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.values && typeof node.values === 'object') {
        const base = node.path || '';
        for (const [key, val] of Object.entries(node.values)) {
          if (key && key[0] === 'r') {
            const p = base ? `${base}/${key}` : key;
            pushEntry(p, key, val);
          }
        }
      }
      if (node.children && typeof node.children === 'object') {
        for (const [name, child] of Object.entries(node.children)) {
          if (!name) continue;
          const childPath = child.path || (node.path ? `${node.path}/${name}` : name);
          if (name[0] === 'r') {
            const hasKids = child.children && Object.keys(child.children).length;
            if (!hasKids) pushEntry(childPath, name, child.value);
          }
          walk(child);
        }
      }
    };
    walk(root);
    out.sort((a, b) => a.path.localeCompare(b.path));
    return out;
  }

  function formatMeasurementValue(val) {
    if (val === undefined || val === null) return null;
    if (typeof val === 'number' && Number.isFinite(val)) {
      const fixed = val.toFixed(3);
      return parseFloat(fixed).toString();
    }
    if (typeof val === 'string') return val;
    return String(val);
  }

  freeboard.loadWidgetPlugin({
    type_name: 'thingset_measurements',
    display_name: 'ThingSet Measurements',
    description: 'Toggle measurement subscriptions per device and auto-enable reporting',
    settings: [
      { name: 'channel', display_name: 'Channel', type: 'text', default_value: 'can0' }
    ],
    newInstance: function (settings, newInstanceCallback) {
      newInstanceCallback(new MeasurementsWidget(settings));
    }
  });

  function MeasurementsWidget(settings) {
    this.settings = settings || {};
    this.container = $('<div class="d-flex flex-column h-100 gap-2"></div>');
    this.listWrap = $('<div class="flex-fill overflow-auto d-flex flex-column gap-3"></div>');
    this.status = $('<div class="text-muted small"></div>');
    this.subsetCache = new Map();
    this._subscriptionHandler = null;
  }

  MeasurementsWidget.prototype.render = function (el) {
    this.container.empty();
    const controls = $('<div class="d-flex align-items-center gap-2"></div>');
    const refreshBtn = $('<button class="btn btn-outline-secondary btn-sm">Refresh</button>');
    controls.append(refreshBtn, $('<div class="flex-fill"></div>'), this.status);
    this.container.append(controls, this.listWrap);
    $(el).append(this.container);
    refreshBtn.on('click', () => { this.refresh().catch(() => {}); });
    if (!this._subscriptionHandler) {
      this._subscriptionHandler = () => { this.refresh().catch(() => {}); };
      window.addEventListener('thingset-subscriptions-updated', this._subscriptionHandler);
    }
    this.refresh().catch(() => {});
  };

  MeasurementsWidget.prototype.refresh = async function () {
    const devices = await listDevices();
    this.status.text(`${devices.length} device${devices.length === 1 ? '' : 's'} found`);
    this.listWrap.empty();
    if (!devices.length) {
      this.listWrap.append('<div class="text-muted">No ThingSet devices found. Run the CAN scan + build process.</div>');
      return;
    }
    for (const dev of devices) {
      const card = await this._renderDeviceCard(dev);
      this.listWrap.append(card);
    }
  };

  MeasurementsWidget.prototype._renderDeviceCard = async function (dev) {
    const card = $('<div class="border rounded p-2 d-flex flex-column gap-2"></div>');
    const header = $('<div class="d-flex justify-content-between align-items-center flex-wrap gap-1"></div>');
    const hex = `0x${dev.addr.toString(16).toUpperCase().padStart(2, '0')}`;
    header.append($('<strong></strong>').text(hex));
    header.append($('<span class="text-muted small"></span>').text(dev.uid || 'unknown uid'));
    card.append(header);
    const tree = await readTreeForAddr(dev.addr);
    if (!tree || !tree.root) {
      card.append('<div class="text-muted small">No tree JSON found. Run ThingSet tree builder.</div>');
      return card;
    }
    const measurements = collectMeasurements(tree.root);
    if (!measurements.length) {
      card.append('<div class="text-muted small">No readable measurements discovered.</div>');
      return card;
    }
    const subs = tree?.root?._ui?.subscriptions || {};
    const btnWrap = $('<div class="d-flex flex-wrap gap-2"></div>');
    measurements.forEach(meas => {
      const active = subs[meas.path] === true;
      const btn = $('<button class="btn btn-sm"></button>');
      btn.append($('<span class="meas-label"></span>').text(meas.label));
      const formatted = formatMeasurementValue(meas.value);
      if (formatted !== null) {
        btn.append($('<span class="badge bg-secondary ms-1"></span>').text(formatted));
        btn.attr('title', `${meas.path} = ${formatted}`);
      } else {
        btn.attr('title', meas.path);
      }
      btn.toggleClass('btn-success', active).toggleClass('btn-outline-secondary', !active);
      btn.data('active', active);
      btn.on('click', () => {
        const want = !btn.data('active');
        this._toggleMeasurement(dev.addr, meas.path, want, btn);
      });
      btnWrap.append(btn);
    });
    card.append(btnWrap);
    return card;
  };

  MeasurementsWidget.prototype._toggleMeasurement = async function (addr, pathStr, enable, btn) {
    if (!thingsetApi && !ipc) return;
    const channel = this.settings.channel || 'can0';
    const subsetId = await this._ensureSubsetId(channel, addr);
    const endpoint = subsetId != null ? subsetId : 'mLive';
    btn.prop('disabled', true);
    let stateChanged = false;
    try {
      if (enable) {
        const resp = await tsCreate({
          channel,
          targetAddr: addr,
          endpoint,
          value: pathStr
        });
        if (resp && resp.status >= 0x80 && resp.status < 0xA0) {
          btn.data('active', true).removeClass('btn-outline-secondary').addClass('btn-success');
          await setSubscriptionState(addr, pathStr, true);
          await this._ensureReportingEnabled(channel, addr);
          stateChanged = true;
        } else {
          btn.data('active', false).removeClass('btn-success').addClass('btn-outline-secondary');
        }
      } else {
        const resp = await tsDelete({
          channel,
          targetAddr: addr,
          endpoint,
          value: pathStr
        });
        if (resp && resp.status >= 0x80 && resp.status < 0xA0) {
          btn.data('active', false).removeClass('btn-success').addClass('btn-outline-secondary');
          await setSubscriptionState(addr, pathStr, false);
          stateChanged = true;
        } else {
          btn.data('active', true).removeClass('btn-outline-secondary').addClass('btn-success');
        }
      }
    } catch {
      // revert visual state if call failed
      if (enable) btn.data('active', false).removeClass('btn-success').addClass('btn-outline-secondary');
      else btn.data('active', true).removeClass('btn-outline-secondary').addClass('btn-success');
    } finally {
      btn.prop('disabled', false);
      if (stateChanged) {
        window.dispatchEvent(new CustomEvent('thingset-subscriptions-updated', { detail: { addr, path: pathStr, subscribed: btn.data('active') === true } }));
      }
    }
  };

  MeasurementsWidget.prototype._ensureSubsetId = async function (channel, addr) {
    if (this.subsetCache.has(addr)) return this.subsetCache.get(addr);
    let sid = null;
    try {
      const resp = await tsIdsForPaths({ channel, targetAddr: addr, paths: ['mLive'] });
      const payload = resp?.payload;
      if (Array.isArray(payload) && Number.isInteger(payload[0])) sid = payload[0];
    } catch {}
    this.subsetCache.set(addr, sid);
    return sid;
  };

  MeasurementsWidget.prototype._ensureReportingEnabled = async function (channel, addr) {
    try {
      const resp = await tsUpdate({
        channel,
        targetAddr: addr,
        endpoint: '_Reporting/mLive',
        values: { sEnable: true }
      });
      if (resp && resp.status >= 0x80 && resp.status < 0xA0) {
        await setReportingFlag(addr, true);
        return true;
      }
    } catch {}
    return false;
  };

  MeasurementsWidget.prototype.onSettingsChanged = function (newSettings) {
    this.settings = newSettings || {};
    this.refresh().catch(() => {});
  };

  MeasurementsWidget.prototype.onDispose = function () {
    if (this._subscriptionHandler) {
      window.removeEventListener('thingset-subscriptions-updated', this._subscriptionHandler);
      this._subscriptionHandler = null;
    }
  };

  MeasurementsWidget.prototype.getHeight = function () {
    return 6;
  };
}());
