(function () {
    const shared = window.FastFrameShared;

    freeboard.loadWidgetPlugin({
        type_name: 'fast_frame_channel_manager',
        display_name: 'Fast Frame Channel Manager',
        compatibility_only: true,
        category: 'Controls',
        icon: 'layer-group',
        description: 'Manage fast-frame CSV source and plotted channels on a target plot',
        settings: [],
        newInstance: function (settings, cb) { cb(new FastFrameChannelManager(settings)); }
    });

    class FastFrameChannelManager {
        constructor(settings) {
            this.settings = settings;
            this.container = $('<div class="h-100 overflow-auto p-2 d-flex flex-column gap-2"></div>');
            this.controls = {};
            this.selectedCsvPath = '';
            this.availableColumns = [];
            this._configHandler = () => {
                this.populateTargets();
                this.syncTargetState();
                this.populateVariables();
                this.renderSeriesList();
            };
            if (freeboard?.addStyle) {
                freeboard.addStyle('.fast-frame-channel-manager .input-group-text', 'min-width:130px;justify-content:center;');
                freeboard.addStyle('.fast-frame-channel-item', 'border:1px solid #444;border-radius:4px;padding:6px;');
                freeboard.addStyle('.fast-frame-channel-manager .is-hidden', 'display:none;');
            }
            freeboard.on?.('config_updated', this._configHandler);
        }

        render(el) {
            $(el).append(this.container);
            this.container.empty();
            this.controls.target = $('<select class="form-select form-select-sm"></select>');
            this.controls.sourceMode = $('<select class="form-select form-select-sm"></select>')
                .append('<option value="latest">Latest CSV in directory</option>')
                .append('<option value="fixed">Fixed CSV file</option>');
            this.controls.csvButton = $('<button class="btn btn-outline-secondary btn-sm w-100">Choose CSV File</button>');
            this.controls.csvName = $('<div class="small text-muted border rounded p-2">No file selected.</div>');
            this.controls.xVariable = $('<select class="form-select form-select-sm"></select>');
            this.controls.yVariable = $('<select class="form-select form-select-sm"></select>');
            this.controls.label = $('<input type="text" class="form-control form-control-sm" placeholder="Optional label">');
            this.controls.color = $('<input type="color" class="form-control form-control-sm" value="#4e79a7">');
            this.controls.visible = $('<input type="checkbox" class="form-check-input mt-0" checked>');
            // Math channel controls
            this.controls.channelType = $('<select class="form-select form-select-sm"></select>')
                .append('<option value="regular">Regular</option>')
                .append('<option value="math">Math</option>');
            this.controls.mathA = $('<select class="form-select form-select-sm"></select>');
            this.controls.mathOp = $('<select class="form-select form-select-sm" style="max-width:70px"></select>')
                .append('<option value="+">+</option>')
                .append('<option value="-">−</option>')
                .append('<option value="*">×</option>')
                .append('<option value="/">/</option>');
            this.controls.mathB = $('<input type="text" class="form-control form-control-sm" placeholder="channel or number">');
            this.list = $('<div class="d-flex flex-column gap-1"></div>');

            const makeRow = (label, control) => $('<div class="input-group input-group-sm fast-frame-channel-manager"></div>').append(`<span class="input-group-text">${label}</span>`, control);
            this.csvRow = $('<div class="d-flex flex-column gap-1"></div>').append(this.controls.csvButton, this.controls.csvName);
            this.xRow = makeRow('X Variable', this.controls.xVariable);
            this.yRow = makeRow('Y Variable', this.controls.yVariable);
            this.mathRow = $('<div class="input-group input-group-sm fast-frame-channel-manager is-hidden"></div>')
                .append('<span class="input-group-text">Math</span>', this.controls.mathA, this.controls.mathOp, this.controls.mathB);
            this.labelRow = makeRow('Label', this.controls.label);
            this.colorRow = makeRow('Color', this.controls.color);
            this.visibleRow = $('<div class="input-group input-group-sm fast-frame-channel-manager"></div>').append('<label class="input-group-text">Visible</label>', $('<span class="input-group-text"></span>').append(this.controls.visible));
            this.actions = $('<div class="d-flex gap-1"></div>')
                .append($('<button class="btn btn-outline-secondary btn-sm">Apply Source</button>').on('click', () => this.applySource()))
                .append($('<button class="btn btn-primary btn-sm">Add Channel</button>').on('click', () => this.addChannel()))
                .append($('<button class="btn btn-outline-danger btn-sm">Reset Channels</button>').on('click', () => this.resetChannels()));
            this.container.append(
                makeRow('Target Plot', this.controls.target),
                makeRow('CSV Source', this.controls.sourceMode),
                this.csvRow,
                this.xRow,
                makeRow('Type', this.controls.channelType),
                this.yRow,
                this.mathRow,
                this.labelRow,
                this.colorRow,
                this.visibleRow,
                this.actions,
                $('<hr/>'),
                this.list
            );

            this.controls.channelType.on('change', () => this._syncChannelTypeUi());

            this.controls.target.on('change', () => {
                this.syncTargetState();
                this.populateVariables();
                this.renderSeriesList();
            });
            this.controls.sourceMode.on('change', () => {
                this._syncSourceModeUi();
                this.populateVariables();
            });
            this.controls.csvButton.on('click', () => this.chooseCsvFile());
            this._configHandler();
        }

        _targetWidget() {
            if (!this.controls?.target) return null;
            return shared.findWidgetByTitle(this.controls.target.val(), ['fast_frame_plot']);
        }

        populateTargets() {
            if (!this.controls?.target) return;
            const current = this.controls.target.val();
            const targets = shared.listWidgetsByType(['fast_frame_plot']);
            this.controls.target.empty();
            targets.forEach(entry => this.controls.target.append(`<option value="${entry.title}">${entry.title}</option>`));
            if (current && this.controls.target.find(`option[value="${current}"]`).length) this.controls.target.val(current);
            else if (!current && targets.length) this.controls.target.val(targets[0].title);
        }

        syncTargetState() {
            if (!this.controls?.csvName || !this.controls?.xVariable || !this.actions) return;
            const widget = this._targetWidget();
            const settings = widget?.settings() || {};
            this.selectedCsvPath = settings.csvPath || '';
            this.controls.sourceMode.val(shared.getCsvSourceMode(settings));
            this.availableColumns = Array.isArray(widget?.widgetInstance?.availableColumns) ? widget.widgetInstance.availableColumns.slice() : [];
            this.controls.csvName.text(this._csvLabel(this.selectedCsvPath));
            this._syncSourceModeUi();
            this.labelRow.removeClass('is-hidden');
            this.colorRow.removeClass('is-hidden');
            this.visibleRow.removeClass('is-hidden');
            const addBtn = this.actions.find('.btn-primary');
            const resetBtn = this.actions.find('.btn-outline-danger');
            addBtn.removeClass('is-hidden');
            resetBtn.removeClass('is-hidden');
            const columns = this._currentColumns(widget);
            const fill = (select, value, placeholder) => {
                select.empty().append(`<option value="">${placeholder}</option>`);
                columns.forEach(column => select.append(`<option value="${column}">${column}</option>`));
                if (value && select.find(`option[value="${value}"]`).length) select.val(value);
                else if (!value && columns.length) select.val(columns[0]);
            };
            fill(this.controls.xVariable, settings.timeColumn, 'Row index');
            fill(this.controls.yVariable, '', 'Select Y variable');
        }

        async chooseCsvFile() {
            const chooser = shared.fileApi?.chooseCsvFile;
            if (!chooser) return;
            const chosen = await chooser();
            if (!chosen) return;
            this.selectedCsvPath = chosen;
            this.controls.sourceMode.val('fixed');
            this.controls.csvName.text(this._csvLabel(chosen));
            this._syncSourceModeUi();
            await this._loadColumnsForPath(chosen);
            this.applySource();
            this.populateVariables();
            this.renderSeriesList();
        }

        _csvLabel(filePath) {
            if (!filePath) return 'No file selected.';
            const parts = String(filePath).split(/[\\/]/);
            return parts[parts.length - 1] || filePath;
        }

        _syncSourceModeUi() {
            const mode = this.controls?.sourceMode?.val?.() || 'fixed';
            const buttonLabel = mode === 'latest' ? 'Choose Fallback CSV / Directory Anchor' : 'Choose CSV File';
            if (this.controls?.csvButton) this.controls.csvButton.text(buttonLabel);
        }

        _currentColumns(widget) {
            if (this.availableColumns.length) return this.availableColumns.slice();
            return Array.isArray(widget?.widgetInstance?.availableColumns) ? widget.widgetInstance.availableColumns : [];
        }

        async _loadColumnsForPath(filePath) {
            const loaded = await shared.loadCsvDataset(filePath, '');
            this.availableColumns = loaded.dataset ? loaded.dataset.headers.filter(header => header !== 'k_acquire') : [];
            return this.availableColumns;
        }

        async populateVariables() {
            if (!this.controls?.xVariable || !this.controls?.yVariable) return;
            const widget = this._targetWidget();
            const settings = widget?.settings() || {};
            const source = shared.resolveCsvSource({
                ...settings,
                csvPath: this.selectedCsvPath || settings.csvPath || '',
                csvSourceMode: this.controls?.sourceMode?.val?.() || shared.getCsvSourceMode(settings)
            }, widget?.widgetInstance?.availableFiles || []);
            if (source.filePath) {
                await this._loadColumnsForPath(source.filePath);
            }
            const columns = this._currentColumns(widget);
            const fill = (select, current, placeholder) => {
                select.empty().append(`<option value="">${placeholder}</option>`);
                columns.forEach(column => select.append(`<option value="${column}">${column}</option>`));
                if (current && select.find(`option[value="${current}"]`).length) select.val(current);
                else if (!current && columns.length) select.val(columns[0]);
            };
            fill(this.controls.xVariable, this.controls.xVariable.val() || settings.timeColumn, 'Row index');
            fill(this.controls.yVariable, this.controls.yVariable.val() || settings.yVariable, 'Select Y variable');
            fill(this.controls.mathA, this.controls.mathA.val(), 'A');
        }

        applySource() {
            if (!this.controls?.xVariable) return;
            const widget = this._targetWidget();
            if (!widget) return;
            const csvPath = this.selectedCsvPath || widget.settings().csvPath || '';
            const csvSourceMode = this.controls.sourceMode.val() || shared.getCsvSourceMode(widget.settings());
            const csvDirectory = csvPath ? (shared.pathApi?.dirname ? shared.pathApi.dirname(csvPath) : shared.defaultCsvDirectory()) : (widget.settings().csvDirectory || shared.defaultCsvDirectory());
            shared.updateWidgetSettings(widget, {
                csvSourceMode,
                csvDirectory,
                csvPath,
                timeColumn: this.controls.xVariable.val() || '',
                xVariable: this.controls.xVariable.val() || '',
                yVariable: this.controls.yVariable.val() || widget.settings().yVariable || ''
            });
        }

        _syncChannelTypeUi() {
            const isMath = this.controls?.channelType?.val() === 'math';
            this.yRow.toggleClass('is-hidden', isMath);
            this.mathRow.toggleClass('is-hidden', !isMath);
        }

        addChannel() {
            if (!this.controls?.label || !this.controls?.color || !this.controls?.visible) return;
            const widget = this._targetWidget();
            if (!widget || widget.type() !== 'fast_frame_plot') return;
            const isMath = this.controls.channelType?.val() === 'math';
            const defs = shared.normalizeSeriesDefs(widget.settings(), this._currentColumns(widget));
            const csvPath = this.selectedCsvPath || widget.settings().csvPath || '';
            const csvSourceMode = this.controls.sourceMode.val() || shared.getCsvSourceMode(widget.settings());
            const csvDirectory = csvPath ? (shared.pathApi?.dirname ? shared.pathApi.dirname(csvPath) : shared.defaultCsvDirectory()) : (widget.settings().csvDirectory || shared.defaultCsvDirectory());
            const color = this.controls.color.val() || shared.DEFAULT_COLORS[defs.length % shared.DEFAULT_COLORS.length];
            const visible = this.controls.visible.prop('checked');
            if (isMath) {
                const operandA = this.controls.mathA.val();
                const operator = this.controls.mathOp.val();
                const operandB = this.controls.mathB.val().trim();
                if (!operandA || !operator || !operandB) return;
                const autoLabel = `${operandA} ${operator} ${operandB}`;
                defs.push({ type: 'math', operandA, operator, operandB, label: this.controls.label.val() || autoLabel, color, visible });
            } else {
                const variable = this.controls.yVariable.val();
                if (!variable) return;
                defs.push({ variable, label: this.controls.label.val() || variable, color, visible });
            }
            shared.updateWidgetSettings(widget, { csvSourceMode, csvDirectory, csvPath, timeColumn: this.controls.xVariable.val() || '', seriesDefs: defs });
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
            if (!this.list) return;
            const widget = this._targetWidget();
            this.list.empty();
            const defs = widget ? shared.normalizeSeriesDefs(widget.settings(), this._currentColumns(widget)) : [];
            defs.forEach((def, index) => {
                const subtitle = def.type === 'math'
                    ? `math: ${def.operandA} ${def.operator} ${def.operandB}`
                    : def.variable;
                const row = $('<div class="fast-frame-channel-item d-flex justify-content-between align-items-center gap-2"></div>');
                row.append(`<div>${def.label} <span class="text-muted">(${subtitle})</span></div>`);
                row.append($('<button class="btn btn-outline-danger btn-sm">Remove</button>').on('click', () => this.removeChannel(index)));
                this.list.append(row);
            });
            if (!defs.length) {
                this.list.append('<div class="small text-muted">No channels configured.</div>');
            }
        }

        onSettingsChanged(s) { this.settings = s; }
        getHeight() { return 7; }
        onDispose() {
            if (this._configHandler && freeboard.off) {
                freeboard.off('config_updated', this._configHandler);
            }
        }
    }
}());
