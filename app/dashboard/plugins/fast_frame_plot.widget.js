(function () {
    const shared = window.FastFrameShared;

    freeboard.loadWidgetPlugin({
        type_name: 'fast_frame_plot',
        display_name: 'Fast Frame Plot',
        category: 'Fast Frame',
        description: 'Plots multiple CSV-backed fast-frame channels against time or sample index',
        external_scripts: [
            'https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.iife.min.js',
            'https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.min.css'
        ],
        settings: [
            { name: 'title', display_name: 'Title', type: 'text', default_value: 'Fast Frame Plot' },
            { name: 'helperWidgets', display_name: 'Helper Widgets', type: 'option', default_value: 'both', options: [
                { name: 'None', value: 'none' },
                { name: 'UI Controller', value: 'ui' },
                { name: 'Channel Manager', value: 'channels' },
                { name: 'Both', value: 'both' }
            ] }
        ],
        newInstance: function (settings, cb) { cb(new FastFramePlot(settings)); }
    });

    class FastFramePlot {
        constructor(settings) {
            this.settings = { ...settings };
            this.pollTimer = null;
            this.plot = null;
            this.lastFileSignature = '';
            this.lastRenderedSignature = '';
            this._helpersSpawned = false;
            this._helperSpawnTimer = null;
            this.availableFiles = [];
            this.availableColumns = [];
            this.dataset = null;
            this._helperSpawnKey = null;
            this.container = $('<div class="fast-frame-plot h-100 overflow-auto p-2"></div>');
            this.status = $('<div class="small text-muted border rounded p-2 mb-2">Configure this plot with the Fast Frame UI and Channel Manager widgets.</div>');
            this.summary = $('<div class="small text-muted border rounded p-2 mb-2"></div>');
            this.chartHost = $('<div class="fast-frame-plot-host"></div>');
            this.emptyState = $('<div class="small text-muted border rounded p-3">Use the Fast Frame Channel Manager to add channels to this plot.</div>');
        }

        render(el) {
            $(el).append(this.container);
            this.container.empty().append(this.status, this.summary, this.chartHost);
            this._scheduleHelperSpawn();
            this._startPolling();
        }

        _scheduleHelperSpawn(delay = 0) {
            if (this._helpersSpawned || this._helperSpawnTimer) return;
            this._helperSpawnTimer = setTimeout(() => {
                this._helperSpawnTimer = null;
                this._maybeSpawnHelpers();
            }, delay);
        }

        _resolveHelperWidgets(settings) {
            const raw = (typeof settings.helperWidgets === 'function' ? settings.helperWidgets() : settings.helperWidgets) || 'none';
            return String(raw).toLowerCase();
        }

        _resolveHelperSpawnKey(helperTypes) {
            const title = ((typeof this.settings.title === 'function' ? this.settings.title() : this.settings.title) || '').trim();
            if (!title) return null;
            return `fast-frame:${title}:${helperTypes.slice().sort().join(',')}`;
        }

        _maybeSpawnHelpers() {
            const mode = this._resolveHelperWidgets(this.settings);
            if (mode === 'none' || this._helpersSpawned) return;

            const helperTypes = [];
            if (mode === 'ui' || mode === 'both') helperTypes.push('fast_frame_plot_ui');
            if (mode === 'channels' || mode === 'both') helperTypes.push('fast_frame_channel_manager');
            if (!helperTypes.length) return;
            const spawnKey = this._resolveHelperSpawnKey(helperTypes);
            if (!spawnKey) return;
            window.__modularHelperSpawnLocks = window.__modularHelperSpawnLocks || {};
            if (window.__modularHelperSpawnLocks[spawnKey]) {
                this._helpersSpawned = true;
                return;
            }

            const model = freeboard.getLiveModel && freeboard.getLiveModel();
            if (!model || typeof model.panes !== 'function') return;

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
            if (paneIndex < 0 || widgetIndex < 0) {
                this._scheduleHelperSpawn(50);
                return;
            }

            const cfg = freeboard.serialize();
            const pane = cfg.panes[paneIndex];
            if (!pane) return;

            const missingHelpers = helperTypes.filter((helperType) => {
                return !cfg.panes.some((existingPane) => Array.isArray(existingPane.widgets) && existingPane.widgets.some((widget) => widget.type === helperType));
            });
            if (!missingHelpers.length) {
                window.__modularHelperSpawnLocks[spawnKey] = true;
                this._helpersSpawned = true;
                return;
            }

            const paneModel = panes[paneIndex];
            const helperPane = {
                title: null,
                width: pane.width,
                row: {},
                col: {},
                col_width: pane.col_width || (paneModel.col_width ? Number(paneModel.col_width()) : 1),
                widgets: missingHelpers.map((type) => ({ type, settings: {} }))
            };

            const rowKeys = paneModel && paneModel.row ? Object.keys(paneModel.row) : [];
            const colKeys = paneModel && paneModel.col ? Object.keys(paneModel.col) : [];
            const keys = new Set([...rowKeys, ...colKeys]);
            const paneWidth = Math.max(1, Number(pane.width || (paneModel.width && paneModel.width()) || 1));

            if (keys.size > 0) {
                keys.forEach((key) => {
                    const rowVal = paneModel.row && paneModel.row[key] ? paneModel.row[key] : 1;
                    const colVal = paneModel.col && paneModel.col[key] ? paneModel.col[key] : 1;
                    helperPane.row[key] = rowVal;
                    helperPane.col[key] = colVal + paneWidth;
                });
            } else {
                helperPane.row = 1;
                helperPane.col = 1 + paneWidth;
            }

            cfg.panes.splice(paneIndex + 1, 0, helperPane);
            window.__modularHelperSpawnLocks[spawnKey] = true;
            this._helperSpawnKey = spawnKey;
            this._helpersSpawned = true;
            freeboard.loadDashboard(cfg);
        }

        _startPolling() {
            if (this.pollTimer) clearInterval(this.pollTimer);
            const rate = Math.max(100, parseInt(this.settings.refreshRate, 10) || 500);
            this.pollTimer = setInterval(() => this._refresh(), rate);
            this._refresh();
        }

        async _refresh() {
            this.availableFiles = await shared.listCsvFiles(this.settings.csvDirectory);
            const source = shared.resolveCsvSource(this.settings, this.availableFiles);
            const loaded = await shared.loadCsvDataset(source.filePath, this.lastFileSignature);
            if (loaded.changed) {
                this.dataset = loaded.dataset;
                this.lastFileSignature = loaded.signature;
                this.availableColumns = this.dataset ? this.dataset.headers.filter(header => header !== 'k_acquire') : [];
                this.lastRenderedSignature = '';
            }
            const defs = shared.normalizeSeriesDefs(this.settings, this.availableColumns);
            const sourceLabel = source.mode === 'latest' ? 'Latest CSV' : 'Fixed CSV';
            const fileLabel = source.filePath ? shared.displayPath(source.filePath) : 'none';
            this.summary.text(`Source: ${sourceLabel} | File: ${fileLabel} | Time: ${this.settings.timeColumn || 'Row index'} | Channels: ${defs.map(def => def.label).join(', ') || '--'}`);
            if (!this.dataset) {
                this.status.text('Select a CSV file with the Fast Frame UI widget.');
                this._renderPlaceholder();
                return;
            }
            if (!defs.length) {
                this.status.text('Add at least one channel with the Fast Frame Channel Manager.');
                this._renderPlaceholder();
                return;
            }
            const invalid = defs.filter(def => !this.availableColumns.includes(def.variable));
            if (invalid.length) {
                this.status.text(`Missing columns: ${invalid.map(def => def.variable).join(', ')}`);
                this._renderPlaceholder();
                return;
            }
            this.status.text(`Loaded ${this.dataset.rows.length} rows from ${shared.displayPath(source.filePath)}.`);
            this._renderPlot(defs);
        }

        _renderPlaceholder() {
            if (this.lastRenderedSignature === 'empty') return;
            this.lastRenderedSignature = 'empty';
            this._destroyPlot();
            this.chartHost.empty().append(this.emptyState);
        }

        _renderPlot(defs) {
            const xValues = Array.isArray(this.dataset.columns[this.settings.timeColumn])
                ? this.dataset.columns[this.settings.timeColumn].map(value => Number.isFinite(value) ? value : null)
                : this.dataset.rows.map((_row, index) => index);
            const data = [xValues];
            const series = [{ label: this.settings.xLabel || this.settings.timeColumn || 'Sample' }];

            defs.forEach((def) => {
                data.push(this.dataset.columns[def.variable] || []);
                series.push({
                    label: def.label,
                    stroke: def.color,
                    width: 2,
                    show: def.visible !== false
                });
            });

            const signature = JSON.stringify({
                file: this.lastFileSignature,
                timeColumn: this.settings.timeColumn || '',
                defs,
                sample: data.map(values => Array.isArray(values) && values.length ? [values[0], values[Math.floor(values.length / 2)], values[values.length - 1]] : null),
                xLabel: this.settings.xLabel || '',
                yLabel: this.settings.yLabel || ''
            });
            if (signature === this.lastRenderedSignature) return;
            this.lastRenderedSignature = signature;
            this._destroyPlot();
            this.chartHost.empty();
            const host = $('<div></div>');
            this.chartHost.append(host);
            this.plot = new uPlot({
                title: this.settings.title || 'Fast Frame Plot',
                width: Math.max(320, this.chartHost.width() || this.container.width() || 640),
                height: Math.max(260, this.chartHost.height() || 320),
                legend: { show: !!this.settings.showLegend },
                scales: {
                    x: { time: false, min: shared.parseAxisBound(this.settings.xMin), max: shared.parseAxisBound(this.settings.xMax) },
                    y: { min: shared.parseAxisBound(this.settings.yMin), max: shared.parseAxisBound(this.settings.yMax) }
                },
                axes: [
                    { stroke: '#666', grid: { show: true }, label: this.settings.xLabel || this.settings.timeColumn || 'Sample' },
                    { stroke: '#666', grid: { show: true }, label: this.settings.yLabel || 'Value' }
                ],
                series
            }, data, host[0]);
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
            this._helperSpawnKey = null;
            this._scheduleHelperSpawn();
            this._startPolling();
        }

        onDispose() {
            if (this.pollTimer) clearInterval(this.pollTimer);
            if (this._helperSpawnTimer) clearTimeout(this._helperSpawnTimer);
            this._destroyPlot();
        }

        getHeight() { return 8; }
    }
}());
