(function () {
  const api = window.api || null;
  const tsSerialApi = api && api.thingsetSerial ? api.thingsetSerial : null;
  const paths = api && api.paths ? api.paths : null;
  const ipc = !api && window.require ? window.require('electron')?.ipcRenderer : null;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function lastSeg(path) {
    if (!path) return '';
    const parts = String(path).split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  function valueToInline(value) {
    if (value === null || value === undefined) return '<span class="text-muted">null</span>';
    if (typeof value === 'object') return `<code>${escapeHtml(JSON.stringify(value))}</code>`;
    return `<code>${escapeHtml(String(value))}</code>`;
  }

  function parseInputValue(raw) {
    if (raw == null) return '';
    const txt = String(raw).trim();
    if (txt === '') return '';
    const lowered = txt.toLowerCase();
    if (lowered === 'true' || lowered === 'false' || lowered === 'null') {
      try { return JSON.parse(lowered); } catch { return txt; }
    }
    if ((txt.startsWith('{') && txt.endsWith('}')) || (txt.startsWith('[') && txt.endsWith(']')) || (txt.startsWith('"') && txt.endsWith('"'))) {
      try { return JSON.parse(txt); } catch { return txt; }
    }
    if (/^0x[0-9a-f]+$/i.test(txt)) {
      try { return Number.parseInt(txt, 16); } catch { return txt; }
    }
    const num = Number(txt);
    if (!Number.isNaN(num)) return num;
    return txt;
  }

  function joinPath(base, leaf) {
    const parts = [];
    if (base) parts.push(String(base).replace(/^\/+|\/+$/g, ''));
    if (leaf) parts.push(String(leaf).replace(/^\/+|\/+$/g, ''));
    return '/' + parts.filter(Boolean).join('/');
  }

  function renderNodeItem(key, node, widget) {
    const wrap = $('<div class="mb-1"></div>');
    const hasChildren = node && node.children && Object.keys(node.children).length;
    const hasValues = node && node.values && Object.keys(node.values).length;
    const hasValue = Object.prototype.hasOwnProperty.call(node || {}, 'value');
    const title = key || lastSeg(node?.path) || node?.id || 'Node';
    const summary = $(`<summary class="d-flex align-items-center gap-2">
        <strong>${escapeHtml(String(title))}</strong>
        ${node?.path ? `<span class="badge bg-light text-dark">${escapeHtml(node.path)}</span>` : ''}
        ${node?.id ? `<span class="badge bg-secondary">${escapeHtml(node.id)}</span>` : ''}
      </summary>`);

    if (hasChildren || hasValues) {
      const det = $('<details class="border rounded px-2 py-1"></details>');
      det.append(summary);
      const body = $('<div class="ms-2 mt-1"></div>');
      const pathKey = node?.path || title;
      if (widget.uiState.expanded[pathKey]) det.prop('open', true);
      det.on('toggle', () => {
        widget.uiState.expanded[pathKey] = det.prop('open');
      });

      if (hasValues) {
        const tbl = $('<div class="mb-1"></div>');
        for (const [vk, vv] of Object.entries(node.values)) {
          const row = $('<div class="d-flex align-items-center justify-content-between gap-2"></div>');
          const left = $(`<span>${escapeHtml(vk)}</span>`);
          const right = $('<span class="d-flex align-items-center gap-2"></span>');
          right.append($(valueToInline(vv)));
          const leafPath = joinPath(node.path, vk);

          const prefix = typeof vk === 'string' ? vk[0] : '';
          const isWritable = prefix === 'w' || prefix === 's';
          const isReadable = prefix === 'r';

          if (isWritable && (widget.tsSerialApi || widget.ipc)) {
            const input = $('<input type="text" class="form-control form-control-sm" style="max-width: 140px;" placeholder="value">');
            const sendBtn = $('<button class="btn btn-primary btn-sm">send</button>');
            sendBtn.on('click', async () => {
              const raw = String(input.val() ?? '').trim();
              if (!raw.length) return;
              const parsed = parseInputValue(raw);
              sendBtn.prop('disabled', true).text('sending…');
              try {
                const res = await widget.invokeUpdate(leafPath, parsed);
                if (res?.ok) {
                  right.children('code').remove();
                  right.prepend($(valueToInline(res.readBack ?? parsed)));
                }
              } catch (e) {
                right.append(`<span class="text-danger small">${escapeHtml(e?.message || 'error')}</span>`);
              } finally {
                sendBtn.prop('disabled', false).text('send');
              }
            });
            right.append(input, sendBtn);
          }

          if (isReadable && (widget.tsSerialApi || widget.ipc)) {
            const readBtn = $('<button class="btn btn-outline-secondary btn-sm">read</button>');
            readBtn.on('click', async () => {
              readBtn.prop('disabled', true).text('reading…');
              try {
                const res = await widget.invokeRead(leafPath);
                if (res?.ok) {
                  right.children('code').remove();
                  right.prepend($(valueToInline(res.value)));
                }
              } catch (e) {
                right.append(`<span class="text-danger small">${escapeHtml(e?.message || 'error')}</span>`);
              } finally {
                readBtn.prop('disabled', false).text('read');
              }
            });
            right.append(readBtn);
          }

          row.append(left, right);
          tbl.append(row);
        }
        body.append(tbl);
      }

      if (hasChildren) {
        for (const [ck, child] of Object.entries(node.children)) {
          body.append(renderNodeItem(ck, child, widget));
        }
      }

      det.append(body);
      wrap.append(det);
    } else if (hasValue) {
      const row = $('<div class="border rounded px-2 py-1 d-flex justify-content-between align-items-center"></div>');
      row.append(`<span>${escapeHtml(String(title))}</span>`);
      row.append($(valueToInline(node.value)));
      wrap.append(row);
    }
    return wrap;
  }

  function SerialThingSetWidget(settings) {
    this.settings = settings || {};
    this.tsSerialApi = tsSerialApi;
    this.ipc = !this.tsSerialApi ? ipc : null;
    this.uiState = { expanded: {} };
    this.root = $('<div class="d-flex flex-column h-100 p-1 gap-2"></div>');
    this.dsSelect = $('<select class="form-select form-select-sm"></select>');
    this.dsRow = $('<div class="input-group input-group-sm"></div>')
      .append('<span class="input-group-text">Datasource</span>')
      .append(this.dsSelect);
    this.header = $('<div class="d-flex align-items-center gap-2"></div>');
    this.status = $('<div class="text-muted small flex-fill"></div>');
    this.refreshBtn = $('<button class="btn btn-outline-primary btn-sm"><i class="fa fa-rotate me-1"></i>Refresh</button>');
    this.refreshBtn.on('click', () => this.refresh());
    this.header.append(this.refreshBtn, this.status);
    this.body = $('<div class="flex-fill overflow-auto border rounded p-2 bg-light"></div>');
    this.root.append(this.dsRow, this.header, this.body);
    this.tree = null;
    this.deviceMeta = null;

    this._configHandler = () => this._refreshDatasourceOptions();
    freeboard.on && freeboard.on('config_updated', this._configHandler);

    setTimeout(() => {
      this._refreshDatasourceOptions();
      this.dsSelect.val(this.settings.datasource || '');
      if (this.settings.autoRefresh !== false) this.refresh();
      else this.status.text('Select a serial datasource and press Refresh.');
    }, 0);
  }

  SerialThingSetWidget.prototype.render = function (element) {
    $(element).append(this.root);
    this.dsSelect.on('change', () => {
      this.settings.datasource = this.dsSelect.val();
      this.refresh();
    });
    this.dsSelect.val(this.settings.datasource || '');
  };

  SerialThingSetWidget.prototype._getDatasourceSettings = function () {
    if (!this.settings.datasource || typeof freeboard?.getDatasourceSettings !== 'function') return null;
    return freeboard.getDatasourceSettings(this.settings.datasource) || null;
  };

  SerialThingSetWidget.prototype._refreshDatasourceOptions = function () {
    const live = freeboard.getLiveModel?.();
    if (!live || typeof live.datasources !== 'function') return;
    const list = live.datasources();
    const current = this.settings.datasource || '';
    const options = [];
    const allowed = new Set(['serialport_datasource', 'thingset_serial_datasource']);
    list.forEach((ds) => {
      try {
        if (ds.type && allowed.has(ds.type())) {
          options.push(ds.name());
        }
      } catch {}
    });
    this.dsSelect.empty();
    if (!options.length) {
      this.dsSelect.append('<option value="" disabled selected>No serial datasource found</option>');
      this.settings.datasource = '';
      return;
    }
    options.forEach((name, idx) => {
      this.dsSelect.append(`<option value="${name}">${name}</option>`);
      if (!current && idx === 0) {
        this.settings.datasource = name;
      }
    });
    if (current && !options.includes(current)) {
      this.dsSelect.append(`<option value="${current}">${current}</option>`);
      this.dsSelect.val(current);
    } else {
      this.dsSelect.val(this.settings.datasource || options[0]);
    }
  };

  SerialThingSetWidget.prototype.getHeight = function () {
    return 10;
  };

  SerialThingSetWidget.prototype.onDispose = function () {
    if (this._configHandler && freeboard.off) {
      try { freeboard.off('config_updated', this._configHandler); } catch {}
    }
  };

  SerialThingSetWidget.prototype.onSettingsChanged = function (newSettings) {
    this.settings = newSettings || {};
    this.uiState.expanded = {};
    this._refreshDatasourceOptions();
    this.dsSelect.val(this.settings.datasource || '');
    this.refresh();
  };

  SerialThingSetWidget.prototype.setLoading = function (loading) {
    this.refreshBtn.prop('disabled', loading);
    if (loading) this.status.text('Loading…');
  };

  SerialThingSetWidget.prototype.invokeUpdate = async function (path, value) {
    if (!this.tsSerialApi && !this.ipc) throw new Error('IPC unavailable');
    const ds = this._getDatasourceSettings();
    if (!ds || !ds.portPath) throw new Error('serial datasource not configured');
    const opts = {
      port: ds.portPath,
      path,
      value,
      baudRate: Number(ds.baudRate) || 115200,
      usePrefix: !!this.settings.usePrefix,
      verbose: !!this.settings.debug,
    };
    if (this.tsSerialApi && this.tsSerialApi.setValue) {
      return this.tsSerialApi.setValue(opts);
    }
    return this.ipc.invoke('ts-serial-set-value', opts);
  };

  SerialThingSetWidget.prototype.invokeRead = async function (path) {
    if (!this.tsSerialApi && !this.ipc) throw new Error('IPC unavailable');
    const ds = this._getDatasourceSettings();
    if (!ds || !ds.portPath) throw new Error('serial datasource not configured');
    const opts = {
      port: ds.portPath,
      path,
      baudRate: Number(ds.baudRate) || 115200,
      usePrefix: !!this.settings.usePrefix,
      verbose: !!this.settings.debug,
    };
    if (this.tsSerialApi && this.tsSerialApi.getValue) {
      return this.tsSerialApi.getValue(opts);
    }
    return this.ipc.invoke('ts-serial-get-value', opts);
  };

  SerialThingSetWidget.prototype.refresh = async function () {
    if (!this.tsSerialApi && !this.ipc) {
      this.status.text('Electron IPC unavailable.');
      return;
    }
    this._refreshDatasourceOptions();
    const ds = this._getDatasourceSettings();
    if (!ds) {
      this.status.text('Create or select a serial datasource.');
      this.body.empty().append('<div class="text-muted">No datasource selected.</div>');
      return;
    }
    const port = ds.portPath;
    if (!port) {
      this.status.text('Datasource missing port path.');
      this.body.empty().append('<div class="text-muted">No port configured.</div>');
      return;
    }
    this.setLoading(true);
    try {
      const res = this.tsSerialApi && this.tsSerialApi.tree
        ? await this.tsSerialApi.tree({
          port,
          baudRate: Number(ds.baudRate) || 115200,
          usePrefix: !!this.settings.usePrefix,
          verbose: !!this.settings.debug,
        })
        : await this.ipc.invoke('ts-serial-tree', {
        port,
        baudRate: Number(ds.baudRate) || 115200,
        usePrefix: !!this.settings.usePrefix,
        verbose: !!this.settings.debug,
      });
      this.tree = res?.root || null;
      this.deviceMeta = res || null;
      if (!this.tree) {
        console.warn('ThingSet serial tree returned no root data', res);
        this.body.empty().append('<div class="text-muted">Device returned no data.</div>');
        this.status.text('No tree data');
      } else {
        this.renderTree();
      }
      const info = [];
      if (res?.address_hex) info.push(res.address_hex);
      if (res?.node_uid) info.push(res.node_uid);
      if (res?.saved_tree_path) {
        let pretty = res.saved_tree_path;
        try {
          if (paths && paths.relative && paths.cwd) {
            const rel = paths.relative(paths.cwd(), res.saved_tree_path);
            if (rel && rel.length < pretty.length) pretty = rel;
          }
        } catch {}
        info.push(`saved ${pretty}`);
      }
      if (info.length) this.status.text(info.join(' · '));
      else this.status.text('Connected');
    } catch (err) {
      this.tree = null;
      this.body.empty().append(`<div class="text-danger">${escapeHtml(err?.message || String(err))}</div>`);
      this.status.text('Error');
      console.error('ThingSet serial refresh failed', err);
    } finally {
      this.setLoading(false);
    }
  };

  SerialThingSetWidget.prototype.renderTree = function () {
    this.body.empty();
    if (!this.tree) {
      this.body.append('<div class="text-muted">No data.</div>');
      return;
    }
    const rootValues = this.tree.values && Object.keys(this.tree.values).length ? this.tree.values : null;
    if (rootValues) {
      const tbl = $('<div class="mb-2"></div>');
      for (const [key, val] of Object.entries(rootValues)) {
        const row = $('<div class="d-flex justify-content-between"></div>');
        row.append(`<span>${escapeHtml(key)}</span>`);
        row.append($(valueToInline(val)));
        tbl.append(row);
      }
      this.body.append(tbl);
    }
    const children = this.tree.children || {};
    if (!Object.keys(children).length) {
      this.body.append('<div class="text-muted">No child nodes.</div>');
      return;
    }
    for (const [key, child] of Object.entries(children)) {
      this.body.append(renderNodeItem(key, child, this));
    }
  };

  freeboard.loadWidgetPlugin({
    type_name: 'thingset_serial_device_ui',
    display_name: 'ThingSet Serial Device UI',
    category: 'ThingSet',
    description: 'Inspect and control ThingSet devices via serial shell commands.',
    icon: 'plug',
    settings: [
      { name: 'datasource', display_name: 'Serial datasource', type: 'text' },
      { name: 'usePrefix', display_name: "Prefix commands with 'thingset '", type: 'boolean', default_value: false },
      { name: 'debug', display_name: 'Log ThingSet serial I/O to console', type: 'boolean', default_value: false },
      { name: 'autoRefresh', display_name: 'Load on start', type: 'boolean', default_value: true },
    ],
    newInstance(settings, newInstanceCallback) {
      newInstanceCallback(new SerialThingSetWidget(settings));
    },
  });
}());
