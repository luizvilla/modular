(function () {
    function getShared(providedShared) {
        return providedShared
            || window.ModularPlotEditorShared
            || (window.freeboard && typeof window.freeboard.getPlotEditorShared === 'function' ? window.freeboard.getPlotEditorShared() : null);
    }

    function createSection(title) {
        const section = $('<section class="border rounded p-2 d-flex flex-column gap-2"></section>');
        section.append($('<h3 class="small text-uppercase text-muted mb-0"></h3>').text(title));
        return section;
    }

    function createInputRow(label, type, initialValue, placeholder) {
        const row = $('<div class="input-group input-group-sm"></div>');
        const input = $(`<input type="${type}" class="form-control form-control-sm">`);
        if (placeholder) input.attr('placeholder', placeholder);
        if (initialValue !== undefined && initialValue !== null) input.val(initialValue);
        row.append($('<span class="input-group-text"></span>').text(label), input);
        return { row, input };
    }

    function createCheckboxRow(label, checked) {
        const row = $('<div class="input-group input-group-sm"></div>');
        const input = $('<input type="checkbox" class="form-check-input mt-0">').prop('checked', !!checked);
        row.append($('<label class="input-group-text"></label>').text(label), $('<span class="input-group-text"></span>').append(input));
        return { row, input };
    }

    function createSelectRow(label, options, selectedValue, placeholder) {
        const row = $('<div class="input-group input-group-sm"></div>');
        const select = $('<select class="form-select form-select-sm"></select>');
        if (placeholder) select.append($('<option value=""></option>').text(placeholder));
        (options || []).forEach((option) => {
            const value = option && typeof option === 'object' ? option.value : option;
            const text = option && typeof option === 'object' ? option.label : option;
            const opt = $('<option></option>').attr('value', value).text(text);
            if (option && typeof option === 'object' && option.uid) opt.attr('data-uid', option.uid);
            select.append(opt);
        });
        if (selectedValue !== undefined && selectedValue !== null && selectedValue !== '') select.val(String(selectedValue));
        row.append($('<span class="input-group-text"></span>').text(label), select);
        return { row, select };
    }

    function readSelectedUid(select) {
        const selected = select.find('option:selected');
        return selected.length ? (selected.attr('data-uid') || null) : null;
    }

    async function refreshCanDeviceSelect(shared, dsName, select, preferredDevice, preferredUid) {
        const devices = await shared.fetchCanDevices(dsName);
        select.empty().append('<option value="">Select device</option>');
        devices.forEach((device) => {
            const option = $('<option></option>').attr('value', device.value).text(device.label);
            if (device.uid) option.attr('data-uid', device.uid);
            select.append(option);
        });
        let next = preferredDevice || '';
        if (preferredUid) {
            const match = devices.find((device) => device.uid && device.uid === preferredUid);
            if (match) next = match.value;
        }
        if (next && select.find(`option[value="${next}"]`).length) select.val(next);
        else if (!next && devices.length) select.val(devices[0].value);
        return select.val() || '';
    }

    async function refreshVariableSelect(shared, dsName, deviceValue, select, selectedVar) {
        const options = await shared.fetchDatasourceVariableOptions(dsName, deviceValue);
        select.empty();
        if (!options.length) {
            select.append('<option value="">No variables</option>');
            return;
        }
        options.forEach((option) => {
            select.append($('<option></option>').attr('value', option.value).text(option.label));
        });
        const normalized = selectedVar === undefined || selectedVar === null ? '' : String(selectedVar);
        if (normalized && select.find(`option[value="${normalized}"]`).length) select.val(normalized);
        else select.val(select.find('option').first().val());
    }

    function applyPalette(shared, paletteName) {
        const themes = shared.getColorThemes();
        const palette = themes[paletteName] || themes.ColorBlind10 || [];
        if (Array.isArray(palette) && palette.length) {
            window.PlotColorPalette = palette.slice();
        }
    }

    function buildSourceControls(shared, label, sourceDef) {
        const normalized = sourceDef || {};
        const wrapper = $('<div class="d-flex flex-column gap-1"></div>');
        const datasourceOptions = shared.listDatasources().map((ds) => ({ value: ds.name, label: ds.name }));
        const dsRow = createSelectRow(label, datasourceOptions, normalized.ds || '', 'Select datasource');
        const deviceRow = createSelectRow('Device', [], normalized.device || '', 'Select device');
        const variableRow = createSelectRow('Variable', [], normalized.var, 'Select variable');
        wrapper.append(dsRow.row, deviceRow.row, variableRow.row);

        async function sync(preferredVar) {
            const dsName = dsRow.select.val();
            const dsType = shared.getDatasourceType(dsName);
            const showDevice = dsType === 'can_datasource';
            deviceRow.row.toggle(showDevice);
            let deviceValue = '';
            if (showDevice) {
                deviceValue = await refreshCanDeviceSelect(shared, dsName, deviceRow.select, normalized.device || deviceRow.select.val(), normalized.device_uid || readSelectedUid(deviceRow.select));
            } else {
                deviceRow.select.empty();
            }
            await refreshVariableSelect(shared, dsName, deviceValue, variableRow.select, preferredVar !== undefined ? preferredVar : normalized.var);
        }

        dsRow.select.on('change', () => {
            sync().catch(() => {});
        });
        deviceRow.select.on('change', () => {
            const dsName = dsRow.select.val();
            refreshVariableSelect(shared, dsName, deviceRow.select.val(), variableRow.select, variableRow.select.val()).catch(() => {});
        });

        sync().catch(() => {});

        return {
            wrapper,
            dsSelect: dsRow.select,
            deviceSelect: deviceRow.select,
            variableSelect: variableRow.select,
            sync,
            buildValue() {
                const dsName = dsRow.select.val();
                if (!dsName) return null;
                const dsType = shared.getDatasourceType(dsName);
                const rawVar = variableRow.select.val();
                return {
                    ds: dsName,
                    type: dsType,
                    device: dsType === 'can_datasource' ? (deviceRow.select.val() || null) : null,
                    device_uid: dsType === 'can_datasource' ? readSelectedUid(deviceRow.select) : null,
                    var: dsType === 'can_datasource' ? rawVar : parseInt(rawVar, 10)
                };
            }
        };
    }

    function normalizeOwntechSeriesDef(def) {
        const sourceA = def && def.a ? def.a : {};
        const sourceB = def && def.b ? def.b : null;
        return {
            label: def && def.label ? def.label : '',
            op: def && def.op ? def.op : 'identity',
            param: Number(def && def.param) || 0,
            a: {
                ds: sourceA.ds || '',
                type: sourceA.type || '',
                device: sourceA.device || null,
                device_uid: sourceA.device_uid || null,
                var: sourceA.var
            },
            b: sourceB ? {
                ds: sourceB.ds || '',
                type: sourceB.type || '',
                device: sourceB.device || null,
                device_uid: sourceB.device_uid || null,
                var: sourceB.var
            } : null
        };
    }

    function openOwntechPlotEditor(widgetModel, shared) {
        const settings = widgetModel.settings() || {};
        const form = $('<div class="row g-3 integrated-plot-editor"></div>');
        const left = $('<div class="col-md-5 d-flex flex-column gap-2"></div>');
        const right = $('<div class="col-md-7 d-flex flex-column gap-2"></div>');
        form.append(left, right);

        const displaySection = createSection('Display');
        const titleField = createInputRow('Title', 'text', settings.title || '');
        const durationField = createInputRow('Display Duration (ms)', 'number', settings.duration || 20000);
        const refreshField = createInputRow('Refresh Rate (ms)', 'number', settings.refreshRate || 1000);
        const yLabelField = createInputRow('Y Axis Label', 'text', settings.yLabel || '');
        const yMinField = createInputRow('Y Min', 'number', settings.yMin ?? '');
        const yMaxField = createInputRow('Y Max', 'number', settings.yMax ?? '');
        const legendField = createCheckboxRow('Show Legend', settings.showLegend);
        const paletteThemes = shared.getColorThemes();
        const paletteOptions = Object.keys(paletteThemes).map((key) => ({ value: key, label: key })).filter((entry) => (paletteThemes[entry.value] || []).length);
        const paletteField = createSelectRow('Color palette', paletteOptions, settings.colorPalette || 'ColorBlind10');
        displaySection.append(
            titleField.row,
            durationField.row,
            refreshField.row,
            yLabelField.row,
            yMinField.row,
            yMaxField.row,
            legendField.row,
            paletteField.row
        );
        left.append(displaySection);

        const channelsSection = createSection('Channels');
        const channelHeader = $('<div class="d-flex align-items-center justify-content-between gap-2"></div>');
        channelHeader.append('<div class="small text-muted">Configure local series sources and transforms.</div>');
        const addChannelButton = $('<button type="button" class="btn btn-sm btn-outline-primary">Add channel</button>');
        channelHeader.append(addChannelButton);
        const channelList = $('<div class="d-flex flex-column gap-2"></div>');
        channelsSection.append(channelHeader, channelList);
        right.append(channelsSection);

        const channelEditors = [];
        const seriesDefs = shared.parseSeriesDefs(settings.seriesDefs).map(normalizeOwntechSeriesDef);

        function createChannelEditor(def) {
            const normalized = normalizeOwntechSeriesDef(def);
            const card = $('<div class="border rounded p-2 d-flex flex-column gap-2"></div>');
            const labelField = createInputRow('Label', 'text', normalized.label || '', 'Optional channel label');
            const opField = createSelectRow('Operation', [
                { value: 'identity', label: 'x' },
                { value: 'negate', label: '-x' },
                { value: 'abs', label: 'abs(x)' },
                { value: 'scale', label: 'x * k' },
                { value: 'offset', label: 'x + b' },
                { value: 'mulvar', label: 'x * y' }
            ], normalized.op || 'identity');
            const paramField = createInputRow('Parameter', 'number', normalized.param || 0, 'k or b');
            const sourceA = buildSourceControls(shared, 'Source X', normalized.a);
            const sourceB = buildSourceControls(shared, 'Source Y', normalized.b || {});
            const removeButton = $('<button type="button" class="btn btn-sm btn-outline-danger align-self-end">Remove channel</button>');

            function syncMode() {
                const op = opField.select.val();
                sourceB.wrapper.toggle(op === 'mulvar');
                paramField.row.toggle(op === 'scale' || op === 'offset');
            }

            opField.select.on('change', syncMode);
            syncMode();

            removeButton.on('click', () => {
                const index = channelEditors.indexOf(editor);
                if (index >= 0) channelEditors.splice(index, 1);
                card.remove();
            });

            card.append(labelField.row, opField.row, paramField.row, sourceA.wrapper, sourceB.wrapper, removeButton);
            channelList.append(card);

            const editor = {
                buildDef() {
                    const sourceValueA = sourceA.buildValue();
                    if (!sourceValueA || !sourceValueA.ds) return null;
                    const op = opField.select.val() || 'identity';
                    const nextDef = {
                        label: (labelField.input.val() || '').trim(),
                        op,
                        param: (op === 'scale' || op === 'offset') ? (parseFloat(paramField.input.val()) || 0) : 0,
                        a: sourceValueA
                    };
                    if (op === 'mulvar') {
                        const sourceValueB = sourceB.buildValue();
                        if (!sourceValueB || !sourceValueB.ds) return null;
                        nextDef.b = sourceValueB;
                    } else {
                        nextDef.b = null;
                    }
                    return nextDef;
                }
            };
            channelEditors.push(editor);
            return editor;
        }

        addChannelButton.on('click', () => {
            createChannelEditor({
                label: '',
                op: 'identity',
                param: 0,
                a: { ds: '', type: '', device: null, device_uid: null, var: null },
                b: null
            });
        });

        if (!seriesDefs.length) {
            addChannelButton.trigger('click');
        } else {
            seriesDefs.forEach((def) => createChannelEditor(def));
        }

        paletteField.select.on('change', () => {
            applyPalette(shared, paletteField.select.val() || 'ColorBlind10');
        });
        applyPalette(shared, paletteField.select.val() || 'ColorBlind10');

        new DialogBox(form, 'Edit owntech_plot_uplot', 'Save', 'Cancel', function () {
            const newDefs = channelEditors.map((editor) => editor.buildDef()).filter(Boolean);
            const updated = _.extend({}, settings, {
                title: titleField.input.val() || settings.title || 'Plot widget',
                duration: parseInt(durationField.input.val(), 10) || 20000,
                refreshRate: parseInt(refreshField.input.val(), 10) || 1000,
                yLabel: yLabelField.input.val() || 'Value',
                yMin: shared.parseNumber(yMinField.input.val()),
                yMax: shared.parseNumber(yMaxField.input.val()),
                showLegend: legendField.input.prop('checked'),
                colorPalette: paletteField.select.val() || 'ColorBlind10',
                seriesDefs: newDefs
            });
            delete updated.helperWidgets;
            applyPalette(shared, updated.colorPalette);
            shared.commitWidgetSettings(widgetModel, updated);
        });
        return true;
    }

    window.ModularIntegratedPlotEditor = {
        open(widgetModel, type, providedShared) {
            const shared = getShared(providedShared);
            if (!shared || !widgetModel) return false;
            if (type === 'owntech_plot_uplot') {
                return openOwntechPlotEditor(widgetModel, shared);
            }
            return false;
        }
    };
}());
