(function () {
    const api = window.api || null;
    const pathApi = api?.paths || null;
    const fileApi = api?.files || null;

    freeboard.loadWidgetPlugin({
        type_name: 'fast_frame_plot',
        display_name: 'Fast Frame Plot',
        category: 'Fast Frame',
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

    function parseAxisBound(value) {
        if (value === null || value === undefined || value === '') return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function hashText(text) {
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16);
    }

    function detectDelimiter(text) {
        const sample = String(text || '').split(/\r?\n/, 1)[0] || '';
        const delimiters = [':', ',', ';', '\t'];
        let best = ',';
        let bestCount = -1;
        delimiters.forEach((delimiter) => {
            const count = sample.split(delimiter).length - 1;
            if (count > bestCount) {
                best = delimiter;
                bestCount = count;
            }
        });
        return best;
    }

    function parseCsvText(text, delimiter = ',') {
        const rows = [];
        let current = [];
        let field = '';
        let inQuotes = false;

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (text[i + 1] === '"') {
                        field += '"';
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    field += ch;
                }
                continue;
            }
            if (ch === '"') {
                inQuotes = true;
                continue;
            }
            if (ch === delimiter) {
                current.push(field);
                field = '';
                continue;
            }
            if (ch === '\n') {
                current.push(field);
                rows.push(current);
                current = [];
                field = '';
                continue;
            }
            if (ch !== '\r') field += ch;
        }

        if (field.length || current.length) {
            current.push(field);
            rows.push(current);
        }
        return rows;
    }

    function buildCsvDataset(text) {
        const source = String(text || '');
        const rows = parseCsvText(source, detectDelimiter(source));
        if (!rows.length) {
            return { headers: [], rows: [], columns: {} };
        }
        const headers = rows[0].map((value, index) => normalizePath(value) || `column_${index + 1}`);
        const body = rows.slice(1).filter(row => row.some(cell => normalizePath(cell) !== ''));
        const columns = Object.fromEntries(headers.map(header => [header, []]));

        body.forEach((row, rowIndex) => {
            headers.forEach((header, colIndex) => {
                const raw = normalizePath(row[colIndex]);
                const numeric = raw === '' ? null : Number(raw);
                columns[header].push(Number.isFinite(numeric) ? numeric : null);
            });
            body[rowIndex] = row;
        });

        if (columns.duty_cycle && columns.V_high && !columns.V_Low_estim) {
            columns.V_Low_estim = columns.duty_cycle.map((value, idx) => {
                const duty = Number(value);
                const high = Number(columns.V_high[idx]);
                return Number.isFinite(duty) && Number.isFinite(high) ? duty * high : null;
            });
            headers.push('V_Low_estim');
        }

        return { headers, rows: body, columns };
    }

    class FastFramePlot {
        constructor(settings) {
            this.settings = { ...settings };
            this.pollTimer = null;
            this.plot = null;
            this.lastConfigSignature = '';
            this.lastRenderedSignature = '';
            this.lastFileSignature = '';
            this.lastLoadedAt = null;
            this.availableFiles = [];
            this.availableColumns = [];
            this.dataset = null;
            this.container = $('<div class="fast-frame-plot h-100 overflow-auto p-2"></div>');
            this.status = $('<div class="small text-muted border rounded p-2 mb-2">Select a CSV file to plot.</div>');
            this.summary = $('<div class="small text-muted border rounded p-2 mb-2"></div>');
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
            this.timeWrap = null;
            this.xWrap = null;
            this._configHandler = () => this._syncFromSettings();

            if (freeboard?.on) freeboard.on('config_updated', this._configHandler);
            if (freeboard?.addStyle) {
                freeboard.addStyle('.fast-frame-plot-controls label', 'font-size:12px;color:#aaa;margin-bottom:4px;');
                freeboard.addStyle('.fast-frame-plot .fast-frame-control-grid', 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;');
                freeboard.addStyle('.fast-frame-plot .fast-frame-control-grid .full-span', 'grid-column:1 / -1;');
                freeboard.addStyle('.fast-frame-plot .fast-frame-plot-host', 'min-height:260px;');
                freeboard.addStyle('.fast-frame-plot .is-hidden', 'display:none;');
            }
        }

        render(containerElement) {
            this._buildControls();
            this.container.empty().append(this.status, this.summary, this.controls, this.chartHost);
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
            this.timeWrap = this._makeControl('Time Column', this.timeSelect);
            this.xWrap = this._makeControl('X Variable', this.xSelect);
            grid.append(this.timeWrap);
            grid.append(this.xWrap);
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
            await this._reloadCsvData();
            this._reconcileSelections();
            this._refreshControlState();
            const selected = normalizePath(this.settings.csvPath);
            if (!selected) {
                this.status.text('Select a CSV file to plot.');
                this._renderPlaceholder();
                return;
            }
            if (!this.dataset) {
                this.status.text(`Unable to parse ${this._displayPath(selected)}.`);
                this._renderPlaceholder();
                return;
            }
            const invalid = this._invalidSelections();
            if (invalid.length) {
                this.status.text(`Missing column selection: ${invalid.join(', ')}.`);
                this._renderPlaceholder();
                return;
            }
            this.status.text(`Loaded ${this.dataset.rows.length} rows from ${this._displayPath(selected)}.`);
            this._renderPlot();
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
            this._populateColumnOptions(this.availableColumns);
            const xyMode = (this.settings.plotMode || 'time_series') === 'xy';
            this.timeWrap?.toggleClass('is-hidden', xyMode);
            this.xWrap?.toggleClass('is-hidden', !xyMode);
            this.summary.text(this._summaryText());
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

        _summaryText() {
            const mode = this.settings.plotMode || 'time_series';
            const file = this.settings.csvPath ? this._displayPath(this.settings.csvPath) : 'none';
            if (mode === 'xy') {
                return `File: ${file} | Mode: X vs Y | X: ${this.settings.xVariable || '--'} | Y: ${this.settings.yVariable || '--'} | Updated: ${this._updatedLabel()}`;
            }
            return `File: ${file} | Mode: Y vs Time | Time: ${this.settings.timeColumn || 'Row index'} | Y: ${this.settings.yVariable || '--'} | Updated: ${this._updatedLabel()}`;
        }

        _updatedLabel() {
            return this.lastLoadedAt ? new Date(this.lastLoadedAt).toLocaleTimeString() : '--';
        }

        _syncFromSettings() {
            this.settings = { ...this.settings };
            this.lastConfigSignature = '';
            this.lastRenderedSignature = '';
            this.lastFileSignature = '';
            this.lastLoadedAt = null;
        }

        async _reloadCsvData() {
            const filePath = normalizePath(this.settings.csvPath);
            if (!filePath || !fileApi?.readText) {
                this.dataset = null;
                this.availableColumns = [];
                this.lastFileSignature = '';
                this.lastLoadedAt = null;
                return;
            }
            try {
                const text = await fileApi.readText(filePath);
                const signature = `${text.length}:${hashText(text)}`;
                if (signature === this.lastFileSignature) return;
                this.dataset = buildCsvDataset(text);
                this.availableColumns = this.dataset.headers.filter(header => header !== 'k_acquire');
                this.lastFileSignature = signature;
                this.lastRenderedSignature = '';
                this.lastLoadedAt = Date.now();
            } catch {
                this.dataset = null;
                this.availableColumns = [];
                this.lastFileSignature = '';
                this.lastLoadedAt = null;
            }
        }

        _reconcileSelections() {
            if (!this.dataset) return;
            const next = {};
            const columns = this.availableColumns.slice();
            const mode = this.settings.plotMode || 'time_series';
            const has = (name) => !!name && columns.includes(name);
            const preferredTime = has(this.settings.timeColumn)
                ? this.settings.timeColumn
                : (columns.includes('time_ms') ? 'time_ms' : '');
            const preferredY = has(this.settings.yVariable)
                ? this.settings.yVariable
                : columns.find(column => column !== preferredTime) || '';
            const preferredX = mode === 'xy'
                ? (has(this.settings.xVariable)
                    ? this.settings.xVariable
                    : columns.find(column => column !== preferredY) || '')
                : this.settings.xVariable || '';

            if ((this.settings.timeColumn || '') !== preferredTime) next.timeColumn = preferredTime;
            if ((this.settings.yVariable || '') !== preferredY) next.yVariable = preferredY;
            if ((this.settings.xVariable || '') !== preferredX) next.xVariable = preferredX;

            if (Object.keys(next).length) {
                this.settings = { ...this.settings, ...next };
                this._persistCurrentSettings();
            }
        }

        _invalidSelections() {
            if (!this.dataset) return [];
            const missing = [];
            const mode = this.settings.plotMode || 'time_series';
            const has = (name) => !name || this.availableColumns.includes(name);
            if (mode === 'xy') {
                if (!this.settings.xVariable) missing.push('X variable');
                else if (!has(this.settings.xVariable)) missing.push(`X variable (${this.settings.xVariable})`);
            } else if (this.settings.timeColumn && !has(this.settings.timeColumn)) {
                missing.push(`Time column (${this.settings.timeColumn})`);
            }
            if (!this.settings.yVariable) missing.push('Y variable');
            else if (!has(this.settings.yVariable)) missing.push(`Y variable (${this.settings.yVariable})`);
            return missing;
        }

        _updateSettings(partial) {
            const updated = { ...this.settings, ...partial };
            this.settings = updated;
            this._persistCurrentSettings();
        }

        _persistCurrentSettings() {
            const updated = { ...this.settings };
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
            this.lastFileSignature = '';
            this.lastLoadedAt = null;
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
                fileSignature: this.lastFileSignature || '',
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

        _renderPlot() {
            const payload = this._buildPlotPayload();
            if (!payload) {
                this._renderPlaceholder();
                return;
            }
            const signature = JSON.stringify({
                csvPath: this.settings.csvPath || '',
                plotMode: this.settings.plotMode || 'time_series',
                xVariable: this.settings.xVariable || '',
                yVariable: this.settings.yVariable || '',
                timeColumn: this.settings.timeColumn || '',
                fileSignature: this.lastFileSignature || '',
                sample: this._sampleSignature(payload.data),
                xLabel: payload.xLabel,
                yLabel: payload.yLabel,
                xMin: payload.scales.x.min,
                xMax: payload.scales.x.max,
                yMin: payload.scales.y.min,
                yMax: payload.scales.y.max
            });
            if (signature === this.lastRenderedSignature) return;
            this.lastRenderedSignature = signature;
            this._destroyPlot();
            this.chartHost.empty();

            const host = $('<div class="fast-frame-plot-canvas"></div>');
            this.chartHost.append(host);
            const opts = {
                title: this.settings.title || 'Fast Frame Plot',
                width: Math.max(320, this.chartHost.width() || this.container.width() || 640),
                height: Math.max(260, this.chartHost.height() || 320),
                legend: { show: true },
                scales: payload.scales,
                axes: [
                    { stroke: '#666', grid: { show: true }, label: payload.xLabel },
                    { stroke: '#666', grid: { show: true }, label: payload.yLabel }
                ],
                series: [
                    { label: payload.xLabel },
                    {
                        label: payload.seriesLabel,
                        stroke: '#4e79a7',
                        width: 2,
                        points: { show: payload.points }
                    }
                ]
            };
            this.plot = new uPlot(opts, payload.data, host[0]);
        }

        _buildPlotPayload() {
            if (!this.dataset) return null;
            const mode = this.settings.plotMode || 'time_series';
            const yName = this.settings.yVariable;
            const yValues = this.dataset.columns[yName];
            if (!Array.isArray(yValues)) return null;

            if (mode === 'xy') {
                const xName = this.settings.xVariable;
                const xValues = this.dataset.columns[xName];
                if (!Array.isArray(xValues)) return null;
                const pairs = xValues.map((x, index) => [x, yValues[index]])
                    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
                return {
                    data: [pairs.map(pair => pair[0]), pairs.map(pair => pair[1])],
                    xLabel: this.settings.xLabel || xName || 'X',
                    yLabel: this.settings.yLabel || yName || 'Y',
                    seriesLabel: `${yName} vs ${xName}`,
                    points: { show: true, size: 6 },
                    scales: {
                        x: { time: false, min: parseAxisBound(this.settings.xMin), max: parseAxisBound(this.settings.xMax) },
                        y: { min: parseAxisBound(this.settings.yMin), max: parseAxisBound(this.settings.yMax) }
                    }
                };
            }

            const timeName = this.settings.timeColumn;
            const xValues = Array.isArray(this.dataset.columns[timeName])
                ? this.dataset.columns[timeName].map(value => Number.isFinite(value) ? value : null)
                : yValues.map((_value, index) => index);
            return {
                data: [xValues, yValues],
                xLabel: this.settings.xLabel || (timeName || 'Sample'),
                yLabel: this.settings.yLabel || yName || 'Value',
                seriesLabel: yName,
                points: { show: false },
                scales: {
                    x: { time: false, min: parseAxisBound(this.settings.xMin), max: parseAxisBound(this.settings.xMax) },
                    y: { min: parseAxisBound(this.settings.yMin), max: parseAxisBound(this.settings.yMax) }
                }
            };
        }

        _sampleSignature(data) {
            return data.map(series => {
                if (!Array.isArray(series) || !series.length) return null;
                return [series[0], series[Math.floor(series.length / 2)], series[series.length - 1]];
            });
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
