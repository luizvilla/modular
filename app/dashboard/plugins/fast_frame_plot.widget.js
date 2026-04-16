(function () {
    const api = window.api || null;
    const ipcShim = (function createIpcShim(apiRef) {
        if (!apiRef) return null;
        const serial = apiRef.serial || null;
        if (!serial) return null;
        return {
            invoke: async (channel, payload = {}) => {
                switch (channel) {
                    case 'get-fast-dataset':
                        return serial.getFastDataset ? serial.getFastDataset(payload.path) : null;
                    case 'get-fast-frame-status':
                        return serial.getFastStatus ? serial.getFastStatus(payload.path) : null;
                    case 'get-serial-headers':
                        return serial.getHeaders ? serial.getHeaders(payload.path, payload.type) : null;
                    default:
                        return null;
                }
            }
        };
    })(api);

    freeboard.loadWidgetPlugin({
        type_name: 'fast_frame_plot',
        display_name: 'Fast Frame Plot',
        description: 'Plots the latest fast-frame dataset using voltage/current/other groups',
        external_scripts: [
            'https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.iife.min.js',
            'https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.min.css'
        ],
        settings: [
            {
                name: 'datasource',
                display_name: 'Datasource Name',
                type: 'option',
                options: getFastFrameDatasourceOptions,
                optionsRefreshMs: 1000
            },
            { name: 'refreshRate', display_name: 'Refresh Rate (ms)', type: 'number', default_value: 250 },
            { name: 'title', display_name: 'Title', type: 'text', default_value: 'Fast Frame Plot' }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new FastFramePlot(settings));
        }
    });

    function getFastFrameDatasourceOptions() {
        const live = freeboard.getLiveModel?.();
        if (!live || typeof live.datasources !== 'function') return [];
        const out = [];
        live.datasources().forEach(ds => {
            try {
                if (ds.type && ds.type() === 'fast_frame_datasource') {
                    const name = ds.name();
                    out.push({ name, value: name });
                }
            } catch {}
        });
        return out;
    }

    class FastFramePlot {
        constructor(settings) {
            this.settings = settings;
            this.ipc = ipcShim || window.require?.('electron')?.ipcRenderer;
            this.pollTimer = null;
            this.status = $('<div class="small text-muted border rounded p-2 mb-2">Waiting for fast-frame acquisition.</div>');
            this.container = $('<div class="fast-frame-plot h-100 overflow-auto p-2"></div>');
            this.plotsHost = $('<div class="d-flex flex-column gap-3"></div>');
            this.plots = [];
            this.headers = [];
            this.lastSignature = '';
            this._configHandler = () => this._syncDatasourceOptions();
            freeboard.on && freeboard.on('config_updated', this._configHandler);
            if (freeboard && typeof freeboard.addStyle === 'function') {
                freeboard.addStyle('.fast-frame-plot .uplot-title', 'font-weight:600;margin-bottom:4px;');
            }
        }

        render(containerElement) {
            this.container.empty().append(this.status, this.plotsHost);
            $(containerElement).append(this.container);
            this._startPolling();
        }

        _syncDatasourceOptions() {
            if (!this.settings.datasource) {
                const options = getFastFrameDatasourceOptions();
                if (options.length) this.settings.datasource = options[0].value;
            }
        }

        _portPath() {
            const dsSettings = freeboard.getDatasourceSettings(this.settings.datasource) || {};
            return dsSettings.portPath || this.settings.datasource;
        }

        _startPolling() {
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
                this.pollTimer = null;
            }
            const rate = Math.max(100, parseInt(this.settings.refreshRate, 10) || 250);
            this.pollTimer = setInterval(() => this._refresh(), rate);
            this._refresh();
        }

        async _refresh() {
            const path = this._portPath();
            if (!path || !this.ipc) {
                this.status.text('Select a fast-frame datasource.');
                return;
            }
            const [status, headers, dataset] = await Promise.all([
                this.ipc.invoke('get-fast-frame-status', { path }),
                this.ipc.invoke('get-serial-headers', { path, type: 'fast_frame_datasource' }),
                this.ipc.invoke('get-fast-dataset', { path })
            ]);
            this.headers = Array.isArray(headers) ? headers : [];
            if (!dataset || !Array.isArray(dataset.timestamps) || !Array.isArray(dataset.series)) {
                this.status.text(status?.message || 'Waiting for fast-frame acquisition.');
                return;
            }

            const derived = this._deriveDataset(dataset);
            const acquisitionMarker = dataset.capturedAt || status?.completedAt || null;
            const acquisitionId = dataset.acquisitionId || status?.acquisitionId || 0;
            const signature = JSON.stringify({
                acquisitionId,
                lengths: [derived.timestamps.length, ...derived.series.map(s => s.values.length)],
                capturedAt: acquisitionMarker,
                headers: derived.series.map(s => s.name),
                sample: this._datasetFingerprint(derived)
            });
            const statusParts = [
                `Showing ${derived.timestamps.length} points`,
                acquisitionId ? `Acq: ${acquisitionId}` : null,
                status?.state ? `State: ${status.state}` : null,
                acquisitionMarker ? `Completed: ${new Date(acquisitionMarker).toLocaleTimeString()}` : null
            ].filter(Boolean);
            this.status.text(statusParts.join(' | '));
            if (signature === this.lastSignature) return;
            this.lastSignature = signature;
            this._renderPlots(derived);
        }

        _deriveDataset(dataset) {
            const names = this.headers.length
                ? this.headers.slice(0, dataset.series.length)
                : dataset.series.map((_, i) => `ch${i + 1}`);
            const baseSeries = names.map((name, idx) => ({
                name,
                values: Array.isArray(dataset.series[idx]) ? dataset.series[idx].slice() : []
            }));
            const byName = new Map(baseSeries.map(s => [s.name, s.values]));
            const filtered = baseSeries.filter(s => s.name !== 'k_acquire');
            if (byName.has('duty_cycle') && byName.has('V_high')) {
                const duty = byName.get('duty_cycle');
                const high = byName.get('V_high');
                const values = duty.map((v, i) => (Number(v) || 0) * (Number(high[i]) || 0));
                filtered.push({ name: 'V_Low_estim', values });
            }
            return {
                timestamps: Array.isArray(dataset.timestamps) ? dataset.timestamps.slice() : [],
                groups: {
                    voltage: filtered.filter(s => s.name.startsWith('V')),
                    current: filtered.filter(s => s.name.startsWith('I')),
                    other: filtered.filter(s => !s.name.startsWith('V') && !s.name.startsWith('I'))
                },
                series: filtered
            };
        }

        _renderPlots(derived) {
            this._destroyPlots();
            this.plotsHost.empty();
            const groups = [
                { key: 'voltage', title: 'Voltages' },
                { key: 'current', title: 'Currents' },
                { key: 'other', title: 'Other Signals' }
            ];
            groups.forEach((group, groupIndex) => {
                const entries = derived.groups[group.key];
                if (!entries.length) return;
                const block = $('<div class="fast-frame-plot-block"></div>');
                const title = $(`<div class="uplot-title">${group.title}</div>`);
                const host = $('<div class="fast-frame-plot-host"></div>');
                block.append(title, host);
                this.plotsHost.append(block);

                const palette = (typeof ColorBlind10 !== 'undefined' && Array.isArray(ColorBlind10))
                    ? ColorBlind10
                    : ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f'];
                const data = [derived.timestamps, ...entries.map(s => s.values)];
                const series = [{ label: 'Samples' }].concat(entries.map((entry, idx) => ({
                    label: entry.name,
                    stroke: palette[(groupIndex * 3 + idx) % palette.length],
                    width: 2
                })));
                const opts = {
                    title: '',
                    width: Math.max(320, host.width() || this.container.width() || 640),
                    height: 220,
                    legend: { show: true },
                    scales: { x: { time: false }, y: {} },
                    axes: [
                        { stroke: '#666', grid: { show: true }, label: 'Sample' },
                        { stroke: '#666', grid: { show: true }, label: group.title }
                    ],
                    series
                };
                this.plots.push(new uPlot(opts, data, host[0]));
            });
        }

        _datasetFingerprint(derived) {
            return derived.series.map((entry) => {
                const values = entry.values || [];
                if (!values.length) return [entry.name, null];
                const first = values[0];
                const middle = values[Math.floor(values.length / 2)];
                const last = values[values.length - 1];
                return [entry.name, first, middle, last];
            });
        }

        _destroyPlots() {
            this.plots.forEach(plot => {
                try { plot.destroy(); } catch {}
            });
            this.plots = [];
        }

        onSettingsChanged(newSettings) {
            this.settings = newSettings;
            this.lastSignature = '';
            this._startPolling();
        }

        onDispose() {
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
                this.pollTimer = null;
            }
            this._destroyPlots();
            if (this._configHandler && freeboard.off) {
                freeboard.off('config_updated', this._configHandler);
            }
        }

        getHeight() {
            return 10;
        }
    }
}());
