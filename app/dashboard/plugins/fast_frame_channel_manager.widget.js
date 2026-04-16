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
            if (freeboard?.addStyle) {
                freeboard.addStyle('.fast-frame-channel-manager .input-group-text', 'min-width:130px;justify-content:center;');
                freeboard.addStyle('.fast-frame-channel-item', 'border:1px solid #444;border-radius:4px;padding:6px;');
            }
        }

        render(el) {
            $(el).append(this.container);
            this.container.empty();
            this.controls.target = $('<select class="form-select form-select-sm"></select>');
            this.controls.variable = $('<select class="form-select form-select-sm"></select>');
            this.controls.label = $('<input type="text" class="form-control form-control-sm" placeholder="Optional label">');
            this.controls.color = $('<input type="color" class="form-control form-control-sm" value="#4e79a7">');
            this.controls.visible = $('<input type="checkbox" class="form-check-input mt-0" checked>');
            this.list = $('<div class="d-flex flex-column gap-1"></div>');

            const makeRow = (label, control) => $('<div class="input-group input-group-sm fast-frame-channel-manager"></div>').append(`<span class="input-group-text">${label}</span>`, control);
            this.container.append(
                makeRow('Target Plot', this.controls.target),
                makeRow('Variable', this.controls.variable),
                makeRow('Label', this.controls.label),
                makeRow('Color', this.controls.color),
                $('<div class="input-group input-group-sm fast-frame-channel-manager"></div>').append('<label class="input-group-text">Visible</label>', $('<span class="input-group-text"></span>').append(this.controls.visible)),
                $('<div class="d-flex gap-1"></div>')
                    .append($('<button class="btn btn-primary btn-sm">Add Channel</button>').on('click', () => this.addChannel()))
                    .append($('<button class="btn btn-outline-danger btn-sm">Reset Channels</button>').on('click', () => this.resetChannels())),
                $('<hr/>'),
                this.list
            );

            this.controls.target.on('change', () => {
                this.populateVariables();
                this.renderSeriesList();
            });

            const refresh = () => {
                this.populateTargets();
                this.populateVariables();
                this.renderSeriesList();
            };
            freeboard.on?.('config_updated', refresh);
            refresh();
        }

        _targetWidget() {
            return shared.findWidgetByTitle(this.controls.target.val(), 'fast_frame_plot');
        }

        populateTargets() {
            const current = this.controls.target.val();
            const targets = shared.listWidgetsByType('fast_frame_plot');
            this.controls.target.empty();
            targets.forEach(entry => this.controls.target.append(`<option value="${entry.title}">${entry.title}</option>`));
            if (current && this.controls.target.find(`option[value="${current}"]`).length) this.controls.target.val(current);
            else if (!current && targets.length) this.controls.target.val(targets[0].title);
        }

        populateVariables() {
            const widget = this._targetWidget();
            const columns = Array.isArray(widget?.widgetInstance?.availableColumns) ? widget.widgetInstance.availableColumns : [];
            const current = this.controls.variable.val();
            this.controls.variable.empty();
            columns.forEach(column => this.controls.variable.append(`<option value="${column}">${column}</option>`));
            if (current && this.controls.variable.find(`option[value="${current}"]`).length) this.controls.variable.val(current);
            else if (!current && columns.length) this.controls.variable.val(columns[0]);
        }

        addChannel() {
            const widget = this._targetWidget();
            const variable = this.controls.variable.val();
            if (!widget || !variable) return;
            const defs = shared.normalizeSeriesDefs(widget.settings(), widget.widgetInstance?.availableColumns || []);
            defs.push({
                variable,
                label: this.controls.label.val() || variable,
                color: this.controls.color.val() || shared.DEFAULT_COLORS[defs.length % shared.DEFAULT_COLORS.length],
                visible: this.controls.visible.prop('checked')
            });
            shared.updateWidgetSettings(widget, { seriesDefs: defs });
            this.renderSeriesList();
        }

        resetChannels() {
            const widget = this._targetWidget();
            if (!widget) return;
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
            const defs = widget ? shared.normalizeSeriesDefs(widget.settings(), widget.widgetInstance?.availableColumns || []) : [];
            this.list.empty();
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
