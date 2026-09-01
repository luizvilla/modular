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

    function buildTimestampStamp(date = new Date()) {
        const pad = (value) => String(value).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
    }

    function csvEscape(value) {
        const str = value === null || value === undefined ? '' : String(value);
        return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    }

    function downloadCsv(rows, filename) {
        const content = rows.map(row => row.map(csvEscape).join(',')).join('\r\n');
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = window.URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(a.href);
    }

    async function saveCsvExport(rows, filename, category) {
        const content = rows.map(row => row.map(csvEscape).join(',')).join('\r\n');
        if (api && api.files && typeof api.files.saveExportCsv === 'function') {
            try {
                const result = await api.files.saveExportCsv(category, filename, content);
                if (result && result.ok) return result;
                console.warn('[export] save-export-csv failed, falling back to browser download', result && result.error);
            } catch (err) {
                console.error('[export] save-export-csv failed, falling back to browser download', err);
            }
        }
        downloadCsv(rows, filename);
        return null;
    }

    freeboard.loadWidgetPlugin({
        type_name: "xy_plot_uplot",
        display_name: "XY Plot Widget",
        category: "Plots",
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
            this._dragCleanup = null;
            this.plotHeightPx = null;
            this.subSectionElement = null;
            this.sectionElement = null;

            this.xSourceDef = this._parseSourceDef(this._resolveSetting('xSourceDef'));
            this.ySourceDef = this._parseSourceDef(this._resolveSetting('ySourceDef'));
            this.dataBuffer = [[], [], []]; // x, y, latest-point-only y
            this.paused = false;

            this.container = $('<div class="xy-plot-shell h-100 d-flex flex-column gap-2 p-2"></div>');
            this.toolbar = $('<div class="d-flex align-items-center justify-content-between gap-2"></div>');
            this.status = $('<div class="small text-muted flex-grow-1">Configure X and Y sources.</div>');
            this.pauseBtn = $('<button class="btn btn-outline-secondary btn-sm xy-plot-pause" title="Pause / resume data">⏸ Pause</button>');
            this.clearBtn = $('<button class="btn btn-outline-secondary btn-sm xy-plot-clear">Clear history</button>');
            this.exportBtn = $('<button class="btn btn-outline-secondary btn-sm xy-plot-export" title="Export visible data to CSV">Export CSV</button>');
            this.chartHost = $('<div class="xy-plot-chart" style="min-height:220px;"></div>');
            this.readout = $('<div class="uplot-readout-grid"></div>');
            this.resizeHandle = $('<div class="uplot-resize-handle" title="Drag to resize plot"></div>');
            this.toolbar.append(this.status, this.pauseBtn, this.clearBtn, this.exportBtn);
            this.container.append(this.toolbar, this.chartHost, this.readout, this.resizeHandle);
            this.axisLeftMarginPx = 56;
            this.axisBottomMarginPx = 30;
            this._bindRadialContextMenu();
        }

        // Milestone 3 of docs/GUI/02-navigation_overhaul.md: the same pattern
        // piloted on time_plot_uplot, adapted for XY Plot's shape -- exactly
        // two fixed sources (X, Y) instead of an open-ended channel list, and
        // two real data axes instead of a time axis. Built entirely on
        // RadialWidgetKit (Milestone 0), no per-widget copy of the plumbing.
        _bindRadialContextMenu() {
            this.chartHost.on('contextmenu', (e) => {
                if (!window.RadialContextMenu) return;
                e.preventDefault();
                e.stopPropagation();
                const kit = window.RadialWidgetKit;
                window.RadialContextMenu.show({
                    x: e.clientX, y: e.clientY,
                    root: [
                        { id: 'x-source', label: 'X Source', children: () => kit.buildChannelMenuRoot({ onLeafSelect: (def) => this._quickSetSourceDef('xSourceDef', def) }) },
                        { id: 'y-source', label: 'Y Source', children: () => kit.buildChannelMenuRoot({ onLeafSelect: (def) => this._quickSetSourceDef('ySourceDef', def) }) }
                    ]
                });
            });
            this._bindChartHover();
            this._bindReadoutInteractions();
            this._bindTitleRename();
        }

        // Hovering the plot area shows an "Add Source" hint; hovering either
        // axis margin shows its own inline panel directly (Label/Min/Max for
        // whichever axis), since both are just a handful of fixed fields --
        // no drill-down needed, same reasoning as the time plot's axis
        // panels.
        _bindChartHover() {
            const kit = window.RadialWidgetKit;
            kit.ensureStyles();
            this._axisHoverBridge = kit.makeHoverBridge();

            this.chartHost.on('mousemove', (e) => {
                const zone = this._chartZoneAt(e.clientX, e.clientY);
                if (zone === 'yAxis') {
                    this._axisHoverBridge.cancel();
                    kit.hideHint();
                    this._showYAxisPanel();
                } else if (zone === 'xAxis') {
                    this._axisHoverBridge.cancel();
                    kit.hideHint();
                    this._showXAxisPanel();
                } else {
                    this._axisHoverBridge.schedule(() => this._hideAxisPanels());
                    kit.showHint('Add Source', e.clientX, e.clientY);
                }
            });
            this.chartHost.on('mouseleave', () => {
                kit.hideHint();
                this._axisHoverBridge.schedule(() => this._hideAxisPanels());
            });
        }

        _hideAxisPanels() {
            if (this._yAxisPanel) { this._yAxisPanel.remove(); this._yAxisPanel = null; }
            if (this._xAxisPanel) { this._xAxisPanel.remove(); this._xAxisPanel = null; }
        }

        _showYAxisPanel() {
            if (this._yAxisPanel) return;
            if (this._xAxisPanel) { this._xAxisPanel.remove(); this._xAxisPanel = null; }
            const kit = window.RadialWidgetKit;
            const rect = this.chartHost[0].getBoundingClientRect();
            const panel = kit.floatingPanel({
                position: { left: (rect.left + 6) + 'px', top: (rect.top + rect.height / 2 - 45) + 'px' },
                rows: [
                    kit.panelRow('text', 'Y Label', this._settingValue('yLabel') || '', (v) => this._quickSetSetting('yLabel', v)),
                    kit.panelRow('number', 'Y Min', this._settingValue('yMin'), (v) => this._quickSetSetting('yMin', v === '' ? null : Number(v))),
                    kit.panelRow('number', 'Y Max', this._settingValue('yMax'), (v) => this._quickSetSetting('yMax', v === '' ? null : Number(v)))
                ]
            });
            panel.on('mouseenter', () => this._axisHoverBridge.cancel());
            panel.on('mouseleave', () => this._axisHoverBridge.schedule(() => this._hideAxisPanels()));
            this._yAxisPanel = panel;
        }

        _showXAxisPanel() {
            if (this._xAxisPanel) return;
            if (this._yAxisPanel) { this._yAxisPanel.remove(); this._yAxisPanel = null; }
            const kit = window.RadialWidgetKit;
            const rect = this.chartHost[0].getBoundingClientRect();
            const panel = kit.floatingPanel({
                position: { left: (rect.left + rect.width / 2 - 90) + 'px', top: (rect.bottom - 90) + 'px' },
                rows: [
                    kit.panelRow('text', 'X Label', this._settingValue('xLabel') || '', (v) => this._quickSetSetting('xLabel', v)),
                    kit.panelRow('number', 'X Min', this._settingValue('xMin'), (v) => this._quickSetSetting('xMin', v === '' ? null : Number(v))),
                    kit.panelRow('number', 'X Max', this._settingValue('xMax'), (v) => this._quickSetSetting('xMax', v === '' ? null : Number(v)))
                ]
            });
            panel.on('mouseenter', () => this._axisHoverBridge.cancel());
            panel.on('mouseleave', () => this._axisHoverBridge.schedule(() => this._hideAxisPanels()));
            this._xAxisPanel = panel;
        }

        _chartZoneAt(clientX, clientY) {
            const rect = this.chartHost[0].getBoundingClientRect();
            const relX = clientX - rect.left;
            const relY = clientY - rect.top;
            if (relX < this.axisLeftMarginPx) return 'yAxis';
            if (relY > (rect.height - this.axisBottomMarginPx)) return 'xAxis';
            return 'channel';
        }

        // Double-click the X or Y readout label to rename it -- this writes
        // the *same* xLabel/yLabel setting the axis hover panel's Label field
        // edits (one field, one mechanism, not two ways to set the same
        // thing). Right-click a readout swatch for the 10-color carrousel
        // against that axis's trail/latest color.
        _bindReadoutInteractions() {
            if (!this.readout) return;
            this.readout.on('dblclick', '.uplot-readout-label', (e) => {
                const axis = $(e.currentTarget).closest('.uplot-readout-item').attr('data-axis');
                if (axis) this._startRenameLabel(axis, e.currentTarget);
            });
            this.readout.on('contextmenu', '.uplot-readout-swatch', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const axis = $(e.currentTarget).closest('.uplot-readout-item').attr('data-axis');
                if (axis) window.RadialWidgetKit.colorCarrousel(e.clientX, e.clientY, (hex) => this._setAxisColor(axis, hex));
            });
        }

        _bindTitleRename() {
            this.chartHost.on('dblclick', '.u-title', (e) => {
                e.stopPropagation();
                this._startRenameTitle(e.currentTarget);
            });
        }

        _startRenameLabel(axis, labelEl) {
            const settingName = axis === 'x' ? 'xLabel' : 'yLabel';
            window.RadialWidgetKit.floatingInput({
                anchorEl: labelEl,
                value: this._settingValue(settingName) || '',
                placeholder: $(labelEl).text(),
                onCommit: (val) => this._quickSetSetting(settingName, val)
            });
        }

        _startRenameTitle(titleEl) {
            window.RadialWidgetKit.floatingInput({
                anchorEl: titleEl,
                value: this._settingValue('title') || '',
                onCommit: (val) => this._quickSetSetting('title', val)
            });
        }

        _setAxisColor(axis, hex) {
            this._quickSetSetting(axis === 'x' ? 'trailColor' : 'latestColor', hex);
        }

        _findWidgetModel() {
            return window.RadialWidgetKit.findWidgetModel(this);
        }

        _settingValue(name) {
            const widgetModel = this._findWidgetModel();
            if (!widgetModel) return this._resolveSetting(name);
            return window.RadialWidgetKit.settingValue(widgetModel, name);
        }

        _quickSetSetting(name, value) {
            window.RadialWidgetKit.quickSetSetting(this._findWidgetModel(), name, value);
        }

        _quickSetSourceDef(settingName, sourceDef) {
            this._quickSetSetting(settingName, sourceDef);
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
            this.subSectionElement = containerElement?.closest?.('.sub-section') || null;
            this.sectionElement = this.subSectionElement?.parentElement || null;
            this.container.appendTo(containerElement);
            this.clearBtn.off('click').on('click', () => this._clearHistory());
            this.pauseBtn.off('click').on('click', () => {
                this.paused = !this.paused;
                this.pauseBtn.text(this.paused ? '▶ Resume' : '⏸ Pause');
            });
            this.exportBtn.off('click').on('click', () => this._exportCsv());
            this._maybeSpawnHelpers();
            this._initPlot();
            this._applyPlotHeight();
            this._bindHeightDrag();
            this._bindResize(containerElement);
            this._restartPollTimer();
            this._refreshStatus();
            requestAnimationFrame(() => requestAnimationFrame(() => {
                this._applyPlotHeight();
                this._resizePlot();
            }));
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
                height: Math.max(160, this.chartHost.height() || this.container.height() || 240),
                legend: { show: false },
                scales: {
                    x: { time: false },
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
                        stroke: this._resolveSetting('trailColor') || '#4e79a7',
                        width: 2,
                        points: { show: false }
                    },
                    {
                        label: 'Latest',
                        stroke: this._resolveSetting('latestColor') || '#e15759',
                        width: 0,
                        paths: () => null,
                        points: {
                            show: true,
                            size: 10,
                            fill: this._resolveSetting('latestColor') || '#e15759',
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
            this._resizeObs = new ResizeObserver(() => {
                this._applyPlotHeight();
                this._resizePlot();
            });
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
            if (this.paused) return;
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

        async _exportCsv() {
            const xs = this.dataBuffer[0] || [];
            const ys = this.dataBuffer[1] || [];
            const xLabel = this._resolveSetting('xLabel') || 'X';
            const yLabel = this._resolveSetting('yLabel') || 'Y';
            const rows = [[xLabel, yLabel]];
            for (let i = 0; i < xs.length; i++) rows.push([xs[i], ys[i]]);
            await saveCsvExport(rows, `${buildTimestampStamp()}-xy_plot.csv`, 'xy_plot_csv');
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
            const xLabel = _.escape(this._resolveSetting('xLabel') || 'X');
            const yLabel = _.escape(this._resolveSetting('yLabel') || 'Y');
            const trailColor = _.escape(this._resolveSetting('trailColor') || '#4e79a7');
            const latestColor = _.escape(this._resolveSetting('latestColor') || '#e15759');
            const lastX = xs.length ? this._fmt(xs[xs.length - 1]) : '---';
            const lastY = ys.length ? this._fmt(ys[ys.length - 1]) : '---';
            this.readout.html(
                `<div class="uplot-readout-item uplot-readout-time">` +
                `<span class="uplot-readout-label">Points</span>` +
                `<span class="uplot-readout-value">${xs.length}</span>` +
                `</div>` +
                `<div class="uplot-readout-item" data-axis="x">` +
                `<span class="uplot-readout-swatch" style="border-color:${trailColor};"></span>` +
                `<span class="uplot-readout-label">${xLabel}</span>` +
                `<span class="uplot-readout-value">${lastX}</span>` +
                `</div>` +
                `<div class="uplot-readout-item" data-axis="y">` +
                `<span class="uplot-readout-swatch" style="border-color:${latestColor};"></span>` +
                `<span class="uplot-readout-label">${yLabel}</span>` +
                `<span class="uplot-readout-value">${lastY}</span>` +
                `</div>`
            );
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

        onSizeChanged() {
            this._applyPlotHeight();
            this._resizePlot();
        }

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
            if (this._dragCleanup) {
                this._dragCleanup();
                this._dragCleanup = null;
            }
        }

        _applyPlotHeight() {
            const next = this.plotHeightPx;
            if (typeof next === 'number' && Number.isFinite(next)) {
                const maxAllowed = this._measureAutoChartHeight();
                this.plotHeightPx = Math.min(Math.max(220, next), maxAllowed || Math.max(220, next));
                this.chartHost.css({ height: `${this.plotHeightPx}px`, flex: '0 0 auto' });
                return;
            }
            const autoHeight = this._measureAutoChartHeight();
            this.plotHeightPx = null;
            this.chartHost.css({
                height: autoHeight > 0 ? `${autoHeight}px` : '',
                flex: '1 1 auto'
            });
        }

        _syncSubSectionHeight() {
            const subSection = this.subSectionElement;
            const section = this.sectionElement;
            if (!subSection || !section) return;
            const isOnlyWidget = section.children && section.children.length === 1;
            if (isOnlyWidget) {
                const h = section.clientHeight;
                if (h > 0) subSection.style.height = `${h}px`;
            } else {
                subSection.style.height = '';
            }
        }

        _measureAutoChartHeight() {
            const subSection = this.subSectionElement;
            const shell = this.container?.[0];
            const toolbar = this.toolbar?.[0];
            const readout = this.readout?.[0];
            const handle = this.resizeHandle?.[0];
            if (!subSection || !shell) return 0;

            const subSectionStyles = window.getComputedStyle ? window.getComputedStyle(subSection) : null;
            const shellStyles = window.getComputedStyle ? window.getComputedStyle(shell) : null;
            const paddingTop = subSectionStyles ? parseFloat(subSectionStyles.paddingTop) || 0 : 0;
            const paddingBottom = subSectionStyles ? parseFloat(subSectionStyles.paddingBottom) || 0 : 0;
            const shellGap = shellStyles ? parseFloat(shellStyles.rowGap || shellStyles.gap) || 0 : 0;
            const shellPaddingTop = shellStyles ? parseFloat(shellStyles.paddingTop) || 0 : 0;
            const shellPaddingBottom = shellStyles ? parseFloat(shellStyles.paddingBottom) || 0 : 0;
            const toolbarHeight = toolbar ? toolbar.offsetHeight : 0;
            const readoutHeight = readout ? readout.offsetHeight : 0;
            const handleHeight = handle ? handle.offsetHeight : 0;

            const available = subSection.clientHeight
                - paddingTop - paddingBottom
                - shellPaddingTop - shellPaddingBottom
                - toolbarHeight - readoutHeight - handleHeight
                - (toolbarHeight > 0 ? shellGap : 0)
                - (readoutHeight > 0 ? shellGap : 0)
                - (handleHeight > 0 ? shellGap : 0);
            return Math.max(220, available);
        }

        _bindHeightDrag() {
            if (!this.resizeHandle || this.resizeHandle.data('xy-plot-bound')) return;
            this.resizeHandle.data('xy-plot-bound', true);
            this.resizeHandle.on('mousedown', (event) => {
                event.preventDefault();
                const startY = event.clientY;
                const startHeight = this.chartHost[0]?.clientHeight || this.plotHeightPx || 280;
                const onMove = (moveEvent) => {
                    const delta = moveEvent.clientY - startY;
                    this.plotHeightPx = startHeight + delta;
                    this._applyPlotHeight();
                    this._resizePlot();
                };
                const onUp = () => {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                    this._dragCleanup = null;
                };
                this._dragCleanup = onUp;
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
            });
        }

        getHeight() {
            return 10;
        }
    }
})();
