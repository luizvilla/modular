(function () {
    const shared = window.FastFrameShared;

    freeboard.loadWidgetPlugin({
        type_name: 'fast_frame_plot',
        display_name: 'Fast Frame Plot',
        category: 'Fast Frame',
        icon: 'chart-area',
        description: 'Plots multiple CSV-backed fast-frame channels against time or sample index',
        external_scripts: [
            'https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.iife.min.js',
            'https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.min.css'
        ],
        settings: [
            { name: 'title', display_name: 'Title', type: 'text', default_value: 'Fast Frame Plot' }
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
            this._resizeObs = null;
            this._resizeRAF = 0;
            this._dragCleanup = null;
            this.plotHeightPx = null;
            this.hostElement = null;
            this.container = $('<div class="fast-frame-plot h-100 d-flex flex-column gap-2 p-2"></div>');
            this.status = $('<div class="small text-muted border rounded p-2 mb-2">Configure a CSV source, time column, and one or more plotted channels.</div>');
            this.summary = $('<div class="small text-muted border rounded p-2 mb-2"></div>');
            this.chartShell = $('<div class="d-flex flex-column flex-grow-1 gap-2"></div>');
            this.chartHost = $('<div class="fast-frame-plot-host flex-grow-1" style="min-height:220px;"></div>');
            this.resizeHandle = $('<div class="uplot-resize-handle" title="Drag to resize plot"></div>');
            this.emptyState = $('<div class="small text-muted border rounded p-3">Use the Fast Frame Channel Manager to add channels to this plot.</div>');
            this.chartShell.append(this.chartHost, this.resizeHandle);
        }

        render(el) {
            this.hostElement = el || null;
            $(el).append(this.container);
            this.container.empty().append(this.status, this.summary, this.chartShell);
            this._applyPlotHeight();
            this._bindHeightDrag();
            this._bindResize();
            this._scheduleHelperSpawn();
            this._startPolling();
        }

        _scheduleHelperSpawn(delay = 0) {
            return;
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
            return;
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
            this.summary.text(`Source: ${sourceLabel} | File: ${fileLabel} | Time: ${this.settings.timeColumn || 'Row index'} | Channels: ${defs.map(def => `${def.label} (${def.variable})`).join(', ') || '--'}`);
            if (!this.dataset) {
                this.status.text('Select a CSV source and choose the X/time column.');
                this._renderPlaceholder();
                return;
            }
            if (!defs.length) {
                this.status.text('CSV source ready. Add at least one plotted channel.');
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
            this._requestResize();
        }

        _destroyPlot() {
            if (!this.plot) return;
            try { this.plot.destroy(); } catch {}
            this.plot = null;
        }

        _bindResize() {
            if (this._resizeObs) {
                try { this._resizeObs.disconnect(); } catch {}
                this._resizeObs = null;
            }
            if (typeof ResizeObserver !== 'function') return;
            this._resizeObs = new ResizeObserver(() => this._requestResize());
            if (this.hostElement) this._resizeObs.observe(this.hostElement);
            if (this.chartHost?.[0]) this._resizeObs.observe(this.chartHost[0]);
        }

        _requestResize() {
            if (this._resizeRAF) cancelAnimationFrame(this._resizeRAF);
            this._resizeRAF = requestAnimationFrame(() => {
                this._resizeRAF = 0;
                this._resizePlot();
            });
        }

        _resizePlot() {
            if (!this.plot) return;
            const width = Math.max(320, this.chartHost.width() || this.container.width() || 640);
            const height = Math.max(220, this.chartHost.height() || 320);
            try {
                this.plot.setSize({ width, height });
            } catch {}
        }

        _applyPlotHeight() {
            if (typeof this.plotHeightPx === 'number' && Number.isFinite(this.plotHeightPx)) {
                this.chartHost.css({
                    height: `${Math.max(160, this.plotHeightPx)}px`,
                    flex: '0 0 auto'
                });
            } else {
                this.chartHost.css({
                    height: '',
                    flex: '1 1 auto'
                });
            }
        }

        _bindHeightDrag() {
            if (!this.resizeHandle || this.resizeHandle.data('fast-frame-bound')) return;
            this.resizeHandle.data('fast-frame-bound', true);
            this.resizeHandle.on('mousedown', (event) => {
                event.preventDefault();
                const startY = event.clientY;
                const startHeight = this.chartHost[0]?.clientHeight || this.plotHeightPx || 320;
                const onMove = (moveEvent) => {
                    this.plotHeightPx = Math.max(160, startHeight + (moveEvent.clientY - startY));
                    this._applyPlotHeight();
                    this._requestResize();
                };
                const onUp = () => {
                    $(window)
                        .off('mousemove.fast-frame-plot-resize', onMove)
                        .off('mouseup.fast-frame-plot-resize', onUp);
                };
                $(window)
                    .on('mousemove.fast-frame-plot-resize', onMove)
                    .on('mouseup.fast-frame-plot-resize', onUp);
                this._dragCleanup = onUp;
            });
        }

        onSettingsChanged(newSettings) {
            this.settings = { ...newSettings };
            this.lastFileSignature = '';
            this.lastRenderedSignature = '';
            this._helperSpawnKey = null;
            this._scheduleHelperSpawn();
            this._startPolling();
            this._requestResize();
        }

        onSizeChanged() {
            this._applyPlotHeight();
            this._requestResize();
        }

        onDispose() {
            if (this.pollTimer) clearInterval(this.pollTimer);
            if (this._helperSpawnTimer) clearTimeout(this._helperSpawnTimer);
            if (this._resizeObs) {
                try { this._resizeObs.disconnect(); } catch {}
                this._resizeObs = null;
            }
            if (this._resizeRAF) {
                cancelAnimationFrame(this._resizeRAF);
                this._resizeRAF = 0;
            }
            if (this._dragCleanup) {
                this._dragCleanup();
                this._dragCleanup = null;
            }
            this._destroyPlot();
        }

        getHeight() { return 8; }
    }
}());
