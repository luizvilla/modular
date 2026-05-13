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
                    case 'get-fast-dataset':
                        return serial && serial.getFastDataset ? serial.getFastDataset(payload.path) : null;
                    case 'get-serial-buffer':
                        return serial && serial.getBuffer ? serial.getBuffer(payload.path) : null;
                    case 'can-aggregate-start':
                        return can && can.aggregateStart ? can.aggregateStart(payload) : null;
                    case 'can-aggregate-snapshot':
                        return can && can.aggregateSnapshot ? can.aggregateSnapshot(payload) : null;
                    default:
                        return null;
                }
            }
        };
    })(api);

    freeboard.loadWidgetPlugin({
        type_name: "xy_plot_uplot",
        display_name: "XY Plot widget",
        description: "Realtime X versus Y plot with trailing history",
        icon: "chart-line",
        external_scripts: [
            "https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.iife.min.js",
            "https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.min.css"
        ],
        settings: [
            { name: "title", display_name: "Title", type: "text", default_value: "XY Plot" }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new XYPlotWidget(settings));
        }
    });

    class XYPlotWidget {
        constructor(settings) {
            this.settings = settings;
            this.ipc = ipcShim || window.require?.('electron')?.ipcRenderer;
            this.plot = null;
            this.pollTimer = null;
            this.lastRender = 0;
            this._resizeObs = null;
            this._helpersSpawned = false;

            this.xSourceDef = this._parseSourceDef(this._resolveSetting('xSourceDef'));
            this.ySourceDef = this._parseSourceDef(this._resolveSetting('ySourceDef'));
            this.dataBuffer = [[], [], []]; // x, y, latest-point-only y

            this.container = $('<div class="xy-plot-shell h-100 d-flex flex-column gap-2 p-2"></div>');
            this.toolbar = $('<div class="d-flex align-items-center justify-content-between gap-2"></div>');
            this.status = $('<div class="small text-muted flex-grow-1">Configure X and Y sources.</div>');
            this.clearBtn = $('<button class="btn btn-outline-secondary btn-sm xy-plot-clear">Clear history</button>');
            this.chartHost = $('<div class="xy-plot-chart flex-grow-1" style="min-height:220px;"></div>');
            this.readout = $('<div class="small text-muted xy-plot-readout">No points yet.</div>');
            this.toolbar.append(this.status, this.clearBtn);
            this.container.append(this.toolbar, this.chartHost, this.readout);
        }

        _resolveSetting(key) {
            const value = this.settings ? this.settings[key] : undefined;
            return (typeof value === 'function') ? value() : value;
        }

        _parseSourceDef(raw) {
            let src = raw;
            try {
                if (typeof raw === 'string' && raw.trim().startsWith('{')) src = JSON.parse(raw);
            } catch {}
            if (!src || typeof src !== 'object') return null;
            const op = src.op || 'identity';
            const param = Number(src.param);
            const ds = src.ds || '';
            const type = src.type || this._getDatasourceType(ds) || '';
            return {
                ds,
                type,
                device: src.device || null,
                device_uid: src.device_uid || src.deviceUid || null,
                var: src.var,
                op,
                param: Number.isFinite(param) ? param : 0
            };
        }

        _resolveHelperWidgets(settings) {
            const raw = (typeof settings.helperWidgets === 'function' ? settings.helperWidgets() : settings.helperWidgets) || 'none';
            return String(raw).toLowerCase();
        }

        _historyLength() {
            const val = parseInt(this._resolveSetting('historyLength'), 10);
            if (!Number.isFinite(val) || val < 2) return 200;
            return val;
        }

        render(containerElement) {
            this.container.appendTo(containerElement);
            this.clearBtn.off('click').on('click', () => this._clearHistory());
            this._maybeSpawnHelpers();
            this._initPlot();
            this._bindResize(containerElement);
            this._restartPollTimer();
            this._refreshStatus();
        }

        _maybeSpawnHelpers() {
            return;
        }

        _initPlot() {
            if (this.plot) {
                this.plot.destroy();
                this.plot = null;
            }

            const opts = {
                title: this._resolveSetting('title') || '',
                width: this.chartHost.width() || this.container.width() || 480,
                height: Math.max(220, this.chartHost.height() || 280),
                legend: { show: false },
                scales: {
                    x: {},
                    y: {}
                },
                axes: [
                    {
                        stroke: '#666',
                        grid: { show: true },
                        label: this._resolveSetting('xLabel') || 'X'
                    },
                    {
                        stroke: '#666',
                        grid: { show: true },
                        label: this._resolveSetting('yLabel') || 'Y'
                    }
                ],
                series: [
                    {},
                    {
                        label: 'Trail',
                        stroke: '#4e79a7',
                        width: 2,
                        points: { show: false }
                    },
                    {
                        label: 'Latest',
                        stroke: '#e15759',
                        width: 0,
                        paths: () => null,
                        points: {
                            show: true,
                            size: 10,
                            fill: '#e15759',
                            stroke: '#ffffff',
                            width: 2
                        }
                    }
                ]
            };

            this.plot = new uPlot(opts, this.dataBuffer, this.chartHost[0]);
            this._applyAxisRanges();
            this._renderReadout();
        }

        _bindResize(containerElement) {
            if (this._resizeObs) {
                try { this._resizeObs.disconnect(); } catch {}
                this._resizeObs = null;
            }
            if (typeof ResizeObserver !== 'function') return;
            this._resizeObs = new ResizeObserver(() => this._resizePlot());
            this._resizeObs.observe(containerElement);
            this._resizeObs.observe(this.chartHost[0]);
        }

        _resizePlot() {
            if (!this.plot) return;
            const width = this.chartHost.width() || this.container.width() || 480;
            const height = Math.max(220, this.chartHost.height() || 280);
            try {
                this.plot.setSize({ width, height });
            } catch {}
        }

        _restartPollTimer() {
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
                this.pollTimer = null;
            }
            const interval = parseInt(this._resolveSetting('refreshRate'), 10);
            const safeInterval = Number.isFinite(interval) && interval >= 50 ? interval : 250;
            this.pollTimer = setInterval(() => this._pollOnce(), safeInterval);
            this._pollOnce();
        }

        async _pollOnce() {
            if (!this.xSourceDef || !this.ySourceDef) {
                this._refreshStatus();
                return;
            }

            try {
                if (this._canUseFastFrameDataset()) {
                    await this._pollFastFrameDataset();
                } else {
                    const x = await this._readSourceValue(this.xSourceDef);
                    const y = await this._readSourceValue(this.ySourceDef);
                    if (Number.isFinite(x) && Number.isFinite(y)) this._appendPoint(x, y);
                }
            } catch {
                // Ignore transient datasource errors.
            }
        }

        _canUseFastFrameDataset() {
            return !!(
                this.xSourceDef &&
                this.ySourceDef &&
                this.xSourceDef.type === 'fast_frame_datasource' &&
                this.ySourceDef.type === 'fast_frame_datasource' &&
                this.xSourceDef.ds &&
                this.xSourceDef.ds === this.ySourceDef.ds
            );
        }

        async _pollFastFrameDataset() {
            const dsSettings = freeboard.getDatasourceSettings(this.xSourceDef.ds) || {};
            const path = dsSettings.portPath || this.xSourceDef.ds;
            const data = await this.ipc.invoke('get-fast-dataset', { path });
            const xIdx = Number(this.xSourceDef.var);
            const yIdx = Number(this.ySourceDef.var);
            if (!data || !Array.isArray(data.series) || !Array.isArray(data.series[xIdx]) || !Array.isArray(data.series[yIdx])) return;

            const len = Math.min(data.series[xIdx].length, data.series[yIdx].length, this._historyLength());
            const xs = data.series[xIdx].slice(-len).map(v => this._transform(this.xSourceDef.op, this.xSourceDef.param, v));
            const ys = data.series[yIdx].slice(-len).map(v => this._transform(this.ySourceDef.op, this.ySourceDef.param, v));
            this._setTrail(xs, ys);
        }

        async _readSourceValue(sourceDef) {
            const raw = await this._readInstantValue(sourceDef);
            return this._transform(sourceDef.op, sourceDef.param, raw);
        }

        async _readInstantValue(s) {
            if (!s || !s.ds) return null;
            if (s.type === 'serialport_datasource') {
                const dsSettings = freeboard.getDatasourceSettings(s.ds) || {};
                const path = dsSettings.portPath || s.ds;
                const arr = await this.ipc.invoke('get-serial-buffer', { path });
                const idx = Number(s.var);
                return Array.isArray(arr) ? Number(arr[idx]) : null;
            }
            if (s.type === 'fast_frame_datasource') {
                const dsSettings = freeboard.getDatasourceSettings(s.ds) || {};
                const path = dsSettings.portPath || s.ds;
                const data = await this.ipc.invoke('get-fast-dataset', { path });
                const idx = Number(s.var);
                const arr = (data && Array.isArray(data.series) && Array.isArray(data.series[idx])) ? data.series[idx] : [];
                return arr.length ? Number(arr[arr.length - 1]) : null;
            }
            if (s.type === 'can_datasource') {
                const dsSettings = freeboard.getDatasourceSettings(s.ds) || {};
                const channel = dsSettings.channel || 'can0';
                try { await this.ipc.invoke('can-aggregate-start', { channel }); } catch {}
                const snap = await this.ipc.invoke('can-aggregate-snapshot', { channel });
                const nodes = snap?.nodes || {};
                const resolved = this._resolveDeviceKey(nodes, s.device, s.device_uid);
                if (!resolved) return null;
                s.device = resolved;
                s.device_uid = nodes[resolved]?.node_uid || s.device_uid || null;
                return Number(nodes[resolved]?.flat?.[s.var]);
            }
            if (s.type === 'signal_generator_datasource') {
                const live = freeboard.getLiveModel?.();
                const data = live?.datasourceData ? live.datasourceData[s.ds] : null;
                if (data && data.y1 != null) return Number(data.y1);
                if (data && data.value != null) return Number(data.value);
            }
            return null;
        }

        _transform(op, param, value) {
            const x = Number(value);
            if (!Number.isFinite(x)) return NaN;
            switch (op) {
                case 'negate':
                    return -x;
                case 'abs':
                    return Math.abs(x);
                case 'scale':
                    return x * (Number.isFinite(param) ? param : 1);
                case 'offset':
                    return x + (Number.isFinite(param) ? param : 0);
                case 'identity':
                default:
                    return x;
            }
        }

        _appendPoint(x, y) {
            const xs = this.dataBuffer[0];
            const ys = this.dataBuffer[1];
            xs.push(x);
            ys.push(y);
            const max = this._historyLength();
            while (xs.length > max) {
                xs.shift();
                ys.shift();
            }
            this._syncLatestSeries();
            this._updatePlot();
        }

        _setTrail(xs, ys) {
            const cleanX = [];
            const cleanY = [];
            const len = Math.min(xs.length, ys.length);
            for (let i = 0; i < len; i++) {
                if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) continue;
                cleanX.push(xs[i]);
                cleanY.push(ys[i]);
            }
            this.dataBuffer = [cleanX, cleanY, []];
            this._syncLatestSeries();
            this._updatePlot(true);
        }

        _syncLatestSeries() {
            const xs = this.dataBuffer[0];
            const ys = this.dataBuffer[1];
            const latest = new Array(ys.length).fill(null);
            if (xs.length && ys.length) latest[ys.length - 1] = ys[ys.length - 1];
            this.dataBuffer[2] = latest;
        }

        _clearHistory() {
            this.dataBuffer = [[], [], []];
            this._updatePlot(true);
            this._refreshStatus();
        }

        _updatePlot(force = false) {
            if (!this.plot) this._initPlot();
            const now = Date.now();
            const refresh = parseInt(this._resolveSetting('refreshRate'), 10);
            const minRefresh = Number.isFinite(refresh) && refresh >= 50 ? refresh : 250;
            if (!force && now - this.lastRender < minRefresh) return;
            this.plot.setData(this.dataBuffer);
            this._applyAxisRanges();
            this._renderReadout();
            this._refreshStatus();
            this.lastRender = now;
        }

        _refreshStatus() {
            if (!this.xSourceDef || !this.ySourceDef) {
                this.status.text('Configure X and Y sources.');
                this.clearBtn.prop('disabled', this.dataBuffer[0].length === 0);
                return;
            }
            this.status.text(`X: ${this._sourceLabel(this.xSourceDef)} | Y: ${this._sourceLabel(this.ySourceDef)}`);
            this.clearBtn.prop('disabled', this.dataBuffer[0].length === 0);
        }

        _sourceLabel(def) {
            if (!def) return 'source';
            if (def.type === 'signal_generator_datasource') {
                return `${def.ds} / Signal`;
            }
            if (def.type === 'can_datasource') {
                const device = def.device_uid ? `${def.device || 'device'} (${def.device_uid})` : (def.device || 'device');
                return `${def.ds} / ${device} / ${def.var || 'variable'}`;
            }
            if (Number.isFinite(Number(def.var))) {
                return `${def.ds} / Channel ${Number(def.var) + 1}`;
            }
            return `${def.ds} / ${def.var || 'source'}`;
        }

        _renderReadout() {
            const xs = this.dataBuffer[0];
            const ys = this.dataBuffer[1];
            if (!xs.length || !ys.length) {
                this.readout.text('No points yet.');
                return;
            }
            const lastX = xs[xs.length - 1];
            const lastY = ys[ys.length - 1];
            this.readout.text(`Points: ${xs.length} | Latest: (${this._fmt(lastX)}, ${this._fmt(lastY)})`);
        }

        _fmt(value) {
            if (!Number.isFinite(value)) return '---';
            const abs = Math.abs(value);
            if (abs >= 1000 || (abs > 0 && abs < 0.01)) return value.toExponential(2);
            return Number(value.toFixed(3)).toString();
        }

        _applyAxisRanges() {
            if (!this.plot) return;
            const [xMin, xMax] = this._resolveRange(this.dataBuffer[0], this._resolveSetting('xMin'), this._resolveSetting('xMax'));
            const [yMin, yMax] = this._resolveRange(this.dataBuffer[1], this._resolveSetting('yMin'), this._resolveSetting('yMax'));
            try { this.plot.setScale('x', { min: xMin, max: xMax }); } catch {}
            try { this.plot.setScale('y', { min: yMin, max: yMax }); } catch {}
        }

        _resolveRange(values, manualMinRaw, manualMaxRaw) {
            const manualMin = this._parseMaybeNumber(manualMinRaw);
            const manualMax = this._parseMaybeNumber(manualMaxRaw);
            let min = Number.POSITIVE_INFINITY;
            let max = Number.NEGATIVE_INFINITY;
            for (const v of values) {
                if (!Number.isFinite(v)) continue;
                if (v < min) min = v;
                if (v > max) max = v;
            }
            if (!Number.isFinite(min) || !Number.isFinite(max)) {
                min = -1;
                max = 1;
            }
            if (manualMin != null) min = manualMin;
            if (manualMax != null) max = manualMax;
            if (min === max) {
                min -= 0.5;
                max += 0.5;
            }
            if (manualMin == null || manualMax == null) {
                const span = Math.max(1e-6, Math.abs(max - min));
                const pad = span * 0.08;
                if (manualMin == null) min -= pad;
                if (manualMax == null) max += pad;
            }
            return [min, max];
        }

        _parseMaybeNumber(val) {
            if (val === undefined || val === null || val === '') return null;
            const num = Number(val);
            return Number.isFinite(num) ? num : null;
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

        _resolveDeviceKey(nodes, preferredKey, preferredUid) {
            if (!nodes || typeof nodes !== 'object') return preferredKey || null;
            if (preferredUid) {
                for (const [addr, meta] of Object.entries(nodes)) {
                    if (meta && meta.node_uid && meta.node_uid === preferredUid) return addr;
                }
            }
            if (preferredKey && nodes[preferredKey]) return preferredKey;
            const keys = Object.keys(nodes);
            return keys.length ? keys[0] : null;
        }

        onSettingsChanged(newSettings) {
            const oldX = JSON.stringify(this.xSourceDef);
            const oldY = JSON.stringify(this.ySourceDef);
            this.settings = newSettings;
            this.xSourceDef = this._parseSourceDef(this._resolveSetting('xSourceDef'));
            this.ySourceDef = this._parseSourceDef(this._resolveSetting('ySourceDef'));
            const nextX = JSON.stringify(this.xSourceDef);
            const nextY = JSON.stringify(this.ySourceDef);
            if (oldX !== nextX || oldY !== nextY) this._clearHistory();
            this._maybeSpawnHelpers();
            this._initPlot();
            this._restartPollTimer();
            this._refreshStatus();
        }

        onCalculatedValueChanged() {}

        onDispose() {
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
                this.pollTimer = null;
            }
            if (this.plot) {
                this.plot.destroy();
                this.plot = null;
            }
            if (this._resizeObs) {
                try { this._resizeObs.disconnect(); } catch {}
                this._resizeObs = null;
            }
        }

        getHeight() {
            return 8;
        }
    }
})();
