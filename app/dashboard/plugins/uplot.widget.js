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
    freeboard.loadWidgetPlugin({
        type_name: "owntech_plot_uplot",
        display_name: "Plot widget",
        description: "Realtime uPlot-based chart. Accepts streaming values or a full dataset",
        external_scripts: [
            "https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.iife.min.js",
            "https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.min.css"
        ],
        settings: [
            { name: "title", display_name: "Title", type: "text" },
            // Keep the widget config slim; advanced tuning is handled via helper widgets.
            { name: "helperWidgets", display_name: "Helper Widgets", type: "option", default_value: "none", options: [
                { name: "None", value: "none" },
                { name: "UI Controller", value: "ui" },
                { name: "Series Manager", value: "series" },
                { name: "Both", value: "both" }
            ] }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new OwnTechPlotUPlot(settings));
        }
    });

class OwnTechPlotUPlot {
        constructor(settings) {
            this.settings = settings;
            // Keep the chart area stable and render channel values in a separate aligned grid.
            this.container = $('<div class="uplot-widget-shell"></div>');
            this.chartHost = $('<div class="uplot-chart-host"></div>');
            this.resizeHandle = $('<div class="uplot-resize-handle" title="Drag to resize plot"></div>');
            this.readoutHost = $('<div class="uplot-readout-grid"></div>');
            this.container.append(this.chartHost, this.resizeHandle, this.readoutHost);
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

            if (changed && this.plot) this._resetPlot();
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
            const mapping = this.dsMap[idx] || {};
            const ds = mapping.ds ?? this.datasourceName;
            const chIdx = mapping.idx ?? this.channelIndices[idx] ?? idx;
            const colors = this.colorsByDs[ds] || [];
            if (colors[chIdx]) return colors[chIdx];
            // Allow the UI controller to override the default palette for plot colors.
            const palette = Array.isArray(window.PlotColorPalette) && window.PlotColorPalette.length
                ? window.PlotColorPalette
                : (typeof ColorBlind10 !== "undefined" ? ColorBlind10 : null);
            if (palette && palette.length) return palette[idx % palette.length];
            return `hsl(${(idx * 60) % 360}, 70%, 50%)`;
        }

        render(containerElement) {
            this.hostElement = containerElement || null;
            this.subSectionElement = containerElement?.closest?.('.sub-section') || null;
            this.container.appendTo(containerElement);
            this._applyPlotHeight();
            this._bindHeightDrag();
            // Optionally spawn helper widgets (UI controller / series manager) next to this plot.
            this._maybeSpawnHelpers();
            this._initPlot();
            this._maybeUpdateHeaders(true);
            this._bindResize();
            // If seriesDefs present, start local streaming
            this.localMode = Array.isArray(this.seriesDefs) && this.seriesDefs.length > 0;
            if (this.localMode) this._restartPullTimer();
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

            // Identify the pane + widget index for this plot so helpers can be inserted next to it.
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
            if ((mode === 'ui' || mode === 'both') && !existingTypes.has('uplot_config_panel')) {
                helpers.push({ type: 'uplot_config_panel', settings: {} });
            }
            if ((mode === 'series' || mode === 'both') && !existingTypes.has('uplot_series_manager')) {
                helpers.push({ type: 'uplot_series_manager', settings: {} });
            }
            if (!helpers.length) return;

            // Spawn helpers in a separate pane to the right of the plot.
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
                    show: false,
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
            const needsReset = ['duration', 'yMin', 'yMax', 'yLabel', 'showLegend'].some(
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
            this._applyPlotHeight();
            this._requestResize();
        }

        _applyPlotHeight() {
            const next = this.plotHeightPx;
            if (typeof next === 'number' && Number.isFinite(next)) {
                this.plotHeightPx = Math.max(160, next);
                this.chartHost.css({
                    height: `${this.plotHeightPx}px`,
                    flex: '0 0 auto'
                });
                return;
            }
            const autoHeight = this._measureAutoChartHeight();
            this.plotHeightPx = null;
            this.chartHost.css({
                height: autoHeight > 0 ? `${autoHeight}px` : '',
                flex: '1 1 auto'
            });
        }

        _measureAutoChartHeight() {
            const subSection = this.subSectionElement;
            const shell = this.container?.[0];
            const readout = this.readoutHost?.[0];
            const handle = this.resizeHandle?.[0];
            if (!subSection || !shell) return 0;

            const subSectionStyles = window.getComputedStyle ? window.getComputedStyle(subSection) : null;
            const shellStyles = window.getComputedStyle ? window.getComputedStyle(shell) : null;
            const paddingTop = subSectionStyles ? parseFloat(subSectionStyles.paddingTop) || 0 : 0;
            const paddingBottom = subSectionStyles ? parseFloat(subSectionStyles.paddingBottom) || 0 : 0;
            const shellGap = shellStyles ? parseFloat(shellStyles.rowGap || shellStyles.gap) || 0 : 0;
            const shellPaddingTop = shellStyles ? parseFloat(shellStyles.paddingTop) || 0 : 0;
            const shellPaddingBottom = shellStyles ? parseFloat(shellStyles.paddingBottom) || 0 : 0;
            const readoutHeight = readout ? readout.offsetHeight : 0;
            const handleHeight = handle ? handle.offsetHeight : 0;

            const available = subSection.clientHeight
                - paddingTop
                - paddingBottom
                - shellPaddingTop
                - shellPaddingBottom
                - readoutHeight
                - handleHeight
                - (readoutHeight > 0 ? shellGap : 0)
                - (handleHeight > 0 ? shellGap : 0);
            return Math.max(160, available);
        }

        _bindHeightDrag() {
            if (!this.resizeHandle || this.resizeHandle.data('uplot-bound')) return;
            this.resizeHandle.data('uplot-bound', true);
            this.resizeHandle.on('mousedown', (event) => {
                event.preventDefault();
                const startY = event.clientY;
                const startHeight = this.chartHost[0]?.clientHeight || this.plotHeightPx || 240;
                const onMove = (moveEvent) => {
                    const delta = moveEvent.clientY - startY;
                    this.plotHeightPx = startHeight + delta;
                    this._applyPlotHeight();
                    this._requestResize();
                };
                const onUp = () => {
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
                    `<div class="uplot-readout-item">` +
                    `<span class="uplot-readout-swatch" style="border-color:${color};"></span>` +
                    `<span class="uplot-readout-label">${label}</span>` +
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

        _bindResize() {
            if (this._resizeObs || !this.container || !this.container[0]) return;
            const el = this.subSectionElement || this.container[0];
            if (typeof ResizeObserver !== 'undefined') {
                this._resizeObs = new ResizeObserver(() => {
                    this._applyPlotHeight();
                    this._requestResize();
                });
                this._resizeObs.observe(el);
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
                if (w && h) {
                    try { this.plot.setSize({ width: w, height: h }); } catch {}
                }
            });
        }
    }
})();
