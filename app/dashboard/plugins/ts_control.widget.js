(function () {
  const api = window.api || null;
  const filesApi = api && api.files ? api.files : null;
  const paths = api && api.paths ? api.paths : null;
  const thingsetApi = api && api.thingset ? api.thingset : null;
  const ipc = !api && window.require ? window.require('electron')?.ipcRenderer : null;
  const fs = !api && window.require ? window.require('fs') : null;
  const path = !api && window.require ? window.require('path') : null;

  function thingsetDir() {
    try {
      if (paths && paths.cwd && paths.join) return paths.join(paths.cwd(), 'thingset');
      if (path) return path.join(process.cwd(), 'thingset');
    } catch {}
    return null;
  }

  async function readJsonSafe(p) {
    try {
      if (filesApi && filesApi.readText) {
        const text = await filesApi.readText(p);
        return JSON.parse(text);
      }
      if (fs) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {}
    return null;
  }

  async function listDirSafe(dir) {
    try {
      if (filesApi && filesApi.listDir) return filesApi.listDir(dir);
      if (fs) return fs.readdirSync(dir);
    } catch {}
    return [];
  }

  async function listDevices() {
    const dir = thingsetDir(); if (!dir) return [];
    const byAddr = new Map();

    // nodes.json mapping (if present)
    const np = (paths && paths.join) ? paths.join(dir, 'nodes.json') : path.join(dir, 'nodes.json');
    const mapping = await readJsonSafe(np) || {};
    for (const [addrStr, uid] of Object.entries(mapping)) {
      const addr = parseInt(addrStr, 10); if (!Number.isFinite(addr)) continue;
      byAddr.set(addr, { addr, uid });
    }
    const hasMapping = byAddr.size > 0;

    // node_XX_tree.json files (ensure we include any device with a tree)
    try {
      const files = (await listDirSafe(dir)).filter(f => /^node_[0-9A-Fa-f]{2}_tree\.json$/.test(f));
      for (const f of files) {
        const m = f.match(/^node_([0-9A-Fa-f]{2})_tree\.json$/);
        if (!m) continue;
        const hex = m[1];
        const addr = parseInt(hex, 16);
        if (!Number.isFinite(addr)) continue;
        if (hasMapping && !byAddr.has(addr)) {
          // If nodes.json is authoritative, skip stray tree files from prior scans
          continue;
        }
        const tree = await readJsonSafe((paths && paths.join) ? paths.join(dir, f) : path.join(dir, f)) || {};
        const prev = byAddr.get(addr) || { addr, uid: null };
        const uid = tree.node_uid || prev.uid;
        byAddr.set(addr, { addr, uid });
      }
    } catch {}

    // If nodes.json was empty, fall back to whatever trees we parsed
    if (!hasMapping && byAddr.size === 0) {
      try {
        const files = (await listDirSafe(dir)).filter(f => /^node_[0-9A-Fa-f]{2}_tree\.json$/.test(f));
        for (const f of files) {
          const hex = f.match(/^node_([0-9A-Fa-f]{2})_tree\.json$/)?.[1];
          if (!hex) continue;
          const addr = parseInt(hex, 16);
          if (!Number.isFinite(addr) || byAddr.has(addr)) continue;
          const tree = await readJsonSafe((paths && paths.join) ? paths.join(dir, f) : path.join(dir, f)) || {};
          byAddr.set(addr, { addr, uid: tree.node_uid || null });
        }
      } catch {}
    }

    const out = [...byAddr.values()];
    out.sort((a, b) => a.addr - b.addr);
    return out;
  }

  async function readTreeForAddr(addr) {
    const dir = thingsetDir(); if (!dir) return null;
    const hex = addr.toString(16).toUpperCase().padStart(2, '0');
    const fp = (paths && paths.join) ? paths.join(dir, `node_${hex}_tree.json`) : path.join(dir, `node_${hex}_tree.json`);
    return readJsonSafe(fp);
  }

  function walkNodes(root, cb) {
    function walk(n) {
      if (!n || typeof n !== 'object') return;
      cb(n);
      if (n.children && typeof n.children === 'object') {
        for (const cn of Object.values(n.children)) walk(cn);
      }
    }
    walk(root);
  }

  // Specific discovery aligned with node_XX_tree.json
  // Leg 0 VC mode and reference live at: Config/Leg/0/wModeVC and Config/Leg/0/wRef
  function findLeg0WModeVC(root) {
    let out = null;
    walkNodes(root, (n) => {
      if (out || !n || typeof n.path !== 'string') return;
      if (/\/Leg\/0\/wModeVC$/.test(n.path)) {
        const endpoint = n.path.substring(0, n.path.lastIndexOf('/'));
        out = { endpoint, key: 'wModeVC', current: n.value };
      }
    });
    return out;
  }
  function findLeg0WRef(root) {
    let out = null;
    walkNodes(root, (n) => {
      if (out || !n || typeof n.path !== 'string') return;
      if (/\/Leg\/0\/wRef$/.test(n.path)) {
        const endpoint = n.path.substring(0, n.path.lastIndexOf('/'));
        out = { endpoint, key: 'wRef', current: n.value };
      }
    });
    return out;
  }

  async function setValue(channel, addr, endpoint, key, value) {
    if (thingsetApi && thingsetApi.update) {
      try {
        const resp = await thingsetApi.update({ channel, targetAddr: addr, endpoint, values: { [key]: value } });
        return { ok: !!resp };
      } catch { return { ok: false }; }
    }
    if (!ipc) return { ok: false };
    try {
      const resp = await ipc.invoke('ts-update', { channel, targetAddr: addr, endpoint, values: { [key]: value } });
      return { ok: !!resp };
    } catch { return { ok: false }; }
  }

  freeboard.loadWidgetPlugin({
    type_name: 'thingset_control_panel',
    display_name: 'ThingSet Control Panel',
    description: 'Per-device: Voltage/Current (Leg0 wModeVC) and Reference (wRef)',
    icon: 'gamepad',
    settings: [
      { name: 'channel', display_name: 'Channel', type: 'text', default_value: 'can0' },
      { name: 'autoHeight', display_name: 'Auto height (fit devices)', type: 'boolean', default_value: false }
    ],
    newInstance: function (settings, newInstanceCallback) {
      newInstanceCallback(new ControlPanelWidget(settings));
    }
  });

  function ControlPanelWidget(settings) {
    let current = settings || {};
    const root = $('<div class="d-flex flex-column h-100 p-1 gap-2"></div>');
    const grid = $('<div class="d-flex flex-column gap-2"></div>');
    const scrollWrap = $('<div class="flex-fill overflow-auto"></div>');
    const refreshBtn = $('<button class="btn btn-outline-secondary btn-sm align-self-start"><i class="fa fa-rotate me-1"></i>Refresh</button>');
    const resetVoltageBtn = $('<button class="btn btn-outline-success btn-sm align-self-start"><i class="fa fa-bolt me-1"></i>Reset to Voltage</button>');
    scrollWrap.append(grid);
    root.append($('<div class="d-flex gap-2"></div>').append(refreshBtn, resetVoltageBtn), scrollWrap);

    function parseList(txt) {
      if (!txt) return [];
      return String(txt).split(',').map(s => s.trim()).filter(Boolean);
    }

    function makeRow(dev) {
      const hex = `0x${dev.addr.toString(16).toUpperCase().padStart(2, '0')}`;
      const row = $('<div class="d-flex align-items-center gap-2 border rounded px-2 py-1"></div>');
      const badge = $(`<span class="badge bg-light text-dark">${hex}</span>`);
      const voltageBtn = $('<button class="btn btn-outline-success btn-sm ts-voltage">Voltage</button>');
      const currentBtn = $('<button class="btn btn-outline-danger btn-sm ts-current">Current</button>');
      const refGroup = $('<div class="input-group input-group-sm" style="width: 220px;"></div>');
      const refInput = $('<input type="number" step="any" class="form-control" placeholder="Reference" />');
      const refSend = $('<button class="btn btn-outline-primary">Send</button>');
      refGroup.append(refInput, refSend);
      row.append(badge, voltageBtn, currentBtn, refGroup);

      async function setModeVC(value) {
        const tree = await readTreeForAddr(dev.addr);
        const found = tree && tree.root ? findLeg0WModeVC(tree.root) : null;
        if (!found) return false;
        // Optimistic UI update
        const prevV = voltageBtn.hasClass('btn-success') ? 0 : (currentBtn.hasClass('btn-danger') ? 1 : null);
        voltageBtn.toggleClass('btn-success', value === 0).toggleClass('btn-outline-success', value !== 0);
        currentBtn.toggleClass('btn-danger', value === 1).toggleClass('btn-outline-danger', value !== 1);
        const res = await setValue(current.channel || 'can0', dev.addr, found.endpoint, found.key, value);
        if (!res.ok && prevV !== null) {
          // Revert on failure
          voltageBtn.toggleClass('btn-success', prevV === 0).toggleClass('btn-outline-success', prevV !== 0);
          currentBtn.toggleClass('btn-danger', prevV === 1).toggleClass('btn-outline-danger', prevV !== 1);
        }
        return res.ok;
      }

      voltageBtn.on('click', async () => {
        voltageBtn.prop('disabled', true); currentBtn.prop('disabled', true);
        try { await setModeVC(0); } finally { voltageBtn.prop('disabled', false); currentBtn.prop('disabled', false); }
      });
      currentBtn.on('click', async () => {
        voltageBtn.prop('disabled', true); currentBtn.prop('disabled', true);
        try { await setModeVC(1); } finally { voltageBtn.prop('disabled', false); currentBtn.prop('disabled', false); }
      });

      refSend.on('click', async () => {
        const tree = await readTreeForAddr(dev.addr);
        const found = tree && tree.root ? findLeg0WRef(tree.root) : null;
        if (!found) { refSend.blur(); return; }
        const raw = String(refInput.val() ?? '').trim();
        const num = parseFloat(raw);
        if (!Number.isFinite(num)) return;
        refSend.prop('disabled', true);
        await setValue(current.channel || 'can0', dev.addr, found.endpoint, found.key, num);
        refSend.prop('disabled', false);
      });

      return row;
    }

    async function render() {
      grid.empty();
      const devs = await listDevices();
      if (!devs.length) { grid.append('<div class="text-muted">No devices found. Use Scan + Build in ThingSet UI.</div>'); return; }
      devs.forEach(d => {
        const row = makeRow(d);
        // Initialize button style based on current value from tree
        readTreeForAddr(d.addr).then((tree) => {
          const found = tree && tree.root ? findLeg0WModeVC(tree.root) : null;
          if (!found) return;
          const mode = found.current;
          if (mode === 0) {
            row.find('.ts-voltage').addClass('btn-success').removeClass('btn-outline-success');
          } else if (mode === 1) {
            row.find('.ts-current').addClass('btn-danger').removeClass('btn-outline-danger');
          }
        }).catch(() => {});
        grid.append(row);
      });
    }

    refreshBtn.on('click', () => { render().catch(() => {}); });

    resetVoltageBtn.on('click', async () => {
      const devs = await listDevices();
      const list = parseList(current.resetTargets);
      const filtered = list.length
        ? devs.filter(d => list.includes(String(d.addr)) || list.includes(`0x${d.addr.toString(16).toUpperCase().padStart(2, '0')}`))
        : devs;
      for (const dev of filtered) {
        const tree = await readTreeForAddr(dev.addr);
        const found = tree && tree.root ? findLeg0WModeVC(tree.root) : null;
        if (!found) continue;
        await setValue(current.channel || 'can0', dev.addr, found.endpoint, found.key, 0);
      }
      render().catch(() => {});
    });

    this.render = function (el) {
      $(el).append(root);
      render().catch(() => {});
    };
    this.onSettingsChanged = function (newSettings) { current = newSettings || {}; render().catch(() => {}); };
    this.getHeight = function () { return current.autoHeight ? Math.max(4, (grid.children().length || 1) + 1) : 6; };
  }
})();
