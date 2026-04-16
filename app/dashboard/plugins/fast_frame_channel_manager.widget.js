(function () {
    const shared = window.FastFrameShared;

    freeboard.loadWidgetPlugin({
        type_name: 'fast_frame_channel_manager',
        display_name: 'Fast Frame Channel Manager',
        category: 'Fast Frame',
        description: 'Manage multiple fast-frame channels on a target time plot',
        settings: [],
        newInstance: function (settings, cb) { cb(new FastFrameChannelManager(settings)); }
    });

    class FastFrameChannelManager {
        constructor(settings) {
            this.settings = settings;
            this.container = $('<div class="h-100 overflow-auto p-2 d-flex flex-column gap-2"></div>');
            this.controls = {};
            this.selectedCsvPath = '';
            if (freeboard?.addStyle) {
                freeboard.addStyle('.fast-frame-channel-manager .input-group-text', 'min-width:130px;justify-content:center;');
                freeboard.addStyle('.fast-frame-channel-item', 'border:1px solid #444;border-radius:4px;padding:6px;');
                freeboard.addStyle('.fast-frame-channel-manager .is-hidden', 'display:none;');
            }
        }

        render(el) {
            $(el).append(this.container);
            this.container.empty();
            this.controls.target = $('<select class="form-select form-select-sm"></select>');
            this.controls.csvButton = $('<button class="btn btn-outline-secondary btn-sm w-100">Choose CSV File</button>');
            this.controls.csvName = $('<div class="small text-muted border rounded p-2">No file selected.</div>');
            this.controls.timeColumn = $('<select class="form-select form-select-sm"></select>');
            this.controls.variable = $('<select class="form-select form-select-sm"></select>');
            this.controls.xVariable = $('<select class="form-select form-select-sm"></select>');
            this.controls.yVariable = $('<select class="form-select form-select-sm"></select>');
            this.controls.label = $('<input type="text" class="form-control form-control-sm" placeholder="Optional label">');
            this.controls.color = $('<input type="color" class="form-control form-control-sm" value="#4e79a7">');
            this.controls.visible = $('<input type="checkbox" class="form-check-input mt-0" checked>');
            this.list = $('<div class="d-flex flex-column gap-1"></div>');

            const makeRow = (label, control) => $('<div class="input-group input-group-sm fast-frame-channel-manager"></div>').append(`<span class="input-group-text">${label}</span>`, control);
            this.csvRow = $('<div class="d-flex flex-column gap-1"></div>').append(this.controls.csvButton, this.controls.csvName);
            this.timeRow = makeRow('Time Column', this.controls.timeColumn);
            this.variableRow = makeRow('Variable', this.controls.variable);
            this.xRow = makeRow('X Variable', this.controls.xVariable);
            this.yRow = makeRow('Y Variable', this.controls.yVariable);
            this.labelRow = makeRow('Label', this.controls.label);
            this.colorRow = makeRow('Color', this.controls.color);
            this.visibleRow = $('<div class="input-group input-group-sm fast-frame-channel-manager"></div>').append('<label class="input-group-text">Visible</label>', $('<span class="input-group-text"></span>').append(this.controls.visible));
            this.actions = $('<div class="d-flex gap-1"></div>')
                .append($('<button class="btn btn-outline-secondary btn-sm">Apply Source</button>').on('click', () => this.applySource()))
                .append($('<button class="btn btn-primary btn-sm">Add Channel</button>').on('click', () => this.addChannel()))
                .append($('<button class="btn btn-outline-danger btn-sm">Reset Channels</button>').on('click', () => this.resetChannels()));
            this.container.append(
                makeRow('Target Plot', this.controls.target),
                this.csvRow,
                this.timeRow,
                this.variableRow,
                this.xRow,
                this.yRow,
                this.labelRow,
                this.colorRow,
                this.visibleRow,
                this.actions,
                $('<hr/>'),
                this.list
            );

            this.controls.target.on('change', () => {
                this.syncTargetState();
                this.populateVariables();
                this.renderSeriesList();
            });
            this.controls.csvButton.on('click', () => this.chooseCsvFile());

            const refresh = () => {
                this.populateTargets();
                this.syncTargetState();
                this.populateVariables();
                this.renderSeriesList();
            };
            freeboard.on?.('config_updated', refresh);
            refresh();
        }

        _targetWidget() {
            return shared.findWidgetByTitle(this.controls.target.val(), ['fast_frame_plot', 'fast_frame_xy_plot']);
        }

        populateTargets() {
            const current = this.controls.target.val();
            const targets = shared.listWidgetsByType(['fast_frame_plot', 'fast_frame_xy_plot']);
            this.controls.target.empty();
            targets.forEach(entry => this.controls.target.append(`<option value="${entry.title}">${entry.title}</option>`));
            if (current && this.controls.target.find(`option[value="${current}"]`).length) this.controls.target.val(current);
            else if (!current && targets.length) this.controls.target.val(targets[0].title);
        }

        syncTargetState() {
            const widget = this._targetWidget();
            const isXY = widget?.type() === 'fast_frame_xy_plot';
            const settings = widget?.settings() || {};
            this.selectedCsvPath = settings.csvPath || '';
            this.controls.csvName.text(this._csvLabel(this.selectedCsvPath));
            this.timeRow.toggleClass('is-hidden', isXY);
            this.variableRow.toggleClass('is-hidden', isXY);
            this.labelRow.toggleClass('is-hidden', isXY);
            this.colorRow.toggleClass('is-hidden', isXY);
            this.visibleRow.toggleClass('is-hidden', isXY);
            this.xRow.toggleClass('is-hidden', !isXY);
            this.yRow.toggleClass('is-hidden', !isXY);
            const addBtn = this.actions.find('.btn-primary');
            const resetBtn = this.actions.find('.btn-outline-danger');
            addBtn.toggleClass('is-hidden', isXY);
            resetBtn.toggleClass('is-hidden', isXY);
            const columns = Array.isArray(widget?.widgetInstance?.availableColumns) ? widget.widgetInstance.availableColumns : [];
            const fill = (select, value, placeholder) => {
                select.empty().append(`<option value="">${placeholder}</option>`);
                columns.forEach(column => select.append(`<option value="${column}">${column}</option>`));
                select.val(value || '');
            };
            fill(this.controls.timeColumn, settings.timeColumn, 'Row index');
            fill(this.controls.variable, '', 'Select variable');
            fill(this.controls.xVariable, settings.xVariable, 'Select X variable');
            fill(this.controls.yVariable, settings.yVariable, 'Select Y variable');
        }

        async chooseCsvFile() {
            const chooser = shared.fileApi?.chooseCsvFile;
            if (!chooser) return;
            const chosen = await chooser();
            if (!chosen) return;
            this.selectedCsvPath = chosen;
            this.controls.csvName.text(this._csvLabel(chosen));
            this.applySource();
            this.populateVariables();
            this.renderSeriesList();
        }

        _csvLabel(filePath) {
            if (!filePath) return 'No file selected.';
            const parts = String(filePath).split(/[\\/]/);
            return parts[parts.length - 1] || filePath;
        }

        populateVariables() {
            const widget = this._targetWidget();
            const columns = Array.isArray(widget?.widgetInstance?.availableColumns) ? widget.widgetInstance.availableColumns : [];
            const fill = (select, current, placeholder) => {
                select.empty().append(`<option value="">${placeholder}</option>`);
                columns.forEach(column => select.append(`<option value="${column}">${column}</option>`));
                if (current && select.find(`option[value="${current}"]`).length) select.val(current);
                else if (!current && columns.length) select.val(columns[0]);
            };
            fill(this.controls.variable, this.controls.variable.val(), 'Select variable');
            fill(this.controls.xVariable, this.controls.xVariable.val(), 'Select X variable');
            fill(this.controls.yVariable, this.controls.yVariable.val(), 'Select Y variable');
            fill(this.controls.timeColumn, this.controls.timeColumn.val(), 'Row index');
        }

        applySource() {
            const widget = this._targetWidget();
            if (!widget) return;
            const isXY = widget.type() === 'fast_frame_xy_plot';
            const csvPath = this.selectedCsvPath || widget.settings().csvPath || '';
            const csvDirectory = csvPath ? (shared.pathApi?.dirname ? shared.pathApi.dirname(csvPath) : shared.defaultCsvDirectory()) : (widget.settings().csvDirectory || shared.defaultCsvDirectory());
            shared.updateWidgetSettings(widget, {
                csvDirectory,
                csvPath,
                timeColumn: isXY ? widget.settings().timeColumn : (this.controls.timeColumn.val() || ''),
                xVariable: isXY ? (this.controls.xVariable.val() || '') : widget.settings().xVariable,
                yVariable: isXY ? (this.controls.yVariable.val() || '') : widget.settings().yVariable
            });
        }

        addChannel() {
            const widget = this._targetWidget();
            const variable = this.controls.variable.val();
            if (!widget || widget.type() !== 'fast_frame_plot' || !variable) return;
            const defs = shared.normalizeSeriesDefs(widget.settings(), widget.widgetInstance?.availableColumns || []);
            const csvPath = this.selectedCsvPath || widget.settings().csvPath || '';
            const csvDirectory = csvPath ? (shared.pathApi?.dirname ? shared.pathApi.dirname(csvPath) : shared.defaultCsvDirectory()) : (widget.settings().csvDirectory || shared.defaultCsvDirectory());
            defs.push({
                variable,
                label: this.controls.label.val() || variable,
                color: this.controls.color.val() || shared.DEFAULT_COLORS[defs.length % shared.DEFAULT_COLORS.length],
                visible: this.controls.visible.prop('checked')
            });
            shared.updateWidgetSettings(widget, {
                csvDirectory,
                csvPath,
                timeColumn: this.controls.timeColumn.val() || '',
                seriesDefs: defs
            });
            this.renderSeriesList();
        }

        resetChannels() {
            const widget = this._targetWidget();
            if (!widget || widget.type() !== 'fast_frame_plot') return;
            shared.updateWidgetSettings(widget, { seriesDefs: [] });
            this.renderSeriesList();
        }

        removeChannel(index) {
            const widget = this._targetWidget();
            if (!widget) return;
            const defs = shared.normalizeSeriesDefs(widget.settings(), widget.widgetInstance?.availableColumns || []);
            defs.splice(index, 1);
            shared.updateWidgetSettings(widget, { seriesDefs: defs });
            this.renderSeriesList();
        }

        renderSeriesList() {
            const widget = this._targetWidget();
            this.list.empty();
            if (widget?.type() === 'fast_frame_xy_plot') {
                const settings = widget.settings();
                this.list.append(`<div class="small text-muted">XY Pair: ${settings.xVariable || '--'} vs ${settings.yVariable || '--'}</div>`);
                return;
            }
            const defs = widget ? shared.normalizeSeriesDefs(widget.settings(), widget.widgetInstance?.availableColumns || []) : [];
            defs.forEach((def, index) => {
                const row = $('<div class="fast-frame-channel-item d-flex justify-content-between align-items-center gap-2"></div>');
                row.append(`<div>${def.label} <span class="text-muted">(${def.variable})</span></div>`);
                row.append($('<button class="btn btn-outline-danger btn-sm">Remove</button>').on('click', () => this.removeChannel(index)));
                this.list.append(row);
            });
            if (!defs.length) {
                this.list.append('<div class="small text-muted">No channels configured.</div>');
            }
        }

        onSettingsChanged(s) { this.settings = s; }
        getHeight() { return 7; }
        onDispose() {}
    }
}());
