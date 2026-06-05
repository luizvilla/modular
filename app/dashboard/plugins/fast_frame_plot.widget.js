(function () {
    const shared = window.FastFrameShared;

    freeboard.loadWidgetPlugin({
        type_name: 'fast_frame_plot',
        display_name: 'Fast Frame Widget',
        category: 'Plots',
        icon: 'chart-area',
        description: 'Plots multiple CSV-backed fast-frame channels against time or sample index',
        settings: [
            { name: 'title', display_name: 'Title', type: 'text', default_value: 'Fast Frame Plot' }
        ],
        // Do not use external_scripts here.  freeboard's head.js calls finishLoad()
        // asynchronously even for cached URLs, leaving widgetInstance undefined for one
        // tick.  During that tick _heightUpdate fires, widget.height() falls back to 1,
        // and gridster shrinks the pane to 4 rows.  When finishLoad() completes it jumps
        // back to 18 rows — the visible "expands downwards" on every load.
        //
        // Instead: if uPlot is already on the page (loaded by time_plot_uplot or any
        // other co-resident widget) skip head.js entirely and call newInstance
        // synchronously, which keeps the pane height stable.  Only fall back to an
        // on-demand CDN load when fast_frame_plot is the sole uPlot widget.
        newInstance: function (settings, cb) {
            const UPLOT_JS  = 'https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.iife.min.js';
            const UPLOT_CSS = 'https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.min.css';
            if (window.uPlot) {
                cb(new FastFramePlot(settings));
            } else {
                head.js([UPLOT_JS, UPLOT_CSS], function () { cb(new FastFramePlot(settings)); });
            }
        }
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
            this.subSectionElement = null;
            this.sectionElement = null;
            this.container = $('<div class="fast-frame-plot h-100 d-flex flex-column gap-2 p-2" style="overflow-y:auto"></div>');
            this.status = $('<div class="small text-muted border rounded p-2 mb-2">Configure a CSV source, time column, and one or more plotted channels.</div>');
            this.readoutHost = $('<div class="uplot-readout-grid"></div>');
            this.chartShell = $('<div class="d-flex flex-column gap-2"></div>');
            this.chartHost = $('<div class="fast-frame-plot-host" style="min-height:0;overflow:hidden;"></div>');
            this.resizeHandle = $('<div class="uplot-resize-handle" title="Drag to resize plot"></div>');
            this.emptyState = $('<div class="small text-muted border rounded p-3">Add channels with the ↓ button below.</div>');
            this.chartShell.append(this.chartHost, this.resizeHandle);
            this._editorOpen = false;
            this._ed = null;
            this.channelToggleBtn = null;
            this.channelPanel = null;
            this._buildChannelEditor();
        }

        render(el) {
            this.hostElement = el || null;
            this.subSectionElement = el?.closest?.('.sub-section') || null;
            this.sectionElement = this.subSectionElement?.parentElement || null;
            $(el).append(this.container);
            this.container.empty().append(this.status, this.chartShell, this.readoutHost, this.channelToggleBtn, this.channelPanel);
            this._applyPlotHeight();
            this._bindHeightDrag();
            this._bindResize();
            this._scheduleHelperSpawn();
            this._startPolling();
            requestAnimationFrame(() => requestAnimationFrame(() => {
                this._applyPlotHeight();
                this._requestResize();
            }));
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
                if (this._editorOpen) this._refreshEditorColumns();
            }
            const defs = shared.normalizeSeriesDefs(this.settings, this.availableColumns);
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
            // Math channels with missing operands return [] from computeMathChannel — not a hard error.
            const invalid = defs.filter(def => def.type !== 'math' && !this.availableColumns.includes(def.variable));
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
            if (this.readoutHost) this.readoutHost.html('');
            this._applyPlotHeight();
        }

        _renderPlot(defs) {
            const xValues = Array.isArray(this.dataset.columns[this.settings.timeColumn])
                ? this.dataset.columns[this.settings.timeColumn].map(value => Number.isFinite(value) ? value : null)
                : this.dataset.rows.map((_row, index) => index);
            const data = [xValues];
            const series = [{ label: this.settings.xLabel || this.settings.timeColumn || 'Sample' }];

            defs.forEach((def) => {
                const yData = def.type === 'math'
                    ? shared.computeMathChannel(def, this.dataset.columns)
                    : (this.dataset.columns[def.variable] || []);
                data.push(yData);
                series.push({
                    label: def.label,
                    stroke: def.color,
                    width: 2,
                    show: def.visible !== false
                });
            });

            // Compute data-range bounds; used as fallback when no explicit bound is set.
            const finiteX = xValues.filter(v => v !== null && Number.isFinite(v));
            const allY = data.slice(1).flat().filter(v => Number.isFinite(v));
            const autoXMin = finiteX.length ? Math.min(...finiteX) : null;
            const autoXMax = finiteX.length ? Math.max(...finiteX) : null;
            let autoYMin = allY.length ? Math.min(...allY) : null;
            let autoYMax = allY.length ? Math.max(...allY) : null;
            // Guard against a degenerate single-point range that would collapse the y axis.
            if (autoYMin !== null && autoYMin === autoYMax) {
                const pad = Math.abs(autoYMin) * 0.1 || 1;
                autoYMin -= pad;
                autoYMax += pad;
            }

            const xMin = shared.parseAxisBound(this.settings.xMin) ?? autoXMin;
            const xMax = shared.parseAxisBound(this.settings.xMax) ?? autoXMax;
            const yMin = shared.parseAxisBound(this.settings.yMin) ?? autoYMin;
            const yMax = shared.parseAxisBound(this.settings.yMax) ?? autoYMax;

            const signature = JSON.stringify({
                file: this.lastFileSignature,
                timeColumn: this.settings.timeColumn || '',
                defs,
                sample: data.map(values => Array.isArray(values) && values.length ? [values[0], values[Math.floor(values.length / 2)], values[values.length - 1]] : null),
                xLabel: this.settings.xLabel || '',
                yLabel: this.settings.yLabel || '',
                xMin, xMax, yMin, yMax
            });
            if (signature === this.lastRenderedSignature) return;
            this.lastRenderedSignature = signature;

            // Read clientHeight before emptying so the new instance inherits the current size.
            const savedHeight = this.chartHost[0]?.clientHeight || this.chartHost.height() || 320;
            this._destroyPlot();
            this.chartHost.empty();
            const host = $('<div></div>');
            this.chartHost.append(host);
            const uplotHeight = Math.max(260, savedHeight);
            this.plot = new uPlot({
                width: Math.max(320, this.chartHost.width() || this.container.width() || 640),
                height: uplotHeight,
                legend: { show: !!this.settings.showLegend },
                scales: {
                    x: { time: false, min: xMin, max: xMax },
                    y: { min: yMin, max: yMax }
                },
                axes: [
                    { stroke: '#666', grid: { show: true }, label: this.settings.xLabel || this.settings.timeColumn || 'Sample' },
                    { stroke: '#666', grid: { show: true }, label: this.settings.yLabel || 'Value' }
                ],
                series
            }, data, host[0]);
            const lastValues = data.slice(1).map(arr => Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null);
            this._renderReadout(defs, lastValues);
            this._requestResize();
        }

        _renderReadout(defs, lastValues) {
            if (!this.readoutHost) return;
            if (!defs || !defs.length) {
                this.readoutHost.html('');
                this._applyPlotHeight();
                return;
            }
            const cards = defs.map((def, i) => {
                const val = lastValues && lastValues[i] != null ? this._formatValue(lastValues[i]) : '---';
                const color = _.escape(def.color || '#7aa2f7');
                const label = _.escape(def.label || `Series ${i + 1}`);
                return `<div class="uplot-readout-item">` +
                    `<span class="uplot-readout-swatch" style="border-color:${color};"></span>` +
                    `<span class="uplot-readout-label">${label}</span>` +
                    `<span class="uplot-readout-value">${val}</span>` +
                    `</div>`;
            });
            this.readoutHost.html(cards.join(''));
            this._applyPlotHeight();
        }

        _formatValue(val) {
            if (!Number.isFinite(val)) return '---';
            const abs = Math.abs(val);
            if (abs >= 1000 || (abs > 0 && abs < 0.01)) return val.toExponential(2);
            return Number(val.toFixed(3)).toString();
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
            this._resizeObs = new ResizeObserver(() => {
                this._applyPlotHeight();
                this._requestResize();
            });
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

        _measureAutoChartHeight() {
            const subSection = this.subSectionElement;
            const shell = this.container?.[0];
            const status = this.status?.[0];
            const readout = this.readoutHost?.[0];
            const toggle = this.channelToggleBtn?.[0];
            const panel = this._editorOpen ? this.channelPanel?.[0] : null;
            if (!subSection || !shell) return 0;
            const shellStyles = window.getComputedStyle(shell);
            const shellPaddingTop = parseFloat(shellStyles.paddingTop) || 0;
            const shellPaddingBottom = parseFloat(shellStyles.paddingBottom) || 0;
            const shellGap = parseFloat(shellStyles.rowGap || shellStyles.gap) || 0;
            const statusH = status ? status.offsetHeight : 0;
            const readoutH = readout ? readout.offsetHeight : 0;
            const toggleH = toggle ? toggle.offsetHeight : 0;
            const panelH = panel ? panel.offsetHeight : 0;
            // Use container.clientHeight when available — it accounts for the .widget
            // padding (5px top + 5px bottom) that subSection.clientHeight does not.
            // Fall back to subSection minus the hardcoded widget padding (10px).
            const containerH = shell.clientHeight;
            const baseH = containerH > 0 ? containerH : subSection.clientHeight - 10;
            // Fixed flex items: status, chartShell, readout, toggle (+panel when open).
            const numGaps = 3 + (this._editorOpen ? 1 : 0);
            const available = baseH
                - shellPaddingTop - shellPaddingBottom
                - statusH - readoutH - toggleH - panelH
                - shellGap * numGaps;
            return Math.max(160, available);
        }

        _applyPlotHeight() {
            const next = this.plotHeightPx;
            let targetH;
            if (typeof next === 'number' && Number.isFinite(next)) {
                const maxAllowed = this._measureAutoChartHeight();
                this.plotHeightPx = Math.min(Math.max(160, next), maxAllowed || Math.max(160, next));
                targetH = this.plotHeightPx;
            } else {
                this.plotHeightPx = null;
                targetH = this._measureAutoChartHeight();
            }
            // Always use flex: 0 0 auto so chartShell never grows beyond the computed
            // height and the readout + resize handle remain visible.
            this.chartShell.css({ height: targetH > 0 ? `${targetH}px` : '', flex: '0 0 auto' });
            this.chartHost.css({ flex: '1 1 auto' });
        }

        _bindHeightDrag() {
            if (!this.resizeHandle || this.resizeHandle.data('fast-frame-bound')) return;
            this.resizeHandle.data('fast-frame-bound', true);
            this.resizeHandle.on('mousedown', (event) => {
                event.preventDefault();
                const startY = event.clientY;
                const startHeight = this.chartShell[0]?.clientHeight || this.plotHeightPx || 320;
                const onMove = (moveEvent) => {
                    this.plotHeightPx = startHeight + (moveEvent.clientY - startY);
                    this._applyPlotHeight();
                    this._requestResize();
                };
                const onUp = () => {
                    $(window)
                        .off('mousemove.fast-frame-plot-resize', onMove)
                        .off('mouseup.fast-frame-plot-resize', onUp);
                    this._dragCleanup = null;
                };
                $(window)
                    .on('mousemove.fast-frame-plot-resize', onMove)
                    .on('mouseup.fast-frame-plot-resize', onUp);
                this._dragCleanup = onUp;
            });
        }

        // ── Inline channel editor ────────────────────────────────────────────────

        _buildChannelEditor() {
            const ed = {};
            ed.type = $('<select class="form-select form-select-sm"></select>')
                .append('<option value="regular">Regular</option>')
                .append('<option value="math">Math</option>');
            ed.variable = $('<select class="form-select form-select-sm"></select>');
            ed.mathA    = $('<select class="form-select form-select-sm"></select>');
            ed.mathOp   = $('<select class="form-select form-select-sm" style="max-width:56px"></select>')
                .append('<option value="+">+</option>').append('<option value="-">−</option>')
                .append('<option value="*">×</option>').append('<option value="/">/</option>');
            ed.mathB    = $('<select class="form-select form-select-sm"></select>');
            ed.mathK    = $('<input type="number" class="form-control form-control-sm" placeholder="k" step="any">');
            ed.label    = $('<input type="text" class="form-control form-control-sm" placeholder="Label (optional)">');
            ed.color    = $('<input type="color" class="form-control form-control-sm" value="#f28e2b" style="max-width:52px">');
            ed.visible  = $('<input type="checkbox" class="form-check-input" checked>');
            ed.list     = $('<div class="d-flex flex-column gap-1 mt-1"></div>');
            this._ed = ed;

            if (freeboard?.addStyle) {
                freeboard.addStyle('.ff-ed-lbl', 'min-width:68px;font-size:11px;justify-content:center;');
            }
            const mkRow = (lbl, ...ctrls) =>
                $('<div class="input-group input-group-sm"></div>')
                .append(`<span class="input-group-text ff-ed-lbl">${lbl}</span>`, ...ctrls);

            ed.varRow  = mkRow('Channel', ed.variable);
            ed.mathRow = $('<div class="d-flex gap-1"></div>').append(
                mkRow('A', ed.mathA), ed.mathOp, mkRow('B', ed.mathB)
            );
            ed.mathKRow = mkRow('k', ed.mathK);

            ed.type.on('change', () => {
                const math = ed.type.val() === 'math';
                ed.varRow.toggle(!math);
                ed.mathRow.toggle(math);
                ed.mathKRow.hide();
            });
            ed.mathB.on('change', () => ed.mathKRow.toggle(ed.mathB.val() === '__const__'));

            const addBtn = $('<button class="btn btn-primary btn-sm w-100">Add channel</button>')
                .on('click', () => this._addChannel());

            this.channelPanel = $('<div class="d-flex flex-column gap-1 border rounded p-2" style="display:none"></div>').append(
                mkRow('Type', ed.type),
                ed.varRow,
                ed.mathRow,
                ed.mathKRow,
                mkRow('Label', ed.label),
                $('<div class="d-flex gap-1"></div>').append(
                    mkRow('Color', ed.color),
                    $('<div class="input-group input-group-sm"></div>').append(
                        '<label class="input-group-text ff-ed-lbl">Visible</label>',
                        $('<span class="input-group-text"></span>').append(ed.visible)
                    )
                ),
                addBtn,
                ed.list
            );

            this.channelToggleBtn = $('<button class="btn btn-outline-secondary btn-sm w-100">▼ Channels</button>')
                .on('click', () => this._toggleChannelEditor());

            ed.varRow.show(); ed.mathRow.hide(); ed.mathKRow.hide();
        }

        _toggleChannelEditor() {
            this._editorOpen = !this._editorOpen;
            this.channelPanel.toggle(this._editorOpen);
            this.channelToggleBtn.text(this._editorOpen ? '▲ Channels' : '▼ Channels');
            if (this._editorOpen) {
                this._refreshEditorColumns();
                this._renderChannelList();
            }
            this._applyPlotHeight();
            this._requestResize();
        }

        _refreshEditorColumns() {
            if (!this._ed) return;
            const cols = this.availableColumns || [];
            const fill = (sel) => {
                const prev = sel.val();
                sel.empty();
                cols.forEach(c => sel.append(`<option value="${c}">${c}</option>`));
                if (prev && sel.find(`option[value="${prev}"]`).length) sel.val(prev);
            };
            fill(this._ed.variable);
            fill(this._ed.mathA);
            const prevB = this._ed.mathB.val();
            this._ed.mathB.empty();
            cols.forEach(c => this._ed.mathB.append(`<option value="${c}">${c}</option>`));
            this._ed.mathB.append('<option value="__const__">— constant k —</option>');
            if (prevB && this._ed.mathB.find(`option[value="${prevB}"]`).length) this._ed.mathB.val(prevB);
            this._ed.mathKRow.toggle(this._ed.mathB.val() === '__const__');
        }

        _renderChannelList() {
            if (!this._ed) return;
            this._ed.list.empty();
            const defs = shared.normalizeSeriesDefs(this.settings, this.availableColumns || []);
            if (!defs.length) {
                this._ed.list.append('<div class="small text-muted">No channels yet.</div>');
                return;
            }
            defs.forEach((def, i) => {
                const subtitle = def.type === 'math'
                    ? `${def.operandA} ${def.operator} ${def.operandB}`
                    : def.variable;
                const row = $('<div class="d-flex align-items-center gap-1 border rounded px-2 py-1"></div>');
                row.append(
                    $(`<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${_.escape(def.color)};flex-shrink:0"></span>`),
                    $(`<span class="small flex-fill text-truncate">${_.escape(def.label)} <span class="text-muted">(${_.escape(subtitle)})</span></span>`),
                    $('<button class="btn btn-outline-danger btn-sm" style="padding:1px 6px;font-size:11px">✕</button>')
                        .on('click', () => this._removeChannel(i))
                );
                this._ed.list.append(row);
            });
        }

        _addChannel() {
            const ed = this._ed;
            if (!ed) return;
            const currentDefs = Array.isArray(this.settings.seriesDefs) ? [...this.settings.seriesDefs] : [];
            const color = ed.color.val() || shared.DEFAULT_COLORS[currentDefs.length % shared.DEFAULT_COLORS.length];
            const visible = ed.visible.prop('checked');
            const label = ed.label.val().trim();
            let newDef;
            if (ed.type.val() === 'math') {
                const operandA = ed.mathA.val();
                const operator = ed.mathOp.val();
                const bIsConst = ed.mathB.val() === '__const__';
                const operandB = bIsConst ? String(parseFloat(ed.mathK.val()) || 0) : ed.mathB.val();
                if (!operandA || !operator || !operandB) return;
                newDef = { type: 'math', operandA, operator, operandB,
                    label: label || `${operandA} ${operator} ${operandB}`, color, visible };
            } else {
                const variable = ed.variable.val();
                if (!variable) return;
                newDef = { variable, label: label || variable, color, visible };
            }
            currentDefs.push(newDef);
            this._updateSeriesDefs(currentDefs);
            ed.label.val('');
        }

        _removeChannel(index) {
            const defs = shared.normalizeSeriesDefs(this.settings, this.availableColumns || []);
            defs.splice(index, 1);
            this._updateSeriesDefs(defs);
        }

        _updateSeriesDefs(defs) {
            this.settings = { ...this.settings, seriesDefs: defs };
            this.lastRenderedSignature = '';
            this._renderChannelList();
            const model = freeboard.getLiveModel?.();
            if (!model) return;
            model.panes?.().forEach(pane => pane.widgets?.().forEach(w => {
                if (w.widgetInstance === this) {
                    w.settings({ ...(w.settings() || {}), seriesDefs: defs });
                }
            }));
        }

        // ─────────────────────────────────────────────────────────────────────────

        onSettingsChanged(newSettings) {
            this.settings = { ...newSettings };
            this.lastFileSignature = '';
            this.lastRenderedSignature = '';
            this._helperSpawnKey = null;
            this._scheduleHelperSpawn();
            this._startPolling();
            this._requestResize();
            if (this._editorOpen) this._renderChannelList();
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

        getHeight() { return 10; }
    }
}());
