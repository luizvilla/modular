(function () {
    // Shared interaction-binding helpers behind the radial-menu pattern piloted
    // on time_plot_uplot (see docs/GUI/02-navigation_overhaul.md, Milestone 0).
    // Extracted so every widget adopting the pattern (XY Plot, Fast Frame Plot,
    // FFT Spectrum, the gauge family, buttons, OwnTech) shares one copy of the
    // hover-hint, floating-input, axis/inline-panel, channel-menu-builder, and
    // color-carrousel plumbing instead of six-plus drifting near-duplicates.
    //
    // CSS class names below (`.uplot-floating-input`, `.uplot-radial-hover-hint`,
    // `.uplot-axis-hover-panel[-row]`) intentionally keep their original
    // "uplot-" prefix even though this module is widget-agnostic: they're
    // asserted on directly by tests/e2e/radial-context-menu.spec.js, and this
    // extraction must not change that widget's behavior or DOM. New widgets
    // adopting the kit reuse the exact same classes, the same way
    // fast_frame_plot.widget.js already reuses `.uplot-readout-*`.

    let stylesInjected = false;
    let hintEl = null;

    function ensureStyles() {
        if (stylesInjected) return;
        stylesInjected = true;
        if (!(window.freeboard && typeof freeboard.addStyle === 'function')) return;
        freeboard.addStyle('.uplot-radial-hover-hint', 'position:fixed;z-index:9999;pointer-events:none;background:#20232a;color:#e8e8e8;border:1px solid #454b55;border-radius:4px;padding:2px 8px;font-size:11px;white-space:nowrap;');
        freeboard.addStyle('html.theme-light .uplot-radial-hover-hint', 'background:#ffffff;color:#1a1a1a;border-color:#c8c8c8;');
        // The system pointer already reads as clickable -- no need for a hand
        // glyph in the hint text on top of it.
        freeboard.addStyle('.uplot-chart-host, .uplot-widget-shell', 'cursor:pointer;');
        freeboard.addStyle('.uplot-readout-label, .uplot-readout-swatch, .u-title', 'cursor:pointer;');
        // Shared by every floating rename/edit input -- all live in
        // document.body, independent of whatever DOM churn (readout
        // re-renders, plot resets) is happening underneath them.
        freeboard.addStyle('.uplot-floating-input', 'z-index:9999;background:#141619;border:1px solid #6a90ff;border-radius:4px;color:#e8e8e8;font-size:inherit;padding:0 2px;text-align:center;');
        freeboard.addStyle('html.theme-light .uplot-floating-input', 'background:#ffffff;color:#1a1a1a;');
        freeboard.addStyle('.uplot-axis-hover-panel', 'position:fixed;z-index:9999;background:#20232a;border:1px solid #454b55;border-radius:6px;padding:6px 8px;display:flex;flex-direction:column;gap:4px;box-shadow:0 2px 8px rgba(0,0,0,0.4);');
        freeboard.addStyle('html.theme-light .uplot-axis-hover-panel', 'background:#ffffff;border-color:#c8c8c8;box-shadow:0 2px 8px rgba(0,0,0,0.15);');
        freeboard.addStyle('.uplot-axis-hover-panel-row', 'display:flex;align-items:center;gap:6px;font-size:11px;color:#c8c8c8;white-space:nowrap;');
        freeboard.addStyle('html.theme-light .uplot-axis-hover-panel-row', 'color:#444;');
        freeboard.addStyle('.uplot-axis-hover-panel-row input', 'width:80px;background:#141619;border:1px solid #454b55;border-radius:4px;color:#e8e8e8;font-size:11px;padding:2px 4px;');
        freeboard.addStyle('html.theme-light .uplot-axis-hover-panel-row input', 'background:#f5f5f5;color:#1a1a1a;border-color:#c8c8c8;');
    }

    function ensureHintEl() {
        if (!hintEl) hintEl = $('<div class="uplot-radial-hover-hint"></div>').appendTo(document.body).hide();
        return hintEl;
    }

    // Single shared tooltip-like hint -- only one widget can be hovered at a
    // time, so there's no reason for each widget instance to keep its own.
    function showHint(text, clientX, clientY) {
        ensureStyles();
        ensureHintEl().text(text).css({ left: (clientX + 14) + 'px', top: (clientY + 14) + 'px' }).show();
    }

    function hideHint() {
        if (hintEl) hintEl.hide();
    }

    // Generic version of the pilot's hover-hint half of _bindChartHover():
    // binds mousemove/mouseleave on `el`, calling `zoneToLabelFn(clientX,
    // clientY)` on every move. A returned falsy value hides the hint (the
    // caller is expected to be showing something else instead, e.g. an axis
    // panel); a string shows that text as the hint near the cursor.
    function bindHoverHint(el, zoneToLabelFn) {
        ensureStyles();
        const $el = $(el);
        $el.on('mousemove', (e) => {
            const label = zoneToLabelFn(e.clientX, e.clientY);
            if (label) showHint(label, e.clientX, e.clientY);
            else hideHint();
        });
        $el.on('mouseleave', () => hideHint());
    }

    // Generalizes uplot.widget.js's _findWidgetModel(): walk the live model's
    // panes -> widgets to find the WidgetModel wrapping a given widget plugin
    // instance (matched by reference).
    function findWidgetModel(widgetInstance) {
        const model = window.freeboard && freeboard.getLiveModel && freeboard.getLiveModel();
        if (!model || typeof model.panes !== 'function') return null;
        let found = null;
        model.panes().forEach((pane) => {
            (pane.widgets ? pane.widgets() : []).forEach((w) => {
                if (w.widgetInstance === widgetInstance) found = w;
            });
        });
        return found;
    }

    function settingValue(widgetModel, name) {
        const settings = widgetModel ? (widgetModel.settings() || {}) : {};
        const raw = settings ? settings[name] : undefined;
        return typeof raw === 'function' ? raw() : raw;
    }

    function quickSetSetting(widgetModel, name, value) {
        const shared = window.ModularPlotEditorShared;
        if (!widgetModel || !shared) return;
        const settings = widgetModel.settings() || {};
        shared.commitWidgetSettings(widgetModel, { ...settings, [name]: value });
    }

    // Generalizes _startRenameChannel/_startRenameTitle's shared body: a
    // floating input positioned over `anchorEl` via getBoundingClientRect()
    // and appended to document.body, fully decoupled from any container the
    // widget re-renders periodically (this was a real, reported bug before
    // this pattern existed -- see Design Principle 3 in the plan doc).
    function floatingInput({ anchorEl, value, placeholder, type = 'text', onCommit, onCancel, selectOnFocus = true }) {
        ensureStyles();
        const rect = anchorEl.getBoundingClientRect();
        const input = $(`<input type="${type === 'number' ? 'number' : 'text'}" class="uplot-floating-input">`)
            .val(value != null ? value : '')
            .css({ position: 'fixed', left: rect.left + 'px', top: rect.top + 'px', width: Math.max(rect.width, 60) + 'px', height: rect.height + 'px' })
            .appendTo(document.body);
        if (placeholder) input.attr('placeholder', placeholder);

        let done = false;
        const commit = () => {
            if (done) return;
            done = true;
            input.remove();
            if (onCommit) onCommit(input.val());
        };
        const cancel = () => {
            if (done) return;
            done = true;
            input.remove();
            if (onCancel) onCancel();
        };
        input.on('click', (e) => e.stopPropagation());
        input.on('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });
        input.on('blur', () => commit());
        requestAnimationFrame(() => { input.trigger('focus'); if (selectOnFocus) input[0].select(); });
        return input;
    }

    // A single labeled row (label + input) for a hover panel, matching
    // _axisPanelRow(): commits on blur/Enter, never bubbles clicks/keys to
    // whatever's behind the panel.
    function panelRow(type, label, value, onCommit) {
        const row = $('<div class="uplot-axis-hover-panel-row"></div>');
        const input = $(`<input type="${type === 'number' ? 'number' : 'text'}">`);
        if (value !== null && value !== undefined) input.val(value);
        row.append($('<span></span>').text(label), input);
        input.on('mousedown click', (e) => e.stopPropagation());
        input.on('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); input.trigger('blur'); }
        });
        input.on('blur', () => onCommit(input.val()));
        return row;
    }

    // Builds (but does not track) a floating panel of rows at a fixed
    // position. Callers own the returned jQuery element's lifecycle (remove()
    // when done) since a widget may show more than one panel (X axis + Y
    // axis) independently.
    function floatingPanel({ position, rows }) {
        ensureStyles();
        const panel = $('<div class="uplot-axis-hover-panel"></div>').css(position).appendTo(document.body);
        rows.forEach((row) => panel.append(row));
        return panel;
    }

    // A short hide-delay bridge for hover panels: moving the cursor from the
    // trigger zone into the panel itself (which lives outside the trigger
    // element's own DOM) shouldn't close it. Call cancel() on
    // mouseenter/mousemove over either the zone or the panel, schedule(fn) on
    // mouseleave of either.
    function makeHoverBridge(delayMs = 200) {
        let timer = null;
        return {
            cancel: () => { if (timer) { clearTimeout(timer); timer = null; } },
            schedule: (fn) => { if (timer) clearTimeout(timer); timer = setTimeout(fn, delayMs); }
        };
    }

    function dsLatestData(dsName) {
        const live = window.freeboard && freeboard.getLiveModel && freeboard.getLiveModel();
        const dsModel = live && typeof live.datasources === 'function'
            ? live.datasources().find((d) => { try { return d.name() === dsName; } catch (e) { return false; } })
            : null;
        return (dsModel && dsModel.latestData) ? (dsModel.latestData() || {}) : {};
    }

    function getDatasourceType(dsName) {
        const shared = window.ModularPlotEditorShared;
        return shared ? shared.getDatasourceType(dsName) : null;
    }

    // Generalizes _buildThingSetCategoryNodes(): Datasource -> (Measurements |
    // Others [-> Config | Calibration | ...]) -> leaf variable names, for
    // ThingSet-type datasources. `onLeafSelect(sourceDef)` is called with the
    // chosen variable's sourceDef; what it does with it (append to a list,
    // quick-set a single field) is left to the caller.
    function buildThingSetCategoryNodes(dsName, dsType, onLeafSelect) {
        const data = dsLatestData(dsName);
        const values = data.values || {};
        const buckets = {};
        Object.keys(values).forEach((path) => {
            const clean = path.replace(/^\/+/, '');
            if (!clean) return;
            const segments = clean.split('/');
            // A single-segment path is a scalar living directly on the tree
            // root rather than nested under a real named group -- there's no
            // meaningful group to bucket it into.
            if (segments.length < 2) return;
            const top = segments[0];
            const label = segments[segments.length - 1];
            (buckets[top] = buckets[top] || []).push({ path, label });
        });
        const leafItems = (entries) => entries
            .slice()
            .sort((a, b) => a.label.localeCompare(b.label))
            .map((entry) => ({
                id: entry.path, label: entry.label,
                onSelect: () => onLeafSelect({ ds: dsName, type: dsType, device: null, device_uid: null, var: entry.path })
            }));
        const nodes = [];
        if (buckets.Measurements) {
            nodes.push({ id: 'Measurements', label: 'Measurements', items: leafItems(buckets.Measurements) });
        }
        const otherGroups = Object.keys(buckets).filter((k) => k !== 'Measurements').sort();
        if (otherGroups.length) {
            nodes.push({
                id: 'Others', label: 'Others',
                children: otherGroups.map((group) => ({
                    id: group, label: group,
                    items: leafItems(buckets[group])
                }))
            });
        }
        return nodes;
    }

    async function buildSimpleLeafItems(dsName, dsType, onLeafSelect) {
        const shared = window.ModularPlotEditorShared;
        if (!shared || typeof shared.fetchDatasourceVariableOptions !== 'function') return [];
        const options = await shared.fetchDatasourceVariableOptions(dsName, '');
        const keepAsString = dsType === 'can_datasource';
        return options.map((opt) => ({
            id: String(opt.value), label: opt.label,
            onSelect: () => onLeafSelect({
                ds: dsName, type: dsType, device: null, device_uid: null,
                var: keepAsString ? opt.value : parseInt(opt.value, 10)
            })
        }));
    }

    // Generalizes _buildChannelMenuRoot(): the full Datasource -> category ->
    // leaf drill tree, for every datasource currently on the board (or a
    // filtered subset via includeTypes/excludeTypes). `onLeafSelect(sourceDef)`
    // fires once a leaf variable is chosen.
    function buildChannelMenuRoot({ onLeafSelect, includeTypes, excludeTypes } = {}) {
        const shared = window.ModularPlotEditorShared;
        if (!shared || typeof onLeafSelect !== 'function') return [];
        let list = shared.listDatasources();
        if (Array.isArray(includeTypes)) {
            list = list.filter((ds) => includeTypes.includes(getDatasourceType(ds.name)));
        }
        if (Array.isArray(excludeTypes)) {
            list = list.filter((ds) => !excludeTypes.includes(getDatasourceType(ds.name)));
        }
        return list.map((ds) => {
            const dsType = getDatasourceType(ds.name);
            const isThingSet = dsType === 'thingset_serial_datasource' || dsType === 'owntech_thingset_datasource';
            return {
                id: ds.name, label: ds.name,
                ...(isThingSet
                    ? { children: () => buildThingSetCategoryNodes(ds.name, dsType, onLeafSelect) }
                    : { items: () => buildSimpleLeafItems(ds.name, dsType, onLeafSelect) })
            };
        });
    }

    const FALLBACK_PALETTE = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc949', '#af7aa1', '#ff9da7', '#9c755f', '#bab0ac'];

    function getColorblind10Palette() {
        const shared = window.ModularPlotEditorShared;
        if (!shared) return FALLBACK_PALETTE;
        const themes = shared.getColorThemes();
        return (Array.isArray(themes.ColorBlind10) && themes.ColorBlind10.length) ? themes.ColorBlind10 : FALLBACK_PALETTE;
    }

    // A ring of the 10 ColorBlind10 palette colors around the click point, no
    // category step -- there's nothing to categorize.
    function colorCarrousel(clientX, clientY, onSelect) {
        if (!window.RadialContextMenu) return;
        const palette = getColorblind10Palette();
        window.RadialContextMenu.show({
            x: clientX, y: clientY,
            items: palette.map((hex) => ({ id: hex, label: hex, color: hex, onSelect: () => onSelect(hex) }))
        });
    }

    window.RadialWidgetKit = {
        ensureStyles,
        showHint,
        hideHint,
        bindHoverHint,
        findWidgetModel,
        settingValue,
        quickSetSetting,
        floatingInput,
        panelRow,
        floatingPanel,
        makeHoverBridge,
        buildChannelMenuRoot,
        colorCarrousel,
        getColorblind10Palette
    };
})();
