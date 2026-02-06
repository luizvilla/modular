(function () {
    // Vertical gauge configuration panel for adjusting gauge settings.
    const COLOR_OPTIONS = [
        { name: 'Blue', value: 'blue' },
        { name: 'Green', value: 'green' },
        { name: 'Orange', value: 'orange' },
        { name: 'Purple', value: 'purple' },
        { name: 'Teal', value: 'teal' },
        { name: 'Yellow', value: 'yellow' },
        { name: 'Gray', value: 'gray' },
        { name: 'White', value: 'white' }
    ];

    freeboard.loadWidgetPlugin({
        type_name: 'vertical_gauge_config_panel',
        display_name: 'Vertical Gauge UI',
        description: 'Control panel to adjust vertical gauge settings',
        category: 'Vertical gauge',
        settings: [],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new VerticalGaugeConfigPanel(settings));
        }
    });

    class VerticalGaugeConfigPanel {
        constructor(settings) {
            this.settings = settings;
            this.container = $('<div class="h-100 overflow-auto p-2"></div>');
            this.controls = {};
            // Reuse the serial header editor workflow inside the gauge UI controller.
            this.serialApi = window.api && window.api.serial ? window.api.serial : null;
            this.ipc = !this.serialApi && window.require ? window.require('electron')?.ipcRenderer : null;
            this.colorThemes = {
                ColorBlind10: ColorBlind10,
                OfficeClassic6: OfficeClassic6,
                HueCircle19: HueCircle19,
                Tableau20: Tableau20
            };
            this.dsSelect = $('<select class="form-select form-select-sm flex-fill"></select>');
            this.paletteSelect = $('<select class="form-select form-select-sm flex-fill"></select>');
            Object.keys(this.colorThemes).forEach(k => {
                this.paletteSelect.append(`<option value="${k}">${k}</option>`);
            });
            this.rowsWrap = $('<div class="flex-fill overflow-auto"></div>');
            this.rows = $('<div class="d-flex flex-column"></div>');
            this.rowsWrap.append(this.rows);
            this.addBtn = $('<button class="btn btn-secondary btn-sm">Add Field</button>');
            this.saveBtn = $('<button class="btn btn-primary btn-sm">Save Labels & Colors</button>');
        }

        render(containerElement) {
            this.container.empty();
            this.controls = {};

            const form = $('<div></div>');

            const targetRow = $('<div class="input-group input-group-sm mb-1"></div>');
            const targetLabel = $('<span class="input-group-text">Select Target Widget</span>');
            const targetSelect = $('<select class="form-select form-select-sm"></select>');
            this.controls.target_widget_title = targetSelect;

            targetSelect.on('change', () => { if (targetSelect.val()) this.syncFromSelectedWidget(); });

            targetRow.append(targetLabel).append(targetSelect);
            form.append(targetRow);

            const createInput = (labelText, key, type = 'text') => {
                const wrapper = $('<div class="input-group input-group-sm mb-1"></div>');
                const label = $(`<span class="input-group-text">${labelText}</span>`);
                const input = $(`<input type="${type}" class="form-control form-control-sm">`);
                this.controls[key] = input;
                wrapper.append(label).append(input);
                return wrapper;
            };

            form.append(createInput('Title', 'title'));
            form.append(createInput('Minimum', 'min', 'number'));
            form.append(createInput('Maximum', 'max', 'number'));

            const colorRow = $('<div class="input-group input-group-sm mb-1"></div>');
            const colorLabel = $('<span class="input-group-text">Bar Color</span>');
            const colorSelect = $('<select class="form-select form-select-sm"></select>');
            COLOR_OPTIONS.forEach(opt => colorSelect.append($('<option></option>').val(opt.value).text(opt.name)));
            this.controls.barColor = colorSelect;
            colorRow.append(colorLabel).append(colorSelect);
            form.append(colorRow);

            form.append(createInput('Refresh Rate (ms)', 'refreshRate', 'number'));

            const alarmRow = $('<div class="input-group input-group-sm mb-1"></div>');
            const alarmId = `chk_${Math.random().toString(36).slice(2)}`;
            const alarmCheckbox = $('<input type="checkbox">').addClass('form-check-input mt-0').attr('id', alarmId);
            const alarmLabel = $(`<label class="input-group-text" for="${alarmId}">Alarm Enabled</label>`);
            const alarmBox = $('<span class="input-group-text"></span>').append(alarmCheckbox);
            alarmRow.append(alarmLabel).append(alarmBox);
            this.controls.alarmEnabled = alarmCheckbox;
            form.append(alarmRow);

            form.append(createInput('Alarm Threshold', 'alarmThreshold', 'number'));

            const dirRow = $('<div class="input-group input-group-sm mb-1"></div>');
            const dirLabel = $('<span class="input-group-text">Alarm Direction</span>');
            const dirSelect = $('<select class="form-select form-select-sm"></select>');
            dirSelect.append('<option value="above">Above threshold</option>');
            dirSelect.append('<option value="below">Below threshold</option>');
            this.controls.alarmDirection = dirSelect;
            dirRow.append(dirLabel).append(dirSelect);
            form.append(dirRow);

            const btn = $('<button class="btn btn-primary btn-sm w-100">Apply Settings</button>');
            btn.on('click', () => this.applySettings());

            // Labels & colors editor for the selected datasource.
            const sectionTitle = $('<div class="fw-semibold mt-2">Labels & Colors</div>');
            const dsRow = $('<div class="input-group input-group-sm mb-1"></div>');
            dsRow.append('<span class="input-group-text">Datasource</span>', this.dsSelect);
            const palRow = $('<div class="input-group input-group-sm mb-1"></div>');
            palRow.append('<span class="input-group-text">Colors</span>', this.paletteSelect);
            const btnRow = $('<div class="d-flex gap-1"></div>').append(this.addBtn, this.saveBtn);

            this.container.append(form, btn, sectionTitle, dsRow, palRow, this.rowsWrap, btnRow);
            $(containerElement).append(this.container);

            freeboard.on('initialized', () => this.populateWidgetDropdown());
            freeboard.on('config_updated', () => this.populateWidgetDropdown());
            this.populateWidgetDropdown();

            this.addBtn.on('click', () => this._addRow());
            this.saveBtn.on('click', () => this._saveHeaders());
            this.dsSelect.on('change', () => {
                this._loadHeaders();
            });
            this.paletteSelect.on('change', () => {
                this._applyPalette();
            });
            this._refreshDatasourceOptions();
            this.paletteSelect.val('ColorBlind10');
        }

        syncFromSelectedWidget() {
            const model = freeboard.getLiveModel();
            const title = this.controls.target_widget_title.val();
            const widget = model.panes().flatMap(p => p.widgets()).find(w => {
                let wTitle = w.settings().title; if (typeof wTitle === 'function') wTitle = wTitle();
                return wTitle === title && w.type() === 'vertical_gauge';
            });
            if (!widget) return;
            const settings = widget.settings();
            this.controls.title.val(typeof settings.title === 'function' ? settings.title() : settings.title || '');
            this.controls.min.val(typeof settings.min === 'function' ? settings.min() : (settings.min ?? 0));
            this.controls.max.val(typeof settings.max === 'function' ? settings.max() : (settings.max ?? 100));
            this.controls.barColor.val(typeof settings.barColor === 'function' ? settings.barColor() : (settings.barColor || 'blue'));
            this.controls.refreshRate.val(typeof settings.refreshRate === 'function' ? settings.refreshRate() : (settings.refreshRate ?? 500));
            this.controls.alarmEnabled.prop('checked', !!(typeof settings.alarmEnabled === 'function' ? settings.alarmEnabled() : settings.alarmEnabled));
            this.controls.alarmThreshold.val(typeof settings.alarmThreshold === 'function' ? settings.alarmThreshold() : (settings.alarmThreshold ?? 0));
            this.controls.alarmDirection.val(typeof settings.alarmDirection === 'function' ? settings.alarmDirection() : (settings.alarmDirection || 'above'));
            const sourceDef = typeof settings.sourceDef === 'function' ? settings.sourceDef() : settings.sourceDef;
            if (sourceDef && typeof sourceDef === 'string') {
                try {
                    const parsed = JSON.parse(sourceDef);
                    if (parsed?.ds) {
                        this.dsSelect.val(parsed.ds);
                        this._loadHeaders();
                    }
                } catch { /* ignore */ }
            }
        }

        populateWidgetDropdown() {
            const titleSelect = this.controls.target_widget_title;
            const widgets = [];
            const model = freeboard.getLiveModel();
            model.panes().forEach(pane => {
                pane.widgets().forEach(widget => {
                    if (widget.type() === 'vertical_gauge') {
                        const t = typeof widget.settings().title === 'function' ? widget.settings().title() : widget.settings().title;
                        if (t) widgets.push(t);
                    }
                });
            });
            const selected = titleSelect.val();
            titleSelect.empty();
            widgets.forEach(t => titleSelect.append($('<option>').val(t).text(t)));
            if (selected && titleSelect.find(`option[value="${selected}"]`).length) titleSelect.val(selected);
            else if (!selected && widgets.length === 1) titleSelect.val(widgets[0]);
            if (titleSelect.val()) this.syncFromSelectedWidget();
        }

        applySettings() {
            const model = freeboard.getLiveModel();
            const title = this.controls.target_widget_title.val();
            const widget = model.panes().flatMap(p => p.widgets()).find(w => {
                let wTitle = w.settings().title; if (typeof wTitle === 'function') wTitle = wTitle();
                return wTitle === title && w.type() === 'vertical_gauge';
            });
            if (!widget) return;
            const minVal = parseFloat(this.controls.min.val());
            const maxVal = parseFloat(this.controls.max.val());
            const thresholdVal = parseFloat(this.controls.alarmThreshold.val());
            const updated = {
                ...widget.settings(),
                title: this.controls.title.val() || '',
                min: isNaN(minVal) ? 0 : minVal,
                max: isNaN(maxVal) ? 100 : maxVal,
                barColor: this.controls.barColor.val() || 'blue',
                refreshRate: parseInt(this.controls.refreshRate.val(), 10) || 500,
                alarmEnabled: this.controls.alarmEnabled.prop('checked'),
                alarmThreshold: isNaN(thresholdVal) ? 0 : thresholdVal,
                alarmDirection: this.controls.alarmDirection.val() || 'above'
            };
            widget.settings(updated);
            widget.widgetInstance.onSettingsChanged(updated);
        }

        _refreshDatasourceOptions() {
            const live = freeboard.getLiveModel?.();
            if (!live || typeof live.datasources !== 'function') return;
            const list = live.datasources();
            const current = this.dsSelect.val();
            this.dsSelect.empty();
            list.forEach(ds => {
                try {
                    const t = ds.type && ds.type();
                    if (t === 'serialport_datasource' || t === 'fast_frame_datasource' || t === 'can_datasource') {
                        const name = ds.name();
                        this.dsSelect.append(`<option value="${name}">${name}</option>`);
                    }
                } catch (e) { /* ignore */ }
            });
            if (current && this.dsSelect.find(`option[value="${current}"]`).length === 0) {
                this.dsSelect.append(`<option value="${current}">${current}</option>`);
            }
            if (current) this.dsSelect.val(current);
        }

        async _getPortPath() {
            const dsName = this.dsSelect.val();
            const dsSettings = freeboard.getDatasourceSettings(dsName) || {};
            return dsSettings.portPath || dsName;
        }

        _getDatasourceType() {
            const live = freeboard.getLiveModel?.();
            if (!live || typeof live.datasources !== 'function') return null;
            const list = live.datasources();
            const dsName = this.dsSelect.val();
            for (const ds of list) {
                try {
                    if (ds.name && ds.name() === dsName) {
                        return ds.type?.();
                    }
                } catch (e) { /* ignore */ }
            }
            return null;
        }

        async _getChannelCount() {
            if ((!this.serialApi && !this.ipc) || !this.dsSelect.val()) return 0;
            try {
                const path = await this._getPortPath();
                const dsType = this._getDatasourceType();
                if (dsType === 'fast_frame_datasource') {
                    const dataset = this.serialApi && this.serialApi.getFastDataset
                        ? await this.serialApi.getFastDataset(path)
                        : await this.ipc.invoke('get-fast-dataset', { path });
                    if (dataset && Array.isArray(dataset.series)) return dataset.series.length;
                } else if (dsType === 'can_datasource') {
                    const headers = this.serialApi && this.serialApi.getHeaders
                        ? await this.serialApi.getHeaders(path, dsType)
                        : await this.ipc.invoke('get-serial-headers', { path, type: dsType });
                    if (Array.isArray(headers)) return headers.length;
                } else {
                    const data = this.serialApi && this.serialApi.getBuffer
                        ? await this.serialApi.getBuffer(path)
                        : await this.ipc.invoke('get-serial-buffer', { path });
                    if (Array.isArray(data)) return data.length;
                }
            } catch (e) { /* ignore */ }
            return 0;
        }

        _clearRows() {
            this.rows.empty();
        }

        _defaultColor(idx) {
            const pal = this.colorThemes[this.paletteSelect.val()] || this.colorThemes.ColorBlind10;
            return pal[idx % pal.length];
        }

        _addRow(label = '', color = null) {
            const idx = this.rows.children().length + 1;
            const clr = color || this._defaultColor(idx - 1);
            const row = $('<div class="input-group input-group-sm mb-1"></div>');
            row.append(`<span class="input-group-text">${idx}</span>`);
            const input = $(`<input type="text" class="form-control" value="${label}">`);
            row.append(input);
            const colorInput = $(`<input type="color" class="form-control form-control-color" value="${clr}" title="Choose color">`);
            row.append(colorInput);
            const del = $('<button class="btn btn-danger" type="button">✕</button>')
                .on('click', () => { row.remove(); this._renumber(); });
            row.append(del);
            this.rows.append(row);
        }

        _renumber() {
            this.rows.children().each((i, row) => {
                $(row).children('.input-group-text').first().text(i + 1);
            });
        }

        _applyPalette() {
            const pal = this.colorThemes[this.paletteSelect.val()] || this.colorThemes.ColorBlind10;
            this.rows.children().each((i, row) => {
                $(row).find("input[type='color']").val(pal[i % pal.length]);
            });
        }

        async _loadHeaders() {
            this._clearRows();
            const dsName = this.dsSelect.val();
            if (!dsName) return;
            const dsSettings = freeboard.getDatasourceSettings(dsName) || {};
            let headers = [];
            let colors = [];
            if (this.serialApi || this.ipc) {
                try {
                    const path = await this._getPortPath();
                    const type = this._getDatasourceType();
                    headers = this.serialApi && this.serialApi.getHeaders
                        ? await this.serialApi.getHeaders(path, type)
                        : await this.ipc.invoke('get-serial-headers', { path, type });
                    colors = this.serialApi && this.serialApi.getColors
                        ? await this.serialApi.getColors(path, type)
                        : await this.ipc.invoke('get-serial-colors', { path, type });
                } catch (e) { /* ignore */ }
            }
            if (!Array.isArray(headers) || !headers.length) {
                if (Array.isArray(dsSettings.headers)) {
                    headers = dsSettings.headers.map(h => h.label);
                    colors = dsSettings.headers.map(h => h.color || null);
                } else if (typeof dsSettings.headers === 'string') {
                    headers = dsSettings.headers.split(/[,;]+/).map(h => h.trim()).filter(Boolean);
                }
            }
            if (!Array.isArray(colors)) colors = [];

            const chanCount = await this._getChannelCount();
            const required = Math.max(chanCount, headers.length);
            for (let i = headers.length; i < required; i++) headers.push('');
            for (let i = colors.length; i < required; i++) colors.push(null);

            headers.forEach((h, i) => this._addRow(h, colors[i]));
            if (headers.length === 0) this._addRow();
            this._applyPalette();
        }

        async _saveHeaders() {
            const dsName = this.dsSelect.val();
            if (!dsName) return;
            const rows = this.rows.children();
            const labels = [];
            const colors = [];
            rows.each((_, row) => {
                labels.push($(row).find('input[type="text"]').val().trim());
                colors.push($(row).find('input[type="color"]').val() || '#ff0000');
            });
            const clean = labels.slice();
            const newHeaders = labels.map((l, i) => ({ label: l, color: colors[i] }));
            if (typeof freeboard.setDatasourceSettings === 'function') {
                freeboard.setDatasourceSettings(dsName, { headers: newHeaders });
            }
            if (this.serialApi || this.ipc) {
                try {
                    const path = await this._getPortPath();
                    const type = this._getDatasourceType();
                    if (this.serialApi && this.serialApi.setHeaders) {
                        await this.serialApi.setHeaders(path, clean, type);
                    } else {
                        await this.ipc.invoke('set-serial-headers', { path, type, headers: clean });
                    }
                    if (this.serialApi && this.serialApi.setColors) {
                        await this.serialApi.setColors(path, colors, type);
                    } else {
                        await this.ipc.invoke('set-serial-colors', { path, type, colors });
                    }
                } catch (e) { console.error('Failed to set headers', e); }
            }
        }

        onSettingsChanged(newSettings) { this.settings = newSettings; }
        getHeight() { return 7; }
        onDispose() {}
    }
})();
