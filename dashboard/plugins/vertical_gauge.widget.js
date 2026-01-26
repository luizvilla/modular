(function () {
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
        category: 'plots',
        settings: [
            { name: 'title', display_name: 'Title', type: 'text' },
            { name: 'min', display_name: 'Minimum', type: 'number', default_value: 0 },
            { name: 'max', display_name: 'Maximum', type: 'number', default_value: 100 },
            {
                name: 'barColor',
                display_name: 'Bar Color',
                type: 'option',
                default_value: 'blue',
                options: [
                    { name: 'Blue', value: 'blue' },
                    { name: 'Green', value: 'green' },
                    { name: 'Orange', value: 'orange' },
                    { name: 'Purple', value: 'purple' },
                    { name: 'Teal', value: 'teal' },
                    { name: 'Yellow', value: 'yellow' },
                    { name: 'Gray', value: 'gray' },
                    { name: 'White', value: 'white' }
                ]
            },
            { name: 'alarmEnabled', display_name: 'Alarm Enabled', type: 'boolean', default_value: false },
            { name: 'alarmThreshold', display_name: 'Alarm Threshold', type: 'number', default_value: 0 },
            {
                name: 'alarmDirection',
                display_name: 'Alarm Direction',
                type: 'option',
                default_value: 'above',
                options: [
                    { name: 'Above threshold', value: 'above' },
                    { name: 'Below threshold', value: 'below' }
                ]
            },
            { name: 'refreshRate', display_name: 'Refresh Rate (ms)', type: 'number', default_value: 500 },
            { name: 'sourceDef', display_name: 'Source (managed by Gauge Manager)', type: 'text' }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new VerticalGauge(settings));
        }
    });

    class VerticalGauge {
        constructor(settings) {
            this.settings = settings;
            this.ipc = window.require?.('electron')?.ipcRenderer;
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

        _applySettings() {
            const title = typeof this.settings.title === 'function' ? this.settings.title() : this.settings.title;
            this.titleEl.text(title || '');
            const min = this._num(this.settings.min, 0);
            const max = this._num(this.settings.max, 100);
            this.minEl.text(String(min));
            this.maxEl.text(String(max));
            const colorKey = typeof this.settings.barColor === 'function' ? this.settings.barColor() : this.settings.barColor;
            const color = COLOR_MAP[colorKey] || COLOR_MAP.blue;
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
