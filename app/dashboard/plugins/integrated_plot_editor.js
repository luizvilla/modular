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

    const GAUGE_COLOR_OPTIONS = [
        { label: 'Blue', value: 'blue' },
        { label: 'Green', value: 'green' },
        { label: 'Orange', value: 'orange' },
        { label: 'Purple', value: 'purple' },
        { label: 'Teal', value: 'teal' },
        { label: 'Yellow', value: 'yellow' },
        { label: 'Gray', value: 'gray' },
        { label: 'White', value: 'white' }
    ];

    function refreshGaugeColorOptions(shared, paletteName, select, selectedValue) {
        const themes = shared.getColorThemes();
        const palette = themes[paletteName] || themes.ColorBlind10 || [];
        const options = GAUGE_COLOR_OPTIONS.slice();
        palette.forEach((color, index) => {
            options.push({ value: color, label: `Palette color ${index + 1}` });
        });
        const currentValue = selectedValue || select.val() || 'blue';
        if (currentValue && !options.some((option) => String(option.value) === String(currentValue))) {
            options.push({ value: currentValue, label: 'Current color' });
        }

        select.empty();
        options.forEach((option) => {
            select.append($('<option></option>').attr('value', option.value).text(option.label));
        });
        select.val(currentValue);
    }

    function getGaugeFamily() {
        return window.ModularGaugeFamily || null;
    }

    function getGaugeMeta(type) {
        const family = getGaugeFamily();
        return family && typeof family.getTypeMeta === 'function' ? family.getTypeMeta(type) : null;
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

    function normalizeXYSourceDef(sourceDef) {
        const normalized = sourceDef || {};
        return {
            ds: normalized.ds || '',
            type: normalized.type || '',
            device: normalized.device || null,
            device_uid: normalized.device_uid || normalized.deviceUid || null,
            var: normalized.var,
            op: normalized.op || 'identity',
            param: Number(normalized.param) || 0
        };
    }

    function buildXYAxisControls(shared, title, sourceDef) {
        const normalized = normalizeXYSourceDef(sourceDef);
        const card = $('<div class="border rounded p-2 d-flex flex-column gap-2"></div>');
        card.append($('<h4 class="small text-uppercase text-muted mb-0"></h4>').text(title));
        const source = buildSourceControls(shared, 'Datasource', normalized);
        const opField = createSelectRow('Transform', [
            { value: 'identity', label: 'x' },
            { value: 'negate', label: '-x' },
            { value: 'abs', label: 'abs(x)' },
            { value: 'scale', label: 'x * k' },
            { value: 'offset', label: 'x + b' }
        ], normalized.op || 'identity');
        const paramField = createInputRow('Parameter', 'number', normalized.param || 0, 'k or b');

        function syncTransformVisibility() {
            const op = opField.select.val() || 'identity';
            paramField.row.toggle(op === 'scale' || op === 'offset');
        }

        opField.select.on('change', syncTransformVisibility);
        syncTransformVisibility();

        card.append(source.wrapper, opField.row, paramField.row);

        return {
            card,
            buildValue() {
                const value = source.buildValue();
                if (!value || !value.ds) return null;
                const op = opField.select.val() || 'identity';
                return _.extend({}, value, {
                    op,
                    param: (op === 'scale' || op === 'offset') ? (parseFloat(paramField.input.val()) || 0) : 0
                });
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
        const left = $('<div class="col-md-6 d-flex flex-column gap-2"></div>');
        const right = $('<div class="col-md-6 d-flex flex-column gap-2"></div>');
        form.append(left, right);

        const channelsSection = createSection('Channels');
        const channelHeader = $('<div class="d-flex align-items-center justify-content-between gap-2"></div>');
        channelHeader.append('<div class="small text-muted">Configure series sources and transforms.</div>');
        const addChannelButton = $('<button type="button" class="btn btn-sm btn-outline-primary">Add channel</button>');
        channelHeader.append(addChannelButton);
        const channelList = $('<div class="d-flex flex-column gap-2"></div>');
        channelsSection.append(channelHeader, channelList);
        left.append(channelsSection);

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
        right.append(displaySection);

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
            const sourceA = buildSourceControls(shared, 'Source', normalized.a);
            const sourceB = buildSourceControls(shared, 'Second Source', normalized.b || {});
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

        new DialogBox(form, 'Edit Widget', 'Save', 'Cancel', function () {
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

    function normalizeFastFrameSeriesDefs(settings, sharedFast) {
        const rawDefs = Array.isArray(settings && settings.seriesDefs) ? settings.seriesDefs : [];
        if (rawDefs.length) {
            return rawDefs
                .filter((def) => def && def.variable)
                .map((def, index) => ({
                    variable: def.variable,
                    label: def.label || def.variable,
                    color: def.color || sharedFast.DEFAULT_COLORS[index % sharedFast.DEFAULT_COLORS.length],
                    visible: def.visible !== false
                }));
        }
        if (settings && settings.yVariable) {
            return [{
                variable: settings.yVariable,
                label: settings.yVariable,
                color: sharedFast.DEFAULT_COLORS[0],
                visible: true
            }];
        }
        return [];
    }

    function updateFastFrameSourceButtonLabel(button, mode) {
        if (!button) return;
        button.text(mode === 'latest' ? 'Choose Fallback CSV / Directory Anchor' : 'Choose CSV File');
    }

    function populateFastFrameColumnSelect(select, columns, currentValue, placeholder) {
        const values = Array.isArray(columns) ? columns : [];
        select.empty().append($('<option value=""></option>').text(placeholder));
        values.forEach((column) => {
            select.append($('<option></option>').attr('value', column).text(column));
        });
        if (currentValue && values.includes(currentValue)) {
            select.val(currentValue);
        } else if (!currentValue && values.length) {
            select.val(values[0]);
        } else {
            select.val('');
        }
    }

    function openFastFramePlotEditor(widgetModel, shared) {
        const sharedFast = shared.getFastFrameShared ? shared.getFastFrameShared() : window.FastFrameShared;
        if (!sharedFast) return false;

        const settings = widgetModel.settings() || {};
        const widgetInstance = widgetModel.widgetInstance || null;
        const state = {
            selectedCsvPath: settings.csvPath || '',
            availableFiles: Array.isArray(widgetInstance && widgetInstance.availableFiles) ? widgetInstance.availableFiles.slice() : [],
            availableColumns: Array.isArray(widgetInstance && widgetInstance.availableColumns) ? widgetInstance.availableColumns.slice() : [],
            seriesDefs: normalizeFastFrameSeriesDefs(settings, sharedFast)
        };

        const form = $('<div class="row g-3 integrated-plot-editor"></div>');
        const left = $('<div class="col-md-6 d-flex flex-column gap-2"></div>');
        const right = $('<div class="col-md-6 d-flex flex-column gap-2"></div>');
        form.append(left, right);

        const sourceSection = createSection('Source');
        const sourceModeField = createSelectRow('CSV Source', [
            { value: 'latest', label: 'Latest CSV in directory' },
            { value: 'fixed', label: 'Fixed CSV file' }
        ], sharedFast.getCsvSourceMode(settings));
        const chooseCsvButton = $('<button type="button" class="btn btn-sm btn-outline-secondary w-100"></button>');
        const csvName = $('<div class="small text-muted border rounded p-2"></div>');
        const timeColumnField = createSelectRow('X Variable', [], settings.timeColumn || settings.xVariable || '', 'Row index');
        sourceSection.append(sourceModeField.row, chooseCsvButton, csvName, timeColumnField.row);
        left.append(sourceSection);

        const channelsSection = createSection('Channels');
        const yVariableField = createSelectRow('Y Variable', [], settings.yVariable || '', 'Select Y variable');
        const labelField = createInputRow('Label', 'text', '', 'Optional label');
        const colorField = createInputRow('Color', 'color', sharedFast.DEFAULT_COLORS[0]);
        const visibleField = createCheckboxRow('Visible', true);
        const channelActions = $('<div class="d-flex gap-2"></div>');
        const applySourceButton = $('<button type="button" class="btn btn-sm btn-outline-secondary">Apply source</button>');
        const addChannelButton = $('<button type="button" class="btn btn-sm btn-primary">Add channel</button>');
        const resetChannelsButton = $('<button type="button" class="btn btn-sm btn-outline-danger">Reset channels</button>');
        const channelList = $('<div class="d-flex flex-column gap-2"></div>');
        channelActions.append(applySourceButton, addChannelButton, resetChannelsButton);
        channelsSection.append(
            yVariableField.row,
            labelField.row,
            colorField.row,
            visibleField.row,
            channelActions,
            channelList
        );
        left.append(channelsSection);

        const displaySection = createSection('Display');
        const titleField = createInputRow('Title', 'text', settings.title || 'Fast Frame Plot');
        const xLabelField = createInputRow('X Label', 'text', settings.xLabel || '');
        const yLabelField = createInputRow('Y Label', 'text', settings.yLabel || '');
        const xMinField = createInputRow('X Min', 'number', settings.xMin ?? '');
        const xMaxField = createInputRow('X Max', 'number', settings.xMax ?? '');
        const yMinField = createInputRow('Y Min', 'number', settings.yMin ?? '');
        const yMaxField = createInputRow('Y Max', 'number', settings.yMax ?? '');
        const legendField = createCheckboxRow('Show Legend', settings.showLegend);
        displaySection.append(
            titleField.row,
            xLabelField.row,
            yLabelField.row,
            xMinField.row,
            xMaxField.row,
            yMinField.row,
            yMaxField.row,
            legendField.row
        );
        right.append(displaySection);

        function displayCsvLabel(filePath) {
            if (!filePath) return 'No file selected.';
            return sharedFast.displayPath ? sharedFast.displayPath(filePath) : filePath;
        }

        function renderSeriesList() {
            channelList.empty();
            state.seriesDefs.forEach((def, index) => {
                const row = $('<div class="border rounded p-2 d-flex justify-content-between align-items-center gap-2"></div>');
                const summary = `${def.label || def.variable} (${def.variable})${def.visible === false ? ' [hidden]' : ''}`;
                row.append($('<div class="small"></div>').text(summary));
                row.append($('<button type="button" class="btn btn-sm btn-outline-danger">Remove</button>').on('click', () => {
                    state.seriesDefs.splice(index, 1);
                    renderSeriesList();
                }));
                channelList.append(row);
            });
            if (!state.seriesDefs.length) {
                channelList.append('<div class="small text-muted">No channels configured.</div>');
            }
        }

        async function refreshColumns(preferredX, preferredY) {
            const currentMode = sourceModeField.select.val() || sharedFast.getCsvSourceMode(settings);
            updateFastFrameSourceButtonLabel(chooseCsvButton, currentMode);
            csvName.text(displayCsvLabel(state.selectedCsvPath || settings.csvPath || ''));

            const csvPath = state.selectedCsvPath || settings.csvPath || '';
            const csvDirectory = csvPath
                ? ((sharedFast.pathApi && sharedFast.pathApi.dirname) ? sharedFast.pathApi.dirname(csvPath) : sharedFast.defaultCsvDirectory())
                : (settings.csvDirectory || sharedFast.defaultCsvDirectory());
            state.availableFiles = csvDirectory ? await sharedFast.listCsvFiles(csvDirectory) : [];
            const source = sharedFast.resolveCsvSource({
                csvSourceMode: currentMode,
                csvDirectory,
                csvPath
            }, state.availableFiles);

            if (source.filePath) {
                const loaded = await sharedFast.loadCsvDataset(source.filePath, '');
                state.availableColumns = loaded.dataset ? loaded.dataset.headers.filter((header) => header !== 'k_acquire') : [];
            } else if (Array.isArray(widgetInstance && widgetInstance.availableColumns) && widgetInstance.availableColumns.length) {
                state.availableColumns = widgetInstance.availableColumns.slice();
            } else {
                state.availableColumns = [];
            }

            populateFastFrameColumnSelect(
                timeColumnField.select,
                state.availableColumns,
                preferredX !== undefined ? preferredX : (timeColumnField.select.val() || settings.timeColumn || settings.xVariable || ''),
                'Row index'
            );
            populateFastFrameColumnSelect(
                yVariableField.select,
                state.availableColumns,
                preferredY !== undefined ? preferredY : (yVariableField.select.val() || settings.yVariable || ''),
                'Select Y variable'
            );
        }

        sourceModeField.select.on('change', () => {
            refreshColumns(timeColumnField.select.val(), yVariableField.select.val()).catch(() => {});
        });

        chooseCsvButton.on('click', async () => {
            const chooser = sharedFast.fileApi && sharedFast.fileApi.chooseCsvFile;
            if (!chooser) return;
            const chosen = await chooser();
            if (!chosen) return;
            state.selectedCsvPath = chosen;
            csvName.text(displayCsvLabel(chosen));
            await refreshColumns(timeColumnField.select.val(), yVariableField.select.val());
        });

        applySourceButton.on('click', () => {
            refreshColumns(timeColumnField.select.val(), yVariableField.select.val()).catch(() => {});
            renderSeriesList();
        });

        addChannelButton.on('click', () => {
            const variable = yVariableField.select.val();
            if (!variable) return;
            state.seriesDefs.push({
                variable,
                label: labelField.input.val() || variable,
                color: colorField.input.val() || sharedFast.DEFAULT_COLORS[state.seriesDefs.length % sharedFast.DEFAULT_COLORS.length],
                visible: visibleField.input.prop('checked')
            });
            renderSeriesList();
        });

        resetChannelsButton.on('click', () => {
            state.seriesDefs = [];
            renderSeriesList();
        });

        updateFastFrameSourceButtonLabel(chooseCsvButton, sourceModeField.select.val() || sharedFast.getCsvSourceMode(settings));
        csvName.text(displayCsvLabel(state.selectedCsvPath || settings.csvPath || ''));
        renderSeriesList();
        refreshColumns(settings.timeColumn || settings.xVariable || '', settings.yVariable || '').catch(() => {});

        new DialogBox(form, 'Edit Widget', 'Save', 'Cancel', function () {
            const csvPath = state.selectedCsvPath || settings.csvPath || '';
            const csvSourceMode = sourceModeField.select.val() || sharedFast.getCsvSourceMode(settings);
            const csvDirectory = csvPath
                ? ((sharedFast.pathApi && sharedFast.pathApi.dirname) ? sharedFast.pathApi.dirname(csvPath) : sharedFast.defaultCsvDirectory())
                : (settings.csvDirectory || sharedFast.defaultCsvDirectory());
            const xVariable = timeColumnField.select.val() || '';
            const yVariable = yVariableField.select.val() || settings.yVariable || '';
            const updated = _.extend({}, settings, {
                title: titleField.input.val() || settings.title || 'Fast Frame Plot',
                xLabel: xLabelField.input.val() || '',
                yLabel: yLabelField.input.val() || '',
                xMin: xMinField.input.val(),
                xMax: xMaxField.input.val(),
                yMin: yMinField.input.val(),
                yMax: yMaxField.input.val(),
                showLegend: legendField.input.prop('checked'),
                csvSourceMode,
                csvDirectory,
                csvPath,
                timeColumn: xVariable,
                xVariable,
                yVariable,
                seriesDefs: state.seriesDefs.slice()
            });
            delete updated.helperWidgets;
            shared.commitWidgetSettings(widgetModel, updated);
        });
        return true;
    }

    function appendGaugeSpecificStyleFields(type, container, fields) {
        fields.valueSize = createSelectRow('Value Size', [
            { value: 'small', label: 'Small' },
            { value: 'big', label: 'Big' }
        ], (fields.settings.valueSize === 'large' ? 'big' : (fields.settings.valueSize || fields.settings.centerValueSize || (type === 'radial_arc_gauge' || type === 'radial_needle_gauge' || type === 'donut_gauge' ? 'big' : 'small'))));
        container.append(fields.valueSize.row);
        if (type === 'horizontal_gauge') {
            fields.compactMode = createCheckboxRow('Compact Mode', fields.settings.compactMode);
            fields.labelPosition = createSelectRow('Label Position', [
                { value: 'top', label: 'Top' },
                { value: 'bottom', label: 'Bottom' }
            ], fields.settings.labelPosition || 'top');
            fields.fillDirection = createSelectRow('Fill Direction', [
                { value: 'ltr', label: 'Left to right' },
                { value: 'rtl', label: 'Right to left' }
            ], fields.settings.fillDirection || 'ltr');
            container.append(fields.compactMode.row, fields.labelPosition.row, fields.fillDirection.row);
        } else if (type === 'radial_arc_gauge' || type === 'radial_needle_gauge') {
            fields.sweepAngle = createSelectRow('Sweep Size', [
                { value: '180', label: '180 degrees' },
                { value: '270', label: '270 degrees' }
            ], String(fields.settings.sweepAngle || 180));
            container.append(fields.sweepAngle.row);
            if (type === 'radial_needle_gauge') {
                fields.needleStyle = createSelectRow('Needle Style', [
                    { value: 'classic', label: 'Classic' },
                    { value: 'slim', label: 'Slim' }
                ], fields.settings.needleStyle || 'classic');
                fields.showHub = createCheckboxRow('Show Hub', fields.settings.showHub !== false);
                container.append(fields.needleStyle.row, fields.showHub.row);
            }
        } else if (type === 'donut_gauge') {
            fields.ringThickness = createSelectRow('Ring Thickness', [
                { value: 'thin', label: 'Thin' },
                { value: 'medium', label: 'Medium' },
                { value: 'thick', label: 'Thick' }
            ], fields.settings.ringThickness || 'medium');
            container.append(fields.ringThickness.row);
        }
    }

    function buildGaugeSpecificSettings(type, fields, settings) {
        const out = {
            valueSize: fields.valueSize.select.val() || 'small'
        };
        if (type === 'horizontal_gauge') {
            out.compactMode = fields.compactMode.input.prop('checked');
            out.labelPosition = fields.labelPosition.select.val() || 'top';
            out.fillDirection = fields.fillDirection.select.val() || 'ltr';
        } else if (type === 'radial_arc_gauge' || type === 'radial_needle_gauge') {
            out.sweepAngle = parseInt(fields.sweepAngle.select.val(), 10) || 180;
            if (type === 'radial_needle_gauge') {
                out.needleStyle = fields.needleStyle.select.val() || 'classic';
                out.showHub = fields.showHub.input.prop('checked');
            }
        } else if (type === 'donut_gauge') {
            out.ringThickness = fields.ringThickness.select.val() || 'medium';
        }
        return out;
    }

    function openVerticalGaugeEditor(widgetModel, shared, type) {
        type = type || 'vertical_gauge';
        const settings = widgetModel.settings() || {};
        const gaugeMeta = getGaugeMeta(type);
        const form = $('<div class="row g-3 integrated-plot-editor"></div>');
        const left = $('<div class="col-md-6 d-flex flex-column gap-2"></div>');
        const right = $('<div class="col-md-6 d-flex flex-column gap-2"></div>');
        form.append(left, right);

        const sourceSection = createSection('Source');
        const sourceControls = buildSourceControls(shared, 'Datasource', settings.sourceDef);
        sourceSection.append(sourceControls.wrapper);
        left.append(sourceSection);

        const displaySection = createSection('Display');
        const titleField = createInputRow('Title', 'text', settings.title || (gaugeMeta ? gaugeMeta.displayName : 'Gauge'));
        const minField = createInputRow('Minimum', 'number', settings.min ?? 0);
        const maxField = createInputRow('Maximum', 'number', settings.max ?? 100);
        const unitsField = createInputRow('Units', 'text', settings.units || '');
        const refreshField = createInputRow('Refresh Rate (ms)', 'number', settings.refreshRate ?? 500);
        const showValueField = createCheckboxRow('Show Value', settings.showValue !== false);
        const showMinMaxField = createCheckboxRow('Show Min/Max', settings.showMinMax !== false);
        displaySection.append(
            titleField.row,
            minField.row,
            maxField.row,
            unitsField.row,
            refreshField.row,
            showValueField.row,
            showMinMaxField.row
        );
        right.append(displaySection);

        const zonesSection = createSection('Zones');
        const alarmEnabledField = createCheckboxRow('Alarm Enabled', settings.alarmEnabled);
        const warningThresholdField = createInputRow('Warning Threshold', 'number', settings.warningThreshold ?? '');
        const criticalThresholdField = createInputRow('Critical Threshold', 'number', settings.criticalThreshold ?? '');
        const alarmDirectionField = createSelectRow('Alarm Direction', [
            { value: 'above', label: 'Above threshold' },
            { value: 'below', label: 'Below threshold' }
        ], settings.alarmDirection || 'above');
        zonesSection.append(
            alarmEnabledField.row,
            warningThresholdField.row,
            criticalThresholdField.row,
            alarmDirectionField.row
        );
        left.append(zonesSection);

        const styleSection = createSection('Style');
        const paletteThemes = shared.getColorThemes();
        const paletteOptions = Object.keys(paletteThemes)
            .map((key) => ({ value: key, label: key }))
            .filter((entry) => (paletteThemes[entry.value] || []).length);
        const paletteField = createSelectRow('Color palette', paletteOptions, settings.colorPalette || 'ColorBlind10');
        const colorField = createSelectRow('Bar Color', [], settings.barColor || 'blue');
        refreshGaugeColorOptions(shared, paletteField.select.val() || 'ColorBlind10', colorField.select, settings.barColor || 'blue');
        paletteField.select.on('change', () => {
            refreshGaugeColorOptions(shared, paletteField.select.val() || 'ColorBlind10', colorField.select, colorField.select.val());
        });
        styleSection.append(paletteField.row, colorField.row);
        const styleFields = { settings };
        appendGaugeSpecificStyleFields(type, styleSection, styleFields);
        left.append(styleSection);

        new DialogBox(form, 'Edit Widget', 'Save', 'Cancel', function () {
            const sourceDef = sourceControls.buildValue();
            const updated = _.extend({}, settings, buildGaugeSpecificSettings(type, styleFields, settings), {
                title: titleField.input.val() || settings.title || (gaugeMeta ? gaugeMeta.displayName : 'Gauge'),
                min: shared.parseNumber(minField.input.val()) ?? 0,
                max: shared.parseNumber(maxField.input.val()) ?? 100,
                units: unitsField.input.val() || '',
                refreshRate: Math.max(50, parseInt(refreshField.input.val(), 10) || 500),
                showValue: showValueField.input.prop('checked'),
                showMinMax: showMinMaxField.input.prop('checked'),
                alarmEnabled: alarmEnabledField.input.prop('checked'),
                warningThreshold: (warningThresholdField.input.val() === '' ? undefined : shared.parseNumber(warningThresholdField.input.val())),
                criticalThreshold: (criticalThresholdField.input.val() === '' ? undefined : shared.parseNumber(criticalThresholdField.input.val())),
                alarmDirection: alarmDirectionField.select.val() || 'above',
                colorPalette: paletteField.select.val() || 'ColorBlind10',
                barColor: colorField.select.val() || 'blue',
                sourceDef
            });
            delete updated.helperWidgets;
            shared.commitWidgetSettings(widgetModel, updated);
        });

        return true;
    }

    function openXYPlotEditor(widgetModel, shared) {
        const settings = widgetModel.settings() || {};
        const form = $('<div class="row g-3 integrated-plot-editor"></div>');
        const left = $('<div class="col-md-6 d-flex flex-column gap-2"></div>');
        const right = $('<div class="col-md-6 d-flex flex-column gap-2"></div>');
        form.append(left, right);

        const sourcesSection = createSection('Sources');
        const xAxisControls = buildXYAxisControls(shared, 'X Source', settings.xSourceDef);
        const yAxisControls = buildXYAxisControls(shared, 'Y Source', settings.ySourceDef);
        sourcesSection.append(xAxisControls.card, yAxisControls.card);
        left.append(sourcesSection);

        const displaySection = createSection('Display');
        const titleField = createInputRow('Title', 'text', settings.title || 'XY Plot');
        const historyField = createInputRow('History Length', 'number', settings.historyLength || 200);
        const refreshField = createInputRow('Refresh Rate (ms)', 'number', settings.refreshRate || 250);
        const xLabelField = createInputRow('X Axis Label', 'text', settings.xLabel || 'X');
        const yLabelField = createInputRow('Y Axis Label', 'text', settings.yLabel || 'Y');
        const xMinField = createInputRow('X Min', 'number', settings.xMin ?? '');
        const xMaxField = createInputRow('X Max', 'number', settings.xMax ?? '');
        const yMinField = createInputRow('Y Min', 'number', settings.yMin ?? '');
        const yMaxField = createInputRow('Y Max', 'number', settings.yMax ?? '');
        displaySection.append(
            titleField.row,
            historyField.row,
            refreshField.row,
            xLabelField.row,
            yLabelField.row,
            xMinField.row,
            xMaxField.row,
            yMinField.row,
            yMaxField.row
        );
        right.append(displaySection);

        new DialogBox(form, 'Edit Widget', 'Save', 'Cancel', function () {
            const xSourceDef = xAxisControls.buildValue();
            const ySourceDef = yAxisControls.buildValue();
            if (!xSourceDef || !ySourceDef) return;
            const updated = _.extend({}, settings, {
                title: titleField.input.val() || settings.title || 'XY Plot',
                historyLength: Math.max(2, parseInt(historyField.input.val(), 10) || 200),
                refreshRate: Math.max(50, parseInt(refreshField.input.val(), 10) || 250),
                xLabel: xLabelField.input.val() || 'X',
                yLabel: yLabelField.input.val() || 'Y',
                xMin: shared.parseNumber(xMinField.input.val()),
                xMax: shared.parseNumber(xMaxField.input.val()),
                yMin: shared.parseNumber(yMinField.input.val()),
                yMax: shared.parseNumber(yMaxField.input.val()),
                xSourceDef,
                ySourceDef
            });
            delete updated.helperWidgets;
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
            if (type === 'xy_plot_uplot') {
                return openXYPlotEditor(widgetModel, shared);
            }
            if (type === 'fast_frame_plot') {
                return openFastFramePlotEditor(widgetModel, shared);
            }
            if (type === 'vertical_gauge') {
                return openVerticalGaugeEditor(widgetModel, shared, type);
            }
            if (type === 'horizontal_gauge') {
                return openVerticalGaugeEditor(widgetModel, shared, type);
            }
            if (type === 'radial_arc_gauge' || type === 'donut_gauge') {
                return openVerticalGaugeEditor(widgetModel, shared, type);
            }
            if (type === 'radial_needle_gauge') {
                return openVerticalGaugeEditor(widgetModel, shared, type);
            }
            return false;
        }
    };
}());
