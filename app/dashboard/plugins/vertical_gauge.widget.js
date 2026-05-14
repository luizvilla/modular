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
        icon: 'gauge-high',
        category: 'Plots',
        settings: [
            { name: 'title', display_name: 'Title', type: 'text' }
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
            this.sourceSummaryEl = $('<div class="vgauge-source-summary small text-muted">Configure source.</div>');
            this.valueEl = $('<div class="vgauge-value"></div>');
            this.timer = null;
            this.currentValue = null;
            this._summaryRequestId = 0;
        }

        render(el) {
            this.trackEl.append(this.fillEl);
            this.labelsEl.append(this.maxEl, this.minEl);
            this.bodyEl.append(this.trackEl, this.labelsEl);
            this.container.append(this.titleEl, this.sourceSummaryEl, this.bodyEl, this.valueEl);
            $(el).append(this.container);
            this._maybeSpawnHelpers();
            this._applySettings();
            this._refreshSourceSummary();
            this._restartTimer();
        }

        onSettingsChanged(newSettings) {
            this.settings = newSettings;
            this._applySettings();
            this._refreshSourceSummary();
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
            return;
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

        _getPlotEditorShared() {
            return window.ModularPlotEditorShared
                || (window.freeboard && typeof window.freeboard.getPlotEditorShared === 'function' ? window.freeboard.getPlotEditorShared() : null);
        }

        async _refreshSourceSummary() {
            const requestId = ++this._summaryRequestId;
            const src = this._getSourceDef();
            if (!src || !src.ds) {
                this.sourceSummaryEl.text('Configure source.');
                return;
            }
            try {
                const label = await this._describeSourceDef(src);
                if (requestId !== this._summaryRequestId) return;
                this.sourceSummaryEl.text(label || 'Configure source.');
            } catch {
                if (requestId !== this._summaryRequestId) return;
                this.sourceSummaryEl.text(src.ds || 'Configure source.');
            }
        }

        async _describeSourceDef(src) {
            const shared = this._getPlotEditorShared();
            const dsName = src.ds || '';
            const dsType = src.type || (shared && typeof shared.getDatasourceType === 'function' ? shared.getDatasourceType(dsName) : '') || '';
            let variableLabel = '';
            let deviceLabel = '';

            if (shared && typeof shared.fetchDatasourceVariableOptions === 'function') {
                const options = await shared.fetchDatasourceVariableOptions(dsName, src.device || '');
                const match = options.find((option) => String(option.value) === String(src.var));
                if (match) variableLabel = match.label;
            }

            if (!variableLabel) {
                if (dsType === 'signal_generator_datasource') variableLabel = 'Signal';
                else if (src.var != null && dsType === 'can_datasource') variableLabel = String(src.var);
                else if (src.var != null) variableLabel = `Channel ${Number(src.var) + 1}`;
            }

            if (dsType === 'can_datasource' && shared && typeof shared.fetchCanDevices === 'function') {
                const devices = await shared.fetchCanDevices(dsName);
                const device = devices.find((entry) => entry.value === src.device || (src.device_uid && entry.uid === src.device_uid));
                deviceLabel = device ? device.label : (src.device || src.device_uid || '');
            }

            if (deviceLabel) return `${dsName} / ${deviceLabel} / ${variableLabel}`;
            return variableLabel ? `${dsName} / ${variableLabel}` : dsName;
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
