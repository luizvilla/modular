(function () {
    const api = window.api || null;
    const ipcShim = (function createIpcShim(apiRef) {
        if (!apiRef) return null;
        const serial = apiRef.serial || null;
        const can = apiRef.can || null;
        if (!serial && !can) return null;
        return {
            invoke: async (channel, payload = {}) => {
                switch (channel) {
                    case 'can-aggregate-start':
                        return can && can.aggregateStart ? can.aggregateStart(payload) : null;
                    case 'can-aggregate-snapshot':
                        return can && can.aggregateSnapshot ? can.aggregateSnapshot(payload) : null;
                    case 'get-serial-headers':
                        return serial && serial.getHeaders ? serial.getHeaders(payload.path, payload.type) : null;
                    case 'get-fast-dataset':
                        return serial && serial.getFastDataset ? serial.getFastDataset(payload.path) : null;
                    case 'get-serial-buffer':
                        return serial && serial.getBuffer ? serial.getBuffer(payload.path) : null;
                    default:
                        return null;
                }
            }
        };
    })(api);

    freeboard.loadWidgetPlugin({
        type_name: "xy_plot_source_manager",
        display_name: "XY Source Manager",
        description: "Configure X and Y sources for a target XY Plot widget",
        settings: [],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new XYPlotSourceManager(settings));
        }
    });

    class XYPlotSourceManager {
        constructor(settings) {
            this.settings = settings;
            this.ipc = ipcShim || window.require?.('electron')?.ipcRenderer;
            this.container = $('<div class="h-100 overflow-auto p-2 d-flex flex-column gap-2"></div>');
            this.controls = {};
            this._cleanupFns = [];
            if (freeboard && typeof freeboard.addStyle === 'function') {
                freeboard.addStyle('.xy-plot-manager .input-group-text', 'min-width:120px;justify-content:center;');
                freeboard.addStyle('.xy-plot-manager .form-control, .xy-plot-manager .form-select', 'min-width:120px;');
            }
        }

        render(containerElement) {
            const root = this.container;
            $(containerElement).append(root);
            root.empty();
            if (this._cleanupFns.length) {
                this._cleanupFns.forEach(fn => { try { fn(); } catch {} });
                this._cleanupFns = [];
            }

            const headerRow = $('<div class="d-flex flex-wrap align-items-center gap-2"></div>');
            const targetRow = $('<div class="input-group input-group-sm xy-plot-manager"></div>');
            const targetLabel = $('<span class="input-group-text">Target XY Plot</span>');
            const targetSelect = $('<select class="form-select form-select-sm"></select>');
            targetRow.append(targetLabel, targetSelect);
            this.controls.widget = targetSelect;
            const updateBtn = $('<button class="btn btn-outline-secondary btn-sm ms-auto">Update sources</button>');
            headerRow.append(targetRow, updateBtn);

            const makeSourceControls = (label) => {
                const sourceRow = $('<div class="input-group input-group-sm xy-plot-manager"></div>');
                const sourceLabel = $(`<span class="input-group-text">${label}</span>`);
                const ds = $('<select class="form-select form-select-sm" style="max-width:180px;"></select>');
                const dev = $('<select class="form-select form-select-sm" style="max-width:180px;display:none;"></select>');
                const variable = $('<select class="form-select form-select-sm" style="max-width:260px;"></select>');
                sourceRow.append(sourceLabel, ds, dev, variable);

                const opRow = $('<div class="input-group input-group-sm xy-plot-manager"></div>');
                const opLabel = $('<span class="input-group-text">Transform</span>');
                const op = $('<select class="form-select form-select-sm"></select>')
                    .append('<option value="identity">x</option>')
                    .append('<option value="negate">-x</option>')
                    .append('<option value="abs">abs(x)</option>')
                    .append('<option value="scale">x * k</option>')
                    .append('<option value="offset">x + b</option>');
                const param = $('<input type="number" step="any" class="form-control form-control-sm" placeholder="k or b">').hide();
                op.on('change', () => {
                    const v = op.val();
                    param.toggle(v === 'scale' || v === 'offset');
                });
                opRow.append(opLabel, op, param);

                return { sourceRow, opRow, ds, dev, variable, op, param };
            };

            const xControls = makeSourceControls('Source X');
            const yControls = makeSourceControls('Source Y');

            const btnRow = $('<div class="d-flex gap-1"></div>');
            const applyBtn = $('<button class="btn btn-primary btn-sm">Apply to XY Plot</button>');
            const clearBtn = $('<button class="btn btn-outline-danger btn-sm">Clear Sources</button>');
            btnRow.append(applyBtn, clearBtn);

            root.append(
                headerRow,
                xControls.sourceRow,
                xControls.opRow,
                yControls.sourceRow,
                yControls.opRow,
                btnRow
            );

            const refreshWidgets = () => {
                const titles = this._listXYWidgets();
                const current = targetSelect.val();
                targetSelect.empty();
                titles.forEach(title => targetSelect.append($('<option>').val(title).text(title)));
                if (current && targetSelect.find(`option[value="${current}"]`).length) targetSelect.val(current);
                if (!targetSelect.val() && titles.length) targetSelect.val(titles[0]);
            };

            const refreshDatasources = (selectEl) => {
                const sources = this._listDatasources();
                const current = selectEl.val();
                selectEl.empty();
                sources.forEach(ds => selectEl.append($('<option>').val(ds.name).text(ds.name)));
                if (current && selectEl.find(`option[value="${current}"]`).length) selectEl.val(current);
                if (!selectEl.val() && sources.length) selectEl.val(sources[0].name);
            };

            const onDsChange = async (controls) => {
                const type = this._getDatasourceType(controls.ds.val());
                controls.dev.toggle(type === 'can_datasource');
                if (type === 'can_datasource') await this._populateDevices(controls.ds.val(), controls.dev);
                await this._populateVariables(controls.ds.val(), controls.dev.val(), controls.variable);
            };

            const refreshSources = async () => {
                refreshDatasources(xControls.ds);
                refreshDatasources(yControls.ds);
                await onDsChange(xControls);
                await onDsChange(yControls);
            };

            xControls.ds.on('change', () => onDsChange(xControls));
            xControls.dev.on('change', () => onDsChange(xControls));
            yControls.ds.on('change', () => onDsChange(yControls));
            yControls.dev.on('change', () => onDsChange(yControls));
            targetSelect.on('change', () => this._syncFromWidget(targetSelect.val(), xControls, yControls));
            updateBtn.on('click', async () => {
                await refreshSources();
                await this._syncFromWidget(targetSelect.val(), xControls, yControls);
            });

            applyBtn.on('click', () => {
                const widget = this._findTargetWidget(targetSelect.val());
                if (!widget) return;
                const xSourceDef = this._buildSourceDef(xControls);
                const ySourceDef = this._buildSourceDef(yControls);
                if (!xSourceDef || !ySourceDef) return;
                const updated = { ...widget.settings(), xSourceDef, ySourceDef };
                widget.settings(updated);
                widget.widgetInstance.onSettingsChanged(updated);
            });

            clearBtn.on('click', () => {
                const widget = this._findTargetWidget(targetSelect.val());
                if (!widget) return;
                const updated = { ...widget.settings(), xSourceDef: null, ySourceDef: null };
                widget.settings(updated);
                widget.widgetInstance.onSettingsChanged(updated);
            });

            refreshWidgets();
            refreshSources().then(() => this._syncFromWidget(targetSelect.val(), xControls, yControls));

            const subscriptionHandler = () => { refreshSources(); };
            window.addEventListener('thingset-subscriptions-updated', subscriptionHandler);
            this._cleanupFns.push(() => window.removeEventListener('thingset-subscriptions-updated', subscriptionHandler));

            if (freeboard.on) {
                const configHandler = () => {
                    refreshWidgets();
                    refreshSources().then(() => this._syncFromWidget(targetSelect.val(), xControls, yControls));
                };
                freeboard.on('config_updated', configHandler);
                if (typeof freeboard.off === 'function') {
                    this._cleanupFns.push(() => { try { freeboard.off('config_updated', configHandler); } catch {} });
                }
            }
        }

        _listXYWidgets() {
            const model = freeboard.getLiveModel();
            const out = [];
            model.panes().forEach(p => p.widgets().forEach(w => {
                if (w.type() === 'xy_plot_uplot') {
                    let title = w.settings().title;
                    if (typeof title === 'function') title = title();
                    if (title) out.push(title);
                }
            }));
            return out;
        }

        _findTargetWidget(title) {
            const model = freeboard.getLiveModel();
            return model.panes().flatMap(p => p.widgets()).find(w => {
                let widgetTitle = w.settings().title;
                if (typeof widgetTitle === 'function') widgetTitle = widgetTitle();
                return widgetTitle === title && w.type() === 'xy_plot_uplot';
            });
        }

        _listDatasources() {
            const live = freeboard.getLiveModel?.();
            if (!live || typeof live.datasources !== 'function') return [];
            const list = [];
            live.datasources().forEach(ds => {
                try {
                    const type = ds.type && ds.type();
                    if (type === 'serialport_datasource' || type === 'fast_frame_datasource' || type === 'can_datasource' || type === 'signal_generator_datasource') {
                        list.push({ name: ds.name(), type });
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
                try {
                    if (ds.name && ds.name() === name) return ds.type?.();
                } catch {}
            }
            return null;
        }

        async _populateDevices(dsName, devSelect) {
            if (!this.ipc || !dsName) return;
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
                    if (uid) opt.attr('data-uid', uid);
                    devSelect.append(opt);
                });
                if (current && devSelect.find(`option[value="${current}"]`).length) devSelect.val(current);
                if (!devSelect.val() && Object.keys(nodes).length) devSelect.val(Object.keys(nodes).sort()[0]);
            } catch {}
        }

        async _populateVariables(dsName, deviceVal, varSelect) {
            varSelect.empty();
            if (!dsName) return;
            const type = this._getDatasourceType(dsName);
            if (type === 'signal_generator_datasource') {
                varSelect.append('<option value="0">Signal</option>');
                return;
            }
            if (type === 'serialport_datasource' || type === 'fast_frame_datasource') {
                let headers = [];
                try {
                    const dsSettings = freeboard.getDatasourceSettings(dsName) || {};
                    const path = dsSettings.portPath || dsName;
                    headers = await this.ipc.invoke('get-serial-headers', { path, type });
                } catch {}
                let count = headers.length;
                if (!count) {
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
                return;
            }
            if (type === 'can_datasource') {
                try {
                    const dsSettings = freeboard.getDatasourceSettings(dsName) || {};
                    const channel = dsSettings.channel || 'can0';
                    const snap = await this.ipc.invoke('can-aggregate-snapshot', { channel });
                    const flat = snap?.nodes?.[deviceVal]?.flat || {};
                    Object.keys(flat).sort().forEach(path => {
                        const leaf = path.includes('/') ? path.split('/').pop() : path;
                        const text = leaf && leaf !== path ? `${leaf} — ${path}` : path;
                        varSelect.append(`<option value="${path}">${text}</option>`);
                    });
                } catch {}
            }
        }

        async _syncFromWidget(title, xControls, yControls) {
            const widget = this._findTargetWidget(title);
            if (!widget) return;
            const settings = widget.settings();
            await this._syncAxisControls(typeof settings.xSourceDef === 'function' ? settings.xSourceDef() : settings.xSourceDef, xControls);
            await this._syncAxisControls(typeof settings.ySourceDef === 'function' ? settings.ySourceDef() : settings.ySourceDef, yControls);
        }

        async _syncAxisControls(sourceDef, controls) {
            if (!sourceDef || !sourceDef.ds) return;
            controls.ds.val(sourceDef.ds);
            await this._populateDevices(sourceDef.ds, controls.dev);
            await this._populateVariables(sourceDef.ds, sourceDef.device, controls.variable);
            const type = this._getDatasourceType(sourceDef.ds);
            controls.dev.toggle(type === 'can_datasource');
            if (sourceDef.device && controls.dev.find(`option[value="${sourceDef.device}"]`).length) controls.dev.val(sourceDef.device);
            const varValue = String(sourceDef.var);
            if (controls.variable.find(`option[value="${varValue}"]`).length) controls.variable.val(varValue);
            controls.op.val(sourceDef.op || 'identity').trigger('change');
            controls.param.val(sourceDef.param ?? '');
        }

        _buildSourceDef(controls) {
            const ds = controls.ds.val();
            const type = this._getDatasourceType(ds);
            if (!ds || !type) return null;
            const op = controls.op.val() || 'identity';
            const rawParam = parseFloat(controls.param.val());
            const param = Number.isFinite(rawParam) ? rawParam : 0;
            const out = {
                ds,
                type,
                device: null,
                device_uid: null,
                var: type === 'can_datasource' ? controls.variable.val() : parseInt(controls.variable.val(), 10),
                op,
                param
            };
            if (type === 'can_datasource') {
                out.device = controls.dev.val();
                const selected = controls.dev.find('option:selected');
                out.device_uid = selected.attr('data-uid') || null;
            }
            return out;
        }

        onSettingsChanged(newSettings) {
            this.settings = newSettings;
        }

        onDispose() {
            if (this._cleanupFns.length) {
                this._cleanupFns.forEach(fn => { try { fn(); } catch {} });
                this._cleanupFns = [];
            }
        }

        getHeight() {
            return 8;
        }
    }
})();
