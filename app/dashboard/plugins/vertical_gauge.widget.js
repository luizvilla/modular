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
                    case 'get-serial-buffer':
                        return serial && serial.getBuffer ? serial.getBuffer(payload.path) : null;
                    case 'get-fast-dataset':
                        return serial && serial.getFastDataset ? serial.getFastDataset(payload.path) : null;
                    case 'can-aggregate-snapshot':
                        return can && can.aggregateSnapshot ? can.aggregateSnapshot(payload) : null;
                    default:
                        return null;
                }
            }
        };
    })(api);
    const COLOR_MAP = {
        blue: '#3b82f6',
        green: '#22c55e',
        orange: '#f97316',
        purple: '#a855f7',
        teal: '#14b8a6',
        yellow: '#eab308',
        gray: '#9ca3af',
        white: '#f8fafc'
    };

    freeboard.loadWidgetPlugin({
        type_name: 'vertical_gauge',
        display_name: 'Vertical Gauge',
        description: 'Single-channel vertical gauge with min/max and alarm',
        category: 'Vertical gauge',
        settings: [
            { name: 'title', display_name: 'Title', type: 'text' },
            // Keep the widget config slim; advanced tuning is handled via helper widgets.
            {
                name: 'helperWidgets',
                display_name: 'Helper Widgets',
                type: 'option',
                default_value: 'none',
                options: [
                    { name: 'None', value: 'none' },
                    { name: 'UI Controller', value: 'ui' },
                    { name: 'Gauge Manager', value: 'manager' },
                    { name: 'Both', value: 'both' }
                ]
            }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new VerticalGauge(settings));
        }
    });

    class VerticalGauge {
        constructor(settings) {
            this.settings = settings;
            this.ipc = ipcShim || window.require?.('electron')?.ipcRenderer;
            this.container = $('<div class="vgauge-root"></div>');
            this.titleEl = $('<div class="vgauge-title"></div>');
            this.bodyEl = $('<div class="vgauge-body"></div>');
            this.trackEl = $('<div class="vgauge-track"></div>');
            this.fillEl = $('<div class="vgauge-fill"></div>');
            this.labelsEl = $('<div class="vgauge-labels"></div>');
            this.maxEl = $('<div class="vgauge-max"></div>');
            this.minEl = $('<div class="vgauge-min"></div>');
            this.valueEl = $('<div class="vgauge-value"></div>');
            this.timer = null;
            this.currentValue = null;
        }

        render(el) {
            this.trackEl.append(this.fillEl);
            this.labelsEl.append(this.maxEl, this.minEl);
            this.bodyEl.append(this.trackEl, this.labelsEl);
            this.container.append(this.titleEl, this.bodyEl, this.valueEl);
            $(el).append(this.container);
            // Optionally spawn helper widgets (UI controller / gauge manager) next to this gauge.
            this._maybeSpawnHelpers();
            this._applySettings();
            this._restartTimer();
        }

        onSettingsChanged(newSettings) {
            this.settings = newSettings;
            this._applySettings();
            this._restartTimer();
        }

        onDispose() {
            if (this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }
        }

        getHeight() {
            return 4;
        }

        _resolveHelperWidgets(settings) {
            // Normalize helper widget selection for easier checks in the render path.
            const raw = (typeof settings.helperWidgets === 'function' ? settings.helperWidgets() : settings.helperWidgets);
            if (!raw) return 'none';
            return String(raw).toLowerCase();
        }

        _maybeSpawnHelpers() {
            const mode = this._resolveHelperWidgets(this.settings);
            if (mode === 'none') return;
            if (this._helpersSpawned) return;
            const model = freeboard.getLiveModel && freeboard.getLiveModel();
            if (!model || typeof model.panes !== 'function') return;

            // Identify the pane + widget index for this gauge so helpers can be inserted next to it.
            let paneIndex = -1;
            let widgetIndex = -1;
            const panes = model.panes();
            for (let p = 0; p < panes.length; p++) {
                const widgets = panes[p].widgets();
                for (let w = 0; w < widgets.length; w++) {
                    if (widgets[w].widgetInstance === this) {
                        paneIndex = p;
                        widgetIndex = w;
                        break;
                    }
                }
                if (paneIndex >= 0) break;
            }
            if (paneIndex < 0 || widgetIndex < 0) return;

            // Use serialized config for insertion because Freeboard has no public widget-creation API.
            const cfg = freeboard.serialize();
            const pane = cfg.panes[paneIndex];
            if (!pane || !Array.isArray(pane.widgets)) return;
            const existingTypes = new Set(pane.widgets.map(w => w.type));
            const helpers = [];
            if ((mode === 'ui' || mode === 'both') && !existingTypes.has('vertical_gauge_config_panel')) {
                helpers.push({ type: 'vertical_gauge_config_panel', settings: {} });
            }
            if ((mode === 'manager' || mode === 'both') && !existingTypes.has('vertical_gauge_manager')) {
                helpers.push({ type: 'vertical_gauge_manager', settings: {} });
            }
            if (!helpers.length) return;

            // Spawn helpers in a separate pane to the right of the gauge.
            const paneModel = panes[paneIndex];
            const helperTypes = new Set(helpers.map(h => h.type));
            const getPanePosition = (paneModelRef, paneCfgRef) => {
                if (window.freeboardUI && typeof freeboardUI.getPositionForScreenSize === 'function') {
                    const pos = freeboardUI.getPositionForScreenSize(paneModelRef);
                    if (pos && typeof pos.row === 'number' && typeof pos.col === 'number') {
                        return { row: pos.row, col: pos.col };
                    }
                }
                if (paneCfgRef && typeof paneCfgRef.row === 'number' && typeof paneCfgRef.col === 'number') {
                    return { row: paneCfgRef.row, col: paneCfgRef.col };
                }
                const rowKeys = paneModelRef && paneModelRef.row ? Object.keys(paneModelRef.row) : [];
                const colKeys = paneModelRef && paneModelRef.col ? Object.keys(paneModelRef.col) : [];
                const key = rowKeys[0] || colKeys[0];
                return {
                    row: key && paneModelRef.row ? (paneModelRef.row[key] || 1) : 1,
                    col: key && paneModelRef.col ? (paneModelRef.col[key] || 1) : 1
                };
            };
            const basePos = getPanePosition(paneModel, pane);
            const targetRow = basePos.row;
            const targetCol = basePos.col + 1;
            const helperPaneExists = panes.some((paneRef, idx) => {
                if (idx === paneIndex) return false;
                const pos = getPanePosition(paneRef, cfg.panes[idx]);
                if (!pos || pos.row !== targetRow || pos.col !== targetCol) return false;
                return paneRef.widgets().some(widget => helperTypes.has(widget.type && widget.type()));
            });
            if (helperPaneExists) {
                this._helpersSpawned = true;
                return;
            }

            // Prevent duplicate pane creation during rapid re-renders or reloads.
            const lockKey = `pane:${paneIndex}:widget:${widgetIndex}:helpers:${[...helperTypes].sort().join(',')}`;
            window.__modularHelperSpawnLocks = window.__modularHelperSpawnLocks || {};
            if (window.__modularHelperSpawnLocks[lockKey]) return;
            window.__modularHelperSpawnLocks[lockKey] = true;

            const helperPane = {
                title: null,
                width: pane.width,
                row: {},
                col: {},
                col_width: pane.col_width || (paneModel.col_width ? Number(paneModel.col_width()) : 2),
                widgets: helpers
            };
            const rowKeys = paneModel && paneModel.row ? Object.keys(paneModel.row) : [];
            const colKeys = paneModel && paneModel.col ? Object.keys(paneModel.col) : [];
            const keys = new Set([...rowKeys, ...colKeys]);
            if (keys.size > 0) {
                keys.forEach((key) => {
                    const rowVal = paneModel.row && paneModel.row[key] ? paneModel.row[key] : targetRow;
                    const colVal = paneModel.col && paneModel.col[key] ? paneModel.col[key] : basePos.col;
                    helperPane.row[key] = rowVal;
                    helperPane.col[key] = colVal + 1;
                });
            } else {
                helperPane.row = targetRow;
                helperPane.col = targetCol;
            }

            cfg.panes.splice(paneIndex + 1, 0, helperPane);
            // Mark as spawned to prevent duplicate pane creation during reload.
            this._helpersSpawned = true;
            freeboard.loadDashboard(cfg);
        }

        _applySettings() {
            const title = typeof this.settings.title === 'function' ? this.settings.title() : this.settings.title;
            this.titleEl.text(title || '');
            const min = this._num(this.settings.min, 0);
            const max = this._num(this.settings.max, 100);
            this.minEl.text(String(min));
            this.maxEl.text(String(max));
            const colorKey = typeof this.settings.barColor === 'function' ? this.settings.barColor() : this.settings.barColor;
            // Accept raw hex colors from the UI controller palette.
            const color = (typeof colorKey === 'string' && colorKey.startsWith('#')) ? colorKey : (COLOR_MAP[colorKey] || COLOR_MAP.blue);
            this.fillEl.css('background-color', color);
        }

        _restartTimer() {
            if (this.timer) {
                clearInterval(this.timer);
                this.timer = null;
            }
            const interval = this._num(this.settings.refreshRate, 500);
            this.timer = setInterval(() => this._pollOnce(), Math.max(50, interval));
            this._pollOnce();
        }

        async _pollOnce() {
            const src = this._getSourceDef();
            if (!src || !src.ds) return;
            try {
                const val = await this._readInstantValue(src);
                if (val != null && isFinite(val)) this._updateValue(val);
            } catch {
                // Ignore transient polling errors
            }
        }

        _updateValue(val) {
            this.currentValue = val;
            const min = this._num(this.settings.min, 0);
            const max = this._num(this.settings.max, 100);
            const span = max - min;
            const pct = span > 0 ? ((val - min) / span) : 0;
            const clamped = Math.max(0, Math.min(1, pct));
            this.fillEl.css('height', `${(clamped * 100).toFixed(1)}%`);
            this.valueEl.text(this._formatValue(val));
            this._applyAlarm(val);
        }

        _applyAlarm(val) {
            const enabled = !!(typeof this.settings.alarmEnabled === 'function'
                ? this.settings.alarmEnabled()
                : this.settings.alarmEnabled);
            if (!enabled) {
                this.container.removeClass('vgauge-alarm');
                return;
            }
            const threshold = this._num(this.settings.alarmThreshold, 0);
            const dir = typeof this.settings.alarmDirection === 'function'
                ? this.settings.alarmDirection()
                : this.settings.alarmDirection;
            const trip = dir === 'below' ? val <= threshold : val >= threshold;
            this.container.toggleClass('vgauge-alarm', !!trip);
        }

        _formatValue(val) {
            if (val == null || !isFinite(val)) return '--';
            if (Math.abs(val) >= 1000 || Math.abs(val) < 0.01) return val.toExponential(2);
            return (Math.round(val * 100) / 100).toString();
        }

        _getSourceDef() {
            let src = typeof this.settings.sourceDef === 'function' ? this.settings.sourceDef() : this.settings.sourceDef;
            if (!src) return null;
            if (typeof src === 'string') {
                try { src = JSON.parse(src); } catch { return null; }
            }
            return src;
        }

        _num(v, fallback) {
            const n = Number(v);
            return isFinite(n) ? n : fallback;
        }

        async _readInstantValue(s) {
            if (!s || !s.ds) return null;
            if (s.type === 'serialport_datasource') {
                if (!this.ipc) return null;
                const dsSettings = freeboard.getDatasourceSettings(s.ds) || {};
                const path = dsSettings.portPath || s.ds;
                const arr = await this.ipc.invoke('get-serial-buffer', { path });
                const idx = Number(s.var);
                const val = Array.isArray(arr) ? arr[idx] : null;
                return Number(val);
            }
            if (s.type === 'fast_frame_datasource') {
                if (!this.ipc) return null;
                const dsSettings = freeboard.getDatasourceSettings(s.ds) || {};
                const path = dsSettings.portPath || s.ds;
                const data = await this.ipc.invoke('get-fast-dataset', { path });
                const idx = Number(s.var);
                const arr = (data && Array.isArray(data.series) && Array.isArray(data.series[idx])) ? data.series[idx] : [];
                return arr.length ? Number(arr[arr.length - 1]) : null;
            }
            if (s.type === 'can_datasource') {
                if (!this.ipc) return null;
                const dsSettings = freeboard.getDatasourceSettings(s.ds) || {};
                const channel = dsSettings.channel || 'can0';
                const snap = await this.ipc.invoke('can-aggregate-snapshot', { channel });
                const nodes = snap?.nodes || {};
                const resolved = this._resolveDeviceKey(nodes, s.device, s.device_uid || s.deviceUid);
                if (!resolved) return null;
                const flat = nodes[resolved]?.flat || {};
                const val = flat[s.var];
                return Number(val);
            }
            if (s.type === 'signal_generator_datasource') {
                const live = freeboard.getLiveModel?.();
                const data = live?.datasourceData ? live.datasourceData[s.ds] : null;
                if (data && data.y1 != null) return Number(data.y1);
                if (data && data.value != null) return Number(data.value);
                return null;
            }
            return null;
        }

        _resolveDeviceKey(nodes, desired, desiredUid) {
            if (!nodes) return null;
            if (desired && nodes[desired]) return desired;
            if (desiredUid) {
                const key = Object.keys(nodes).find(k => nodes[k]?.node_uid === desiredUid);
                if (key) return key;
            }
            return Object.keys(nodes)[0] || null;
        }
    }
}());
