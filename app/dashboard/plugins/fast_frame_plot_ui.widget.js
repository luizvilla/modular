(function () {
    const shared = window.FastFrameShared;
    const TARGET_TYPES = ['fast_frame_plot', 'fast_frame_xy_plot'];

    freeboard.loadWidgetPlugin({
        type_name: 'fast_frame_plot_ui',
        display_name: 'Fast Frame UI',
        category: 'Fast Frame',
        description: 'Configure a Fast Frame plot widget',
        settings: [],
        newInstance: function (settings, cb) { cb(new FastFramePlotUI(settings)); }
    });

    class FastFramePlotUI {
        constructor(settings) {
            this.settings = settings;
            this.container = $('<div class="h-100 overflow-auto p-2"></div>');
            this.controls = {};
            if (freeboard?.addStyle) {
                freeboard.addStyle('.fast-frame-plot-ui .input-group-text', 'min-width:150px;justify-content:center;');
                freeboard.addStyle('.fast-frame-plot-ui .form-control, .fast-frame-plot-ui .form-select', 'min-width:150px;');
                freeboard.addStyle('.fast-frame-plot-ui .is-hidden', 'display:none;');
            }
        }

        render(el) {
            $(el).append(this.container);
            this.container.empty();

            const form = $('<div class="d-flex flex-column gap-1"></div>');
            const makeRow = (label, control) => $('<div class="input-group input-group-sm fast-frame-plot-ui"></div>').append(`<span class="input-group-text">${label}</span>`, control);

            this.controls.target = $('<select class="form-select form-select-sm"></select>');
            this.controls.title = $('<input type="text" class="form-control form-control-sm">');
            this.controls.csvDirectory = $('<input type="text" class="form-control form-control-sm">');
            this.controls.csvPath = $('<input type="text" class="form-control form-control-sm">');
            this.controls.refreshRate = $('<input type="number" class="form-control form-control-sm">');
            this.controls.timeColumn = $('<select class="form-select form-select-sm"></select>');
            this.controls.xVariable = $('<select class="form-select form-select-sm"></select>');
            this.controls.yVariable = $('<select class="form-select form-select-sm"></select>');
            this.controls.xLabel = $('<input type="text" class="form-control form-control-sm">');
            this.controls.yLabel = $('<input type="text" class="form-control form-control-sm">');
            this.controls.xMin = $('<input type="number" step="any" class="form-control form-control-sm">');
            this.controls.xMax = $('<input type="number" step="any" class="form-control form-control-sm">');
            this.controls.yMin = $('<input type="number" step="any" class="form-control form-control-sm">');
            this.controls.yMax = $('<input type="number" step="any" class="form-control form-control-sm">');
            this.controls.showLegend = $('<input type="checkbox" class="form-check-input mt-0">');

            this.timeRow = makeRow('Time Column', this.controls.timeColumn);
            this.xRow = makeRow('X Variable', this.controls.xVariable);
            this.legendRow = $('<div class="input-group input-group-sm fast-frame-plot-ui"></div>').append('<label class="input-group-text">Show Legend</label>', $('<span class="input-group-text"></span>').append(this.controls.showLegend));

            form.append(
                makeRow('Target Plot', this.controls.target),
                makeRow('Title', this.controls.title),
                makeRow('CSV Directory', this.controls.csvDirectory),
                makeRow('CSV Path', this.controls.csvPath),
                makeRow('Refresh Rate', this.controls.refreshRate),
                this.timeRow,
                this.xRow,
                makeRow('Y Variable', this.controls.yVariable),
                makeRow('X Label', this.controls.xLabel),
                makeRow('Y Label', this.controls.yLabel),
                makeRow('X Min', this.controls.xMin),
                makeRow('X Max', this.controls.xMax),
                makeRow('Y Min', this.controls.yMin),
                makeRow('Y Max', this.controls.yMax),
                this.legendRow
            );

            const applyBtn = $('<button class="btn btn-primary btn-sm w-100 mt-2">Apply Settings</button>');
            applyBtn.on('click', () => this.applySettings());
            this.controls.target.on('change', () => this.syncFromSelectedWidget());
            this.container.append(form, applyBtn);

            const refresh = () => this.populateTargets();
            freeboard.on?.('config_updated', refresh);
            this.populateTargets();
        }

        populateTargets() {
            const current = this.controls.target.val();
            const targets = shared.listWidgetsByType(TARGET_TYPES);
            this.controls.target.empty();
            targets.forEach(entry => this.controls.target.append(`<option value="${entry.title}">${entry.title}</option>`));
            if (current && this.controls.target.find(`option[value="${current}"]`).length) this.controls.target.val(current);
            else if (!current && targets.length) this.controls.target.val(targets[0].title);
            this.syncFromSelectedWidget();
        }

        _targetWidget() {
            return shared.findWidgetByTitle(this.controls.target.val(), TARGET_TYPES);
        }

        syncFromSelectedWidget() {
            const widget = this._targetWidget();
            if (!widget) return;
            const s = widget.settings();
            const instance = widget.widgetInstance;
            const isXY = widget.type() === 'fast_frame_xy_plot';
            this.timeRow.toggleClass('is-hidden', isXY);
            this.xRow.toggleClass('is-hidden', !isXY);
            this.legendRow.toggleClass('is-hidden', isXY);

            this.controls.title.val(s.title || '');
            this.controls.csvDirectory.val(s.csvDirectory || shared.defaultCsvDirectory());
            this.controls.csvPath.val(s.csvPath || '');
            this.controls.refreshRate.val(s.refreshRate || 500);
            this.controls.xLabel.val(s.xLabel || '');
            this.controls.yLabel.val(s.yLabel || '');
            this.controls.xMin.val(s.xMin ?? '');
            this.controls.xMax.val(s.xMax ?? '');
            this.controls.yMin.val(s.yMin ?? '');
            this.controls.yMax.val(s.yMax ?? '');
            this.controls.showLegend.prop('checked', !!s.showLegend);

            const columns = Array.isArray(instance?.availableColumns) ? instance.availableColumns : [];
            const fill = (select, value, placeholder) => {
                select.empty().append(`<option value="">${placeholder}</option>`);
                columns.forEach(column => select.append(`<option value="${column}">${column}</option>`));
                select.val(value || '');
            };
            fill(this.controls.timeColumn, s.timeColumn, 'Row index');
            fill(this.controls.xVariable, s.xVariable, 'Select X variable');
            fill(this.controls.yVariable, s.yVariable, 'Select Y variable');
        }

        applySettings() {
            const widget = this._targetWidget();
            if (!widget) return;
            const isXY = widget.type() === 'fast_frame_xy_plot';
            shared.updateWidgetSettings(widget, {
                title: this.controls.title.val() || widget.settings().title,
                csvDirectory: this.controls.csvDirectory.val() || shared.defaultCsvDirectory(),
                csvPath: this.controls.csvPath.val() || '',
                refreshRate: parseInt(this.controls.refreshRate.val(), 10) || 500,
                timeColumn: isXY ? widget.settings().timeColumn : (this.controls.timeColumn.val() || ''),
                xVariable: isXY ? (this.controls.xVariable.val() || '') : widget.settings().xVariable,
                yVariable: this.controls.yVariable.val() || '',
                xLabel: this.controls.xLabel.val() || '',
                yLabel: this.controls.yLabel.val() || '',
                xMin: this.controls.xMin.val(),
                xMax: this.controls.xMax.val(),
                yMin: this.controls.yMin.val(),
                yMax: this.controls.yMax.val(),
                showLegend: isXY ? widget.settings().showLegend : this.controls.showLegend.prop('checked')
            });
        }

        onSettingsChanged(s) { this.settings = s; }
        getHeight() { return 8; }
        onDispose() {}
    }
}());
