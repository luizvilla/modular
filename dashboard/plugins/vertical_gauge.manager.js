(function () {
    freeboard.loadWidgetPlugin({
        type_name: 'vertical_gauge_manager',
        display_name: 'Gauge Channel Manager',
        description: 'Select datasource/channel for a target Vertical Gauge',
        category: 'plots',
        settings: [],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new GaugeManager(settings));
        }
    });

    class GaugeManager {
        constructor(settings) {
            this.settings = settings;
            this.ipc = window.require?.('electron')?.ipcRenderer;
            this.container = $('<div class="h-100 overflow-auto p-2 d-flex flex-column gap-2"></div>');
            this.controls = {};
            this._cleanupFns = [];
        }

        render(el) {
            const root = this.container;
            $(el).append(root);
            root.empty();
            if (this._cleanupFns.length) {
                this._cleanupFns.forEach(fn => { try { fn(); } catch {} });
                this._cleanupFns = [];
            }

            const widgetRow = $('<div class="input-group input-group-sm"></div>');
            const widgetLabel = $('<span class="input-group-text">Target Gauge</span>');
            const widgetSelect = $('<select class="form-select form-select-sm"></select>');
            this.controls.widget = widgetSelect;
            widgetRow.append(widgetLabel).append(widgetSelect);

            const updateBtn = $('<button class="btn btn-outline-secondary btn-sm ms-auto">Update sources</button>');
            const headerWrap = $('<div class="d-flex flex-wrap align-items-center gap-2"></div>');
            headerWrap.append(widgetRow).append(updateBtn);

            const makeSourceRow = () => {
                const row = $('<div class="input-group input-group-sm"></div>');
                const lab = $('<span class="input-group-text">Source</span>');
                const ds = $('<select class="form-select form-select-sm" style="max-width: 200px;"></select>');
                const dev = $('<select class="form-select form-select-sm" style="max-width: 160px; display:none;"></select>');
                const vsel = $('<select class="form-select form-select-sm" style="max-width: 260px;"></select>');
                row.append(lab).append(ds).append(dev).append(vsel);
                return { row, ds, dev, vsel };
            };

            const srcRow = makeSourceRow();

            const btnRow = $('<div class="d-flex gap-1"></div>');
            const applyBtn = $('<button class="btn btn-primary btn-sm">Apply to Gauge</button>');
            const clearBtn = $('<button class="btn btn-outline-danger btn-sm">Clear Source</button>');
            btnRow.append(applyBtn, clearBtn);

            root.append(headerWrap, srcRow.row, btnRow);

            const refreshWidgets = () => {
                const s = this._listGaugeWidgets();
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
                refreshDatasources(srcRow.ds);
                await onDsChange(srcRow.ds, srcRow.dev, srcRow.vsel);
            };

            updateBtn.on('click', () => { refreshSources(); });
            srcRow.ds.on('change', () => onDsChange(srcRow.ds, srcRow.dev, srcRow.vsel));
            srcRow.dev.on('change', () => onDsChange(srcRow.ds, srcRow.dev, srcRow.vsel));

            applyBtn.on('click', () => {
                const w = this._findTargetGauge(widgetSelect.val());
                if (!w) return;
                const def = this._buildSourceDef(srcRow);
                if (!def) return;
                const updated = { ...w.settings(), sourceDef: def };
                w.settings(updated);
                w.widgetInstance.onSettingsChanged(updated);
            });
            clearBtn.on('click', () => {
                const w = this._findTargetGauge(widgetSelect.val());
                if (!w) return;
                const updated = { ...w.settings(), sourceDef: null };
                w.settings(updated);
                w.widgetInstance.onSettingsChanged(updated);
            });

            refreshWidgets();
            refreshSources();

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

        _listGaugeWidgets() {
            const model = freeboard.getLiveModel();
            const out = [];
            model.panes().forEach(p => p.widgets().forEach(w => {
                if (w.type() === 'vertical_gauge') {
                    let t = w.settings().title; if (typeof t === 'function') t = t();
                    if (t) out.push(t);
                }
            }));
            return out;
        }

        _findTargetGauge(title) {
            const model = freeboard.getLiveModel();
            return model.panes().flatMap(p => p.widgets()).find(w => {
                let t = w.settings().title; if (typeof t === 'function') t = t();
                return t === title && w.type() === 'vertical_gauge';
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

        async _populateDevices(dsName, devSelect) {
            if (!this.ipc) return;
            try {
                const dsSettings = freeboard.getDatasourceSettings(dsName) || {};
                const channel = dsSettings.channel || 'can0';
                try { await this.ipc.invoke('can-aggregate-start', { channel }); } catch {}
                const snap = await this.ipc.invoke('can-aggregate-snapshot', { channel });
                const nodes = snap?.nodes || {};
                const current = devSelect.val();
                devSelect.empty();
                Object.keys(nodes).sort().forEach(addr => {
                    const uid = nodes[addr]?.node_uid;
                    const label = uid ? `${addr} (${uid})` : addr;
                    const opt = $(`<option value="${addr}">${label}</option>`);
                    if (uid) opt.data('uid', uid);
                    devSelect.append(opt);
                });
                if (current && devSelect.find(`option[value="${current}"]`).length) {
                    devSelect.val(current);
                }
            } catch {}
        }

        async _populateVariables(dsName, deviceVal, varSelect) {
            varSelect.empty();
            const type = this._getDatasourceType(dsName);
            if (!type) return;
            if (type === 'signal_generator_datasource') {
                varSelect.append('<option value="0">Signal</option>');
            } else if (type === 'serialport_datasource' || type === 'fast_frame_datasource') {
                let headers = [];
                if (this.ipc) {
                    try {
                        const dsSettings = freeboard.getDatasourceSettings(dsName) || {};
                        const path = dsSettings.portPath || dsName;
                        headers = await this.ipc.invoke('get-serial-headers', { path, type });
                    } catch {}
                }
                let count = 0;
                if (this.ipc) {
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
                    const label = headers[i] || `Channel ${i + 1}`;
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
                        const text = (leaf && leaf !== p) ? `${leaf} - ${p}` : p;
                        const opt = $(`<option value="${p}">${text}</option>`);
                        opt.attr('title', p);
                        varSelect.append(opt);
                    });
                } catch {}
            }
        }

        _buildSourceDef(src) {
            const type = this._getDatasourceType(src.ds.val());
            const selectedUid = src.dev.find('option:selected').data('uid');
            const def = {
                ds: src.ds.val(),
                type,
                device: (type === 'can_datasource') ? src.dev.val() : null,
                device_uid: (type === 'can_datasource') ? (selectedUid || src.dev.data('selectedUid') || null) : null,
                var: (type === 'can_datasource') ? src.vsel.val() : parseInt(src.vsel.val(), 10)
            };
            if (!def.ds) return null;
            return def;
        }

        onSettingsChanged(s) { this.settings = s; }
        getHeight() { return 5; }
        onDispose() {
            if (this._cleanupFns.length) {
                this._cleanupFns.forEach(fn => { try { fn(); } catch {} });
                this._cleanupFns = [];
            }
        }
    }
}());
