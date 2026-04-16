(function () {
    const api = window.api || null;
    const pathApi = api?.paths || null;
    const fileApi = api?.files || null;

    freeboard.loadWidgetPlugin({
        type_name: 'fast_frame_plot',
        display_name: 'Fast Frame Plot',
        description: 'Plots one CSV-backed fast-frame signal as time series or XY data',
        external_scripts: [
            'https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.iife.min.js',
            'https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.min.css'
        ],
        settings: [
            { name: 'title', display_name: 'Title', type: 'text', default_value: 'Fast Frame Plot' },
            { name: 'csvDirectory', display_name: 'CSV Directory', type: 'text', default_value: defaultCsvDirectory() },
            { name: 'csvPath', display_name: 'CSV File Path', type: 'text', default_value: '' },
            { name: 'refreshRate', display_name: 'Refresh Rate (ms)', type: 'number', default_value: 500 },
            {
                name: 'plotMode',
                display_name: 'Plot Mode',
                type: 'option',
                options: [
                    { name: 'Y vs Time', value: 'time_series' },
                    { name: 'X vs Y', value: 'xy' }
                ],
                default_value: 'time_series'
            },
            { name: 'timeColumn', display_name: 'Time Column', type: 'text', default_value: '' },
            { name: 'xVariable', display_name: 'X Variable', type: 'text', default_value: '' },
            { name: 'yVariable', display_name: 'Y Variable', type: 'text', default_value: '' },
            { name: 'xLabel', display_name: 'X Axis Label', type: 'text', default_value: '' },
            { name: 'yLabel', display_name: 'Y Axis Label', type: 'text', default_value: '' },
            { name: 'xMin', display_name: 'X Min', type: 'text', default_value: '' },
            { name: 'xMax', display_name: 'X Max', type: 'text', default_value: '' },
            { name: 'yMin', display_name: 'Y Min', type: 'text', default_value: '' },
            { name: 'yMax', display_name: 'Y Max', type: 'text', default_value: '' }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new FastFramePlot(settings));
        }
    });

    function defaultCsvDirectory() {
        return pathApi?.cwd ? pathApi.cwd() : '';
    }

    function normalizePath(value) {
        return String(value || '').trim();
    }

    class FastFramePlot {
        constructor(settings) {
            this.settings = { ...settings };
            this.pollTimer = null;
            this.plot = null;
            this.lastConfigSignature = '';
            this.lastRenderedSignature = '';
            this.availableFiles = [];
            this.availableColumns = [];
            this.container = $('<div class="fast-frame-plot h-100 overflow-auto p-2"></div>');
            this.status = $('<div class="small text-muted border rounded p-2 mb-2">Select a CSV file to plot.</div>');
            this.controls = $('<div class="fast-frame-plot-controls d-flex flex-column gap-2 mb-3"></div>');
            this.chartHost = $('<div class="fast-frame-plot-host"></div>');
            this.fileSelect = $('<select class="form-control form-control-sm"></select>');
            this.filePathInput = $('<input type="text" class="form-control form-control-sm" placeholder="CSV file path">');
            this.modeSelect = $('<select class="form-control form-control-sm"></select>');
            this.xSelect = $('<select class="form-control form-control-sm"></select>');
            this.ySelect = $('<select class="form-control form-control-sm"></select>');
            this.timeSelect = $('<select class="form-control form-control-sm"></select>');
            this.directoryInput = $('<input type="text" class="form-control form-control-sm" placeholder="Directory containing CSV files">');
            this.emptyState = $('<div class="small text-muted border rounded p-3">Select a CSV file and variables to render a plot.</div>');
            this._configHandler = () => this._syncFromSettings();

            if (freeboard?.on) freeboard.on('config_updated', this._configHandler);
            if (freeboard?.addStyle) {
                freeboard.addStyle('.fast-frame-plot-controls label', 'font-size:12px;color:#aaa;margin-bottom:4px;');
                freeboard.addStyle('.fast-frame-plot .fast-frame-control-grid', 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;');
                freeboard.addStyle('.fast-frame-plot .fast-frame-control-grid .full-span', 'grid-column:1 / -1;');
                freeboard.addStyle('.fast-frame-plot .fast-frame-plot-host', 'min-height:260px;');
            }
        }

        render(containerElement) {
            this._buildControls();
            this.container.empty().append(this.status, this.controls, this.chartHost);
            $(containerElement).append(this.container);
            this._syncFromSettings();
            this._startPolling();
        }

        _buildControls() {
            this.controls.empty();
            this.modeSelect.empty()
                .append('<option value="time_series">Y vs Time</option>')
                .append('<option value="xy">X vs Y</option>');

            this.fileSelect.off('change').on('change', () => {
                const selected = this.fileSelect.val();
                if (!selected) return;
                this._updateSettings({ csvPath: selected });
            });
            this.filePathInput.off('change').on('change', () => {
                this._updateSettings({ csvPath: normalizePath(this.filePathInput.val()) });
            });
            this.directoryInput.off('change').on('change', () => {
                this._updateSettings({ csvDirectory: normalizePath(this.directoryInput.val()) || defaultCsvDirectory() });
            });
            this.modeSelect.off('change').on('change', () => {
                this._updateSettings({ plotMode: this.modeSelect.val() || 'time_series' });
            });
            this.xSelect.off('change').on('change', () => {
                this._updateSettings({ xVariable: this.xSelect.val() || '' });
            });
            this.ySelect.off('change').on('change', () => {
                this._updateSettings({ yVariable: this.ySelect.val() || '' });
            });
            this.timeSelect.off('change').on('change', () => {
                this._updateSettings({ timeColumn: this.timeSelect.val() || '' });
            });

            const grid = $('<div class="fast-frame-control-grid"></div>');
            grid.append(this._makeControl('CSV Directory', this.directoryInput, true));
            grid.append(this._makeControl('CSV File', this.fileSelect, true));
            grid.append(this._makeControl('CSV Path', this.filePathInput, true));
            grid.append(this._makeControl('Mode', this.modeSelect));
            grid.append(this._makeControl('Time Column', this.timeSelect));
            grid.append(this._makeControl('X Variable', this.xSelect));
            grid.append(this._makeControl('Y Variable', this.ySelect));
            this.controls.append(grid);
        }

        _makeControl(label, input, fullSpan = false) {
            const wrap = $('<div></div>');
            if (fullSpan) wrap.addClass('full-span');
            wrap.append($(`<label>${label}</label>`), input);
            return wrap;
        }

        _startPolling() {
            if (this.pollTimer) clearInterval(this.pollTimer);
            const rate = Math.max(100, parseInt(this.settings.refreshRate, 10) || 500);
            this.pollTimer = setInterval(() => this._refresh(), rate);
            this._refresh();
        }

        async _refresh() {
            await this._reloadCsvList();
            this._refreshControlState();
            this.status.text(this.settings.csvPath
                ? `Selected CSV: ${this._displayPath(this.settings.csvPath)}`
                : 'Select a CSV file to plot.');
            this._renderPlaceholder();
        }

        async _reloadCsvList() {
            const dir = normalizePath(this.settings.csvDirectory) || defaultCsvDirectory();
            if (!dir || !fileApi?.listDir) {
                this.availableFiles = [];
                return;
            }
            try {
                const names = await fileApi.listDir(dir);
                this.availableFiles = (Array.isArray(names) ? names : [])
                    .filter(name => /\.csv$/i.test(name))
                    .sort((a, b) => a.localeCompare(b))
                    .map(name => pathApi?.join ? pathApi.join(dir, name) : `${dir}/${name}`);
            } catch {
                this.availableFiles = [];
            }
        }

        _refreshControlState() {
            this.directoryInput.val(this.settings.csvDirectory || defaultCsvDirectory());
            this.filePathInput.val(this.settings.csvPath || '');
            this.modeSelect.val(this.settings.plotMode || 'time_series');
            this._populateFileOptions();
            this._populateColumnOptions([]);
        }

        _populateFileOptions() {
            const selected = normalizePath(this.settings.csvPath);
            this.fileSelect.empty().append('<option value="">Select CSV file</option>');
            this.availableFiles.forEach(filePath => {
                const label = this._displayPath(filePath);
                this.fileSelect.append($('<option></option>').attr('value', filePath).text(label));
            });
            if (selected && !this.availableFiles.includes(selected)) {
                this.fileSelect.append($('<option></option>').attr('value', selected).text(this._displayPath(selected)));
            }
            this.fileSelect.val(selected || '');
        }

        _populateColumnOptions(columns) {
            const opts = Array.isArray(columns) ? columns : [];
            const fill = (select, value, placeholder) => {
                select.empty().append($('<option></option>').attr('value', '').text(placeholder));
                opts.forEach(column => {
                    select.append($('<option></option>').attr('value', column).text(column));
                });
                select.val(value || '');
            };
            fill(this.timeSelect, this.settings.timeColumn, 'Row index');
            fill(this.xSelect, this.settings.xVariable, 'Select X variable');
            fill(this.ySelect, this.settings.yVariable, 'Select Y variable');
        }

        _displayPath(filePath) {
            const cwd = defaultCsvDirectory();
            if (cwd && pathApi?.relative) {
                const rel = pathApi.relative(cwd, filePath);
                if (rel && !rel.startsWith('..')) return rel;
            }
            return filePath;
        }

        _syncFromSettings() {
            this.settings = { ...this.settings };
            this.lastConfigSignature = '';
            this.lastRenderedSignature = '';
        }

        _updateSettings(partial) {
            const updated = { ...this.settings, ...partial };
            this.settings = updated;
            const model = freeboard.getLiveModel?.();
            if (!model || typeof model.panes !== 'function') {
                this.onSettingsChanged(updated);
                return;
            }
            for (const pane of model.panes()) {
                for (const widget of pane.widgets()) {
                    if (widget.widgetInstance !== this) continue;
                    widget.settings(updated);
                    return;
                }
            }
            this.onSettingsChanged(updated);
        }

        onSettingsChanged(newSettings) {
            this.settings = { ...newSettings };
            this.lastConfigSignature = '';
            this.lastRenderedSignature = '';
            this._refreshControlState();
            this._startPolling();
        }

        _renderPlaceholder() {
            const signature = JSON.stringify({
                csvPath: this.settings.csvPath || '',
                plotMode: this.settings.plotMode || 'time_series',
                xVariable: this.settings.xVariable || '',
                yVariable: this.settings.yVariable || '',
                timeColumn: this.settings.timeColumn || '',
                xLabel: this.settings.xLabel || '',
                yLabel: this.settings.yLabel || '',
                xMin: this.settings.xMin || '',
                xMax: this.settings.xMax || '',
                yMin: this.settings.yMin || '',
                yMax: this.settings.yMax || ''
            });
            if (signature === this.lastRenderedSignature) return;
            this.lastRenderedSignature = signature;
            this._destroyPlot();
            this.chartHost.empty().append(this.emptyState);
        }

        _destroyPlot() {
            if (!this.plot) return;
            try { this.plot.destroy(); } catch {}
            this.plot = null;
        }

        onDispose() {
            if (this.pollTimer) clearInterval(this.pollTimer);
            this._destroyPlot();
            if (this._configHandler && freeboard?.off) {
                freeboard.off('config_updated', this._configHandler);
            }
        }

        getHeight() {
            return 8;
        }
    }
}());
