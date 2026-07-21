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
        const row = $('<div class="input-group input-group-sm" style="display:grid;grid-template-columns:max-content 1fr"></div>');
        const input = $(`<input type="${type}" class="form-control form-control-sm" style="min-width:0;width:100%">`);
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
        const row = $('<div class="input-group input-group-sm" style="display:grid;grid-template-columns:max-content 1fr"></div>');
        const select = $('<select class="form-select form-select-sm" style="min-width:0;width:100%"></select>');
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
            { value: 'identity', label: 'x  (signal x value)' },
            { value: 'negate', label: '-x  (signal x inverse value)' },
            { value: 'abs', label: 'abs(x)  (signal x absolute value)' },
            { value: 'scale', label: 'x * k  (signal x times a constant k)' },
            { value: 'offset', label: 'x + b  (signal x plus a constant b)' }
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
            color: def && def.color ? def.color : null,
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
        const sharedFast = shared.getFastFrameShared ? shared.getFastFrameShared() : window.FastFrameShared;
        const form = $('<div class="row g-3 integrated-plot-editor"></div>');
        const left = $('<div class="col-md-6 d-flex flex-column gap-2"></div>');
        const right = $('<div class="col-md-6 d-flex flex-column gap-2"></div>');
        form.append(left, right);

        // ── Channels section: single compact add-form + list below ──────────
        const channelsSection = createSection('Channels');
        channelsSection.append($('<div class="small text-muted">Configure series sources and transforms.</div>'));

        const addLabelField = createInputRow('Label', 'text', '', 'Optional channel label');
        const addOpField = createSelectRow('Operation', [
            { value: 'identity', label: 'x  (signal x value)' },
            { value: 'negate', label: '-x  (signal x inverse value)' },
            { value: 'abs', label: 'abs(x)  (signal x absolute value)' },
            { value: 'scale', label: 'x * k  (signal x times a constant k)' },
            { value: 'offset', label: 'x + b  (signal x plus a constant b)' }
        ], 'identity');
        const addParamField = createInputRow('Parameter', 'number', 0, 'k or b');
        addParamField.row.hide();
        addOpField.select.on('change', () => {
            const op = addOpField.select.val();
            addParamField.row.toggle(op === 'scale' || op === 'offset');
        });
        const addSource = buildSourceControls(shared, 'Source', {});
        const addColorField = createInputRow('Color', 'color', '#4e79a7');

        const channelActions = $('<div class="d-flex gap-2"></div>');
        const addChannelButton = $('<button type="button" class="btn btn-sm btn-primary">Add channel</button>');
        const resetChannelsButton = $('<button type="button" class="btn btn-sm btn-outline-danger">Reset channels</button>');
        channelActions.append(addChannelButton, resetChannelsButton);

        const channelList = $('<div class="d-flex flex-column gap-1 mt-1"></div>');
        channelsSection.append(addLabelField.row, addOpField.row, addParamField.row, addSource.wrapper, addColorField.row, channelActions, channelList);
        left.append(channelsSection);

        // ── Display section ──────────────────────────────────────────────────
        const displaySection = createSection('Display');
        const titleField = createInputRow('Title', 'text', settings.title || '');
        const durationField = createInputRow('Display Duration (ms)', 'number', settings.duration || 20000);
        const refreshField = createInputRow('Refresh Rate (ms)', 'number', settings.refreshRate || 1000);
        const yLabelField = createInputRow('Y Axis Label', 'text', settings.yLabel || '');
        const yMinField = createInputRow('Y Min', 'number', settings.yMin ?? '', 'auto');
        const yMaxField = createInputRow('Y Max', 'number', settings.yMax ?? '', 'auto');
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

        // ── Channel list state ───────────────────────────────────────────────
        const channelDefs = shared.parseSeriesDefs(settings.seriesDefs)
            .map(normalizeOwntechSeriesDef)
            .map((def) => { const d = { ...def, b: null }; if (d.op === 'mulvar') d.op = 'identity'; return d; });

        function nextChannelColor() {
            const paletteName = paletteField.select.val() || 'ColorBlind10';
            const themes = shared.getColorThemes();
            const palette = (Array.isArray(themes[paletteName]) && themes[paletteName].length)
                ? themes[paletteName]
                : (sharedFast ? sharedFast.DEFAULT_COLORS : ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc949']);
            return palette[channelDefs.length % palette.length];
        }
        addColorField.input.val(nextChannelColor());

        function renderChannelList() {
            channelList.empty();
            if (!channelDefs.length) {
                channelList.append('<div class="small text-muted">No channels added.</div>');
                return;
            }
            channelDefs.forEach((def, index) => {
                const row = $('<div class="border rounded px-2 py-1 d-flex justify-content-between align-items-center gap-2"></div>');
                const dsLabel = def.a && def.a.ds ? def.a.ds : 'source';
                const varLabel = (def.a && def.a.var !== undefined && def.a.var !== null) ? ` · ${def.a.var}` : '';
                const opLabel = (def.op && def.op !== 'identity') ? ` [${def.op}${def.op === 'scale' || def.op === 'offset' ? ` ${def.param}` : ''}]` : '';
                const summary = (def.label || `${dsLabel}${varLabel}`) + opLabel;
                const dot = $('<span style="display:inline-block;width:10px;height:10px;border-radius:2px;flex-shrink:0;"></span>').css('background', def.color || '#888');
                const labelWrap = $('<div class="d-flex align-items-center gap-2"></div>').append(dot, $('<div class="small"></div>').text(summary));
                row.append(labelWrap);
                row.append($('<button type="button" class="btn btn-sm btn-outline-danger">Remove</button>').on('click', () => {
                    channelDefs.splice(index, 1);
                    renderChannelList();
                }));
                channelList.append(row);
            });
        }

        addChannelButton.on('click', () => {
            const sourceValue = addSource.buildValue();
            if (!sourceValue || !sourceValue.ds) return;
            const op = addOpField.select.val() || 'identity';
            channelDefs.push({
                label: (addLabelField.input.val() || '').trim(),
                op,
                param: (op === 'scale' || op === 'offset') ? (parseFloat(addParamField.input.val()) || 0) : 0,
                color: addColorField.input.val() || nextChannelColor(),
                a: sourceValue,
                b: null
            });
            addLabelField.input.val('');
            addColorField.input.val(nextChannelColor());
            renderChannelList();
        });

        resetChannelsButton.on('click', () => {
            channelDefs.length = 0;
            addColorField.input.val(nextChannelColor());
            renderChannelList();
        });

        renderChannelList();

        paletteField.select.on('change', () => {
            applyPalette(shared, paletteField.select.val() || 'ColorBlind10');
        });
        applyPalette(shared, paletteField.select.val() || 'ColorBlind10');

        new DialogBox(form, 'Edit Widget', 'Save', 'Cancel', function () {
            const updated = _.extend({}, settings, {
                title: titleField.input.val() || settings.title || 'Plot widget',
                duration: parseInt(durationField.input.val(), 10) || 20000,
                refreshRate: parseInt(refreshField.input.val(), 10) || 1000,
                yLabel: yLabelField.input.val() || 'Value',
                yMin: shared.parseNumber(yMinField.input.val()),
                yMax: shared.parseNumber(yMaxField.input.val()),
                showLegend: legendField.input.prop('checked'),
                colorPalette: paletteField.select.val() || 'ColorBlind10',
                seriesDefs: channelDefs.filter((d) => d && d.a && d.a.ds)
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
                .filter((def) => def && (def.variable || (def.type === 'math' && def.operandA && def.operator && def.operandB !== undefined && def.operandB !== '')))
                .map((def, index) => {
                    if (def.type === 'math') {
                        return {
                            type: 'math',
                            operandA: def.operandA,
                            operator: def.operator,
                            operandB: String(def.operandB),
                            label: def.label || `${def.operandA} ${def.operator} ${def.operandB}`,
                            color: def.color || sharedFast.DEFAULT_COLORS[index % sharedFast.DEFAULT_COLORS.length],
                            visible: def.visible !== false
                        };
                    }
                    return {
                        variable: def.variable,
                        label: def.label || def.variable,
                        color: def.color || sharedFast.DEFAULT_COLORS[index % sharedFast.DEFAULT_COLORS.length],
                        visible: def.visible !== false
                    };
                });
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

    function parseFftSignalColumns(settings) {
        return String(settings && settings.signalColumns || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean);
    }

    function normalizeFftChannelDefs(settings, sharedFast) {
        const palette = sharedFast ? sharedFast.DEFAULT_COLORS : ['#4e9fd4', '#e6862a', '#5cb85c', '#d9534f', '#9b59b6', '#1abc9c'];
        const rawDefs = Array.isArray(settings && settings.channelDefs) ? settings.channelDefs : [];
        if (rawDefs.length) {
            return rawDefs.filter((d) => d && (
                (d.variable && typeof d.variable === 'string') ||
                (d.type === 'math' && d.operandA && d.operator && d.operandB !== undefined && d.operandB !== '')
            )).map((def, index) => Object.assign({ color: palette[index % palette.length] }, def));
        }
        const cols = parseFftSignalColumns(settings);
        return cols.map((col, index) => ({
            variable: col,
            label: col,
            color: palette[index % palette.length]
        }));
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
        if (window._tutorialPendingCsv) {
            state.selectedCsvPath = window._tutorialPendingCsv;
            window._tutorialPendingCsv = null;
        }

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
        const typeField = createSelectRow('Type', [
            { value: 'regular', label: 'Regular' },
            { value: 'math', label: 'Math' }
        ], 'regular');
        const yVariableField = createSelectRow('Y Variable', [], settings.yVariable || '', 'Select Y variable');
        // Math channel controls
        const mathAField = createSelectRow('A', [], '', 'Select A');
        const mathOpField = createSelectRow('Op', [
            { value: '+', label: '+' }, { value: '-', label: '−' },
            { value: '*', label: '×' }, { value: '/', label: '/' }
        ], '+');
        mathOpField.row.find('.input-group-text').css('min-width', '0');
        const mathBField = createSelectRow('B', [], '', 'Select B');
        const mathKField = createInputRow('k', 'number', '', 'constant value');
        const labelField = createInputRow('Label', 'text', '', 'Optional label');
        const colorField = createInputRow('Color', 'color', sharedFast.DEFAULT_COLORS[state.seriesDefs.length % sharedFast.DEFAULT_COLORS.length]);
        const visibleField = createCheckboxRow('Visible', true);
        const channelActions = $('<div class="d-flex gap-2"></div>');
        const applySourceButton = $('<button type="button" class="btn btn-sm btn-outline-secondary">Apply source</button>');
        const addChannelButton = $('<button type="button" class="btn btn-sm btn-primary">Add channel</button>');
        const resetChannelsButton = $('<button type="button" class="btn btn-sm btn-outline-danger">Reset channels</button>');
        const channelList = $('<div class="d-flex flex-column gap-2"></div>');
        channelActions.append(applySourceButton, addChannelButton, resetChannelsButton);
        channelsSection.append(
            typeField.row,
            yVariableField.row,
            mathAField.row,
            mathOpField.row,
            mathBField.row,
            mathKField.row,
            labelField.row,
            colorField.row,
            visibleField.row,
            channelActions,
            channelList
        );
        left.append(channelsSection);

        function syncChannelTypeUi() {
            const isMath = typeField.select.val() === 'math';
            yVariableField.row.toggle(!isMath);
            mathAField.row.toggle(isMath);
            mathOpField.row.toggle(isMath);
            mathBField.row.toggle(isMath);
            mathKField.row.toggle(isMath && mathBField.select.val() === '__const__');
        }
        typeField.select.on('change', syncChannelTypeUi);
        mathBField.select.on('change', () => mathKField.row.toggle(mathBField.select.val() === '__const__'));
        syncChannelTypeUi();

        const displaySection = createSection('Display');
        const titleField = createInputRow('Title', 'text', settings.title || 'Fast Frame Plot');
        const xLabelField = createInputRow('X Label', 'text', settings.xLabel || '');
        const yLabelField = createInputRow('Y Label', 'text', settings.yLabel || '');
        const xMinField = createInputRow('X Min', 'number', settings.xMin ?? '', 'auto');
        const xMaxField = createInputRow('X Max', 'number', settings.xMax ?? '', 'auto');
        const yMinField = createInputRow('Y Min', 'number', settings.yMin ?? '', 'auto');
        const yMaxField = createInputRow('Y Max', 'number', settings.yMax ?? '', 'auto');
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

        function populateOptionalTimeColumnSelect(columns, currentValue) {
            const values = Array.isArray(columns) ? columns : [];
            timeColumnField.select.empty().append($('<option value=""></option>').text('Sample index × TS'));
            values.forEach((column) => {
                timeColumnField.select.append($('<option></option>').attr('value', column).text(column));
            });
            if (currentValue && values.includes(currentValue)) {
                timeColumnField.select.val(currentValue);
            } else {
                timeColumnField.select.val('');
            }
        }

        function renderSeriesList() {
            channelList.empty();
            state.seriesDefs.forEach((def, index) => {
                const row = $('<div class="border rounded p-2 d-flex justify-content-between align-items-center gap-2"></div>');
                let summary;
                if (def.type === 'math') {
                    summary = `${def.label} (${def.operandA} ${def.operator} ${def.operandB})${def.visible === false ? ' [hidden]' : ''}`;
                } else {
                    summary = `${def.label || def.variable} (${def.variable})${def.visible === false ? ' [hidden]' : ''}`;
                }
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
            populateFastFrameColumnSelect(mathAField.select, state.availableColumns, mathAField.select.val() || '', 'Select A');
            // mathB: columns + constant option
            const prevB = mathBField.select.val();
            mathBField.select.empty().append('<option value="">Select B</option>');
            state.availableColumns.forEach((col) => mathBField.select.append($('<option></option>').attr('value', col).text(col)));
            mathBField.select.append('<option value="__const__">— constant k —</option>');
            if (prevB && mathBField.select.find(`option[value="${prevB}"]`).length) mathBField.select.val(prevB);
            mathKField.row.toggle(typeField.select.val() === 'math' && mathBField.select.val() === '__const__');
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
            const isMath = typeField.select.val() === 'math';
            const color = colorField.input.val() || sharedFast.DEFAULT_COLORS[state.seriesDefs.length % sharedFast.DEFAULT_COLORS.length];
            const visible = visibleField.input.prop('checked');
            const label = labelField.input.val().trim();
            if (isMath) {
                const operandA = mathAField.select.val();
                const operator = mathOpField.select.val();
                const bIsConst = mathBField.select.val() === '__const__';
                const operandB = bIsConst ? String(parseFloat(mathKField.input.val()) || 0) : mathBField.select.val();
                if (!operandA || !operator || !operandB) return;
                state.seriesDefs.push({ type: 'math', operandA, operator, operandB,
                    label: label || `${operandA} ${operator} ${operandB}`, color, visible });
            } else {
                const variable = yVariableField.select.val();
                if (!variable) return;
                state.seriesDefs.push({ variable, label: label || variable, color, visible });
            }
            labelField.input.val('');
            colorField.input.val(sharedFast.DEFAULT_COLORS[state.seriesDefs.length % sharedFast.DEFAULT_COLORS.length]);
            renderSeriesList();
        });

        resetChannelsButton.on('click', () => {
            state.seriesDefs = [];
            colorField.input.val(sharedFast.DEFAULT_COLORS[0]);
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

    function openFftSpectrumPlotEditor(widgetModel, shared) {
        const sharedFast = shared.getFastFrameShared ? shared.getFastFrameShared() : window.FastFrameShared;
        if (!sharedFast) return false;

        const settings = widgetModel.settings() || {};
        const widgetInstance = widgetModel.widgetInstance || null;
        const state = {
            selectedCsvPath: settings.csvPath || '',
            availableFiles: Array.isArray(widgetInstance && widgetInstance.availableFiles) ? widgetInstance.availableFiles.slice() : [],
            availableColumns: Array.isArray(widgetInstance && widgetInstance.availableColumns) ? widgetInstance.availableColumns.slice() : [],
            channelDefs: normalizeFftChannelDefs(settings, sharedFast)
        };

        if (window._tutorialPendingCsv) {
            state.selectedCsvPath = window._tutorialPendingCsv;
            window._tutorialPendingCsv = null;
        }

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
        const timeColumnField = createSelectRow('Time Column', [], settings.timeColumn || '', 'Sample index × TS');
        sourceSection.append(sourceModeField.row, chooseCsvButton, csvName, timeColumnField.row);
        left.append(sourceSection);

        const channelsSection = createSection('Channels');
        const typeField = createSelectRow('Type', [
            { value: 'regular', label: 'Regular' },
            { value: 'math', label: 'Math' }
        ], 'regular');
        const yVariableField = createSelectRow('Y Variable', [], '', 'Select signal column');
        const mathAField = createSelectRow('A', [], '', 'Select A');
        const mathOpField = createSelectRow('Op', [
            { value: '+', label: '+' }, { value: '-', label: '−' },
            { value: '*', label: '×' }, { value: '/', label: '/' }
        ], '+');
        mathOpField.row.find('.input-group-text').css('min-width', '0');
        const mathBField = createSelectRow('B', [], '', 'Select B');
        const mathKField = createInputRow('k', 'number', '', 'constant value');
        const labelField = createInputRow('Label', 'text', '', 'Optional label');
        const colorField = createInputRow('Color', 'color', sharedFast.DEFAULT_COLORS[state.channelDefs.length % sharedFast.DEFAULT_COLORS.length]);
        const channelActions = $('<div class="d-flex gap-2 flex-wrap"></div>');
        const applySourceButton = $('<button type="button" class="btn btn-sm btn-outline-secondary">Apply source</button>');
        const addChannelButton = $('<button type="button" class="btn btn-sm btn-primary">Add channel</button>');
        const resetChannelsButton = $('<button type="button" class="btn btn-sm btn-outline-danger">Reset channels</button>');
        const channelList = $('<div class="d-flex flex-column gap-2"></div>');
        channelActions.append(applySourceButton, addChannelButton, resetChannelsButton);
        channelsSection.append(
            typeField.row,
            yVariableField.row,
            mathAField.row,
            mathOpField.row,
            mathBField.row,
            mathKField.row,
            labelField.row,
            colorField.row,
            channelActions,
            channelList
        );
        left.append(channelsSection);

        const displaySection = createSection('Display');
        const titleField = createInputRow('Title', 'text', settings.title || 'FFT Spectrum');
        const samplingPeriodField = createInputRow('Sampling Period (us)', 'number', settings.samplingPeriodUs || 100);
        const fundamentalField = createInputRow('Fundamental Frequency (Hz)', 'number', settings.fundamentalFreqHz || 50);
        const maxFreqField = createInputRow('Max Frequency (Hz)', 'number', settings.maxFreqHz || 1000);
        const maxHarmonicField = createInputRow('Max Harmonic', 'number', settings.maxHarmonic || 11);
        const showTimeField = createCheckboxRow('Show Time Domain', settings.showTimeDomain !== false);
        const showSpectrumField = createCheckboxRow('Show Spectrum', settings.showSpectrum !== false);
        const showBarsField = createCheckboxRow('Show Harmonic Bars', settings.showHarmonicBars !== false);
        const logScaleField = createCheckboxRow('Log Scale Spectrum', settings.logScaleSpectrum !== false);
        displaySection.append(
            titleField.row,
            samplingPeriodField.row,
            fundamentalField.row,
            maxFreqField.row,
            maxHarmonicField.row,
            showTimeField.row,
            showSpectrumField.row,
            showBarsField.row,
            logScaleField.row
        );
        right.append(displaySection);

        function syncChannelTypeUi() {
            const isMath = typeField.select.val() === 'math';
            yVariableField.row.toggle(!isMath);
            mathAField.row.toggle(isMath);
            mathOpField.row.toggle(isMath);
            mathBField.row.toggle(isMath);
            mathKField.row.toggle(isMath && mathBField.select.val() === '__const__');
        }
        typeField.select.on('change', syncChannelTypeUi);
        mathBField.select.on('change', () => mathKField.row.toggle(mathBField.select.val() === '__const__'));
        syncChannelTypeUi();

        function displayCsvLabel(filePath) {
            if (!filePath) return 'No file selected.';
            return sharedFast.displayPath ? sharedFast.displayPath(filePath) : filePath;
        }

        function renderChannelList() {
            channelList.empty();
            state.channelDefs.forEach((def, index) => {
                const row = $('<div class="border rounded p-2 d-flex justify-content-between align-items-center gap-2"></div>');
                let summary;
                if (def.type === 'math') {
                    summary = `${def.label || (def.operandA + ' ' + def.operator + ' ' + def.operandB)} (math)`;
                } else {
                    const missing = !state.availableColumns.includes(def.variable) && state.availableColumns.length ? ' (missing)' : '';
                    summary = (def.label || def.variable) + missing;
                }
                const dot = $('<span style="display:inline-block;width:10px;height:10px;border-radius:2px;flex-shrink:0;"></span>').css('background', def.color || '#888');
                row.append(dot, $('<div class="small flex-fill min-w-0 text-truncate"></div>').text(summary));
                row.append($('<button type="button" class="btn btn-sm btn-outline-danger">Remove</button>').on('click', () => {
                    state.channelDefs.splice(index, 1);
                    renderChannelList();
                }));
                channelList.append(row);
            });
            if (!state.channelDefs.length) {
                channelList.append('<div class="small text-muted">No channels configured. The widget will auto-pick numeric columns.</div>');
            }
        }

        function populateOptionalTimeColumnSelect(columns, currentValue) {
            const values = Array.isArray(columns) ? columns : [];
            timeColumnField.select.empty().append($('<option value=""></option>').text('Sample index × TS'));
            values.forEach((column) => {
                timeColumnField.select.append($('<option></option>').attr('value', column).text(column));
            });
            if (currentValue && values.includes(currentValue)) {
                timeColumnField.select.val(currentValue);
            } else {
                timeColumnField.select.val('');
            }
        }

        async function refreshColumns(preferredTimeColumn) {
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

            populateOptionalTimeColumnSelect(
                state.availableColumns,
                preferredTimeColumn !== undefined ? preferredTimeColumn : (timeColumnField.select.val() || settings.timeColumn || '')
            );
            populateFastFrameColumnSelect(yVariableField.select, state.availableColumns, yVariableField.select.val() || '', 'Select signal column');
            populateFastFrameColumnSelect(mathAField.select, state.availableColumns, mathAField.select.val() || '', 'Select A');
            const prevB = mathBField.select.val();
            mathBField.select.empty().append('<option value="">Select B</option>');
            state.availableColumns.forEach((col) => mathBField.select.append($('<option></option>').attr('value', col).text(col)));
            mathBField.select.append('<option value="__const__">— constant k —</option>');
            if (prevB && mathBField.select.find(`option[value="${prevB}"]`).length) mathBField.select.val(prevB);
            mathKField.row.toggle(typeField.select.val() === 'math' && mathBField.select.val() === '__const__');
            renderChannelList();
        }

        sourceModeField.select.on('change', () => {
            refreshColumns(timeColumnField.select.val()).catch(() => {});
        });

        chooseCsvButton.on('click', async () => {
            const chooser = sharedFast.fileApi && sharedFast.fileApi.chooseCsvFile;
            if (!chooser) return;
            const chosen = await chooser();
            if (!chosen) return;
            state.selectedCsvPath = chosen;
            csvName.text(displayCsvLabel(chosen));
            await refreshColumns(timeColumnField.select.val());
        });

        applySourceButton.on('click', () => {
            refreshColumns(timeColumnField.select.val()).catch(() => {});
        });

        addChannelButton.on('click', () => {
            const isMath = typeField.select.val() === 'math';
            const color = colorField.input.val() || sharedFast.DEFAULT_COLORS[state.channelDefs.length % sharedFast.DEFAULT_COLORS.length];
            const label = labelField.input.val().trim();
            if (isMath) {
                const operandA = mathAField.select.val();
                const operator = mathOpField.select.val();
                const bIsConst = mathBField.select.val() === '__const__';
                const operandB = bIsConst ? String(parseFloat(mathKField.input.val()) || 0) : mathBField.select.val();
                if (!operandA || !operator || !operandB) return;
                state.channelDefs.push({ type: 'math', operandA, operator, operandB,
                    label: label || `${operandA} ${operator} ${operandB}`, color });
            } else {
                const variable = yVariableField.select.val();
                if (!variable) return;
                if (state.channelDefs.some((d) => !d.type && d.variable === variable)) return;
                state.channelDefs.push({ variable, label: label || variable, color });
            }
            labelField.input.val('');
            colorField.input.val(sharedFast.DEFAULT_COLORS[state.channelDefs.length % sharedFast.DEFAULT_COLORS.length]);
            renderChannelList();
        });

        resetChannelsButton.on('click', () => {
            state.channelDefs = [];
            colorField.input.val(sharedFast.DEFAULT_COLORS[0]);
            renderChannelList();
        });

        updateFastFrameSourceButtonLabel(chooseCsvButton, sourceModeField.select.val() || sharedFast.getCsvSourceMode(settings));
        csvName.text(displayCsvLabel(state.selectedCsvPath || settings.csvPath || ''));
        renderChannelList();
        refreshColumns(settings.timeColumn || '').catch(() => {});

        new DialogBox(form, 'Edit Widget', 'Save', 'Cancel', function () {
            const csvPath = state.selectedCsvPath || settings.csvPath || '';
            const csvSourceMode = sourceModeField.select.val() || sharedFast.getCsvSourceMode(settings);
            const csvDirectory = csvPath
                ? ((sharedFast.pathApi && sharedFast.pathApi.dirname) ? sharedFast.pathApi.dirname(csvPath) : sharedFast.defaultCsvDirectory())
                : (settings.csvDirectory || sharedFast.defaultCsvDirectory());
            const updated = _.extend({}, settings, {
                title: titleField.input.val() || settings.title || 'FFT Spectrum',
                csvSourceMode,
                csvDirectory,
                csvPath,
                timeColumn: timeColumnField.select.val() || '',
                channelDefs: state.channelDefs,
                samplingPeriodUs: samplingPeriodField.input.val() || '100',
                fundamentalFreqHz: fundamentalField.input.val() || '50',
                maxFreqHz: maxFreqField.input.val() || '1000',
                maxHarmonic: maxHarmonicField.input.val() || '11',
                showTimeDomain: showTimeField.input.prop('checked'),
                showSpectrum: showSpectrumField.input.prop('checked'),
                showHarmonicBars: showBarsField.input.prop('checked'),
                logScaleSpectrum: logScaleField.input.prop('checked')
            });
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
        const opField = createSelectRow('Operation', [
            { value: 'identity', label: 'x  (signal x value)' },
            { value: 'negate', label: '-x  (signal x inverse value)' },
            { value: 'abs', label: 'abs(x)  (signal x absolute value)' },
            { value: 'scale', label: 'x * k  (signal x times a constant k)' },
            { value: 'offset', label: 'x + b  (signal x plus a constant b)' },
            { value: 'mulvar', label: 'x * y  (signal x times a signal y)' }
        ], settings.sourceOp || 'identity');
        const paramField = createInputRow('Parameter', 'number', settings.sourceParam ?? 0, 'k or b');
        const sourceBControls = buildSourceControls(shared, 'Source B', settings.sourceBDef);
        const sourceBWrapper = $('<div class="d-flex flex-column gap-2"></div>').append(
            $('<div class="small text-muted mt-1">Second source (y)</div>'),
            sourceBControls.wrapper
        );

        function syncGaugeOpVisibility() {
            const op = opField.select.val() || 'identity';
            paramField.row.toggle(op === 'scale' || op === 'offset');
            sourceBWrapper.toggle(op === 'mulvar');
        }
        opField.select.on('change', syncGaugeOpVisibility);
        syncGaugeOpVisibility();

        sourceSection.append(sourceControls.wrapper, opField.row, paramField.row, sourceBWrapper);
        left.append(sourceSection);

        const displaySection = createSection('Display');
        const titleField = createInputRow('Title', 'text', settings.title || (gaugeMeta ? gaugeMeta.displayName : 'Gauge'));
        const minField = createInputRow('Minimum', 'number', settings.min ?? 0);
        const maxField = createInputRow('Maximum', 'number', settings.max ?? 100);
        const unitsField = createInputRow('Units', 'text', settings.units || '');
        const refreshField = createInputRow('Refresh Rate (ms)', 'number', settings.refreshRate ?? 500);
        const offsetStepField = createInputRow('Offset Step', 'number', settings.offsetStep ?? 1, '1');
        const showValueField = createCheckboxRow('Show Value', settings.showValue !== false);
        const showMinMaxField = createCheckboxRow('Show Min/Max', settings.showMinMax !== false);
        displaySection.append(
            titleField.row,
            minField.row,
            maxField.row,
            unitsField.row,
            refreshField.row,
            offsetStepField.row,
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
            const op = opField.select.val() || 'identity';
            const updated = _.extend({}, settings, buildGaugeSpecificSettings(type, styleFields, settings), {
                title: titleField.input.val() || settings.title || (gaugeMeta ? gaugeMeta.displayName : 'Gauge'),
                min: shared.parseNumber(minField.input.val()) ?? 0,
                max: shared.parseNumber(maxField.input.val()) ?? 100,
                units: unitsField.input.val() || '',
                refreshRate: Math.max(50, parseInt(refreshField.input.val(), 10) || 500),
                offsetStep: Math.max(0.001, parseFloat(offsetStepField.input.val()) || 1),
                showValue: showValueField.input.prop('checked'),
                showMinMax: showMinMaxField.input.prop('checked'),
                alarmEnabled: alarmEnabledField.input.prop('checked'),
                warningThreshold: (warningThresholdField.input.val() === '' ? undefined : shared.parseNumber(warningThresholdField.input.val())),
                criticalThreshold: (criticalThresholdField.input.val() === '' ? undefined : shared.parseNumber(criticalThresholdField.input.val())),
                alarmDirection: alarmDirectionField.select.val() || 'above',
                colorPalette: paletteField.select.val() || 'ColorBlind10',
                barColor: colorField.select.val() || 'blue',
                sourceDef,
                sourceOp: op,
                sourceParam: (op === 'scale' || op === 'offset') ? (parseFloat(paramField.input.val()) || 0) : 0,
                sourceBDef: op === 'mulvar' ? sourceBControls.buildValue() : null
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

        const styleSection = createSection('Style');
        const trailColorField = createInputRow('Trail Color', 'color', settings.trailColor || '#4e79a7');
        const latestColorField = createInputRow('Latest Point Color', 'color', settings.latestColor || '#e15759');
        styleSection.append(trailColorField.row, latestColorField.row);
        left.append(styleSection);

        const displaySection = createSection('Display');
        const titleField = createInputRow('Title', 'text', settings.title || 'XY Plot');
        const historyField = createInputRow('History Length', 'number', settings.historyLength || 200);
        const refreshField = createInputRow('Refresh Rate (ms)', 'number', settings.refreshRate || 250);
        const xLabelField = createInputRow('X Axis Label', 'text', settings.xLabel || 'X');
        const yLabelField = createInputRow('Y Axis Label', 'text', settings.yLabel || 'Y');
        const xMinField = createInputRow('X Min', 'number', settings.xMin ?? '', 'auto');
        const xMaxField = createInputRow('X Max', 'number', settings.xMax ?? '', 'auto');
        const yMinField = createInputRow('Y Min', 'number', settings.yMin ?? '', 'auto');
        const yMaxField = createInputRow('Y Max', 'number', settings.yMax ?? '', 'auto');
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
                trailColor: trailColorField.input.val() || '#4e79a7',
                latestColor: latestColorField.input.val() || '#e15759',
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
            if (type === 'state_machine') {
                if (window.ModularStateMachineEditor) window.ModularStateMachineEditor.open(widgetModel);
                return true;
            }
            if (!shared || !widgetModel) return false;
            if (type === 'time_plot_uplot') {
                return openOwntechPlotEditor(widgetModel, shared);
            }
            if (type === 'xy_plot_uplot') {
                return openXYPlotEditor(widgetModel, shared);
            }
            if (type === 'fast_frame_plot') {
                return openFastFramePlotEditor(widgetModel, shared);
            }
            if (type === 'fft_spectrum_plot') {
                return openFftSpectrumPlotEditor(widgetModel, shared);
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
