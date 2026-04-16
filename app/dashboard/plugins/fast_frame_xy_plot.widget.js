(function () {
    const shared = window.FastFrameShared;

    freeboard.loadWidgetPlugin({
        type_name: 'fast_frame_xy_plot',
        display_name: 'Fast Frame XY Plot',
        category: 'Fast Frame',
        description: 'Plots one CSV-backed fast-frame signal against another signal',
        external_scripts: [
            'https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.iife.min.js',
            'https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.min.css'
        ],
        settings: [
            { name: 'title', display_name: 'Title', type: 'text', default_value: 'Fast Frame XY Plot' },
            { name: 'csvDirectory', display_name: 'CSV Directory', type: 'text', default_value: shared.defaultCsvDirectory() },
            { name: 'csvPath', display_name: 'CSV File Path', type: 'text', default_value: '' },
            { name: 'refreshRate', display_name: 'Refresh Rate (ms)', type: 'number', default_value: 500 },
            { name: 'xVariable', display_name: 'X Variable', type: 'text', default_value: '' },
            { name: 'yVariable', display_name: 'Y Variable', type: 'text', default_value: '' },
            { name: 'xLabel', display_name: 'X Axis Label', type: 'text', default_value: '' },
            { name: 'yLabel', display_name: 'Y Axis Label', type: 'text', default_value: '' },
            { name: 'xMin', display_name: 'X Min', type: 'text', default_value: '' },
            { name: 'xMax', display_name: 'X Max', type: 'text', default_value: '' },
            { name: 'yMin', display_name: 'Y Min', type: 'text', default_value: '' },
            { name: 'yMax', display_name: 'Y Max', type: 'text', default_value: '' }
        ],
        newInstance: function (settings, cb) { cb(new FastFrameXYPlot(settings)); }
    });

    class FastFrameXYPlot {
        constructor(settings) {
            this.settings = { ...settings };
            this.pollTimer = null;
            this.plot = null;
            this.lastFileSignature = '';
            this.availableFiles = [];
            this.availableColumns = [];
            this.dataset = null;
            this.lastRenderedSignature = '';
            this.container = $('<div class="fast-frame-xy-plot h-100 overflow-auto p-2"></div>');
            this.status = $('<div class="small text-muted border rounded p-2 mb-2">Select X and Y variables.</div>');
            this.summary = $('<div class="small text-muted border rounded p-2 mb-2"></div>');
            this.chartHost = $('<div class="fast-frame-plot-host"></div>');
            this.emptyState = $('<div class="small text-muted border rounded p-3">Configure the XY pair with the Fast Frame UI widget.</div>');
        }

        render(el) {
            $(el).append(this.container);
            this.container.empty().append(this.status, this.summary, this.chartHost);
            this._startPolling();
        }

        _startPolling() {
            if (this.pollTimer) clearInterval(this.pollTimer);
            const rate = Math.max(100, parseInt(this.settings.refreshRate, 10) || 500);
            this.pollTimer = setInterval(() => this._refresh(), rate);
            this._refresh();
        }

        async _refresh() {
            this.availableFiles = await shared.listCsvFiles(this.settings.csvDirectory);
            const loaded = await shared.loadCsvDataset(this.settings.csvPath, this.lastFileSignature);
            if (loaded.changed) {
                this.dataset = loaded.dataset;
                this.lastFileSignature = loaded.signature;
                this.availableColumns = this.dataset ? this.dataset.headers.filter(header => header !== 'k_acquire') : [];
                this.lastRenderedSignature = '';
            }
            this.summary.text(`File: ${this.settings.csvPath ? shared.displayPath(this.settings.csvPath) : 'none'} | X: ${this.settings.xVariable || '--'} | Y: ${this.settings.yVariable || '--'}`);
            if (!this.dataset) {
                this.status.text('Select a CSV file to plot.');
                this._renderPlaceholder();
                return;
            }
            if (!this.availableColumns.includes(this.settings.xVariable) || !this.availableColumns.includes(this.settings.yVariable)) {
                this.status.text('Select valid X and Y variables.');
                this._renderPlaceholder();
                return;
            }
            this.status.text(`Loaded ${this.dataset.rows.length} rows from ${shared.displayPath(this.settings.csvPath)}.`);
            this._renderPlot();
        }

        _renderPlaceholder() {
            if (this.lastRenderedSignature === 'empty') return;
            this.lastRenderedSignature = 'empty';
            this._destroyPlot();
            this.chartHost.empty().append(this.emptyState);
        }

        _renderPlot() {
            const xValues = this.dataset.columns[this.settings.xVariable] || [];
            const yValues = this.dataset.columns[this.settings.yVariable] || [];
            const pairs = xValues.map((x, index) => [x, yValues[index]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
            const signature = JSON.stringify({
                file: this.lastFileSignature,
                x: this.settings.xVariable,
                y: this.settings.yVariable,
                sample: [pairs[0] || null, pairs[Math.floor(pairs.length / 2)] || null, pairs[pairs.length - 1] || null]
            });
            if (signature === this.lastRenderedSignature) return;
            this.lastRenderedSignature = signature;
            this._destroyPlot();
            this.chartHost.empty();
            const host = $('<div></div>');
            this.chartHost.append(host);
            this.plot = new uPlot({
                title: this.settings.title || 'Fast Frame XY Plot',
                width: Math.max(320, this.chartHost.width() || this.container.width() || 640),
                height: Math.max(260, this.chartHost.height() || 320),
                legend: { show: true },
                scales: {
                    x: { time: false, min: shared.parseAxisBound(this.settings.xMin), max: shared.parseAxisBound(this.settings.xMax) },
                    y: { min: shared.parseAxisBound(this.settings.yMin), max: shared.parseAxisBound(this.settings.yMax) }
                },
                axes: [
                    { stroke: '#666', grid: { show: true }, label: this.settings.xLabel || this.settings.xVariable || 'X' },
                    { stroke: '#666', grid: { show: true }, label: this.settings.yLabel || this.settings.yVariable || 'Y' }
                ],
                series: [
                    { label: this.settings.xLabel || this.settings.xVariable || 'X' },
                    { label: this.settings.yVariable || 'Y', stroke: shared.DEFAULT_COLORS[0], width: 2, points: { show: true, size: 6 } }
                ]
            }, [pairs.map(pair => pair[0]), pairs.map(pair => pair[1])], host[0]);
        }

        _destroyPlot() {
            if (!this.plot) return;
            try { this.plot.destroy(); } catch {}
            this.plot = null;
        }

        onSettingsChanged(newSettings) {
            this.settings = { ...newSettings };
            this.lastFileSignature = '';
            this.lastRenderedSignature = '';
            this._startPolling();
        }

        onDispose() {
            if (this.pollTimer) clearInterval(this.pollTimer);
            this._destroyPlot();
        }

        getHeight() { return 8; }
    }
}());
