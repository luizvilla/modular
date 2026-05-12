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
        category: 'Plots',
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
            // Keep a local palette selector for gauge colors.
            this.colorThemes = {
                ColorBlind10: ColorBlind10,
                OfficeClassic6: OfficeClassic6,
                HueCircle19: HueCircle19,
                Tableau20: Tableau20
            };
            this.paletteSelect = $('<select class="form-select form-select-sm flex-fill"></select>');
            Object.keys(this.colorThemes).forEach(k => {
                this.paletteSelect.append(`<option value="${k}">${k}</option>`);
            });
            this.colorSelect = $('<select class="form-select form-select-sm flex-fill"></select>');
            if (freeboard && typeof freeboard.addStyle === 'function') {
                // Align label/input widths across the UI rows.
                freeboard.addStyle('.vgauge-ui .input-group-text', 'min-width:180px;justify-content:center;');
                freeboard.addStyle('.vgauge-ui .form-control, .vgauge-ui .form-select', 'min-width:180px;');
            }
        }

        render(containerElement) {
            this.container.empty();
            this.controls = {};

            const form = $('<div></div>');

            const targetRow = $('<div class="input-group input-group-sm mb-1 vgauge-ui"></div>');
            const targetLabel = $('<span class="input-group-text">Select Target Widget</span>');
            const targetSelect = $('<select class="form-select form-select-sm"></select>');
            this.controls.target_widget_title = targetSelect;

            targetSelect.on('change', () => { if (targetSelect.val()) this.syncFromSelectedWidget(); });

            targetRow.append(targetLabel).append(targetSelect);
            form.append(targetRow);

            const createInput = (labelText, key, type = 'text') => {
                const wrapper = $('<div class="input-group input-group-sm mb-1 vgauge-ui"></div>');
                const label = $(`<span class="input-group-text">${labelText}</span>`);
                const input = $(`<input type="${type}" class="form-control form-control-sm">`);
                this.controls[key] = input;
                wrapper.append(label).append(input);
                return wrapper;
            };

            form.append(createInput('Title', 'title'));
            form.append(createInput('Minimum', 'min', 'number'));
            form.append(createInput('Maximum', 'max', 'number'));

            const colorRow = $('<div class="input-group input-group-sm mb-1 vgauge-ui"></div>');
            const colorLabel = $('<span class="input-group-text">Bar Color</span>');
            this.controls.barColor = this.colorSelect;
            colorRow.append(colorLabel).append(this.colorSelect);
            form.append(colorRow);

            form.append(createInput('Refresh Rate (ms)', 'refreshRate', 'number'));

            const alarmRow = $('<div class="input-group input-group-sm mb-1 vgauge-ui"></div>');
            const alarmId = `chk_${Math.random().toString(36).slice(2)}`;
            const alarmCheckbox = $('<input type="checkbox">').addClass('form-check-input mt-0').attr('id', alarmId);
            const alarmLabel = $(`<label class="input-group-text" for="${alarmId}">Alarm Enabled</label>`);
            const alarmBox = $('<span class="input-group-text"></span>').append(alarmCheckbox);
            alarmRow.append(alarmLabel).append(alarmBox);
            this.controls.alarmEnabled = alarmCheckbox;
            form.append(alarmRow);

            form.append(createInput('Alarm Threshold', 'alarmThreshold', 'number'));

            const dirRow = $('<div class="input-group input-group-sm mb-1 vgauge-ui"></div>');
            const dirLabel = $('<span class="input-group-text">Alarm Direction</span>');
            const dirSelect = $('<select class="form-select form-select-sm"></select>');
            dirSelect.append('<option value="above">Above threshold</option>');
            dirSelect.append('<option value="below">Below threshold</option>');
            this.controls.alarmDirection = dirSelect;
            dirRow.append(dirLabel).append(dirSelect);
            form.append(dirRow);

            const palRow = $('<div class="input-group input-group-sm mb-1 vgauge-ui"></div>');
            palRow.append('<span class="input-group-text">Color palette</span>', this.paletteSelect);

            const btn = $('<button class="btn btn-primary btn-sm w-100">Apply Settings</button>');
            btn.on('click', () => this.applySettings());

            this.container.append(form, palRow, btn);
            $(containerElement).append(this.container);

            freeboard.on('initialized', () => this.populateWidgetDropdown());
            freeboard.on('config_updated', () => this.populateWidgetDropdown());
            this.populateWidgetDropdown();

            this.paletteSelect.on('change', () => {
                this._applyPalette(this.controls.barColor.val());
            });
            if (!this.paletteSelect.val()) this.paletteSelect.val('ColorBlind10');
            this._applyPalette(this.controls.barColor.val());
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
            const barColor = typeof settings.barColor === 'function' ? settings.barColor() : (settings.barColor || 'blue');
            this.controls.barColor.val(barColor);
            this.controls.refreshRate.val(typeof settings.refreshRate === 'function' ? settings.refreshRate() : (settings.refreshRate ?? 500));
            this.controls.alarmEnabled.prop('checked', !!(typeof settings.alarmEnabled === 'function' ? settings.alarmEnabled() : settings.alarmEnabled));
            this.controls.alarmThreshold.val(typeof settings.alarmThreshold === 'function' ? settings.alarmThreshold() : (settings.alarmThreshold ?? 0));
            this.controls.alarmDirection.val(typeof settings.alarmDirection === 'function' ? settings.alarmDirection() : (settings.alarmDirection || 'above'));
            const paletteName = typeof settings.colorPalette === 'function' ? settings.colorPalette() : settings.colorPalette;
            if (paletteName && this.colorThemes[paletteName]) this.paletteSelect.val(paletteName);
            this._applyPalette(barColor);
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
                alarmDirection: this.controls.alarmDirection.val() || 'above',
                colorPalette: this.paletteSelect.val() || 'ColorBlind10'
            };
            widget.settings(updated);
            widget.widgetInstance.onSettingsChanged(updated);
        }

        _applyPalette(currentColor = null) {
            const pal = this.colorThemes[this.paletteSelect.val()] || this.colorThemes.ColorBlind10;
            this.colorSelect.empty();
            pal.forEach((color, idx) => {
                this.colorSelect.append($('<option></option>').val(color).text(`Color ${idx + 1}`).css('color', color));
            });
            // Preserve the current selection even if it is outside the palette.
            if (currentColor && !pal.includes(currentColor)) {
                this.colorSelect.append($('<option></option>').val(currentColor).text('Custom').css('color', currentColor));
            }
            if (currentColor) this.colorSelect.val(currentColor);
        }

        onSettingsChanged(newSettings) { this.settings = newSettings; }
        getHeight() { return 6; }
        onDispose() {}
    }
})();
