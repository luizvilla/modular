(function () {
  const ipc = window.require?.('electron')?.ipcRenderer;
  const fs = window.require?.('fs');
  const path = window.require?.('path');

  function thingsetDir() {
    try { return path.join(process.cwd(), 'thingset'); } catch { return null; }
  }

  function readJsonSafe(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  }

  function listDevices() {
    const dir = thingsetDir();
    if (!dir) return [];
    const np = path.join(dir, 'nodes.json');
    const mapping = readJsonSafe(np) || {};
    const out = [];
    for (const [addrStr, uid] of Object.entries(mapping)) {
      const addr = parseInt(addrStr, 10);
      if (!Number.isFinite(addr)) continue;
      out.push({ addr, uid });
    }
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

  // Find parent endpoint + key for Leg 0 wOn using leaf paths (e.g., Config/Leg/0/wOn)
  function findLeg0WOnEndpoint(root) {
    const hits = [];
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.path && typeof node.path === 'string') {
        const p = String(node.path);
        if (/\/Leg\/0\/wOn$/.test(p)) {
          const endpoint = p.substring(0, p.lastIndexOf('/'));
          hits.push({ endpoint, key: 'wOn' });
        }
      }
      if (node.children && typeof node.children === 'object') {
        for (const cn of Object.values(node.children)) walk(cn);
      }
    }
    walk(root);
    return hits;
  }

  // Find parent endpoint + key for global wMode using leaf paths (e.g., Config/Mode/wMode)
  function findWModeEndpoint(root) {
    const hits = [];
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.path && typeof node.path === 'string') {
        const p = String(node.path);
        if (/\/Mode\/wMode$/.test(p)) {
          const endpoint = p.substring(0, p.lastIndexOf('/'));
          hits.push({ endpoint, key: 'wMode' });
        }
      }
      if (node.children && typeof node.children === 'object') {
        for (const cn of Object.values(node.children)) walk(cn);
      }
    }
    walk(root);
    return hits;
  }

  async function setWOnForAll(channel, enable) {
    if (!ipc) return { ok: false, reason: 'no-ipc' };
    const devs = listDevices();
    const ops = [];
    for (const d of devs) {
      const tree = readTreeForAddr(d.addr);
      const wOnPaths = tree && tree.root ? findLeg0WOnEndpoint(tree.root) : [];
      const wModePaths = tree && tree.root ? findWModeEndpoint(tree.root) : [];
      if (!wOnPaths.length && !wModePaths.length) continue;

      const perEndpoint = new Map();
      for (const { endpoint, key } of [...wOnPaths, ...wModePaths]) {
        if (!perEndpoint.has(endpoint)) perEndpoint.set(endpoint, {});
        const val = (key === 'wOn') ? !!enable : (enable ? 1 : 0);
        perEndpoint.get(endpoint)[key] = val;
      }
      for (const [endpoint, values] of perEndpoint.entries()) {
        ops.push(ipc.invoke('ts-update', { channel, targetAddr: d.addr, endpoint, values }).catch(() => null));
      }
    }
    try { await Promise.all(ops); } catch {}
    return { ok: true, count: ops.length };
  }

  freeboard.loadWidgetPlugin({
    type_name: 'thingset_mode_button',
    display_name: 'ThingSet Mode Button',
    description: 'Per-device power toggle: sets wMode (1/0) and Leg0 wOn (true/false)',
    settings: [
      { name: 'channel', display_name: 'Channel', type: 'text', default_value: 'can0' },
      { name: 'labelOn', display_name: 'Label (active)', type: 'text', default_value: 'Power ON' },
      { name: 'labelOff', display_name: 'Label (idle)', type: 'text', default_value: 'Idle' }
    ],
    newInstance: function (settings, newInstanceCallback) {
      newInstanceCallback(new ModeButtonWidget(settings));
    }
  });

  function ModeButtonWidget(settings) {
    let current = settings || {};
    const state = {}; // addr -> boolean

    const root = $('<div class="d-flex flex-column h-100 p-1 gap-2"></div>');
    const actions = $('<div class="d-flex align-items-center gap-2 flex-wrap"></div>');
    const allOffBtn = $('<button class="btn btn-outline-danger btn-sm"><i class="fa fa-power-off me-1"></i>All OFF</button>');
    const refreshBtn = $('<button class="btn btn-outline-secondary btn-sm"><i class="fa fa-rotate me-1"></i>Refresh</button>');
    const grid = $('<div class="d-flex flex-wrap gap-2"></div>');

    actions.append(allOffBtn, refreshBtn);
    root.append(actions, grid);

    function btnFor(addrHex, addr) {
      const wrap = $('<div class="d-flex align-items-center gap-1 border rounded px-2 py-1"></div>');
      const label = $(`<span class="badge bg-light text-dark">${addrHex}</span>`);
      const btn = $('<button class="btn btn-sm"></button>');
      const applyStyle = () => {
        const on = !!state[addr];
        btn.toggleClass('btn-danger', on).toggleClass('btn-secondary', !on)
           .html(`<i class=\"fa fa-power-off me-1\"></i>${on ? (current.labelOn || 'Power ON') : (current.labelOff || 'Idle')}`);
      };
      applyStyle();
      btn.on('click', async () => {
        const next = !state[addr];
        btn.prop('disabled', true);
        try {
          await setWOnForDevice(current.channel || 'can0', addr, next);
          state[addr] = next;
        } finally {
          applyStyle();
          btn.prop('disabled', false);
        }
      });
      wrap.append(label, btn);
      return { el: wrap, update: applyStyle };
    }

    async function setWOnForDevice(channel, addr, enable) {
      if (!ipc || !addr) return;
      const tree = readTreeForAddr(addr);
      const wOnPaths = tree && tree.root ? findLeg0WOnEndpoint(tree.root) : [];
      const wModePaths = tree && tree.root ? findWModeEndpoint(tree.root) : [];
      const perEndpoint = new Map();
      for (const { endpoint, key } of [...wOnPaths, ...wModePaths]) {
        if (!perEndpoint.has(endpoint)) perEndpoint.set(endpoint, {});
        const val = (key === 'wOn') ? !!enable : (enable ? 1 : 0);
        perEndpoint.get(endpoint)[key] = val;
      }
      for (const [endpoint, values] of perEndpoint.entries()) {
        try {
          await ipc.invoke('ts-update', { channel, targetAddr: addr, endpoint, values });
        } catch {}
      }
    }

    async function renderDevices() {
      grid.empty();
      const devs = listDevices();
      for (const d of devs) {
        const hex = `0x${d.addr.toString(16).toUpperCase().padStart(2, '0')}`;
        const comp = btnFor(hex, d.addr);
        grid.append(comp.el);
      }
    }

    allOffBtn.on('click', async () => {
      const ch = current.channel || 'can0';
      allOffBtn.prop('disabled', true);
      try {
        await setWOnForAll(ch, false);
        const devs = listDevices();
        devs.forEach(d => { state[d.addr] = false; });
        // Refresh styles
        grid.find('button.btn').each((_, el) => {
          const wrap = $(el).closest('div');
          const badge = wrap.find('span.badge').text();
          const addr = parseInt(badge, 16);
          if (Number.isFinite(addr)) {
            $(el).removeClass('btn-danger').addClass('btn-secondary').html(`<i class="fa fa-power-off me-1"></i>${current.labelOff || 'Idle'}`);
          }
        });
      } finally {
        allOffBtn.prop('disabled', false);
      }
    });

    refreshBtn.on('click', () => renderDevices());

    this.render = function (container) {
      $(container).empty().append(root);
      renderDevices();
    };
    this.onSettingsChanged = function (s) { current = s || {}; };
    this.onDispose = function () {};
    this.getHeight = function () { return 3; };
  }
}());
