(function () {
  const api = window.api || null;
  const ipcShim = (function createIpcShim(apiRef) {
    if (!apiRef) return null;
    const serial = apiRef.serial || null;
    if (!serial) return null;
    return {
      invoke: async (channel, payload = {}) => {
        switch (channel) {
          case 'get-serial-headers':
            return serial.getHeaders ? serial.getHeaders(payload.path, payload.type) : null;
          case 'get-serial-colors':
            return serial.getColors ? serial.getColors(payload.path, payload.type) : null;
          default:
            return null;
        }
      }
    };
  })(api);
  freeboard.loadWidgetPlugin({
    type_name: 'uplot_series_manager',
    display_name: 'Plot Channel Manager',
    description: 'Add/remove variables and math operations for a target Plot widget',
    settings: [],
    newInstance: function (settings, newInstanceCallback) {
      newInstanceCallback(new SeriesManager(settings));
    }
  });

  class SeriesManager {
    constructor(settings) {
      this.settings = settings;
      this.ipc = ipcShim || window.require?.('electron')?.ipcRenderer;
      this.container = $('<div class="h-100 overflow-auto p-2 d-flex flex-column gap-2"></div>');
      this.controls = {};
      this._cleanupFns = [];
      if (freeboard && typeof freeboard.addStyle === 'function') {
        // Align label/input widths across the manager rows.
        freeboard.addStyle('.plot-channel-manager .input-group-text', 'min-width:140px;justify-content:center;');
        freeboard.addStyle('.plot-channel-manager .form-control, .plot-channel-manager .form-select', 'min-width:140px;');
      }
    }

    render(el) {
      const root = this.container;
      $(el).append(root);
      root.empty();
      if (this._cleanupFns && this._cleanupFns.length) {
        this._cleanupFns.forEach(fn => { try { fn(); } catch {} });
        this._cleanupFns = [];
      }

      const widgetRow = $('<div class="input-group input-group-sm plot-channel-manager"></div>');
      const widgetLabel = $('<span class="input-group-text">Target Plot</span>');
      const widgetSelect = $('<select class="form-select form-select-sm"></select>');
      this.controls.widget = widgetSelect;
      widgetRow.append(widgetLabel).append(widgetSelect);
      const updateBtn = $('<button class="btn btn-outline-secondary btn-sm ms-auto">Update sources</button>');
      const headerWrap = $('<div class="d-flex flex-wrap align-items-center gap-2"></div>');
      headerWrap.append(widgetRow).append(updateBtn);

      const opRow = $('<div class="input-group input-group-sm plot-channel-manager"></div>');
      const opLabel = $('<span class="input-group-text">Operation</span>');
      const opSelect = $('<select class="form-select form-select-sm"></select>')
        .append('<option value="identity">x</option>')
        .append('<option value="negate">-x</option>')
        .append('<option value="abs">abs(x)</option>')
        .append('<option value="scale">x * k</option>')
        .append('<option value="offset">x + b</option>')
        .append('<option value="mulvar">x * y</option>');
      const paramInput = $('<input type="number" step="any" class="form-control form-control-sm" placeholder="k or b">').hide();
      opSelect.on('change', () => {
        const v = opSelect.val();
        paramInput.toggle(v === 'scale' || v === 'offset');
        const showY = v === 'mulvar';
        srcB.row.toggle(showY);
      });
      opRow.append(opLabel).append(opSelect).append(paramInput);

      const makeSourceRow = (title) => {
        const row = $('<div class="input-group input-group-sm plot-channel-manager"></div>');
        const lab = $(`<span class="input-group-text">${title}</span>`);
        const ds = $('<select class="form-select form-select-sm" style="max-width: 200px;"></select>');
        const dev = $('<select class="form-select form-select-sm" style="max-width: 160px; display:none;"></select>');
        const vsel = $('<select class="form-select form-select-sm" style="max-width: 260px;"></select>');
        row.append(lab).append(ds).append(dev).append(vsel);
        return { row, ds, dev, vsel };
      };

      const srcARow = makeSourceRow('Source X');
      const srcB = makeSourceRow('Source Y');
      srcB.row.hide();

      const labelRow = $('<div class="input-group input-group-sm plot-channel-manager"></div>');
      const labelLab = $('<span class="input-group-text">Label</span>');
      const labelInput = $('<input type="text" class="form-control form-control-sm" placeholder="Channel label (optional)">');
      labelRow.append(labelLab).append(labelInput);

      const btnRow = $('<div class="d-flex gap-1"></div>');
      const addBtn = $('<button class="btn btn-primary btn-sm">Add channel</button>');
      const resetBtn = $('<button class="btn btn-outline-danger btn-sm">Reset channels</button>');
      btnRow.append(addBtn, resetBtn);

      const list = $('<div class="d-flex flex-column gap-1"></div>');

      root.append(headerWrap, opRow, srcARow.row, srcB.row, labelRow, btnRow, $('<hr/>'), list);

      // Wire up behaviors
      const refreshWidgets = () => {
        const s = this._listPlotWidgets();
        const cur = widgetSelect.val();
        widgetSelect.empty();
        s.forEach(t => widgetSelect.append($('<option>').val(t).text(t)));
        if (cur && widgetSelect.find(`option[value="${cur}"]`).length) widgetSelect.val(cur);
      };

      const refreshDatasources = (selectEl) => {
        const list = this._listDatasources();
        const cur = selectEl.val();
        selectEl.empty();
        list.forEach(d => selectEl.append($('<option>').val(d.name).text(d.name)));
        if (cur && selectEl.find(`option[value="${cur}"]`).length) selectEl.val(cur);
      };

      const onDsChange = async (dsSel, devSel, varSel) => {
        const type = this._getDatasourceType(dsSel.val());
        devSel.toggle(type === 'can_datasource');
        if (type === 'can_datasource') await this._populateDevices(dsSel.val(), devSel);
        await this._populateVariables(dsSel.val(), devSel.val(), varSel);
      };

      const refreshSources = async () => {
        refreshDatasources(srcARow.ds);
        refreshDatasources(srcB.ds);
        await onDsChange(srcARow.ds, srcARow.dev, srcARow.vsel);
        await onDsChange(srcB.ds, srcB.dev, srcB.vsel);
      };

      updateBtn.on('click', () => { refreshSources(); });

      srcARow.ds.on('change', () => onDsChange(srcARow.ds, srcARow.dev, srcARow.vsel));
      srcARow.dev.on('change', () => onDsChange(srcARow.ds, srcARow.dev, srcARow.vsel));
      srcB.ds.on('change', () => onDsChange(srcB.ds, srcB.dev, srcB.vsel));
      srcB.dev.on('change', () => onDsChange(srcB.ds, srcB.dev, srcB.vsel));
      opSelect.on('change', () => { if (opSelect.val() === 'mulvar') srcB.row.show(); else srcB.row.hide(); });

      addBtn.on('click', () => {
        const def = this._buildDefFromInputs(opSelect, paramInput, srcARow, srcB, labelInput);
        if (!def) return;
        const w = this._findTargetPlot(widgetSelect.val());
        if (!w) return;
        const defs = this._getSeriesDefs(w);
        defs.push(def);
        this._setSeriesDefs(w, defs);
        this._renderList(w, list);
      });
      resetBtn.on('click', () => {
        const w = this._findTargetPlot(widgetSelect.val());
        if (!w) return;
        this._setSeriesDefs(w, []);
        this._renderList(w, list);
      });

      // Initial population
      refreshWidgets();
      refreshSources();
      if (widgetSelect.val()) this._renderList(this._findTargetPlot(widgetSelect.val()), list);

      const subscriptionHandler = () => { refreshSources(); };
      window.addEventListener('thingset-subscriptions-updated', subscriptionHandler);
      this._cleanupFns.push(() => window.removeEventListener('thingset-subscriptions-updated', subscriptionHandler));

      if (freeboard.on) {
        const configHandler = () => {
          refreshWidgets();
          refreshSources();
        };
        freeboard.on('config_updated', configHandler);
        if (typeof freeboard.off === 'function') {
          this._cleanupFns.push(() => { try { freeboard.off('config_updated', configHandler); } catch {} });
        }
      }
    }

    _listPlotWidgets() {
      const model = freeboard.getLiveModel();
      const out = [];
      model.panes().forEach(p => p.widgets().forEach(w => {
        if (w.type() === 'owntech_plot_uplot') {
          let t = w.settings().title; if (typeof t === 'function') t = t();
          if (t) out.push(t);
        }
      }));
      return out;
    }

    _findTargetPlot(title) {
      const model = freeboard.getLiveModel();
      return model.panes().flatMap(p => p.widgets()).find(w => {
        let t = w.settings().title; if (typeof t === 'function') t = t();
        return t === title && w.type() === 'owntech_plot_uplot';
      });
    }

    _listDatasources() {
      const live = freeboard.getLiveModel?.();
      if (!live || typeof live.datasources !== 'function') return [];
      const list = [];
      live.datasources().forEach(ds => {
        try {
          const t = ds.type && ds.type();
          if (t === 'serialport_datasource' || t === 'fast_frame_datasource' || t === 'can_datasource' || t === 'signal_generator_datasource') {
            list.push({ name: ds.name(), type: t });
          }
        } catch {}
      });
      return list;
    }

    _getDatasourceType(name) {
      const live = freeboard.getLiveModel?.();
      if (!live || typeof live.datasources !== 'function') return null;
      const list = live.datasources();
      for (const ds of list) {
        try { if (ds.name && ds.name() === name) return ds.type?.(); } catch {}
      }
      return null;
    }

    _formatDeviceLabel(addr, meta) {
      if (!addr) return '';
      const uid = meta && meta.node_uid;
      return uid ? `${addr} (${uid})` : addr;
    }

    async _populateDevices(dsName, devSelect) {
      if (!this.ipc) return;
      try {
        const dsSettings = freeboard.getDatasourceSettings(dsName) || {};
        const channel = dsSettings.channel || 'can0';
        try { await this.ipc.invoke('can-aggregate-start', { channel }); } catch {}
        const snap = await this.ipc.invoke('can-aggregate-snapshot', { channel });
        const nodes = snap?.nodes || {};
        const keys = Object.keys(nodes).sort();
        const prevVal = devSelect.val();
        const prevUidAttr = devSelect.find('option:selected').data('uid');
        const prevUid = (typeof prevUidAttr !== 'undefined') ? prevUidAttr : (devSelect.data('selectedUid') || null);
        devSelect.empty();
        keys.forEach(k => {
          const meta = nodes[k] || {};
          const label = this._formatDeviceLabel(k, meta);
          const opt = $(`<option value="${k}">${label}</option>`);
          if (meta.node_uid) opt.attr('data-uid', meta.node_uid);
          devSelect.append(opt);
        });
        let next = null;
        if (prevUid) next = keys.find(k => (nodes[k]?.node_uid === prevUid)) || null;
        if (!next && prevVal && devSelect.find(`option[value='${prevVal}']`).length) next = prevVal;
        if (!next && keys.length) next = keys[0];
        if (next) {
          devSelect.val(next);
          devSelect.data('selectedUid', nodes[next]?.node_uid || null);
        } else {
          devSelect.data('selectedUid', null);
        }
      } catch {}
    }

    async _populateVariables(dsName, deviceVal, varSelect) {
      varSelect.empty();
      if (!dsName) return;
      const type = this._getDatasourceType(dsName);
      if (type === 'signal_generator_datasource') {
        varSelect.append('<option value="0">Signal</option>');
      } else if (type === 'fast_frame_datasource' || type === 'serialport_datasource') {
        let headers = [];
        try {
          const dsSettings = freeboard.getDatasourceSettings(dsName) || {};
          const path = dsSettings.portPath || dsName;
          headers = await this.ipc.invoke('get-serial-headers', { path, type });
        } catch {}
        let count = headers && headers.length ? headers.length : 0;
        if (!count && this.ipc) {
          try {
            const dsSettings = freeboard.getDatasourceSettings(dsName) || {};
            const path = dsSettings.portPath || dsName;
            if (type === 'fast_frame_datasource') {
              const dataset = await this.ipc.invoke('get-fast-dataset', { path });
              if (dataset && Array.isArray(dataset.series)) count = dataset.series.length;
            } else {
              const arr = await this.ipc.invoke('get-serial-buffer', { path });
              if (Array.isArray(arr)) count = arr.length;
            }
          } catch {}
        }
        for (let i = 0; i < count; i++) {
          const alpha = String.fromCharCode(65 + (i % 26));
          const suffix = i >= 26 ? ` ${Math.floor(i / 26) + 1}` : '';
          const fallback = `Channel ${alpha}${suffix}`;
          const label = headers[i] || fallback;
          varSelect.append(`<option value="${i}">${label}</option>`);
        }
      } else if (type === 'can_datasource') {
        if (!this.ipc) return;
        try {
          const dsSettings = freeboard.getDatasourceSettings(dsName) || {};
          const channel = dsSettings.channel || 'can0';
          const dev = deviceVal;
          const snap = await this.ipc.invoke('can-aggregate-snapshot', { channel });
          const flat = snap?.nodes?.[dev]?.flat || {};
          const entries = Object.keys(flat).sort();
          entries.forEach(p => {
            const leaf = p.includes('/') ? p.split('/').pop() : p;
            const text = (leaf && leaf !== p) ? `${leaf} — ${p}` : p;
            const opt = $(`<option value="${p}">${text}</option>`);
            opt.attr('title', p);
            varSelect.append(opt);
          });
        } catch {}
      }
    }

    _buildDefFromInputs(opSelect, paramInput, srcA, srcB, labelInput) {
      const op = opSelect.val();
      const param = parseFloat(paramInput.val());
      const typeA = this._getDatasourceType(srcA.ds.val());
      const selectedAUid = srcA.dev.find('option:selected').data('uid');
      const A = {
        ds: srcA.ds.val(),
        type: typeA,
        device: (typeA === 'can_datasource') ? srcA.dev.val() : null,
        device_uid: (typeA === 'can_datasource') ? (selectedAUid || srcA.dev.data('selectedUid') || null) : null,
        var: (typeA === 'can_datasource') ? srcA.vsel.val() : parseInt(srcA.vsel.val(), 10)
      };
      let B = null;
      if (op === 'mulvar') {
        const typeB = this._getDatasourceType(srcB.ds.val());
        const selectedBUid = srcB.dev.find('option:selected').data('uid');
        B = {
          ds: srcB.ds.val(),
          type: typeB,
          device: (typeB === 'can_datasource') ? srcB.dev.val() : null,
          device_uid: (typeB === 'can_datasource') ? (selectedBUid || srcB.dev.data('selectedUid') || null) : null,
          var: (typeB === 'can_datasource') ? srcB.vsel.val() : parseInt(srcB.vsel.val(), 10)
        };
      }
      if (!A.ds) return null;
      const def = { label: (labelInput.val() || '').trim(), op, param: isNaN(param) ? 0 : param, a: A };
      if (B) def.b = B;
      return def;
    }

    _getSeriesDefs(widget) {
      const s = widget.settings();
      let defs = typeof s.seriesDefs === 'function' ? s.seriesDefs() : s.seriesDefs;
      if (typeof defs === 'string' && defs.trim().startsWith('[')) { try { defs = JSON.parse(defs); } catch { defs = []; } }
      if (!Array.isArray(defs)) defs = [];
      return defs;
    }

    _setSeriesDefs(widget, defs) {
      const updated = { ...widget.settings(), seriesDefs: defs };
      widget.settings(updated);
      widget.widgetInstance.onSettingsChanged(updated);
    }

    _renderList(widget, listEl) {
      const defs = this._getSeriesDefs(widget);
      listEl.empty();
      if (!defs.length) { listEl.append('<div class="text-muted">No channels added</div>'); return; }
      defs.forEach((d, i) => {
        const row = $('<div class="d-flex align-items-center justify-content-between border rounded px-2 py-1"></div>');
        const left = $('<div class="d-flex align-items-center gap-2"></div>');
        const label = d.label || this._formatDefLabel(d, i);
        left.append($('<strong></strong>').text(label));
        const devALabel = (d.a.type === 'can_datasource') ? (d.a.device_uid || d.a.device || '') : '';
        left.append(`<span class="badge bg-light text-dark">${d.a.ds}${devALabel ? ' ' + devALabel : ''}</span>`);
        if (d.op === 'mulvar' && d.b) {
          const devBLabel = (d.b.type === 'can_datasource') ? (d.b.device_uid || d.b.device || '') : '';
          left.append(`<span>×</span><span class="badge bg-light text-dark">${d.b.ds}${devBLabel ? ' ' + devBLabel : ''}</span>`);
        }
        const rm = $('<button class="btn btn-sm btn-outline-danger">Remove</button>');
        rm.on('click', () => {
          const newer = defs.slice(0, i).concat(defs.slice(i + 1));
          this._setSeriesDefs(widget, newer);
          this._renderList(widget, listEl);
        });
        row.append(left, rm);
        listEl.append(row);
      });
    }

    _formatDefLabel(d, plotIndex = 0) {
      const nameA = String(d?.a?.var);
      // Build a consistent label that includes plot channel + source index.
      const plotLetter = String.fromCharCode(65 + (plotIndex % 26));
      const plotSuffix = plotIndex >= 26 ? ` ${Math.floor(plotIndex / 26) + 1}` : '';
      const plotLabel = `Channel ${plotLetter}${plotSuffix}`;
      const srcIndex = Number.isFinite(Number(d?.a?.var)) ? Number(d?.a?.var) + 1 : d?.a?.var;
      const base = `${plotLabel} · Src ${srcIndex}`;
      if (d.op === 'mulvar' && d.b) return `${base} × ${String(d.b.var)}`;
      if (d.op === 'negate') return `-${base}`;
      if (d.op === 'abs') return `abs(${base})`;
      if (d.op === 'scale') return `${base} * ${d.param}`;
      if (d.op === 'offset') return `${base} + ${d.param}`;
      return base;
    }

    onSettingsChanged(s) { this.settings = s; }
    getHeight() { return 6; }
    onDispose() {
      if (this._cleanupFns && this._cleanupFns.length) {
        this._cleanupFns.forEach(fn => { try { fn(); } catch {} });
        this._cleanupFns = [];
      }
    }
  }
}());
