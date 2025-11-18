(function () {
  const ipc = window.require?.('electron')?.ipcRenderer;
  const fs = window.require?.('fs');
  const path = window.require?.('path');

  function thingsetDir() {
    try {
      return path.join(process.cwd(), 'thingset');
    } catch {
      return null;
    }
  }

  function readJsonSafe(fp) {
    try {
      const txt = fs.readFileSync(fp, 'utf8');
      return JSON.parse(txt);
    } catch {
      return null;
    }
  }

  function listDevices() {
    const dir = thingsetDir();
    if (!dir) return [];
    const byAddr = new Map();
    const nodesPath = path.join(dir, 'nodes.json');
    const mapping = readJsonSafe(nodesPath) || {};
    for (const [addrStr, uid] of Object.entries(mapping)) {
      const addr = parseInt(addrStr, 10);
      if (!Number.isFinite(addr)) continue;
      byAddr.set(addr, { addr, uid });
    }
    try {
      const files = fs.readdirSync(dir).filter(f => /^node_[0-9A-Fa-f]{2}_tree\.json$/.test(f));
      for (const f of files) {
        const m = f.match(/^node_([0-9A-Fa-f]{2})_tree\.json$/);
        if (!m) continue;
        const addr = parseInt(m[1], 16);
        if (!Number.isFinite(addr)) continue;
        const tree = readJsonSafe(path.join(dir, f)) || {};
        const uid = tree.node_uid || tree?.root?.node_uid || (byAddr.get(addr)?.uid);
        if (!byAddr.has(addr)) byAddr.set(addr, { addr, uid });
        else if (!byAddr.get(addr).uid && uid) byAddr.get(addr).uid = uid;
      }
    } catch {}
    const out = [...byAddr.values()];
    out.sort((a, b) => a.addr - b.addr);
    return out;
  }

  function readTreeForAddr(addr) {
    const dir = thingsetDir();
    if (!dir) return null;
    const hex = addr.toString(16).toUpperCase().padStart(2, '0');
    const fp = path.join(dir, `node_${hex}_tree.json`);
    return readJsonSafe(fp);
  }

  function writeTreeForAddr(addr, treeObj) {
    try {
      const dir = thingsetDir();
      if (!dir) return false;
      const hex = addr.toString(16).toUpperCase().padStart(2, '0');
      const fp = path.join(dir, `node_${hex}_tree.json`);
      fs.writeFileSync(fp, JSON.stringify(treeObj, null, 2), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  function setSubscriptionState(addr, pathStr, subscribed) {
    try {
      const tree = readTreeForAddr(addr);
      if (!tree || !tree.root) return false;
      tree.root._ui = tree.root._ui || {};
      tree.root._ui.subscriptions = tree.root._ui.subscriptions || {};
      if (subscribed) tree.root._ui.subscriptions[pathStr] = true;
      else delete tree.root._ui.subscriptions[pathStr];
      return writeTreeForAddr(addr, tree);
    } catch {
      return false;
    }
  }

  function setReportingFlag(addr, enabled) {
    try {
      const tree = readTreeForAddr(addr);
      if (!tree || !tree.root) return false;
      tree.root._ui = tree.root._ui || {};
      tree.root._ui.reporting = tree.root._ui.reporting || {};
      tree.root._ui.reporting.sEnable = !!enabled;
      const repNode = findNodeByPath(tree.root, '_Reporting/mLive/sEnable');
      if (repNode) repNode.value = !!enabled;
      return writeTreeForAddr(addr, tree);
    } catch {
      return false;
    }
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
    refreshBtn.on('click', () => this.refresh());
    if (!this._subscriptionHandler) {
      this._subscriptionHandler = () => this.refresh();
      window.addEventListener('thingset-subscriptions-updated', this._subscriptionHandler);
    }
    this.refresh();
  };

  MeasurementsWidget.prototype.refresh = function () {
    const devices = listDevices();
    this.status.text(`${devices.length} device${devices.length === 1 ? '' : 's'} found`);
    this.listWrap.empty();
    if (!devices.length) {
      this.listWrap.append('<div class="text-muted">No ThingSet devices found. Run the CAN scan + build process.</div>');
      return;
    }
    devices.forEach(dev => {
      this.listWrap.append(this._renderDeviceCard(dev));
    });
  };

  MeasurementsWidget.prototype._renderDeviceCard = function (dev) {
    const card = $('<div class="border rounded p-2 d-flex flex-column gap-2"></div>');
    const header = $('<div class="d-flex justify-content-between align-items-center flex-wrap gap-1"></div>');
    const hex = `0x${dev.addr.toString(16).toUpperCase().padStart(2, '0')}`;
    header.append($('<strong></strong>').text(hex));
    header.append($('<span class="text-muted small"></span>').text(dev.uid || 'unknown uid'));
    card.append(header);
    const tree = readTreeForAddr(dev.addr);
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
    if (!ipc) return;
    const channel = this.settings.channel || 'can0';
    const subsetId = await this._ensureSubsetId(channel, addr);
    const endpoint = subsetId != null ? subsetId : 'mLive';
    btn.prop('disabled', true);
    let stateChanged = false;
    try {
      if (enable) {
        const resp = await ipc.invoke('ts-create', {
          channel,
          targetAddr: addr,
          endpoint,
          value: pathStr
        });
        if (resp && resp.status >= 0x80 && resp.status < 0xA0) {
          btn.data('active', true).removeClass('btn-outline-secondary').addClass('btn-success');
          setSubscriptionState(addr, pathStr, true);
          await this._ensureReportingEnabled(channel, addr);
          stateChanged = true;
        } else {
          btn.data('active', false).removeClass('btn-success').addClass('btn-outline-secondary');
        }
      } else {
        const resp = await ipc.invoke('ts-delete', {
          channel,
          targetAddr: addr,
          endpoint,
          value: pathStr
        });
        if (resp && resp.status >= 0x80 && resp.status < 0xA0) {
          btn.data('active', false).removeClass('btn-success').addClass('btn-outline-secondary');
          setSubscriptionState(addr, pathStr, false);
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
      const resp = await ipc.invoke('ts-ids-for-paths', { channel, targetAddr: addr, paths: ['mLive'] });
      const payload = resp?.payload;
      if (Array.isArray(payload) && Number.isInteger(payload[0])) sid = payload[0];
    } catch {}
    this.subsetCache.set(addr, sid);
    return sid;
  };

  MeasurementsWidget.prototype._ensureReportingEnabled = async function (channel, addr) {
    try {
      const resp = await ipc.invoke('ts-update', {
        channel,
        targetAddr: addr,
        endpoint: '_Reporting/mLive',
        values: { sEnable: true }
      });
      if (resp && resp.status >= 0x80 && resp.status < 0xA0) {
        setReportingFlag(addr, true);
        return true;
      }
    } catch {}
    return false;
  };

  MeasurementsWidget.prototype.onSettingsChanged = function (newSettings) {
    this.settings = newSettings || {};
    this.refresh();
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
