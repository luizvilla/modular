(function () {
    const shared = window.FastFrameShared;
    const TARGET_TYPES = ['fast_frame_plot'];

    freeboard.loadWidgetPlugin({
        type_name: 'fast_frame_plot_ui',
        display_name: 'Fast Frame UI',
        category: 'Fast Frame',
        icon: 'chart-line',
        description: 'Configure a Fast Frame plot widget',
        settings: [],
        newInstance: function (settings, cb) { cb(new FastFramePlotUI(settings)); }
    });

    class FastFramePlotUI {
        constructor(settings) {
            this.settings = settings;
            this.container = $('<div class="h-100 overflow-auto p-2"></div>');
            this.controls = {};
            this._configHandler = () => this.populateTargets();
            if (freeboard?.addStyle) {
                freeboard.addStyle('.fast-frame-plot-ui .input-group-text', 'min-width:150px;justify-content:center;');
                freeboard.addStyle('.fast-frame-plot-ui .form-control, .fast-frame-plot-ui .form-select', 'min-width:150px;');
                freeboard.addStyle('.fast-frame-plot-ui .is-hidden', 'display:none;');
            }
            freeboard.on?.('config_updated', this._configHandler);
        }

        render(el) {
            $(el).append(this.container);
            this.container.empty();

            const form = $('<div class="d-flex flex-column gap-1"></div>');
            const makeRow = (label, control) => $('<div class="input-group input-group-sm fast-frame-plot-ui"></div>').append(`<span class="input-group-text">${label}</span>`, control);

            this.controls.target = $('<select class="form-select form-select-sm"></select>');
            this.controls.title = $('<input type="text" class="form-control form-control-sm">');
            this.controls.xLabel = $('<input type="text" class="form-control form-control-sm">');
            this.controls.yLabel = $('<input type="text" class="form-control form-control-sm">');
            this.controls.xMin = $('<input type="number" step="any" class="form-control form-control-sm">');
            this.controls.xMax = $('<input type="number" step="any" class="form-control form-control-sm">');
            this.controls.yMin = $('<input type="number" step="any" class="form-control form-control-sm">');
            this.controls.yMax = $('<input type="number" step="any" class="form-control form-control-sm">');
            this.controls.showLegend = $('<input type="checkbox" class="form-check-input mt-0">');
            this.legendRow = $('<div class="input-group input-group-sm fast-frame-plot-ui"></div>').append('<label class="input-group-text">Show Legend</label>', $('<span class="input-group-text"></span>').append(this.controls.showLegend));

            form.append(
                makeRow('Target Plot', this.controls.target),
                makeRow('Title', this.controls.title),
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
            this.populateTargets();
        }

        populateTargets() {
            if (!this.controls?.target) return;
            const current = this.controls.target.val();
            const targets = shared.listWidgetsByType(TARGET_TYPES);
            this.controls.target.empty();
            targets.forEach(entry => this.controls.target.append(`<option value="${entry.title}">${entry.title}</option>`));
            if (current && this.controls.target.find(`option[value="${current}"]`).length) this.controls.target.val(current);
            else if (!current && targets.length) this.controls.target.val(targets[0].title);
            this.syncFromSelectedWidget();
        }

        _targetWidget() {
            if (!this.controls?.target) return null;
            return shared.findWidgetByTitle(this.controls.target.val(), TARGET_TYPES);
        }

        syncFromSelectedWidget() {
            if (!this.controls?.title || !this.controls?.showLegend) return;
            const widget = this._targetWidget();
            if (!widget) return;
            const s = widget.settings();

            this.controls.title.val(s.title || '');
            this.controls.xLabel.val(s.xLabel || '');
            this.controls.yLabel.val(s.yLabel || '');
            this.controls.xMin.val(s.xMin ?? '');
            this.controls.xMax.val(s.xMax ?? '');
            this.controls.yMin.val(s.yMin ?? '');
            this.controls.yMax.val(s.yMax ?? '');
            this.controls.showLegend.prop('checked', !!s.showLegend);
            this.legendRow.removeClass('is-hidden');
        }

        applySettings() {
            if (!this.controls?.title || !this.controls?.showLegend) return;
            const widget = this._targetWidget();
            if (!widget) return;
            shared.updateWidgetSettings(widget, {
                title: this.controls.title.val() || widget.settings().title,
                xLabel: this.controls.xLabel.val() || '',
                yLabel: this.controls.yLabel.val() || '',
                xMin: this.controls.xMin.val(),
                xMax: this.controls.xMax.val(),
                yMin: this.controls.yMin.val(),
                yMax: this.controls.yMax.val(),
                showLegend: this.controls.showLegend.prop('checked')
            });
        }

        onSettingsChanged(s) { this.settings = s; }
        getHeight() { return 8; }
        onDispose() {
            if (this._configHandler && freeboard.off) {
                freeboard.off('config_updated', this._configHandler);
            }
        }
    }
}());
