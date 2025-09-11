(function () {
    freeboard.loadWidgetPlugin({
        type_name: "owntech_plot_uplot",
        display_name: "Plot widget",
        description: "Realtime uPlot-based chart. Accepts streaming values or a full dataset",
        external_scripts: [
            "https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.iife.min.js",
            "https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.min.css"
        ],
        settings: [
            { name: "title", display_name: "Title", type: "text" },
            { name: "data", display_name: "Data (array, { y: array }, or { timestamps, series })", type: "calculated" },
            // Optional helpers for better UX: a chosen datasource name and channel indices
            // These let config UIs (like uplot.UI.js) drive labels/colors without relying on parsing the 'data' expression
            { name: "datasource", display_name: "Datasource (auto from UI)", type: "text" },
            { name: "channelIndices", display_name: "Channels (auto from UI)", type: "text" },
            { name: "seriesDefs", display_name: "Series (managed by series controller)", type: "text" },
            { name: "duration", display_name: "Display Duration (ms)", type: "number", default_value: 20000 },
            { name: "refreshRate", display_name: "Refresh Rate (ms)", type: "number", default_value: 1000 },
            { name: "yLabel", display_name: "Y Axis Label", type: "text", default_value: "Value" },
            // Use text inputs to make these optional without validation errors
            { name: "yMin", display_name: "Y Min (optional)", type: "text" },
            { name: "yMax", display_name: "Y Max (optional)", type: "text" },
            { name: "showLegend", display_name: "Show Legend", type: "boolean", default_value: true }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new OwnTechPlotUPlot(settings));
        }
    });

class OwnTechPlotUPlot {
        constructor(settings) {
            this.settings = settings;
            // Simple container for the plot only; series are managed by an external controller
            this.container = $('<div class="w-100 h-100 overflow-auto"></div>');
            this.plot = null;
            this.seriesCount = 0;
            this.dataBuffer = [[], []]; // [timestamps, [series1, series2, ...]]
            this.maxPoints = 2000;
            this.lastRender = 0;
            this._resizeObs = null;
            this._resizeRAF = 0;
            this.pullTimer = null;
            this.localMode = false; // when true, we poll values ourselves
            this.seriesDefs = this._parseSeriesDefs((typeof settings.seriesDefs === 'function' ? settings.seriesDefs() : settings.seriesDefs));

            this.ipc = window.require?.('electron')?.ipcRenderer;
            this.headersByDs = {};
            this.colorsByDs = {};
            this.dsMap = [];
            this.datasourceName = (typeof settings.datasource === 'function' ? settings.datasource() : settings.datasource) || '';
            // channelIndices may come as array or JSON string; normalize to array of ints
            const chFromSettings = (typeof settings.channelIndices === 'function' ? settings.channelIndices() : settings.channelIndices);
            this.channelIndices = Array.isArray(chFromSettings)
                ? chFromSettings.map(x => parseInt(x, 10)).filter(n => Number.isFinite(n))
                : (typeof chFromSettings === 'string' && chFromSettings.trim().startsWith('[')
                    ? (function () { try { return JSON.parse(chFromSettings).map(x => parseInt(x, 10)).filter(n => Number.isFinite(n)); } catch { return []; } })()
                    : []);
            this.lastHeaderCheck = 0;
            this._configHandler = () => this._maybeUpdateHeaders(true);
            freeboard.on && freeboard.on('config_updated', this._configHandler);
            this._detectDatasource();
        }

        _detectDatasource() {
            // Prefer explicit settings when present; otherwise try to infer from the 'data' expression
            this.datasourceName = (typeof this.settings.datasource === 'function' ? this.settings.datasource() : this.settings.datasource) || '';
            const chFromSettings = (typeof this.settings.channelIndices === 'function' ? this.settings.channelIndices() : this.settings.channelIndices);
            this.channelIndices = Array.isArray(chFromSettings)
                ? chFromSettings.map(x => parseInt(x, 10)).filter(n => Number.isFinite(n))
                : (typeof chFromSettings === 'string' && chFromSettings.trim().startsWith('[')
                    ? (function () { try { return JSON.parse(chFromSettings).map(x => parseInt(x, 10)).filter(n => Number.isFinite(n)); } catch { return []; } })()
                    : []);
            this.dsMap = [];
            if (!this.datasourceName && typeof this.settings.data === 'string') {
                const pattern = /datasources\["([^"\]]+)"\]\["y(\d+)"\]/g;
                let m;
                while ((m = pattern.exec(this.settings.data)) !== null) {
                    const ds = m[1];
                    const idx = parseInt(m[2], 10) - 1;
                    this.dsMap.push({ ds, idx });
                }
                if (this.dsMap.length) {
                    this.datasourceName = this.dsMap[0].ds;
                    this.channelIndices = this.dsMap.map(d => d.idx);
                } else {
                    const dsMatch = this.settings.data.match(/datasources\[["']([^"']+)["']\]/);
                    if (dsMatch) this.datasourceName = dsMatch[1];
                    const chanRe = /\["y(\d+)"\]/g;
                    while ((m = chanRe.exec(this.settings.data)) !== null) {
                        const idx = parseInt(m[1], 10) - 1;
                        if (!isNaN(idx)) this.channelIndices.push(idx);
                    }
                }
            }
        }

        _getDatasourceType(name) {
            const live = freeboard.getLiveModel?.();
            if (!live || typeof live.datasources !== 'function') return null;
            const list = live.datasources();
            for (const ds of list) {
                try {
                    if (ds.name && ds.name() === name) {
                        return ds.type?.();
                    }
                } catch (e) { /* ignore */ }
            }
            return null;
        }

        async _fetchHeaders(dsName) {
            if (!this.ipc || !dsName) return [];
            const dsSettings = freeboard.getDatasourceSettings(dsName) || {};
            const path = dsSettings.portPath || dsName;
            const type = this._getDatasourceType(dsName);
            try {
                const headers = await this.ipc.invoke('get-serial-headers', { path, type });
                return Array.isArray(headers) ? headers : [];
            } catch (e) {
                console.error('header fetch failed', e);
                return [];
            }
        }

        async _fetchColors(dsName) {
            if (!this.ipc || !dsName) return [];
            const dsSettings = freeboard.getDatasourceSettings(dsName) || {};
            const path = dsSettings.portPath || dsName;
            const type = this._getDatasourceType(dsName);
            try {
                const colors = await this.ipc.invoke('get-serial-colors', { path, type });
                if (Array.isArray(colors) && colors.length) return colors;
            } catch (e) {
                console.error('color fetch failed', e);
            }
            if (Array.isArray(dsSettings.headers)) {
                return dsSettings.headers.map(h => h.color || null);
            }
            return [];
        }

        async _maybeUpdateHeaders(force = false) {
            const now = Date.now();
            if (!force && now - this.lastHeaderCheck < 1000) return;
            this.lastHeaderCheck = now;

            const uniqueDs = [...new Set([this.datasourceName, ...this.dsMap.map(d => d.ds)])].filter(Boolean);
            let changed = false;
            for (const ds of uniqueDs) {
                if (!ds) continue;
                const hdrs = await this._fetchHeaders(ds);
                const cols = await this._fetchColors(ds);
                if (!_.isEqual(hdrs, this.headersByDs[ds])) {
                    this.headersByDs[ds] = hdrs;
                    changed = true;
                }
                if (!_.isEqual(cols, this.colorsByDs[ds])) {
                    this.colorsByDs[ds] = cols;
                    changed = true;
                }
            }

            if (changed && this.plot) this._resetPlot();
        }

        _getSeriesLabel(idx) {
            if (Array.isArray(this.seriesDefs) && this.seriesDefs.length) {
                const def = this.seriesDefs[idx];
                if (def && def.label) return def.label;
            }
            const mapping = this.dsMap[idx] || {};
            const ds = mapping.ds ?? this.datasourceName;
            const chIdx = mapping.idx ?? this.channelIndices[idx] ?? idx;
            const headers = this.headersByDs[ds] || [];
            if (headers[chIdx]) return headers[chIdx];
            return `Channel ${chIdx + 1}`;
        }

        _getSeriesColor(idx) {
            const mapping = this.dsMap[idx] || {};
            const ds = mapping.ds ?? this.datasourceName;
            const chIdx = mapping.idx ?? this.channelIndices[idx] ?? idx;
            const colors = this.colorsByDs[ds] || [];
            if (colors[chIdx]) return colors[chIdx];
            return (typeof ColorBlind10 !== "undefined" ? ColorBlind10[idx % ColorBlind10.length] : `hsl(${(idx * 60) % 360}, 70%, 50%)`);
        }

        render(containerElement) {
            this.container.appendTo(containerElement);
            this._initPlot();
            this._maybeUpdateHeaders(true);
            this._bindResize();
            // If seriesDefs present, start local streaming
            this.localMode = Array.isArray(this.seriesDefs) && this.seriesDefs.length > 0;
            if (this.localMode) this._restartPullTimer();
        }

        _initPlot(series = null) {
            const resolvedSeries = series || [{ label: "Time" }];
            if (!series) {
                for (let i = 0; i < this.seriesCount; i++) {
                    const color = this._getSeriesColor(i);
                    const lbl = this._getSeriesLabel(i);
                    resolvedSeries.push({ label: lbl, stroke: color });
                }
            }

            const opts = {
                title: this.settings.title || "",
                width: this.container.width(),
                height: this.container.height() || 300,
                legend: {
                    show: this.settings.showLegend !== false,
                },
                scales: {
                    x: { time: true },
                    y: {}
                },
                axes: [
                    {
                        stroke: "#666",
                        grid: { show: true },
                        values: (u, vals) => vals.map(v => new Date(v).toLocaleTimeString()),
                    },
                    {
                        stroke: "#666",
                        grid: { show: true },
                        label: this.settings.yLabel || "Value",
                    }
                ],
                series: resolvedSeries
            };
            this.plot = new uPlot(opts, this.dataBuffer, this.container[0]);
            // Apply initial Y range (manual or computed)
            this._applyYAxisRange();
            // In case layout settles after init, try an async resize tick
            this._requestResize();
        }


        _updatePlotData(newDataArray) {
            const now = Date.now();

            // Ensure series count matches
            if (this.seriesCount !== newDataArray.length) {
                this.seriesCount = newDataArray.length;
                this._resetPlot();
                return;
            }

            // Push new values to dataBuffer
            this.dataBuffer[0].push(now);
            newDataArray.forEach((val, idx) => {
                this.dataBuffer[idx + 1].push(val);
            });

            // Trim to keep within time window
            const duration = this.settings.duration || 20000;
            const cutoff = now - duration;
            while (this.dataBuffer[0].length > 0 && this.dataBuffer[0][0] < cutoff) {
                this.dataBuffer[0].shift();
                for (let i = 1; i <= this.seriesCount; i++) {
                    this.dataBuffer[i].shift();
                }
            }

            // Update chart respecting refreshRate
            const refresh = parseInt(this.settings.refreshRate) || 1000;
            if (now - this.lastRender >= refresh) {
                this.plot.setData(this.dataBuffer);
                // Update y-axis scaling if not fully manual
                this._applyYAxisRange();
                this.lastRender = now;
            }
        }

        _setFullDataset(dataset) {
            if (!dataset || !Array.isArray(dataset.timestamps) ||
                !Array.isArray(dataset.series)) {
                return;
            }

            this.seriesCount = dataset.series.length;

            if (!this.plot || this.plot.series.length - 1 !== this.seriesCount) {
                this._resetPlot();
            }

            this.dataBuffer = [dataset.timestamps, ...dataset.series];
            if (this.plot) {
                this.plot.setData(this.dataBuffer);
                this._applyYAxisRange();
                this.lastRender = Date.now();
            }
        }

        _resetPlot() {
            if (this.plot) {
                this.plot.destroy();
                this.plot = null;
            }

            const series = [{ label: "Time" }];
            for (let i = 0; i < this.seriesCount; i++) {
                const color = this._getSeriesColor(i);
                const lbl = this._getSeriesLabel(i);
                series.push({ label: lbl, stroke: color });
            }

            this.dataBuffer = [[], ...Array(this.seriesCount).fill().map(() => [])];
            this.lastRender = 0;
            this._initPlot(series);
        }

        
        onSettingsChanged(newSettings) {
            const needsReset = ['duration', 'yMin', 'yMax', 'yLabel', 'showLegend'].some(
                key => newSettings[key] !== this.settings[key]
            );
            const rateChanged = newSettings.refreshRate !== this.settings.refreshRate;
            const titleChanged = newSettings.title !== this.settings.title;

            this.settings = newSettings;
            // Update helper fields from settings first, then infer from data if still missing
            this.datasourceName = (typeof newSettings.datasource === 'function' ? newSettings.datasource() : newSettings.datasource) || '';
            const chFromSettings = (typeof newSettings.channelIndices === 'function' ? newSettings.channelIndices() : newSettings.channelIndices);
            this.channelIndices = Array.isArray(chFromSettings)
                ? chFromSettings.map(x => parseInt(x, 10)).filter(n => Number.isFinite(n))
                : (typeof chFromSettings === 'string' && chFromSettings.trim().startsWith('[')
                    ? (function () { try { return JSON.parse(chFromSettings).map(x => parseInt(x, 10)).filter(n => Number.isFinite(n)); } catch { return []; } })()
                    : []);
            this._detectDatasource();
            // Parse externally managed series
            const newDefs = this._parseSeriesDefs((typeof newSettings.seriesDefs === 'function' ? newSettings.seriesDefs() : newSettings.seriesDefs));
            const defsChanged = !_.isEqual(newDefs, this.seriesDefs);
            this.seriesDefs = newDefs;
            this.localMode = Array.isArray(this.seriesDefs) && this.seriesDefs.length > 0;
            this._maybeUpdateHeaders(true);

            if (needsReset && this.plot) {
                this._resetPlot();
            }
            // If only refresh/title changed, still re-apply y range in case bounds changed
            if (!needsReset && this.plot) {
                this._applyYAxisRange();
            }
            if (titleChanged && this.plot) {
                const tEl = this.plot.root.querySelector('.u-title');
                if (tEl) tEl.textContent = this.settings.title || '';
            }
            if (rateChanged) {
                this.lastRender = 0;
                if (this.localMode) this._restartPullTimer();
            }
            if (defsChanged) {
                // Rebuild datasets to match new series
                this.seriesCount = this.seriesDefs.length;
                this._resetPlot();
                if (this.localMode) this._restartPullTimer();
            }
        }

        onCalculatedValueChanged(settingName, newValue) {
            if (this.localMode) return; // ignore external data when using local seriesDefs
            this._maybeUpdateHeaders();
            if (!newValue) return;

            if (newValue && Array.isArray(newValue.timestamps) && Array.isArray(newValue.series)) {
                this._setFullDataset(newValue);
                return;
            }

            let yValues = [];
            if (typeof newValue === 'number') {
                yValues = [newValue];
            } else if (Array.isArray(newValue)) {
                yValues = newValue;
            } else if (newValue && Array.isArray(newValue.y)) {
                yValues = newValue.y;
            }

            if (!yValues.length) return;

            if (!this.plot) {
                this.seriesCount = yValues.length;
                this._resetPlot();
            }

            this._updatePlotData(yValues);
        }

        onDispose() {
            if (this.plot) {
                this.plot.destroy();
                this.plot = null;
            }
            if (this.pullTimer) { clearInterval(this.pullTimer); this.pullTimer = null; }
            if (this._resizeObs) {
                try { this._resizeObs.disconnect(); } catch {}
                this._resizeObs = null;
            }
            if (this._resizeRAF) {
                cancelAnimationFrame(this._resizeRAF);
                this._resizeRAF = 0;
            }
            // Remove fallback window resize handler if used
            try { $(window).off('resize.uplot-widget'); } catch {}
            if (this._configHandler && freeboard.off) {
                freeboard.off('config_updated', this._configHandler);
            }
        }

        getHeight() {
            return 6;
        }

        _parseSeriesDefs(val) {
            let arr = [];
            try {
                if (Array.isArray(val)) arr = val;
                else if (typeof val === 'string' && val.trim().startsWith('[')) arr = JSON.parse(val);
            } catch {}
            if (!Array.isArray(arr)) return [];
            // Normalize entries
            const norm = arr.map(d => {
                const a = d?.a || {};
                const b = d?.b || null;
                const out = {
                    label: d?.label || '',
                    op: d?.op || 'identity',
                    param: Number(d?.param) || 0,
                    a: {
                        ds: a.ds || '',
                        type: a.type || this._getDatasourceType(a.ds) || '',
                        device: a.device || null,
                        var: a.var
                    }
                };
                if (b) {
                    out.b = {
                        ds: b.ds || '',
                        type: b.type || this._getDatasourceType(b.ds) || '',
                        device: b.device || null,
                        var: b.var
                    };
                }
                return out;
            });
            return norm;
        }

        // ===== Custom variable selection UI =====
        _refreshDatasourceOptions() {
            const live = freeboard.getLiveModel?.();
            if (!live || typeof live.datasources !== 'function') return;
            const list = live.datasources();
            const current = this.selection.ds || this.datasourceName || '';
            this.dsSelect.empty();
            list.forEach(ds => {
                try {
                    const t = ds.type && ds.type();
                    if (t === 'serialport_datasource' || t === 'fast_frame_datasource' || t === 'can_datasource') {
                        const name = ds.name();
                        this.dsSelect.append(`<option value="${name}">${name}</option>`);
                    }
                } catch {}
            });
            if (current && this.dsSelect.find(`option[value='${current}']`).length === 0) this.dsSelect.append(`<option value="${current}">${current}</option>`);
            if (current) this.dsSelect.val(current);

            // Mirror options into secondary datasource selector
            const selectedB = this.dsSelectB.val();
            this.dsSelectB.empty();
            this.dsSelect.children().each((_, opt) => {
                this.dsSelectB.append($(opt).clone());
            });
            if (selectedB && this.dsSelectB.find(`option[value='${selectedB}']`).length) this.dsSelectB.val(selectedB);
            this._onDatasourceChange();
        }

        async _onDatasourceChange() {
            const ds = this.dsSelect.val();
            const type = this._getDatasourceType(ds);
            this.selection.ds = ds;
            this.selection.type = type;
            const isCAN = type === 'can_datasource';
            this.devSelect.toggle(isCAN);
            if (isCAN) await this._populateDevices();
            await this._populateVariables();
        }

        async _onDatasourceChangeB() {
            const ds = this.dsSelectB.val();
            const type = this._getDatasourceType(ds);
            const showDevB = (this.opSelect.val() === 'mulvar') && (type === 'can_datasource');
            this.devSelectB.toggle(showDevB);
            if (type === 'can_datasource') await this._populateDevicesB();
            await this._populateVariablesB();
        }

        async _populateDevices() {
            if (!this.ipc) return;
            try {
                const dsSettings = freeboard.getDatasourceSettings(this.selection.ds) || {};
                const channel = dsSettings.channel || 'can0';
                try { await this.ipc.invoke('can-aggregate-start', { channel }); } catch {}
                const snap = await this.ipc.invoke('can-aggregate-snapshot', { channel });
                const nodes = snap?.nodes || {};
                const keys = Object.keys(nodes).sort();
                this.devSelect.empty();
                keys.forEach(k => this.devSelect.append(`<option value="${k}">${k}</option>`));
                if (!this.selection.device && keys.length) this.selection.device = keys[0];
                if (this.selection.device) this.devSelect.val(this.selection.device);
            } catch {}
        }

        async _populateVariables() {
            const ds = this.selection.ds;
            const type = this.selection.type;
            this.varSelect.empty();
            if (!ds) return;
            if (type === 'fast_frame_datasource' || type === 'serialport_datasource') {
                const headers = await this._fetchHeaders(ds);
                let count = headers.length;
                if (!count) {
                    // probe channel count
                    try {
                        const dsSettings = freeboard.getDatasourceSettings(ds) || {};
                        const path = dsSettings.portPath || ds;
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
                    this.varSelect.append(`<option value="${i}">${label}</option>`);
                }
            } else if (type === 'can_datasource') {
                if (!this.ipc) return;
                try {
                    const dsSettings = freeboard.getDatasourceSettings(ds) || {};
                    const channel = dsSettings.channel || 'can0';
                    const dev = this.devSelect.val() || this.selection.device;
                    this.selection.device = dev;
                    const snap = await this.ipc.invoke('can-aggregate-snapshot', { channel });
                    const flat = snap?.nodes?.[dev]?.flat || {};
                    const entries = Object.keys(flat).sort();
                    entries.forEach(p => {
                        const leaf = p.includes('/') ? p.split('/').pop() : p;
                        this.varSelect.append(`<option value="${p}">${leaf}</option>`);
                    });
                } catch {}
            }
        }

        async _populateDevicesB() {
            if (!this.ipc) return;
            try {
                const dsSettings = freeboard.getDatasourceSettings(this.dsSelectB.val()) || {};
                const channel = dsSettings.channel || 'can0';
                try { await this.ipc.invoke('can-aggregate-start', { channel }); } catch {}
                const snap = await this.ipc.invoke('can-aggregate-snapshot', { channel });
                const nodes = snap?.nodes || {};
                const keys = Object.keys(nodes).sort();
                this.devSelectB.empty();
                keys.forEach(k => this.devSelectB.append(`<option value="${k}">${k}</option>`));
            } catch {}
        }

        async _populateVariablesB() {
            const ds = this.dsSelectB.val();
            const type = this._getDatasourceType(ds);
            this.varSelectB.empty();
            if (!ds) return;
            if (type === 'fast_frame_datasource' || type === 'serialport_datasource') {
                const headers = await this._fetchHeaders(ds);
                let count = headers.length;
                if (!count) {
                    try {
                        const dsSettings = freeboard.getDatasourceSettings(ds) || {};
                        const path = dsSettings.portPath || ds;
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
                    this.varSelectB.append(`<option value="${i}">${label}</option>`);
                }
            } else if (type === 'can_datasource') {
                if (!this.ipc) return;
                try {
                    const dsSettings = freeboard.getDatasourceSettings(ds) || {};
                    const channel = dsSettings.channel || 'can0';
                    const dev = this.devSelectB.val();
                    const snap = await this.ipc.invoke('can-aggregate-snapshot', { channel });
                    const flat = snap?.nodes?.[dev]?.flat || {};
                    const entries = Object.keys(flat).sort();
                    entries.forEach(p => {
                        const leaf = p.includes('/') ? p.split('/').pop() : p;
                        this.varSelectB.append(`<option value="${p}">${leaf}</option>`);
                    });
                } catch {}
            }
        }

        _transform(op, param, x) {
            const v = Number(x);
            if (!isFinite(v)) return null;
            switch (op) {
                case 'negate': return -v;
                case 'abs': return Math.abs(v);
                case 'scale': return v * (Number(param) || 0);
                case 'offset': return v + (Number(param) || 0);
                default: return v;
            }
        }

        _applySelectionFromUI() {
            const ds = this.dsSelect.val();
            if (!ds) return;
            const type = this._getDatasourceType(ds);
            const op = this.opSelect.val() || 'identity';
            const param = this.paramInput.is(':visible') ? (parseFloat(this.paramInput.val()) || 0) : 0;
            let label = this.varSelect.find('option:selected').text() || 'Series';
            if (op === 'negate') label = `-${label}`;
            else if (op === 'abs') label = `abs(${label})`;
            else if (op === 'scale') label = `${label} * ${param}`;
            else if (op === 'offset') label = `${label} + ${param}`;
            else if (op === 'mulvar') {
                const dsB = this.dsSelectB.val();
                const typeB = this._getDatasourceType(dsB);
                const varBLabel = this.varSelectB.find('option:selected').text() || 'y';
                label = `${label} × ${varBLabel}`;
                this.selectionB = {
                    ds: dsB,
                    type: typeB,
                    device: (typeB === 'can_datasource') ? this.devSelectB.val() : null,
                    var: (typeB === 'can_datasource') ? this.varSelectB.val() : parseInt(this.varSelectB.val(), 10)
                };
            } else {
                this.selectionB = null;
            }

            this.selection = {
                type,
                ds,
                device: (type === 'can_datasource') ? (this.devSelect.val() || this.selection.device) : null,
                var: (type === 'can_datasource') ? this.varSelect.val() : parseInt(this.varSelect.val(), 10),
                op,
                param
            };

            // Reset plot to single series with custom label
            this.seriesCount = 1;
            if (this.plot) { this.plot.destroy(); this.plot = null; }
            this.dataBuffer = [[], []];
            const color = this._getSeriesColor(0);
            const series = [{ label: 'Time' }, { label, stroke: color }];
            this._initPlot(series);

            // Switch to local polling mode
            this.localMode = true;
            this._restartPullTimer();
        }

        _restartPullTimer() {
            if (this.pullTimer) { clearInterval(this.pullTimer); this.pullTimer = null; }
            const interval = parseInt(this.settings.refreshRate) || 1000;
            this.pullTimer = setInterval(() => this._pollOnce(), Math.max(50, interval));
            // Kick an immediate poll
            this._pollOnce();
        }

        async _pollOnce() {
            if (Array.isArray(this.seriesDefs) && this.seriesDefs.length) {
                // Streaming multiple series via instantaneous sampling
                const yvals = [];
                for (const def of this.seriesDefs) {
                    try {
                        const A = def.a || {};
                        const op = def.op || 'identity';
                        if (op === 'mulvar' && def.b) {
                            const yA = await this._readInstantValue(A);
                            const yB = await this._readInstantValue(def.b);
                            yvals.push((Number(yA) || 0) * (Number(yB) || 0));
                        } else {
                            const raw = await this._readInstantValue(A);
                            yvals.push(this._transform(op, def.param, raw));
                        }
                    } catch {
                        yvals.push(null);
                    }
                }
                // Remove nulls -> use 0 or skip? Use 0 by default to keep graph stable
                const clean = yvals.map(v => (isFinite(v) ? v : 0));
                if (!this.plot || this.seriesCount !== clean.length) {
                    this.seriesCount = clean.length;
                    this._resetPlot();
                }
                this._updatePlotData(clean);
                return;
            }
            const sel = this.selection;
            if (!sel || !sel.ds) return;
            try {
                if (sel.op === 'mulvar' && this.selectionB && this.selectionB.ds) {
                    // Multiply two variables (possibly across datasources/types)
                    const A = sel; const B = this.selectionB;
                    if (A.type === 'fast_frame_datasource' && B.type === 'fast_frame_datasource' && A.ds === B.ds) {
                        const dsSettings = freeboard.getDatasourceSettings(A.ds) || {};
                        const path = dsSettings.portPath || A.ds;
                        const data = await this.ipc.invoke('get-fast-dataset', { path });
                        if (!data || !Array.isArray(data.timestamps) || !Array.isArray(data.series)) return;
                        const ia = Number(A.var), ib = Number(B.var);
                        if (!Array.isArray(data.series[ia]) || !Array.isArray(data.series[ib])) return;
                        const len = Math.min(data.series[ia].length, data.series[ib].length);
                        const out = new Array(len);
                        for (let i = 0; i < len; i++) out[i] = (Number(data.series[ia][i]) || 0) * (Number(data.series[ib][i]) || 0);
                        const ts = data.timestamps.slice(-len);
                        this._setFullDataset({ timestamps: ts, series: [out] });
                    } else {
                        // Instantaneous sampling across arbitrary sources
                        const yA = await this._readInstantValue(A);
                        const yB = await this._readInstantValue(B);
                        if (yA != null && yB != null) this._updatePlotData([yA * yB]);
                    }
                } else if (sel.type === 'fast_frame_datasource') {
                    const dsSettings = freeboard.getDatasourceSettings(sel.ds) || {};
                    const path = dsSettings.portPath || sel.ds;
                    const data = await this.ipc.invoke('get-fast-dataset', { path });
                    if (!data || !Array.isArray(data.timestamps) || !Array.isArray(data.series)) return;
                    const idx = Number(sel.var);
                    if (!Number.isFinite(idx) || !Array.isArray(data.series[idx])) return;
                    const transformed = data.series[idx].map(v => this._transform(sel.op, sel.param, v));
                    this._setFullDataset({ timestamps: data.timestamps, series: [transformed] });
                } else if (sel.type === 'serialport_datasource') {
                    const dsSettings = freeboard.getDatasourceSettings(sel.ds) || {};
                    const path = dsSettings.portPath || sel.ds;
                    const arr = await this.ipc.invoke('get-serial-buffer', { path });
                    const idx = Number(sel.var);
                    const val = Array.isArray(arr) ? arr[idx] : null;
                    const y = this._transform(sel.op, sel.param, val);
                    if (y != null) this._updatePlotData([y]);
                } else if (sel.type === 'can_datasource') {
                    const dsSettings = freeboard.getDatasourceSettings(sel.ds) || {};
                    const channel = dsSettings.channel || 'can0';
                    const snap = await this.ipc.invoke('can-aggregate-snapshot', { channel });
                    const flat = snap?.nodes?.[sel.device]?.flat || {};
                    const val = flat[sel.var];
                    const y = this._transform(sel.op, sel.param, val);
                    if (y != null) this._updatePlotData([y]);
                }
            } catch (e) {
                // ignore transient polling errors
            }
        }

        async _readInstantValue(s) {
            if (!s || !s.ds) return null;
            if (s.type === 'serialport_datasource') {
                const dsSettings = freeboard.getDatasourceSettings(s.ds) || {};
                const path = dsSettings.portPath || s.ds;
                const arr = await this.ipc.invoke('get-serial-buffer', { path });
                const idx = Number(s.var);
                const val = Array.isArray(arr) ? arr[idx] : null;
                return Number(val);
            } else if (s.type === 'fast_frame_datasource') {
                const dsSettings = freeboard.getDatasourceSettings(s.ds) || {};
                const path = dsSettings.portPath || s.ds;
                const data = await this.ipc.invoke('get-fast-dataset', { path });
                const idx = Number(s.var);
                const arr = (data && Array.isArray(data.series) && Array.isArray(data.series[idx])) ? data.series[idx] : [];
                return arr.length ? Number(arr[arr.length - 1]) : null;
            } else if (s.type === 'can_datasource') {
                const dsSettings = freeboard.getDatasourceSettings(s.ds) || {};
                const channel = dsSettings.channel || 'can0';
                const snap = await this.ipc.invoke('can-aggregate-snapshot', { channel });
                const flat = snap?.nodes?.[s.device]?.flat || {};
                const val = flat[s.var];
                return Number(val);
            }
            return null;
        }

        // Compute smart defaults and/or apply manual Y range
        _applyYAxisRange() {
            if (!this.plot) return;

            const yMin = this._parseMaybeNumber(this.settings.yMin);
            const yMax = this._parseMaybeNumber(this.settings.yMax);
            const hasMin = yMin != null;
            const hasMax = yMax != null;

            // Compute current data range across all series
            const [dataMin, dataMax] = this._computeDataYRange();

            let min = dataMin;
            let max = dataMax;

            if (hasMin && hasMax) {
                min = yMin;
                max = yMax;
            } else if (hasMin && !hasMax) {
                min = yMin;
                if (isFinite(dataMax)) {
                    max = Math.max(dataMax, min + this._niceDelta(Math.abs(dataMax - min)));
                } else {
                    max = min + 1; // fallback span
                }
            } else if (!hasMin && hasMax) {
                max = yMax;
                if (isFinite(dataMin)) {
                    min = Math.min(dataMin, max - this._niceDelta(Math.abs(max - dataMin)));
                } else {
                    min = max - 1; // fallback span
                }
            } else {
                // No manual bounds: apply smart padding and nice rounding
                const padded = this._paddedNiceRange(dataMin, dataMax);
                min = padded[0];
                max = padded[1];
            }

            if (!isFinite(min) || !isFinite(max) || min === max) {
                // Safe default if no data or degenerate
                const mid = isFinite(min) ? min : (isFinite(max) ? max : 0);
                min = mid - 0.5;
                max = mid + 0.5;
            }

            try {
                this.plot.setScale('y', { min, max });
            } catch (e) {
                // ignore scaling errors
            }
        }

        _parseMaybeNumber(val) {
            if (val === undefined || val === null) return null;
            if (typeof val === 'number') return isFinite(val) ? val : null;
            if (typeof val === 'string') {
                const trimmed = val.trim();
                if (trimmed === '') return null;
                const n = parseFloat(trimmed);
                return isFinite(n) ? n : null;
            }
            return null;
        }

        _computeDataYRange() {
            let min = Infinity;
            let max = -Infinity;

            for (let s = 1; s < this.dataBuffer.length; s++) {
                const arr = this.dataBuffer[s] || [];
                for (let i = 0; i < arr.length; i++) {
                    const v = arr[i];
                    if (v == null) continue;
                    if (!isFinite(v)) continue;
                    if (v < min) min = v;
                    if (v > max) max = v;
                }
            }

            if (min === Infinity || max === -Infinity) return [NaN, NaN];
            return [min, max];
        }

        _paddedNiceRange(min, max) {
            if (!isFinite(min) || !isFinite(max)) return [0, 1];
            if (min === max) {
                const span = Math.max(1e-6, Math.abs(min) * 0.1);
                return [min - span, max + span];
            }
            const span = max - min;
            const pad = span * 0.1; // 10% padding
            const rawMin = min - pad;
            const rawMax = max + pad;
            return this._niceBounds(rawMin, rawMax);
        }

        _niceBounds(min, max) {
            // Round bounds to "nice" numbers to avoid awkward decimals
            const span = max - min;
            if (!isFinite(span) || span <= 0) return [min, max];
            const step = this._niceDelta(span / 8); // target ~8 ticks
            const niceMin = Math.floor(min / step) * step;
            const niceMax = Math.ceil(max / step) * step;
            return [niceMin, niceMax];
        }

        _niceDelta(raw) {
            if (!isFinite(raw) || raw <= 0) return 1;
            const exp = Math.floor(Math.log10(raw));
            const frac = raw / Math.pow(10, exp);
            let niceFrac;
            if (frac <= 1) niceFrac = 1;
            else if (frac <= 2) niceFrac = 2;
            else if (frac <= 2.5) niceFrac = 2.5;
            else if (frac <= 5) niceFrac = 5;
            else niceFrac = 10;
            return niceFrac * Math.pow(10, exp);
        }

        _bindResize() {
            if (this._resizeObs || !this.container || !this.container[0]) return;
            const el = this.container[0];
            if (typeof ResizeObserver !== 'undefined') {
                this._resizeObs = new ResizeObserver(() => this._requestResize());
                this._resizeObs.observe(el);
            } else {
                // Fallback: resize on window events
                $(window).on('resize.uplot-widget', () => this._requestResize());
            }
        }

        _requestResize() {
            if (!this.plot || !this.container) return;
            if (this._resizeRAF) cancelAnimationFrame(this._resizeRAF);
            this._resizeRAF = requestAnimationFrame(() => {
                this._resizeRAF = 0;
                const w = Math.max(0, this.container.width());
                let h = Math.max(0, this.container.height());
                // Subtract non-plot vertical elements (title + legend) to avoid overflow
                try {
                    const root = this.plot.root;
                    const titleEl = root.querySelector('.u-title');
                    const legendEl = root.querySelector('.u-legend');
                    const titleH = titleEl && getComputedStyle(titleEl).display !== 'none' ? titleEl.offsetHeight : 0;
                    const legendH = legendEl && getComputedStyle(legendEl).display !== 'none' ? legendEl.offsetHeight : 0;
                    const extra = titleH + legendH;
                    if (extra > 0) h = Math.max(0, h - extra);
                } catch {}

                if (w && h) {
                    try { this.plot.setSize({ width: w, height: h }); } catch {}
                }
            });
        }
    }
})();
