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
                    case 'get-serial-headers':
                        return serial && serial.getHeaders ? serial.getHeaders(payload.path, payload.type) : null;
                    case 'get-serial-colors':
                        return serial && serial.getColors ? serial.getColors(payload.path, payload.type) : null;
                    case 'get-fast-dataset':
                        return serial && serial.getFastDataset ? serial.getFastDataset(payload.path) : null;
                    case 'get-serial-buffer':
                        return serial && serial.getBuffer ? serial.getBuffer(payload.path) : null;
                    case 'can-aggregate-start':
                        return can && can.aggregateStart ? can.aggregateStart(payload) : null;
                    case 'can-aggregate-snapshot':
                        return can && can.aggregateSnapshot ? can.aggregateSnapshot(payload) : null;
                    case 'can-aggregate-set-debug':
                        return can && can.aggregateSetDebug ? can.aggregateSetDebug(payload) : null;
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
        type_name: "time_plot_uplot",
        display_name: "Time Plot Widget",
        category: "Plots",
        description: "Realtime uPlot-based chart. Accepts streaming values or a full dataset",
        icon: "chart-line",
        external_scripts: [
            "https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.iife.min.js",
            "https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.min.css"
        ],
        settings: [
            { name: "title", display_name: "Title", type: "text" }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new TimePlotUPlot(settings));
        }
    });

class TimePlotUPlot {
        constructor(settings) {
            this.settings = settings;
            // Keep the chart area stable and render channel values in a separate aligned grid.
            this.container = $('<div class="uplot-widget-shell"></div>');
            this.chartHost = $('<div class="uplot-chart-host"></div>');
            this.summaryHost = $('<div class="uplot-source-summary small text-muted border rounded p-2"></div>');
            this.resizeHandle = $('<div class="uplot-resize-handle" title="Drag to resize plot"></div>');
            this.readoutHost = $('<div class="uplot-readout-grid"></div>');
            this.paused = false;
            this.pauseBtn = $('<button class="btn btn-sm btn-outline-secondary" title="Pause / resume data">⏸ Pause</button>');
            this.exportBtn = $('<button class="btn btn-sm btn-outline-secondary" title="Export visible data to CSV">Export CSV</button>');
            this.controlsRow = $('<div class="d-flex justify-content-end" style="flex:0 0 auto;"></div>');
            this.controlsRow.append(this.pauseBtn, this.exportBtn);
            this.pauseBtn.on('click', () => {
                this.paused = !this.paused;
                this.pauseBtn.text(this.paused ? '▶ Resume' : '⏸ Pause');
            });
            this.exportBtn.on('click', () => this._exportCsv());
            this.container.append(this.chartHost, this.summaryHost, this.readoutHost, this.controlsRow, this.resizeHandle);
            this._bindRadialContextMenu();
            this.plot = null;
            this.seriesCount = 0;
            this.dataBuffer = [[], []]; // [timestamps, [series1, series2, ...]]
            this.maxPoints = 2000;
            this.lastRender = 0;
            this._resizeObs = null;
            this._resizeRAF = 0;
            this._dragCleanup = null;
            this.pullTimer = null;
            this.localMode = false; // when true, we poll values ourselves
            this.plotHeightPx = null;
            this.hostElement = null;
            this.subSectionElement = null;
            this.sectionElement = null;
            this.debugId = `uplot-${Math.random().toString(36).slice(2, 8)}`;
            this.seriesDefs = this._parseSeriesDefs((typeof settings.seriesDefs === 'function' ? settings.seriesDefs() : settings.seriesDefs));
            // Persist helper widget preference so we can optionally auto-spawn related widgets.
            this.helperWidgets = this._resolveHelperWidgets(settings);

            this.ipc = ipcShim || window.require?.('electron')?.ipcRenderer;
            this.headersByDs = {};
            this.colorsByDs = {};
            this.dsMap = [];
            this.datasourceName = (typeof settings.datasource === 'function' ? settings.datasource() : settings.datasource) || '';
            // channelIndices may come as array or JSON string; normalize to array of ints
            const chFromSettings = (typeof settings.channelIndices === 'function' ? settings.channelIndices() : settings.channelIndices);
            this.channelIndices = Array.isArray(chFromSettings)
                ? chFromSettings.map(x => parseInt(x, 10)).filter(n => Number.isFinite(n))
                : (typeof chFromSettings === 'string' && chFromSettings.trim().startsWith('[')
                    ? (function () { try { return JSON.parse(chFromSettings).map(x => parseInt(x, 10)).filter(n => Number.isFinite(n)); } catch { return []; } })()
                    : []);
            this.lastHeaderCheck = 0;
            this._configHandler = () => this._maybeUpdateHeaders(true);
            freeboard.on && freeboard.on('config_updated', this._configHandler);
            this._detectDatasource();
            this.selection = { ds: this.datasourceName || '', type: '', device: null, deviceUid: null, var: null, op: 'identity', param: 0 };
            this.selectionB = null;
            this.selectionBState = { device: null, deviceUid: null };
            this.deviceMeta = {};
            this.deviceMetaB = {};
            this.axisLeftMarginPx = 56;
            this.axisBottomMarginPx = 30;
        }

        // Pilot: right-click the plot area to quick-add a channel (the only
        // interaction still worth a drill-down); hover either axis margin
        // for an inline quick-edit panel instead -- Y-axis (Y Label/Min/Max)
        // on the left margin, X-axis (Duration/Refresh Rate) on the bottom
        // margin -- since both are just a handful of fixed fields, hovering
        // straight to them beats right-click, pick "Axis", pick a field.
        // Double-click a channel's readout label or the chart title to
        // rename it in place; right-click a channel's color swatch for a
        // 10-color carrousel.
        _bindRadialContextMenu() {
            this.chartHost.on('contextmenu', (e) => {
                if (!window.RadialContextMenu) return;
                e.preventDefault();
                e.stopPropagation();
                window.RadialContextMenu.show({ x: e.clientX, y: e.clientY, root: this._buildChannelMenuRoot() });
            });

            this._bindChartHover();
            this._bindReadoutInteractions();
            this._bindTitleRename();
        }

        _ensureHoverStylesInjected() {
            if (this._hoverHintEl) return;
            this._hoverHintEl = $('<div class="uplot-radial-hover-hint"></div>').appendTo(document.body).hide();
            if (!(freeboard && typeof freeboard.addStyle === 'function')) return;
            freeboard.addStyle('.uplot-radial-hover-hint', 'position:fixed;z-index:9999;pointer-events:none;background:#20232a;color:#e8e8e8;border:1px solid #454b55;border-radius:4px;padding:2px 8px;font-size:11px;white-space:nowrap;');
            freeboard.addStyle('html.theme-light .uplot-radial-hover-hint', 'background:#ffffff;color:#1a1a1a;border-color:#c8c8c8;');
            // The system pointer already reads as clickable -- no need for a
            // hand glyph in the hint text on top of it.
            freeboard.addStyle('.uplot-chart-host, .uplot-widget-shell', 'cursor:pointer;');
            freeboard.addStyle('.uplot-readout-label, .uplot-readout-swatch, .u-title', 'cursor:pointer;');
            // Shared by the channel-label and title floating rename inputs --
            // both live in document.body, independent of whatever DOM churn
            // (readout re-renders, plot resets) is happening underneath them.
            freeboard.addStyle('.uplot-floating-input', 'z-index:9999;background:#141619;border:1px solid #6a90ff;border-radius:4px;color:#e8e8e8;font-size:inherit;padding:0 2px;text-align:center;');
            freeboard.addStyle('html.theme-light .uplot-floating-input', 'background:#ffffff;color:#1a1a1a;');
            freeboard.addStyle('.uplot-axis-hover-panel', 'position:fixed;z-index:9999;background:#20232a;border:1px solid #454b55;border-radius:6px;padding:6px 8px;display:flex;flex-direction:column;gap:4px;box-shadow:0 2px 8px rgba(0,0,0,0.4);');
            freeboard.addStyle('html.theme-light .uplot-axis-hover-panel', 'background:#ffffff;border-color:#c8c8c8;box-shadow:0 2px 8px rgba(0,0,0,0.15);');
            freeboard.addStyle('.uplot-axis-hover-panel-row', 'display:flex;align-items:center;gap:6px;font-size:11px;color:#c8c8c8;white-space:nowrap;');
            freeboard.addStyle('html.theme-light .uplot-axis-hover-panel-row', 'color:#444;');
            freeboard.addStyle('.uplot-axis-hover-panel-row input', 'width:80px;background:#141619;border:1px solid #454b55;border-radius:4px;color:#e8e8e8;font-size:11px;padding:2px 4px;');
            freeboard.addStyle('html.theme-light .uplot-axis-hover-panel-row input', 'background:#f5f5f5;color:#1a1a1a;border-color:#c8c8c8;');
        }

        // Hovering the plot area shows a small "Add Channel" hint (still a
        // right-click + drill-down, since which channel is genuinely a
        // choice). Hovering either axis margin shows its quick-edit panel
        // directly. A short hide delay bridges the gap between the margin
        // and the panel itself, which sits outside chartHost's own DOM.
        _bindChartHover() {
            this._ensureHoverStylesInjected();
            let hidePanelTimer = null;
            this._cancelAxisPanelHide = () => { if (hidePanelTimer) { clearTimeout(hidePanelTimer); hidePanelTimer = null; } };
            this._scheduleAxisPanelHide = () => {
                this._cancelAxisPanelHide();
                hidePanelTimer = setTimeout(() => this._hideAxisPanels(), 200);
            };

            this.chartHost.on('mousemove', (e) => {
                const zone = this._chartZoneAt(e.clientX, e.clientY);
                if (zone === 'yAxis') {
                    this._cancelAxisPanelHide();
                    this._hoverHintEl.hide();
                    this._showYAxisPanel();
                } else if (zone === 'xAxis') {
                    this._cancelAxisPanelHide();
                    this._hoverHintEl.hide();
                    this._showXAxisPanel();
                } else {
                    this._scheduleAxisPanelHide();
                    this._hoverHintEl.text('Add Channel').css({ left: (e.clientX + 14) + 'px', top: (e.clientY + 14) + 'px' }).show();
                }
            });
            this.chartHost.on('mouseleave', () => {
                this._hoverHintEl.hide();
                this._scheduleAxisPanelHide();
            });
        }

        _hideAxisPanels() {
            if (this._yAxisPanel) { this._yAxisPanel.remove(); this._yAxisPanel = null; }
            if (this._xAxisPanel) { this._xAxisPanel.remove(); this._xAxisPanel = null; }
        }

        _axisPanelRow(type, label, value, onCommit) {
            const row = $('<div class="uplot-axis-hover-panel-row"></div>');
            const input = $(`<input type="${type === 'number' ? 'number' : 'text'}">`);
            if (value !== null && value !== undefined) input.val(value);
            row.append($('<span></span>').text(label), input);
            input.on('mousedown click', (e) => e.stopPropagation());
            input.on('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') { e.preventDefault(); input.trigger('blur'); }
            });
            input.on('blur', () => onCommit(input.val()));
            return row;
        }

        _showYAxisPanel() {
            if (this._yAxisPanel) return;
            const rect = this.chartHost[0].getBoundingClientRect();
            const panel = $('<div class="uplot-axis-hover-panel"></div>')
                .css({ left: (rect.left + 6) + 'px', top: (rect.top + rect.height / 2 - 45) + 'px' })
                .appendTo(document.body);
            panel.append(this._axisPanelRow('text', 'Y Label', this._settingValue('yLabel') || '', (v) => this._quickSetSetting('yLabel', v)));
            panel.append(this._axisPanelRow('number', 'Y Min', this._settingValue('yMin'), (v) => this._quickSetSetting('yMin', v === '' ? null : Number(v))));
            panel.append(this._axisPanelRow('number', 'Y Max', this._settingValue('yMax'), (v) => this._quickSetSetting('yMax', v === '' ? null : Number(v))));
            panel.on('mouseenter', () => this._cancelAxisPanelHide());
            panel.on('mouseleave', () => this._scheduleAxisPanelHide());
            this._yAxisPanel = panel;
        }

        _showXAxisPanel() {
            if (this._xAxisPanel) return;
            const rect = this.chartHost[0].getBoundingClientRect();
            const panel = $('<div class="uplot-axis-hover-panel"></div>')
                .css({ left: (rect.left + rect.width / 2 - 90) + 'px', top: (rect.bottom - 70) + 'px' })
                .appendTo(document.body);
            panel.append(this._axisPanelRow('number', 'Duration (ms)', this._settingValue('duration'), (v) => this._quickSetSetting('duration', v === '' ? null : Number(v))));
            panel.append(this._axisPanelRow('number', 'Refresh Rate (ms)', this._settingValue('refreshRate'), (v) => this._quickSetSetting('refreshRate', v === '' ? null : Number(v))));
            panel.on('mouseenter', () => this._cancelAxisPanelHide());
            panel.on('mouseleave', () => this._scheduleAxisPanelHide());
            this._xAxisPanel = panel;
        }

        // Double-click a channel's name in the readout row to rename it;
        // right-click its color swatch for a radial carrousel of the 10
        // ColorBlind10 palette colors to pick a new one from. Bound once via
        // delegation on readoutHost (a stable parent), since _renderReadouts()
        // rebuilds its children wholesale on every poll.
        _bindReadoutInteractions() {
            if (!this.readoutHost) return;
            this.readoutHost.on('dblclick', '.uplot-readout-label', (e) => {
                const idx = parseInt($(e.currentTarget).closest('.uplot-readout-item').attr('data-idx'), 10);
                if (Number.isFinite(idx)) this._startRenameChannel(idx, e.currentTarget);
            });
            this.readoutHost.on('contextmenu', '.uplot-readout-swatch', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const idx = parseInt($(e.currentTarget).closest('.uplot-readout-item').attr('data-idx'), 10);
                if (Number.isFinite(idx)) this._openColorCarrousel(idx, e.clientX, e.clientY);
            });
        }

        // Double-click the chart's own title (uPlot's .u-title) to rename it.
        _bindTitleRename() {
            this.chartHost.on('dblclick', '.u-title', (e) => {
                e.stopPropagation();
                this._startRenameTitle(e.currentTarget);
            });
        }

        _chartZoneAt(clientX, clientY) {
            const rect = this.chartHost[0].getBoundingClientRect();
            const relX = clientX - rect.left;
            const relY = clientY - rect.top;
            if (relX < this.axisLeftMarginPx) return 'yAxis';
            if (relY > (rect.height - this.axisBottomMarginPx)) return 'xAxis';
            return 'channel';
        }

        _findWidgetModel() {
            const model = freeboard.getLiveModel?.();
            if (!model || typeof model.panes !== 'function') return null;
            let found = null;
            model.panes().forEach((pane) => {
                (pane.widgets ? pane.widgets() : []).forEach((w) => {
                    if (w.widgetInstance === this) found = w;
                });
            });
            return found;
        }

        _settingValue(name) {
            const widgetModel = this._findWidgetModel();
            const settings = widgetModel ? (widgetModel.settings() || {}) : this.settings;
            const raw = settings ? settings[name] : undefined;
            return typeof raw === 'function' ? raw() : raw;
        }

        _quickSetSetting(name, value) {
            const widgetModel = this._findWidgetModel();
            const shared = window.ModularPlotEditorShared;
            if (!widgetModel || !shared) return;
            const settings = widgetModel.settings() || {};
            shared.commitWidgetSettings(widgetModel, { ...settings, [name]: value });
        }

        // Adds a channel directly, with no dialog: the next palette color and
        // the identity ("x") operation, matching the full editor's own
        // defaults for a freshly-added channel. Anything more specific
        // (a custom op, color, or label) still goes through the wrench.
        _quickAddChannel(sourceDef) {
            const widgetModel = this._findWidgetModel();
            const shared = window.ModularPlotEditorShared;
            if (!widgetModel || !shared) return;
            const settings = widgetModel.settings() || {};
            const existing = shared.parseSeriesDefs(settings.seriesDefs);
            const themes = shared.getColorThemes();
            const paletteName = settings.colorPalette || 'ColorBlind10';
            const fallback = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc949'];
            const palette = (Array.isArray(themes[paletteName]) && themes[paletteName].length) ? themes[paletteName] : fallback;
            const color = palette[existing.length % palette.length];
            const newDef = { label: '', op: 'identity', param: 0, color, a: sourceDef, b: null };
            shared.commitWidgetSettings(widgetModel, { ...settings, seriesDefs: [...existing, newDef] });
        }

        _updateSeriesDefAt(idx, patch) {
            const widgetModel = this._findWidgetModel();
            const shared = window.ModularPlotEditorShared;
            if (!widgetModel || !shared) return;
            const settings = widgetModel.settings() || {};
            const existing = shared.parseSeriesDefs(settings.seriesDefs);
            if (!existing[idx]) return;
            const updated = existing.map((def, i) => (i === idx ? { ...def, ...patch } : def));
            shared.commitWidgetSettings(widgetModel, { ...settings, seriesDefs: updated });
        }

        _setChannelLabel(idx, label) {
            this._updateSeriesDefAt(idx, { label });
        }

        _setChannelColor(idx, color) {
            this._updateSeriesDefAt(idx, { color });
        }

        // Swaps a channel's readout label for a small text input in place --
        // Enter/blur commits, Escape cancels back to the plain label.
        // A floating input positioned over the label rather than swapped
        // into it: _renderReadouts() rebuilds readoutHost's children
        // wholesale on every poll tick, which was wiping out (and stealing
        // focus from) an in-place input mid-keystroke. Living in
        // document.body instead, this survives that churn untouched.
        _startRenameChannel(idx, labelEl) {
            const widgetModel = this._findWidgetModel();
            const shared = window.ModularPlotEditorShared;
            if (!widgetModel || !shared) return;
            const existing = shared.parseSeriesDefs((widgetModel.settings() || {}).seriesDefs);
            const def = existing[idx];
            if (!def) return;

            const rect = labelEl.getBoundingClientRect();
            const placeholderText = $(labelEl).text();
            const input = $('<input type="text" class="uplot-floating-input">')
                .val(def.label || '')
                .attr('placeholder', placeholderText)
                .css({ position: 'fixed', left: rect.left + 'px', top: rect.top + 'px', width: Math.max(rect.width, 60) + 'px', height: rect.height + 'px' })
                .appendTo(document.body);

            let done = false;
            const commit = () => {
                if (done) return;
                done = true;
                input.remove();
                this._setChannelLabel(idx, input.val());
            };
            const cancel = () => {
                if (done) return;
                done = true;
                input.remove();
            };
            input.on('click', (e) => e.stopPropagation());
            input.on('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') { e.preventDefault(); commit(); }
                else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            });
            input.on('blur', () => commit());
            requestAnimationFrame(() => { input.trigger('focus'); input[0].select(); });
        }

        // Same floating-input approach for the chart's own title (uPlot's
        // .u-title): title changes don't churn that element the way readout
        // polling does, but keeping one consistent pattern for "rename in
        // place, survive whatever re-renders underneath" is simpler than
        // reasoning about which elements are safe to edit in place.
        _startRenameTitle(titleEl) {
            const rect = titleEl.getBoundingClientRect();
            const current = this._settingValue('title') || '';
            const input = $('<input type="text" class="uplot-floating-input">')
                .val(current)
                .css({ position: 'fixed', left: rect.left + 'px', top: rect.top + 'px', width: Math.max(rect.width, 80) + 'px', height: rect.height + 'px' })
                .appendTo(document.body);

            let done = false;
            const commit = () => {
                if (done) return;
                done = true;
                input.remove();
                this._quickSetSetting('title', input.val());
            };
            const cancel = () => {
                if (done) return;
                done = true;
                input.remove();
            };
            input.on('click', (e) => e.stopPropagation());
            input.on('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') { e.preventDefault(); commit(); }
                else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
            });
            input.on('blur', () => commit());
            requestAnimationFrame(() => { input.trigger('focus'); input[0].select(); });
        }

        // A ring of the 10 ColorBlind10 palette colors around the click
        // point, no category step -- there's nothing to categorize.
        _openColorCarrousel(idx, clientX, clientY) {
            const shared = window.ModularPlotEditorShared;
            if (!shared || !window.RadialContextMenu) return;
            const themes = shared.getColorThemes();
            const fallback = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ac'];
            const palette = (Array.isArray(themes.ColorBlind10) && themes.ColorBlind10.length) ? themes.ColorBlind10 : fallback;
            window.RadialContextMenu.show({
                x: clientX, y: clientY,
                items: palette.map((hex) => ({ id: hex, label: hex, color: hex, onSelect: () => this._setChannelColor(idx, hex) }))
            });
        }

        _dsLatestData(dsName) {
            const live = freeboard.getLiveModel?.();
            const dsModel = live && typeof live.datasources === 'function'
                ? live.datasources().find((d) => { try { return d.name() === dsName; } catch (e) { return false; } })
                : null;
            return (dsModel && dsModel.latestData) ? (dsModel.latestData() || {}) : {};
        }

        // Datasource -> (Measurements | Others [-> Config | Calibration | ...])
        // -> leaf variable names, for ThingSet-type datasources -- their
        // flat leaf lists otherwise run into the dozens, which isn't fun to
        // scroll through as a flyout menu. Simple indexed-channel types
        // (serial, fast-frame, signal generator, CAN) skip straight from the
        // datasource to their (much shorter) channel list.
        _buildChannelMenuRoot() {
            const shared = window.ModularPlotEditorShared;
            if (!shared) return [];
            return shared.listDatasources().map((ds) => {
                const dsType = shared.getDatasourceType(ds.name);
                const isThingSet = dsType === 'thingset_serial_datasource' || dsType === 'owntech_thingset_datasource';
                return {
                    id: ds.name, label: ds.name,
                    ...(isThingSet
                        ? { children: () => this._buildThingSetCategoryNodes(ds.name, dsType) }
                        : { items: () => this._buildSimpleLeafItems(ds.name, dsType) })
                };
            });
        }

        _buildThingSetCategoryNodes(dsName, dsType) {
            const data = this._dsLatestData(dsName);
            const values = data.values || {};
            const buckets = {};
            Object.keys(values).forEach((path) => {
                const clean = path.replace(/^\/+/, '');
                if (!clean) return;
                const segments = clean.split('/');
                // A single-segment path is a scalar living directly on the
                // tree root (e.g. rStatus) rather than nested under a real
                // named group -- there's no meaningful group to bucket it
                // into, so it's left out of this menu rather than becoming a
                // fake single-item "group" named after itself.
                if (segments.length < 2) return;
                const top = segments[0];
                const label = segments[segments.length - 1];
                (buckets[top] = buckets[top] || []).push({ path, label });
            });
            const nodes = [];
            if (buckets.Measurements) {
                nodes.push({ id: 'Measurements', label: 'Measurements', items: this._leafEntriesToItems(dsName, dsType, buckets.Measurements) });
            }
            const otherGroups = Object.keys(buckets).filter((k) => k !== 'Measurements').sort();
            if (otherGroups.length) {
                nodes.push({
                    id: 'Others', label: 'Others',
                    children: otherGroups.map((group) => ({
                        id: group, label: group,
                        items: this._leafEntriesToItems(dsName, dsType, buckets[group])
                    }))
                });
            }
            return nodes;
        }

        _leafEntriesToItems(dsName, dsType, entries) {
            return entries
                .slice()
                .sort((a, b) => a.label.localeCompare(b.label))
                .map((entry) => ({
                    id: entry.path, label: entry.label,
                    onSelect: () => this._quickAddChannel({ ds: dsName, type: dsType, device: null, device_uid: null, var: entry.path })
                }));
        }

        async _buildSimpleLeafItems(dsName, dsType) {
            const shared = window.ModularPlotEditorShared;
            if (!shared || typeof shared.fetchDatasourceVariableOptions !== 'function') return [];
            const options = await shared.fetchDatasourceVariableOptions(dsName, '');
            const keepAsString = dsType === 'can_datasource';
            return options.map((opt) => ({
                id: String(opt.value), label: opt.label,
                onSelect: () => this._quickAddChannel({
                    ds: dsName, type: dsType, device: null, device_uid: null,
                    var: keepAsString ? opt.value : parseInt(opt.value, 10)
                })
            }));
        }

        _debugLog(event, payload = {}) {
            if (!window.console || !console.log) return;
            console.log('[uplot-debug]', {
                id: this.debugId,
                event,
                title: typeof this.settings.title === 'function' ? this.settings.title() : this.settings.title,
                ...payload
            });
        }

        _detectDatasource() {
            // Prefer explicit settings when present; otherwise try to infer from the 'data' expression
            this.datasourceName = (typeof this.settings.datasource === 'function' ? this.settings.datasource() : this.settings.datasource) || '';
            const chFromSettings = (typeof this.settings.channelIndices === 'function' ? this.settings.channelIndices() : this.settings.channelIndices);
            this.channelIndices = Array.isArray(chFromSettings)
                ? chFromSettings.map(x => parseInt(x, 10)).filter(n => Number.isFinite(n))
                : (typeof chFromSettings === 'string' && chFromSettings.trim().startsWith('[')
                    ? (function () { try { return JSON.parse(chFromSettings).map(x => parseInt(x, 10)).filter(n => Number.isFinite(n)); } catch { return []; } })()
                    : []);
            this.dsMap = [];
            if (!this.datasourceName && typeof this.settings.data === 'string') {
                const pattern = /datasources\["([^"\]]+)"\]\["y(\d+)"\]/g;
                let m;
                while ((m = pattern.exec(this.settings.data)) !== null) {
                    const ds = m[1];
                    const idx = parseInt(m[2], 10) - 1;
                    this.dsMap.push({ ds, idx });
                }
                if (this.dsMap.length) {
                    this.datasourceName = this.dsMap[0].ds;
                    this.channelIndices = this.dsMap.map(d => d.idx);
                } else {
                    const dsMatch = this.settings.data.match(/datasources\[["']([^"']+)["']\]/);
                    if (dsMatch) this.datasourceName = dsMatch[1];
                    const chanRe = /\["y(\d+)"\]/g;
                    while ((m = chanRe.exec(this.settings.data)) !== null) {
                        const idx = parseInt(m[1], 10) - 1;
                        if (!isNaN(idx)) this.channelIndices.push(idx);
                    }
                }
            }
        }

        _getDatasourceType(name) {
            const live = freeboard.getLiveModel?.();
            if (!live || typeof live.datasources !== 'function') return null;
            const list = live.datasources();
            for (const ds of list) {
                try {
                    if (ds.name && ds.name() === name) {
                        return ds.type?.();
                    }
                } catch (e) { /* ignore */ }
            }
            return null;
        }

        async _fetchHeaders(dsName) {
            if (!this.ipc || !dsName) return [];
            const dsSettings = freeboard.getDatasourceSettings(dsName) || {};
            const path = dsSettings.portPath || dsName;
            const type = this._getDatasourceType(dsName);
            try {
                const headers = await this.ipc.invoke('get-serial-headers', { path, type });
                return Array.isArray(headers) ? headers : [];
            } catch (e) {
                console.error('header fetch failed', e);
                return [];
            }
        }

        async _fetchColors(dsName) {
            if (!this.ipc || !dsName) return [];
            const dsSettings = freeboard.getDatasourceSettings(dsName) || {};
            const path = dsSettings.portPath || dsName;
            const type = this._getDatasourceType(dsName);
            try {
                const colors = await this.ipc.invoke('get-serial-colors', { path, type });
                if (Array.isArray(colors) && colors.length) return colors;
            } catch (e) {
                console.error('color fetch failed', e);
            }
            if (Array.isArray(dsSettings.headers)) {
                return dsSettings.headers.map(h => h.color || null);
            }
            return [];
        }

        async _maybeUpdateHeaders(force = false) {
            const now = Date.now();
            if (!force && now - this.lastHeaderCheck < 1000) return;
            this.lastHeaderCheck = now;

            const uniqueDs = [...new Set([this.datasourceName, ...this.dsMap.map(d => d.ds)])].filter(Boolean);
            let changed = false;
            for (const ds of uniqueDs) {
                if (!ds) continue;
                const hdrs = await this._fetchHeaders(ds);
                const cols = await this._fetchColors(ds);
                if (!_.isEqual(hdrs, this.headersByDs[ds])) {
                    this.headersByDs[ds] = hdrs;
                    changed = true;
                }
                if (!_.isEqual(cols, this.colorsByDs[ds])) {
                    this.colorsByDs[ds] = cols;
                    changed = true;
                }
            }

            if (changed) {
                this._renderSourceSummary();
                if (this.plot) this._resetPlot();
            }
        }

        async _exportCsv() {
            const timestamps = this.dataBuffer[0] || [];
            const headers = ['Time'];
            for (let i = 0; i < this.seriesCount; i++) headers.push(this._getSeriesLabel(i));
            const rows = [headers];
            for (let t = 0; t < timestamps.length; t++) {
                const row = [new Date(timestamps[t]).toISOString()];
                for (let i = 1; i <= this.seriesCount; i++) row.push(this.dataBuffer[i]?.[t]);
                rows.push(row);
            }
            await saveCsvExport(rows, `${buildTimestampStamp()}-time_plot.csv`, 'time_plot_csv');
        }

        _getSeriesLabel(idx) {
            if (Array.isArray(this.seriesDefs) && this.seriesDefs.length) {
                const def = this.seriesDefs[idx];
                if (def && def.label) return def.label;
            }
            const mapping = this.dsMap[idx] || {};
            const ds = mapping.ds ?? this.datasourceName;
            const chIdx = mapping.idx ?? this.channelIndices[idx] ?? idx;
            const headers = this.headersByDs[ds] || [];
            if (headers[chIdx]) return headers[chIdx];
            const alpha = String.fromCharCode(65 + (chIdx % 26));
            const suffix = chIdx >= 26 ? ` ${Math.floor(chIdx / 26) + 1}` : '';
            return `Channel ${alpha}${suffix}`;
        }

        _getSeriesColor(idx) {
            const def = Array.isArray(this.seriesDefs) ? this.seriesDefs[idx] : null;
            if (def && def.color) return def.color;
            const mapping = this.dsMap[idx] || {};
            const ds = mapping.ds ?? this.datasourceName;
            const chIdx = mapping.idx ?? this.channelIndices[idx] ?? idx;
            const colors = this.colorsByDs[ds] || [];
            if (colors[chIdx]) return colors[chIdx];
            const paletteThemes = {
                ColorBlind10: (typeof ColorBlind10 !== "undefined") ? ColorBlind10 : [],
                OfficeClassic6: (typeof OfficeClassic6 !== "undefined") ? OfficeClassic6 : [],
                HueCircle19: (typeof HueCircle19 !== "undefined") ? HueCircle19 : [],
                Tableau20: (typeof Tableau20 !== "undefined") ? Tableau20 : []
            };
            const paletteName = typeof this.settings.colorPalette === 'function' ? this.settings.colorPalette() : this.settings.colorPalette;
            const configuredPalette = paletteName && Array.isArray(paletteThemes[paletteName]) ? paletteThemes[paletteName] : [];
            // Keep the runtime palette override as a fallback for legacy helpers.
            const palette = configuredPalette.length
                ? configuredPalette
                : (Array.isArray(window.PlotColorPalette) && window.PlotColorPalette.length
                    ? window.PlotColorPalette
                    : ((typeof ColorBlind10 !== "undefined") ? ColorBlind10 : null));
            if (palette && palette.length) return palette[idx % palette.length];
            return `hsl(${(idx * 60) % 360}, 70%, 50%)`;
        }

        _formatIndexedChannelLabel(dsName, index) {
            const headers = this.headersByDs[dsName] || [];
            if (headers[index]) return headers[index];
            const alpha = String.fromCharCode(65 + (index % 26));
            const suffix = index >= 26 ? ` ${Math.floor(index / 26) + 1}` : '';
            return `Channel ${alpha}${suffix}`;
        }

        _formatSourceReference(sourceDef, fallbackIndex) {
            if (!sourceDef || !sourceDef.ds) {
                return fallbackIndex === undefined ? 'Unknown source' : this._formatIndexedChannelLabel(this.datasourceName, fallbackIndex);
            }
            const dsType = sourceDef.type || this._getDatasourceType(sourceDef.ds) || '';
            if (dsType === 'can_datasource') {
                const device = sourceDef.device_uid
                    ? `${sourceDef.device || 'device'} (${sourceDef.device_uid})`
                    : (sourceDef.device || 'device');
                return `${sourceDef.ds} / ${device} / ${sourceDef.var || 'variable'}`;
            }
            if (dsType === 'signal_generator_datasource') {
                return `${sourceDef.ds} / Signal`;
            }
            if (Number.isFinite(Number(sourceDef.var))) {
                return `${sourceDef.ds} / ${this._formatIndexedChannelLabel(sourceDef.ds, Number(sourceDef.var))}`;
            }
            return `${sourceDef.ds} / ${sourceDef.var || 'variable'}`;
        }

        _formatSeriesSummary(def, idx) {
            if (def && def.a && def.a.ds) {
                const primary = this._formatSourceReference(def.a);
                let sourceText = primary;
                switch (def.op) {
                    case 'negate':
                        sourceText = `-${primary}`;
                        break;
                    case 'abs':
                        sourceText = `abs(${primary})`;
                        break;
                    case 'scale':
                        sourceText = `${primary} x ${Number(def.param) || 0}`;
                        break;
                    case 'offset':
                        sourceText = `${primary} + ${Number(def.param) || 0}`;
                        break;
                    case 'mulvar':
                        sourceText = `${primary} x ${this._formatSourceReference(def.b)}`;
                        break;
                    default:
                        break;
                }
                return {
                    label: def.label || this._getSeriesLabel(idx),
                    value: sourceText
                };
            }

            const mapping = this.dsMap[idx] || {};
            const ds = mapping.ds ?? this.datasourceName;
            const chIdx = mapping.idx ?? this.channelIndices[idx] ?? idx;
            return {
                label: this._getSeriesLabel(idx),
                value: `${ds || 'Datasource'} / ${this._formatIndexedChannelLabel(ds, chIdx)}`
            };
        }

        _renderSourceSummary() {
            if (!this.summaryHost) return;
            const entries = [];
            if (Array.isArray(this.seriesDefs) && this.seriesDefs.length) {
                this.seriesDefs.forEach((def, idx) => {
                    entries.push(this._formatSeriesSummary(def, idx));
                });
            } else {
                const count = Math.max(this.seriesCount, this.channelIndices.length, this.dsMap.length);
                for (let i = 0; i < count; i++) {
                    entries.push(this._formatSeriesSummary(null, i));
                }
            }

            if (!entries.length) {
                this.summaryHost.html('<div class="uplot-source-summary-empty">No channels configured.</div>');
                this._applyPlotHeight();
                this._requestResize();
                return;
            }

            this.summaryHost.html(entries.map((entry, idx) => (
                `<div class="uplot-source-summary-item">` +
                `<span class="uplot-source-summary-label">${_.escape(entry.label || `Series ${idx + 1}`)}</span>` +
                `<span class="uplot-source-summary-value">${_.escape(entry.value || 'Unknown source')}</span>` +
                `</div>`
            )).join(''));
            this._applyPlotHeight();
            this._requestResize();
        }

        render(containerElement) {
            this.hostElement = containerElement || null;
            this.subSectionElement = containerElement?.closest?.('.sub-section') || null;
            this.sectionElement = this.subSectionElement?.parentElement || null;
            this._debugLog('render', {
                hostClass: containerElement?.className || '',
                subSectionHeight: this.subSectionElement?.clientHeight || 0,
                sectionHeight: this.sectionElement?.clientHeight || 0,
                hostHeight: containerElement?.clientHeight || 0
            });
            // Disconnect the old ResizeObserver so _bindResize() re-creates it for the new
            // sub-section element (happens when the widget is dragged to a different pane).
            if (this._resizeObs) {
                try { this._resizeObs.disconnect(); } catch {}
                this._resizeObs = null;
            }
            // Destroy the existing plot before re-rendering; without this a second uPlot
            // canvas is stacked on top of the first one and the old instance leaks.
            if (this.plot) {
                try { this.plot.destroy(); } catch {}
                this.plot = null;
                this.chartHost.empty();
            }
            this.container.appendTo(containerElement);
            this._applyPlotHeight();
            this._bindHeightDrag();
            this._renderSourceSummary();
            // Optionally spawn helper widgets (UI controller / series manager) next to this plot.
            this._maybeSpawnHelpers();
            this._initPlot();
            this._maybeUpdateHeaders(true);
            this._bindResize(containerElement);
            // If seriesDefs present, start local streaming
            this.localMode = Array.isArray(this.seriesDefs) && this.seriesDefs.length > 0;
            if (this.localMode) this._restartPullTimer();
            // After drag, initial DOM measurement may return 0. Re-apply once the browser
            // has had two frames to settle the new layout.
            requestAnimationFrame(() => requestAnimationFrame(() => {
                this._applyPlotHeight();
                this._requestResize();
            }));
        }

        _resolveHelperWidgets(settings) {
            // Normalize helper widget selection for easier checks in the render path.
            const raw = (typeof settings.helperWidgets === 'function' ? settings.helperWidgets() : settings.helperWidgets);
            if (!raw) return 'none';
            return String(raw).toLowerCase();
        }

        _resolveHelperSpawnKey(helperTypes) {
            const title = ((typeof this.settings.title === 'function' ? this.settings.title() : this.settings.title) || '').trim();
            if (!title) return null;
            return `uplot:${title}:${helperTypes.slice().sort().join(',')}`;
        }

        _maybeSpawnHelpers() {
            return;
        }

        _initPlot(series = null) {
            const resolvedSeries = series || [{ label: "Time" }];
            if (!series) {
                for (let i = 0; i < this.seriesCount; i++) {
                    const color = this._getSeriesColor(i);
                    const lbl = this._getSeriesLabel(i);
                    resolvedSeries.push({ label: lbl, stroke: color });
                }
            }

            const opts = {
                title: this.settings.title || "",
                width: this.chartHost.width() || this.container.width(),
                height: Math.max(160, this.chartHost.height() || this.container.height() || 240),
                legend: {
                    show: !!(typeof this.settings.showLegend === 'function' ? this.settings.showLegend() : this.settings.showLegend),
                },
                scales: {
                    x: { time: true },
                    y: {}
                },
                axes: [
                    {
                        stroke: "#666",
                        grid: { show: true },
                        values: (u, vals) => vals.map(v => new Date(v).toLocaleTimeString()),
                    },
                    {
                        stroke: "#666",
                        grid: { show: true },
                        label: this.settings.yLabel || "Value",
                    }
                ],
                series: resolvedSeries
            };
            this.plot = new uPlot(opts, this.dataBuffer, this.chartHost[0]);
            // Apply initial Y range (manual or computed)
            this._applyYAxisRange();
            this._renderSourceSummary();
            this._renderReadouts();
            // In case layout settles after init, try an async resize tick
            this._requestResize();
        }


        _updatePlotData(newDataArray) {
            const now = Date.now();

            // Ensure series count matches
            if (this.seriesCount !== newDataArray.length) {
                this.seriesCount = newDataArray.length;
                this._resetPlot();
                return;
            }

            // Push new values to dataBuffer
            this.dataBuffer[0].push(now);
            newDataArray.forEach((val, idx) => {
                this.dataBuffer[idx + 1].push(val);
            });

            // Trim to keep within time window
            const duration = this.settings.duration || 20000;
            const cutoff = now - duration;
            while (this.dataBuffer[0].length > 0 && this.dataBuffer[0][0] < cutoff) {
                this.dataBuffer[0].shift();
                for (let i = 1; i <= this.seriesCount; i++) {
                    this.dataBuffer[i].shift();
                }
            }

            // Update chart respecting refreshRate
            const refresh = parseInt(this.settings.refreshRate) || 1000;
            if (now - this.lastRender >= refresh) {
                this.plot.setData(this.dataBuffer);
                // Update y-axis scaling if not fully manual
                this._applyYAxisRange();
                this._renderReadouts();
                this.lastRender = now;
            }
        }

        _setFullDataset(dataset) {
            if (!dataset || !Array.isArray(dataset.timestamps) ||
                !Array.isArray(dataset.series)) {
                return;
            }

            this.seriesCount = dataset.series.length;

            if (!this.plot || this.plot.series.length - 1 !== this.seriesCount) {
                this._resetPlot();
            }

            this.dataBuffer = [dataset.timestamps, ...dataset.series];
            if (this.plot) {
                this.plot.setData(this.dataBuffer);
                this._applyYAxisRange();
                this._renderReadouts();
                this.lastRender = Date.now();
            }
        }

        _resetPlot() {
            if (this.plot) {
                this.plot.destroy();
                this.plot = null;
            }

            const series = [{ label: "Time" }];
            for (let i = 0; i < this.seriesCount; i++) {
                const color = this._getSeriesColor(i);
                const lbl = this._getSeriesLabel(i);
                series.push({ label: lbl, stroke: color });
            }

            this.dataBuffer = [[], ...Array(this.seriesCount).fill().map(() => [])];
            this.lastRender = 0;
            this._initPlot(series);
        }

        
        onSettingsChanged(newSettings) {
            const needsReset = ['duration', 'yMin', 'yMax', 'yLabel', 'showLegend', 'colorPalette'].some(
                key => newSettings[key] !== this.settings[key]
            );
            const rateChanged = newSettings.refreshRate !== this.settings.refreshRate;
            const titleChanged = newSettings.title !== this.settings.title;

            this.settings = newSettings;
            // Update helper widget choice and refresh helper UI if needed.
            this.helperWidgets = this._resolveHelperWidgets(newSettings);
            // Auto-spawn helpers when toggled on after settings update.
            this._maybeSpawnHelpers();
            // Update helper fields from settings first, then infer from data if still missing
            this.datasourceName = (typeof newSettings.datasource === 'function' ? newSettings.datasource() : newSettings.datasource) || '';
            const chFromSettings = (typeof newSettings.channelIndices === 'function' ? newSettings.channelIndices() : newSettings.channelIndices);
            this.channelIndices = Array.isArray(chFromSettings)
                ? chFromSettings.map(x => parseInt(x, 10)).filter(n => Number.isFinite(n))
                : (typeof chFromSettings === 'string' && chFromSettings.trim().startsWith('[')
                    ? (function () { try { return JSON.parse(chFromSettings).map(x => parseInt(x, 10)).filter(n => Number.isFinite(n)); } catch { return []; } })()
                    : []);
            this._detectDatasource();
            // Parse externally managed series
            const newDefs = this._parseSeriesDefs((typeof newSettings.seriesDefs === 'function' ? newSettings.seriesDefs() : newSettings.seriesDefs));
            const defsChanged = !_.isEqual(newDefs, this.seriesDefs);
            this.seriesDefs = newDefs;
            this.localMode = Array.isArray(this.seriesDefs) && this.seriesDefs.length > 0;
            this._renderSourceSummary();
            this._maybeUpdateHeaders(true);

            if (needsReset && this.plot) {
                this._resetPlot();
            }
            // If only refresh/title changed, still re-apply y range in case bounds changed
            if (!needsReset && this.plot) {
                this._applyYAxisRange();
            }
            if (titleChanged && this.plot) {
                const tEl = this.plot.root.querySelector('.u-title');
                if (tEl) tEl.textContent = this.settings.title || '';
                this._requestResize();
            }
            if (rateChanged) {
                this.lastRender = 0;
                if (this.localMode) this._restartPullTimer();
            }
            if (defsChanged) {
                // Rebuild datasets to match new series
                this.seriesCount = this.seriesDefs.length;
                this._resetPlot();
                if (this.localMode) this._restartPullTimer();
            }
        }

        onCalculatedValueChanged(settingName, newValue) {
            if (this.paused) return;
            if (this.localMode) return; // ignore external data when using local seriesDefs
            this._maybeUpdateHeaders();
            if (!newValue) return;

            if (newValue && Array.isArray(newValue.timestamps) && Array.isArray(newValue.series)) {
                this._setFullDataset(newValue);
                return;
            }

            let yValues = [];
            if (typeof newValue === 'number') {
                yValues = [newValue];
            } else if (Array.isArray(newValue)) {
                yValues = newValue;
            } else if (newValue && Array.isArray(newValue.y)) {
                yValues = newValue.y;
            }

            if (!yValues.length) return;

            if (!this.plot) {
                this.seriesCount = yValues.length;
                this._resetPlot();
            }

            this._updatePlotData(yValues);
        }

        onDispose() {
            if (this.plot) {
                this.plot.destroy();
                this.plot = null;
            }
            if (this.pullTimer) { clearInterval(this.pullTimer); this.pullTimer = null; }
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
            // Remove fallback window resize handler if used
            try { $(window).off('resize.uplot-widget'); } catch {}
            if (this._configHandler && freeboard.off) {
                freeboard.off('config_updated', this._configHandler);
            }
        }

        getHeight() {
            return 10;
        }

        onSizeChanged() {
            this._debugLog('onSizeChanged', {
                subSectionHeight: this.subSectionElement?.clientHeight || 0,
                sectionHeight: this.sectionElement?.clientHeight || 0,
                chartHostHeight: this.chartHost?.[0]?.clientHeight || 0,
                readoutHeight: this.readoutHost?.[0]?.clientHeight || 0,
                handleTop: this.resizeHandle?.[0]?.offsetTop || 0,
                handleHeight: this.resizeHandle?.[0]?.clientHeight || 0,
                plotHeightPx: this.plotHeightPx
            });
            this._applyPlotHeight();
            this._requestResize();
        }

        _applyPlotHeight() {
            const next = this.plotHeightPx;
            if (typeof next === 'number' && Number.isFinite(next)) {
                const maxAllowed = this._measureAutoChartHeight();
                this.plotHeightPx = Math.min(Math.max(160, next), maxAllowed || Math.max(160, next));
                this.chartHost.css({
                    height: `${this.plotHeightPx}px`,
                    flex: '0 0 auto'
                });
                this._debugLog('applyPlotHeight:fixed', {
                    appliedHeight: this.plotHeightPx,
                    maxAllowed,
                    sectionHeight: this.sectionElement?.clientHeight || 0,
                    chartHostHeight: this.chartHost?.[0]?.clientHeight || 0,
                    readoutHeight: this.readoutHost?.[0]?.clientHeight || 0,
                    handleTop: this.resizeHandle?.[0]?.offsetTop || 0
                });
                return;
            }
            const autoHeight = this._measureAutoChartHeight();
            this.plotHeightPx = null;
            this.chartHost.css({
                height: autoHeight > 0 ? `${autoHeight}px` : '',
                flex: '1 1 auto'
            });
            this._debugLog('applyPlotHeight:auto', {
                measuredHeight: autoHeight,
                cssHeight: this.chartHost?.[0]?.style?.height || '',
                subSectionHeight: this.subSectionElement?.clientHeight || 0,
                sectionHeight: this.sectionElement?.clientHeight || 0,
                readoutHeight: this.readoutHost?.[0]?.clientHeight || 0,
                handleTop: this.resizeHandle?.[0]?.offsetTop || 0
            });
        }

        _syncSubSectionHeight() {
            const subSection = this.subSectionElement;
            const section = this.sectionElement;
            if (!subSection || !section) return;

            const isOnlyWidget = section.children && section.children.length === 1;
            if (isOnlyWidget) {
                const h = section.clientHeight;
                // Skip writing 0 — it overrides the CSS class and collapses the sub-section
                // during a drag when the section hasn't been laid out yet.
                if (h > 0) subSection.style.height = `${h}px`;
            } else {
                subSection.style.height = '';
            }
        }

        _measureAutoChartHeight() {
            const subSection = this.subSectionElement;
            const shell = this.container?.[0];
            const summary = this.summaryHost?.[0];
            const readout = this.readoutHost?.[0];
            const handle = this.resizeHandle?.[0];
            const controls = this.controlsRow?.[0];
            if (!subSection || !shell) return 0;

            const subSectionStyles = window.getComputedStyle ? window.getComputedStyle(subSection) : null;
            const shellStyles = window.getComputedStyle ? window.getComputedStyle(shell) : null;
            const paddingTop = subSectionStyles ? parseFloat(subSectionStyles.paddingTop) || 0 : 0;
            const paddingBottom = subSectionStyles ? parseFloat(subSectionStyles.paddingBottom) || 0 : 0;
            const shellGap = shellStyles ? parseFloat(shellStyles.rowGap || shellStyles.gap) || 0 : 0;
            const shellPaddingTop = shellStyles ? parseFloat(shellStyles.paddingTop) || 0 : 0;
            const shellPaddingBottom = shellStyles ? parseFloat(shellStyles.paddingBottom) || 0 : 0;
            const summaryHeight = summary ? summary.offsetHeight : 0;
            const readoutHeight = readout ? readout.offsetHeight : 0;
            const handleHeight = handle ? handle.offsetHeight : 0;
            const controlsHeight = controls ? controls.offsetHeight : 0;

            const available = subSection.clientHeight
                - paddingTop
                - paddingBottom
                - shellPaddingTop
                - shellPaddingBottom
                - summaryHeight
                - readoutHeight
                - handleHeight
                - controlsHeight
                - (summaryHeight > 0 ? shellGap : 0)
                - (readoutHeight > 0 ? shellGap : 0)
                - (handleHeight > 0 ? shellGap : 0)
                - (controlsHeight > 0 ? shellGap : 0);
            const measured = Math.max(160, available);
            this._debugLog('measureAutoChartHeight', {
                subSectionHeight: subSection.clientHeight,
                paddingTop,
                paddingBottom,
                shellPaddingTop,
                shellPaddingBottom,
                shellGap,
                summaryHeight,
                readoutHeight,
                handleHeight,
                available,
                measured
            });
            return measured;
        }

        _bindHeightDrag() {
            if (!this.resizeHandle || this.resizeHandle.data('uplot-bound')) return;
            this.resizeHandle.data('uplot-bound', true);
            this.resizeHandle.on('mousedown', (event) => {
                event.preventDefault();
                const startY = event.clientY;
                const startHeight = this.chartHost[0]?.clientHeight || this.plotHeightPx || 240;
                this._debugLog('dragResize:start', {
                    startY,
                    startHeight,
                    handleTop: this.resizeHandle?.[0]?.offsetTop || 0
                });
                const onMove = (moveEvent) => {
                    const delta = moveEvent.clientY - startY;
                    this.plotHeightPx = startHeight + delta;
                    this._debugLog('dragResize:move', {
                        delta,
                        nextHeight: this.plotHeightPx,
                        chartHostHeight: this.chartHost?.[0]?.clientHeight || 0,
                        readoutHeight: this.readoutHost?.[0]?.clientHeight || 0,
                        handleTop: this.resizeHandle?.[0]?.offsetTop || 0
                    });
                    this._applyPlotHeight();
                    this._requestResize();
                };
                const onUp = () => {
                    this._debugLog('dragResize:stop', {
                        finalHeight: this.plotHeightPx,
                        chartHostHeight: this.chartHost?.[0]?.clientHeight || 0,
                        readoutHeight: this.readoutHost?.[0]?.clientHeight || 0,
                        handleTop: this.resizeHandle?.[0]?.offsetTop || 0
                    });
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                    this._dragCleanup = null;
                };
                this._dragCleanup = onUp;
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
            });
        }

        _formatReadoutValue(value) {
            if (!Number.isFinite(value)) return '---';
            const abs = Math.abs(value);
            if (abs >= 1000 || (abs > 0 && abs < 0.01)) return value.toExponential(2);
            return Number(value.toFixed(3)).toString();
        }

        _formatReadoutTime(timestamp) {
            if (!Number.isFinite(timestamp)) return '---';
            return new Date(timestamp).toLocaleTimeString();
        }

        _renderReadouts() {
            if (!this.readoutHost) return;
            const lastTs = this.dataBuffer[0] && this.dataBuffer[0].length
                ? this.dataBuffer[0][this.dataBuffer[0].length - 1]
                : null;
            const cards = [];
            cards.push(
                `<div class="uplot-readout-item uplot-readout-time">` +
                `<span class="uplot-readout-label">Time</span>` +
                `<span class="uplot-readout-value">${this._formatReadoutTime(lastTs)}</span>` +
                `</div>`
            );

            for (let i = 0; i < this.seriesCount; i++) {
                const arr = this.dataBuffer[i + 1] || [];
                const latest = arr.length ? arr[arr.length - 1] : null;
                const label = _.escape(this._getSeriesLabel(i));
                const color = _.escape(this._getSeriesColor(i));
                cards.push(
                    `<div class="uplot-readout-item" data-idx="${i}">` +
                    `<span class="uplot-readout-swatch" style="border-color:${color};" title="Right-click to change color"></span>` +
                    `<span class="uplot-readout-label" title="Double-click to rename">${label}</span>` +
                    `<span class="uplot-readout-value">${this._formatReadoutValue(latest)}</span>` +
                    `</div>`
                );
            }

            this.readoutHost.html(cards.join(''));
        }

        _parseSeriesDefs(val) {
            let arr = [];
            try {
                if (Array.isArray(val)) arr = val;
                else if (typeof val === 'string' && val.trim().startsWith('[')) arr = JSON.parse(val);
            } catch {}
            if (!Array.isArray(arr)) return [];
            // Normalize entries
            const norm = arr.map(d => {
                const a = d?.a || {};
                const b = d?.b || null;
                const out = {
                    label: d?.label || '',
                    op: d?.op || 'identity',
                    param: Number(d?.param) || 0,
                    color: d?.color || null,
                    a: {
                        ds: a.ds || '',
                        type: a.type || this._getDatasourceType(a.ds) || '',
                        device: a.device || null,
                        device_uid: a.device_uid || null,
                        var: a.var
                    }
                };
                if (b) {
                    out.b = {
                        ds: b.ds || '',
                        type: b.type || this._getDatasourceType(b.ds) || '',
                        device: b.device || null,
                        device_uid: b.device_uid || null,
                        var: b.var
                    };
                }
                return out;
            });
            return norm;
        }

        _formatDeviceLabel(addr, meta) {
            if (!addr) return '';
            const uid = meta && meta.node_uid;
            return uid ? `${addr} (${uid})` : addr;
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

        // ===== Custom variable selection UI =====
        _refreshDatasourceOptions() {
            const live = freeboard.getLiveModel?.();
            if (!live || typeof live.datasources !== 'function') return;
            const list = live.datasources();
            const current = this.selection.ds || this.datasourceName || '';
            this.dsSelect.empty();
            list.forEach(ds => {
                try {
                    const t = ds.type && ds.type();
                    if (t === 'serialport_datasource' || t === 'fast_frame_datasource' || t === 'can_datasource' || t === 'signal_generator_datasource') {
                        const name = ds.name();
                        this.dsSelect.append(`<option value="${name}">${name}</option>`);
                    }
                } catch {}
            });
            if (current && this.dsSelect.find(`option[value='${current}']`).length === 0) this.dsSelect.append(`<option value="${current}">${current}</option>`);
            if (current) this.dsSelect.val(current);

            // Mirror options into secondary datasource selector
            const selectedB = this.dsSelectB.val();
            this.dsSelectB.empty();
            this.dsSelect.children().each((_, opt) => {
                this.dsSelectB.append($(opt).clone());
            });
            if (selectedB && this.dsSelectB.find(`option[value='${selectedB}']`).length) this.dsSelectB.val(selectedB);
            this._onDatasourceChange();
        }

        async _onDatasourceChange() {
            const ds = this.dsSelect.val();
            const type = this._getDatasourceType(ds);
            this.selection.ds = ds;
            this.selection.type = type;
            const isCAN = type === 'can_datasource';
            this.devSelect.toggle(isCAN);
            if (isCAN) await this._populateDevices();
            await this._populateVariables();
        }

        async _onDatasourceChangeB() {
            const ds = this.dsSelectB.val();
            const type = this._getDatasourceType(ds);
            const showDevB = (this.opSelect.val() === 'mulvar') && (type === 'can_datasource');
            this.devSelectB.toggle(showDevB);
            if (type === 'can_datasource') await this._populateDevicesB();
            await this._populateVariablesB();
        }

        async _populateDevices() {
            if (!this.ipc) return;
            try {
                const dsSettings = freeboard.getDatasourceSettings(this.selection.ds) || {};
                const channel = dsSettings.channel || 'can0';
                try { await this.ipc.invoke('can-aggregate-start', { channel }); } catch {}
                const snap = await this.ipc.invoke('can-aggregate-snapshot', { channel });
                const nodes = snap?.nodes || {};
                this.deviceMeta = nodes;
                const keys = Object.keys(nodes).sort();
                this.devSelect.empty();
                keys.forEach(k => {
                    const label = this._formatDeviceLabel(k, nodes[k] || {});
                    this.devSelect.append(`<option value="${k}">${label}</option>`);
                });
                const resolved = this._resolveDeviceKey(nodes, this.selection.device, this.selection.deviceUid);
                if (resolved) {
                    this.selection.device = resolved;
                    this.selection.deviceUid = nodes[resolved]?.node_uid || this.selection.deviceUid || null;
                    this.devSelect.val(resolved);
                } else {
                    this.selection.device = null;
                    this.selection.deviceUid = null;
                }
            } catch {}
        }

        async _populateVariables() {
            const ds = this.selection.ds;
            const type = this.selection.type;
            this.varSelect.empty();
            if (!ds) return;
            if (type === 'signal_generator_datasource') {
                this.varSelect.append('<option value="0">Signal</option>');
            } else if (type === 'fast_frame_datasource' || type === 'serialport_datasource') {
                const headers = await this._fetchHeaders(ds);
                let count = headers.length;
                if (!count) {
                    // probe channel count
                    try {
                        const dsSettings = freeboard.getDatasourceSettings(ds) || {};
                        const path = dsSettings.portPath || ds;
                        if (type === 'fast_frame_datasource') {
                            const dataset = await this.ipc.invoke('get-fast-dataset', { path });
                            if (dataset && Array.isArray(dataset.series)) count = dataset.series.length;
                        } else {
                            const arr = await this.ipc.invoke('get-serial-buffer', { path });
                            if (Array.isArray(arr)) count = arr.length;
                        }
                    } catch {}
                }
                for (let i = 0; i < count; i++) {
                    const label = headers[i] || `Channel ${i + 1}`;
                    this.varSelect.append(`<option value="${i}">${label}</option>`);
                }
            } else if (type === 'can_datasource') {
                if (!this.ipc) return;
                try {
                    const dsSettings = freeboard.getDatasourceSettings(ds) || {};
                    const channel = dsSettings.channel || 'can0';
                    const snap = await this.ipc.invoke('can-aggregate-snapshot', { channel });
                    const nodes = snap?.nodes || {};
                    const resolved = this._resolveDeviceKey(nodes, this.devSelect.val() || this.selection.device, this.selection.deviceUid);
                    if (resolved) {
                        this.selection.device = resolved;
                        this.selection.deviceUid = nodes[resolved]?.node_uid || this.selection.deviceUid || null;
                        if (this.devSelect.find(`option[value='${resolved}']`).length) {
                            this.devSelect.val(resolved);
                        }
                    } else {
                        this.selection.device = null;
                    }
                    const flat = resolved && nodes[resolved] ? (nodes[resolved].flat || {}) : {};
                    const entries = Object.keys(flat).sort();
                    entries.forEach(p => {
                        const leaf = p.includes('/') ? p.split('/').pop() : p;
                        this.varSelect.append(`<option value="${p}">${leaf}</option>`);
                    });
                } catch {}
            }
        }

        async _populateDevicesB() {
            if (!this.ipc) return;
            try {
                const dsSettings = freeboard.getDatasourceSettings(this.dsSelectB.val()) || {};
                const channel = dsSettings.channel || 'can0';
                try { await this.ipc.invoke('can-aggregate-start', { channel }); } catch {}
                const snap = await this.ipc.invoke('can-aggregate-snapshot', { channel });
                const nodes = snap?.nodes || {};
                this.deviceMetaB = nodes;
                const keys = Object.keys(nodes).sort();
                this.devSelectB.empty();
                keys.forEach(k => {
                    const label = this._formatDeviceLabel(k, nodes[k] || {});
                    this.devSelectB.append(`<option value="${k}">${label}</option>`);
                });
                const preferredDev = this.selectionB?.device ?? this.selectionBState.device;
                const preferredUid = this.selectionB?.deviceUid ?? this.selectionBState.deviceUid;
                const resolved = this._resolveDeviceKey(nodes, preferredDev, preferredUid);
                if (resolved) {
                    this.devSelectB.val(resolved);
                    this.selectionBState.device = resolved;
                    this.selectionBState.deviceUid = nodes[resolved]?.node_uid || this.selectionBState.deviceUid || null;
                } else {
                    this.selectionBState.device = null;
                    this.selectionBState.deviceUid = null;
                }
            } catch {}
        }

        async _populateVariablesB() {
            const ds = this.dsSelectB.val();
            const type = this._getDatasourceType(ds);
            this.varSelectB.empty();
            if (!ds) return;
            if (type === 'signal_generator_datasource') {
                this.varSelectB.append('<option value="0">Signal</option>');
            } else if (type === 'fast_frame_datasource' || type === 'serialport_datasource') {
                const headers = await this._fetchHeaders(ds);
                let count = headers.length;
                if (!count) {
                    try {
                        const dsSettings = freeboard.getDatasourceSettings(ds) || {};
                        const path = dsSettings.portPath || ds;
                        if (type === 'fast_frame_datasource') {
                            const dataset = await this.ipc.invoke('get-fast-dataset', { path });
                            if (dataset && Array.isArray(dataset.series)) count = dataset.series.length;
                        } else {
                            const arr = await this.ipc.invoke('get-serial-buffer', { path });
                            if (Array.isArray(arr)) count = arr.length;
                        }
                    } catch {}
                }
                for (let i = 0; i < count; i++) {
                    const label = headers[i] || `Channel ${i + 1}`;
                    this.varSelectB.append(`<option value="${i}">${label}</option>`);
                }
            } else if (type === 'can_datasource') {
                if (!this.ipc) return;
                try {
                    const dsSettings = freeboard.getDatasourceSettings(ds) || {};
                    const channel = dsSettings.channel || 'can0';
                    const snap = await this.ipc.invoke('can-aggregate-snapshot', { channel });
                    const nodes = snap?.nodes || {};
                    const resolved = this._resolveDeviceKey(nodes, this.devSelectB.val() || this.selectionBState.device, this.selectionBState.deviceUid);
                    if (resolved) {
                        this.selectionBState.device = resolved;
                        this.selectionBState.deviceUid = nodes[resolved]?.node_uid || this.selectionBState.deviceUid || null;
                        if (this.devSelectB.find(`option[value='${resolved}']`).length) {
                            this.devSelectB.val(resolved);
                        }
                    } else {
                        this.selectionBState.device = null;
                    }
                    const flat = resolved && nodes[resolved] ? (nodes[resolved].flat || {}) : {};
                    const entries = Object.keys(flat).sort();
                    entries.forEach(p => {
                        const leaf = p.includes('/') ? p.split('/').pop() : p;
                        this.varSelectB.append(`<option value="${p}">${leaf}</option>`);
                    });
                } catch {}
            }
        }

        _transform(op, param, x) {
            const v = Number(x);
            if (!isFinite(v)) return null;
            switch (op) {
                case 'negate': return -v;
                case 'abs': return Math.abs(v);
                case 'scale': return v * (Number(param) || 0);
                case 'offset': return v + (Number(param) || 0);
                default: return v;
            }
        }

        _applySelectionFromUI() {
            const ds = this.dsSelect.val();
            if (!ds) return;
            const type = this._getDatasourceType(ds);
            const op = this.opSelect.val() || 'identity';
            const param = this.paramInput.is(':visible') ? (parseFloat(this.paramInput.val()) || 0) : 0;
            let label = this.varSelect.find('option:selected').text() || 'Series';
            if (op === 'negate') label = `-${label}`;
            else if (op === 'abs') label = `abs(${label})`;
            else if (op === 'scale') label = `${label} * ${param}`;
            else if (op === 'offset') label = `${label} + ${param}`;
            else if (op === 'mulvar') {
                const dsB = this.dsSelectB.val();
                const typeB = this._getDatasourceType(dsB);
                const varBLabel = this.varSelectB.find('option:selected').text() || 'y';
                label = `${label} × ${varBLabel}`;
                let devBVal = null;
                let devBUid = null;
                if (typeB === 'can_datasource') {
                    const nodesB = this.deviceMetaB || {};
                    const desiredB = this.devSelectB.val() || this.selectionBState.device;
                    const resolvedB = this._resolveDeviceKey(nodesB, desiredB, this.selectionBState.deviceUid);
                    if (resolvedB) {
                        devBVal = resolvedB;
                        devBUid = nodesB[resolvedB]?.node_uid || this.selectionBState.deviceUid || null;
                        this.selectionBState.device = resolvedB;
                        this.selectionBState.deviceUid = devBUid;
                        if (this.devSelectB.find(`option[value='${resolvedB}']`).length) this.devSelectB.val(resolvedB);
                    } else {
                        this.selectionBState.device = null;
                        this.selectionBState.deviceUid = null;
                    }
                }
                this.selectionB = {
                    ds: dsB,
                    type: typeB,
                    device: (typeB === 'can_datasource') ? devBVal : null,
                    deviceUid: (typeB === 'can_datasource') ? devBUid : null,
                    var: (typeB === 'can_datasource') ? this.varSelectB.val() : parseInt(this.varSelectB.val(), 10)
                };
            } else {
                this.selectionB = null;
            }

            let devVal = null;
            let devUid = null;
            if (type === 'can_datasource') {
                const nodes = this.deviceMeta || {};
                const desired = this.devSelect.val() || this.selection.device;
                const resolved = this._resolveDeviceKey(nodes, desired, this.selection.deviceUid);
                if (resolved) {
                    devVal = resolved;
                    devUid = nodes[resolved]?.node_uid || this.selection.deviceUid || null;
                    if (this.devSelect.find(`option[value='${resolved}']`).length) this.devSelect.val(resolved);
                }
                this.selection.device = devVal;
                this.selection.deviceUid = devUid;
            }

            this.selection = {
                type,
                ds,
                device: (type === 'can_datasource') ? (devVal ?? null) : null,
                deviceUid: (type === 'can_datasource') ? (devUid ?? null) : null,
                var: (type === 'can_datasource') ? this.varSelect.val() : parseInt(this.varSelect.val(), 10),
                op,
                param
            };

            // Reset plot to single series with custom label
            this.seriesCount = 1;
            if (this.plot) { this.plot.destroy(); this.plot = null; }
            this.dataBuffer = [[], []];
            const color = this._getSeriesColor(0);
            const series = [{ label: 'Time' }, { label, stroke: color }];
            this._initPlot(series);

            // Switch to local polling mode
            this.localMode = true;
            this._restartPullTimer();
        }

        _restartPullTimer() {
            if (this.pullTimer) { clearInterval(this.pullTimer); this.pullTimer = null; }
            const interval = parseInt(this.settings.refreshRate) || 1000;
            this.pullTimer = setInterval(() => this._pollOnce(), Math.max(50, interval));
            // Kick an immediate poll
            this._pollOnce();
        }

        async _pollOnce() {
            if (this.paused) return;
            if (Array.isArray(this.seriesDefs) && this.seriesDefs.length) {
                // Streaming multiple series via instantaneous sampling
                const yvals = [];
                for (const def of this.seriesDefs) {
                    try {
                        const A = def.a || {};
                        const op = def.op || 'identity';
                        if (op === 'mulvar' && def.b) {
                            const yA = await this._readInstantValue(A);
                            const yB = await this._readInstantValue(def.b);
                            yvals.push((Number(yA) || 0) * (Number(yB) || 0));
                        } else {
                            const raw = await this._readInstantValue(A);
                            yvals.push(this._transform(op, def.param, raw));
                        }
                    } catch {
                        yvals.push(null);
                    }
                }
                // Remove nulls -> use 0 or skip? Use 0 by default to keep graph stable
                const clean = yvals.map(v => (isFinite(v) ? v : 0));
                if (!this.plot || this.seriesCount !== clean.length) {
                    this.seriesCount = clean.length;
                    this._resetPlot();
                }
                this._updatePlotData(clean);
                return;
            }
            const sel = this.selection;
            if (!sel || !sel.ds) return;
            try {
                if (sel.op === 'mulvar' && this.selectionB && this.selectionB.ds) {
                    // Multiply two variables (possibly across datasources/types)
                    const A = sel; const B = this.selectionB;
                    if (A.type === 'fast_frame_datasource' && B.type === 'fast_frame_datasource' && A.ds === B.ds) {
                        const dsSettings = freeboard.getDatasourceSettings(A.ds) || {};
                        const path = dsSettings.portPath || A.ds;
                        const data = await this.ipc.invoke('get-fast-dataset', { path });
                        if (!data || !Array.isArray(data.timestamps) || !Array.isArray(data.series)) return;
                        const ia = Number(A.var), ib = Number(B.var);
                        if (!Array.isArray(data.series[ia]) || !Array.isArray(data.series[ib])) return;
                        const len = Math.min(data.series[ia].length, data.series[ib].length);
                        const out = new Array(len);
                        for (let i = 0; i < len; i++) out[i] = (Number(data.series[ia][i]) || 0) * (Number(data.series[ib][i]) || 0);
                        const ts = data.timestamps.slice(-len);
                        this._setFullDataset({ timestamps: ts, series: [out] });
                    } else {
                        // Instantaneous sampling across arbitrary sources
                        const yA = await this._readInstantValue(A);
                        const yB = await this._readInstantValue(B);
                        if (yA != null && yB != null) this._updatePlotData([yA * yB]);
                    }
                } else if (sel.type === 'fast_frame_datasource') {
                    const dsSettings = freeboard.getDatasourceSettings(sel.ds) || {};
                    const path = dsSettings.portPath || sel.ds;
                    const data = await this.ipc.invoke('get-fast-dataset', { path });
                    if (!data || !Array.isArray(data.timestamps) || !Array.isArray(data.series)) return;
                    const idx = Number(sel.var);
                    if (!Number.isFinite(idx) || !Array.isArray(data.series[idx])) return;
                    const transformed = data.series[idx].map(v => this._transform(sel.op, sel.param, v));
                    this._setFullDataset({ timestamps: data.timestamps, series: [transformed] });
                } else if (sel.type === 'serialport_datasource') {
                    const dsSettings = freeboard.getDatasourceSettings(sel.ds) || {};
                    const path = dsSettings.portPath || sel.ds;
                    const arr = await this.ipc.invoke('get-serial-buffer', { path });
                    const idx = Number(sel.var);
                    const val = Array.isArray(arr) ? arr[idx] : null;
                    const y = this._transform(sel.op, sel.param, val);
                    if (y != null) this._updatePlotData([y]);
                } else if (sel.type === 'can_datasource') {
                    const dsSettings = freeboard.getDatasourceSettings(sel.ds) || {};
                    const channel = dsSettings.channel || 'can0';
                    const snap = await this.ipc.invoke('can-aggregate-snapshot', { channel });
                    const flat = snap?.nodes?.[sel.device]?.flat || {};
                    const val = flat[sel.var];
                    const y = this._transform(sel.op, sel.param, val);
                    if (y != null) this._updatePlotData([y]);
                } else if (sel.type === 'signal_generator_datasource') {
                    const val = await this._readInstantValue(sel);
                    const y = this._transform(sel.op, sel.param, val);
                    if (y != null) this._updatePlotData([y]);
                }
            } catch (e) {
                // ignore transient polling errors
            }
        }

        async _readInstantValue(s) {
            if (!s || !s.ds) return null;
            if (s.type === 'serialport_datasource') {
                const dsSettings = freeboard.getDatasourceSettings(s.ds) || {};
                const path = dsSettings.portPath || s.ds;
                const arr = await this.ipc.invoke('get-serial-buffer', { path });
                const idx = Number(s.var);
                const val = Array.isArray(arr) ? arr[idx] : null;
                return Number(val);
            } else if (s.type === 'fast_frame_datasource') {
                const dsSettings = freeboard.getDatasourceSettings(s.ds) || {};
                const path = dsSettings.portPath || s.ds;
                const data = await this.ipc.invoke('get-fast-dataset', { path });
                const idx = Number(s.var);
                const arr = (data && Array.isArray(data.series) && Array.isArray(data.series[idx])) ? data.series[idx] : [];
                return arr.length ? Number(arr[arr.length - 1]) : null;
            } else if (s.type === 'can_datasource') {
                const dsSettings = freeboard.getDatasourceSettings(s.ds) || {};
                const channel = dsSettings.channel || 'can0';
                const snap = await this.ipc.invoke('can-aggregate-snapshot', { channel });
                const nodes = snap?.nodes || {};
                const resolved = this._resolveDeviceKey(nodes, s.device, s.deviceUid);
                if (!resolved) return null;
                if (s.device !== resolved) s.device = resolved;
                if (nodes[resolved]?.node_uid && nodes[resolved].node_uid !== s.deviceUid) {
                    s.deviceUid = nodes[resolved].node_uid;
                }
                const flat = nodes[resolved]?.flat || {};
                const val = flat[s.var];
                return Number(val);
            } else if (s.type === 'signal_generator_datasource') {
                const live = freeboard.getLiveModel?.();
                const data = live?.datasourceData ? live.datasourceData[s.ds] : null;
                if (data && data.y1 != null) return Number(data.y1);
                if (data && data.value != null) return Number(data.value);
                return null;
            }
            return null;
        }

        // Compute smart defaults and/or apply manual Y range
        _applyYAxisRange() {
            if (!this.plot) return;

            const yMin = this._parseMaybeNumber(this.settings.yMin);
            const yMax = this._parseMaybeNumber(this.settings.yMax);
            const hasMin = yMin != null;
            const hasMax = yMax != null;

            // Compute current data range across all series
            const [dataMin, dataMax] = this._computeDataYRange();

            let min = dataMin;
            let max = dataMax;

            if (hasMin && hasMax) {
                min = yMin;
                max = yMax;
            } else if (hasMin && !hasMax) {
                min = yMin;
                if (isFinite(dataMax)) {
                    max = Math.max(dataMax, min + this._niceDelta(Math.abs(dataMax - min)));
                } else {
                    max = min + 1; // fallback span
                }
            } else if (!hasMin && hasMax) {
                max = yMax;
                if (isFinite(dataMin)) {
                    min = Math.min(dataMin, max - this._niceDelta(Math.abs(max - dataMin)));
                } else {
                    min = max - 1; // fallback span
                }
            } else {
                // No manual bounds: apply smart padding and nice rounding
                const padded = this._paddedNiceRange(dataMin, dataMax);
                min = padded[0];
                max = padded[1];
            }

            if (!isFinite(min) || !isFinite(max) || min === max) {
                // Safe default if no data or degenerate
                const mid = isFinite(min) ? min : (isFinite(max) ? max : 0);
                min = mid - 0.5;
                max = mid + 0.5;
            }

            try {
                this.plot.setScale('y', { min, max });
            } catch (e) {
                // ignore scaling errors
            }
        }

        _parseMaybeNumber(val) {
            if (val === undefined || val === null) return null;
            if (typeof val === 'number') return isFinite(val) ? val : null;
            if (typeof val === 'string') {
                const trimmed = val.trim();
                if (trimmed === '') return null;
                const n = parseFloat(trimmed);
                return isFinite(n) ? n : null;
            }
            return null;
        }

        _computeDataYRange() {
            let min = Infinity;
            let max = -Infinity;

            for (let s = 1; s < this.dataBuffer.length; s++) {
                const arr = this.dataBuffer[s] || [];
                for (let i = 0; i < arr.length; i++) {
                    const v = arr[i];
                    if (v == null) continue;
                    if (!isFinite(v)) continue;
                    if (v < min) min = v;
                    if (v > max) max = v;
                }
            }

            if (min === Infinity || max === -Infinity) return [NaN, NaN];
            return [min, max];
        }

        _paddedNiceRange(min, max) {
            if (!isFinite(min) || !isFinite(max)) return [0, 1];
            if (min === max) {
                const span = Math.max(1e-6, Math.abs(min) * 0.1);
                return [min - span, max + span];
            }
            const span = max - min;
            const pad = span * 0.1; // 10% padding
            const rawMin = min - pad;
            const rawMax = max + pad;
            return this._niceBounds(rawMin, rawMax);
        }

        _niceBounds(min, max) {
            // Round bounds to "nice" numbers to avoid awkward decimals
            const span = max - min;
            if (!isFinite(span) || span <= 0) return [min, max];
            const step = this._niceDelta(span / 8); // target ~8 ticks
            const niceMin = Math.floor(min / step) * step;
            const niceMax = Math.ceil(max / step) * step;
            return [niceMin, niceMax];
        }

        _niceDelta(raw) {
            if (!isFinite(raw) || raw <= 0) return 1;
            const exp = Math.floor(Math.log10(raw));
            const frac = raw / Math.pow(10, exp);
            let niceFrac;
            if (frac <= 1) niceFrac = 1;
            else if (frac <= 2) niceFrac = 2;
            else if (frac <= 2.5) niceFrac = 2.5;
            else if (frac <= 5) niceFrac = 5;
            else niceFrac = 10;
            return niceFrac * Math.pow(10, exp);
        }

        _bindResize(containerElement) {
            if (this._resizeObs) {
                try { this._resizeObs.disconnect(); } catch {}
                this._resizeObs = null;
            }
            const watchEl = containerElement || this.hostElement || this.subSectionElement || this.container[0];
            if (!watchEl) return;
            if (typeof ResizeObserver !== 'undefined') {
                this._resizeObs = new ResizeObserver(() => {
                    this._debugLog('resizeObserver', {
                        observedHeight: watchEl?.clientHeight || 0,
                        chartHostHeight: this.chartHost?.[0]?.clientHeight || 0,
                        readoutHeight: this.readoutHost?.[0]?.clientHeight || 0,
                        handleTop: this.resizeHandle?.[0]?.offsetTop || 0,
                        plotHeightPx: this.plotHeightPx
                    });
                    this._applyPlotHeight();
                    this._requestResize();
                });
                this._resizeObs.observe(watchEl);
                if (this.chartHost?.[0]) this._resizeObs.observe(this.chartHost[0]);
            } else {
                // Fallback: resize on window events
                $(window).on('resize.uplot-widget', () => {
                    this._applyPlotHeight();
                    this._requestResize();
                });
            }
        }

        _requestResize() {
            if (!this.plot || !this.chartHost) return;
            if (this._resizeRAF) cancelAnimationFrame(this._resizeRAF);
            this._resizeRAF = requestAnimationFrame(() => {
                this._resizeRAF = 0;
                const el = this.chartHost[0];
                const w = Math.max(0, el ? el.clientWidth : this.chartHost.width());
                const h = Math.max(160, el ? el.clientHeight : this.plotHeightPx);
                this._debugLog('requestResize', {
                    chartHostWidth: el ? el.clientWidth : this.chartHost.width(),
                    chartHostHeight: el ? el.clientHeight : this.plotHeightPx,
                    readoutHeight: this.readoutHost?.[0]?.clientHeight || 0,
                    handleTop: this.resizeHandle?.[0]?.offsetTop || 0,
                    appliedWidth: w,
                    appliedHeight: h
                });
                if (w && h) {
                    try {
                        this.plot.setSize({ width: w, height: h });
                        this._debugLog('setSize', { width: w, height: h });
                    } catch (err) {
                        this._debugLog('setSize:error', { message: err?.message || String(err) });
                    }
                }
            });
        }
    }
})();
