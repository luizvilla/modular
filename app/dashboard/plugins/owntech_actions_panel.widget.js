(function () {
    const treeWalk = window.ThingSetTreeWalk;

    freeboard.loadWidgetPlugin({
        type_name: 'owntech_actions_panel',
        display_name: 'OwnTech Actions',
        description: 'Discovery-driven per-leg action toggles and power controls, sent as ThingSet writes.',
        icon: 'bolt',
        category: 'OwnTech',
        settings: [
            { name: 'title', display_name: 'Title', type: 'text' },
            {
                name: 'datasource',
                display_name: 'Datasource Name',
                type: 'option',
                // Live options provider, filtered to the two ThingSet serial
                // types -- mirrors ts_serial_device_ui.widget.js's datasource
                // filter pattern.
                options: getThingSetDatasourceOptions,
                optionsRefreshMs: 1000
            },
            { name: 'usePrefix', display_name: 'Use "thingset" command prefix', type: 'boolean', default_value: false },
            { name: 'debug', display_name: 'Verbose logging', type: 'boolean', default_value: false }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new OwnTechActionsPanel(settings));
        }
    });

    function getThingSetDatasourceOptions() {
        const live = freeboard.getLiveModel?.();
        if (!live || typeof live.datasources !== 'function') return [];
        const options = [];
        live.datasources().forEach((ds) => {
            try {
                const type = ds.type && ds.type();
                if (type === 'thingset_serial_datasource' || type === 'owntech_thingset_datasource') {
                    const name = ds.name();
                    options.push({ name, value: name });
                }
            } catch (e) { /* ignore */ }
        });
        return options;
    }

    // /Config/Mode is legitimately hardcoded protocol knowledge (the enum's
    // meaning doesn't vary with leg count), unlike leg/action enumeration.
    const MODE_IDLE = 0;
    const MODE_POWER_ON = 1;
    const MODE_POWER_OFF = 2;
    const MODE_NAMES = ['IDLE', 'POWER_ON', 'POWER_OFF'];

    class OwnTechActionsPanel {
        constructor(settings) {
            this.settings = settings || {};
            this.tsSerialApi = window.api && window.api.thingsetSerial ? window.api.thingsetSerial : null;
            this._dsSubscription = null;

            this.container = $('<div class="d-flex flex-column h-100 gap-2 overflow-auto p-2"></div>');
            this.statusLine = $('<div class="small text-muted flex-fill">—</div>');
            this.rescanBtn = $('<button type="button" class="btn btn-outline-secondary btn-sm">Rescan Tree</button>');
            this.powerWrap = $('<div></div>');
            this.legsWrap = $('<div class="d-flex flex-column gap-2"></div>');

            this.rescanBtn.on('click', () => this._rescan());

            if (freeboard && typeof freeboard.addStyle === 'function') {
                // Reuses the same class names/markup as twist_control.widget.js's
                // leg toggles for visual continuity -- duplicated here (rather
                // than shared) because that widget lives in owntech-legacy,
                // which is disabled by default and may not be loaded at all.
                freeboard.addStyle('.twist-toggle-grid', 'display:flex;flex-wrap:wrap;gap:8px;');
                freeboard.addStyle('.twist-toggle-item', 'flex-shrink:0;width:auto!important;flex-wrap:nowrap!important;');
                freeboard.addStyle('.twist-toggle-item .input-group-text', 'min-width:64px;justify-content:center;');
                freeboard.addStyle('.twist-toggle-switch', 'display:flex;align-items:center;justify-content:center;flex-shrink:0;');
            }
        }

        render(el) {
            if (!this._built) {
                const headerRow = $('<div class="d-flex align-items-center gap-2"></div>');
                headerRow.append(this.rescanBtn, this.statusLine);
                this.container.append(headerRow, this.powerWrap, this.legsWrap);
                this._built = true;
            }
            $(el).empty().append(this.container);
            this._subscribeToDatasource();
            this._renderPowerControls();
            this._renderLegs();
        }

        _dsModel() {
            const live = typeof freeboard !== 'undefined' && freeboard.getLiveModel ? freeboard.getLiveModel() : null;
            if (!live || typeof live.datasources !== 'function') return null;
            return live.datasources().find((d) => {
                try { return d.name() === this.settings.datasource; } catch (e) { return false; }
            }) || null;
        }

        // Re-renders leg toggles from the linked datasource's already-cached
        // latestData() whenever it updates (its own poll cycle or an explicit
        // Rescan Tree click) -- no independent IPC tree fetch here, matching
        // the efficiency principle established for the sidebar status card
        // and the button widgets' read path.
        _subscribeToDatasource() {
            if (this._dsSubscription) { this._dsSubscription.dispose(); this._dsSubscription = null; }
            const dsModel = this._dsModel();
            if (dsModel && dsModel.latestData && dsModel.latestData.subscribe) {
                this._dsSubscription = dsModel.latestData.subscribe(() => {
                    this._updateStatus();
                    this._renderLegs();
                });
            }
            this._updateStatus();
        }

        _rescan() {
            const dsModel = this._dsModel();
            if (dsModel && typeof dsModel.updateNow === 'function') dsModel.updateNow();
        }

        _latestData() {
            const dsModel = this._dsModel();
            return (dsModel && dsModel.latestData) ? (dsModel.latestData() || {}) : {};
        }

        _updateStatus() {
            if (!this.settings.datasource) {
                this.statusLine.text('Select a ThingSet datasource in the widget settings.');
                return;
            }
            const data = this._latestData();
            const values = data.values || {};
            const modeNum = values['/Config/Mode'];
            const modeText = modeNum != null ? ` · Power: ${MODE_NAMES[modeNum] || `mode ${modeNum}`}` : '';
            if (data.status === 'ok') this.statusLine.text(`Connected · ${data.portPath || ''}${modeText}`);
            else if (data.status === 'no-port') this.statusLine.text('Shell not detected.');
            else if (data.status === 'error') this.statusLine.text(`Error: ${data.error || 'unknown'}`);
            else this.statusLine.text('Waiting for data…');
        }

        // Writes, then rescans the linked datasource so the status line (and
        // any discovered toggle) reflects the new state without the user
        // having to separately click Rescan Tree -- a plain write success
        // code alone gave no visible feedback that anything happened.
        async _writeValue(path, value) {
            if (!this.tsSerialApi || !this.tsSerialApi.setValue || !path) return;
            const dsSettings = freeboard.getDatasourceSettings(this.settings.datasource) || {};
            if (!dsSettings.portPath) return;
            try {
                await this.tsSerialApi.setValue({
                    port: dsSettings.portPath,
                    path,
                    value,
                    baudRate: Number(dsSettings.baudRate) || 115200,
                    usePrefix: !!this.settings.usePrefix,
                    verbose: !!this.settings.debug,
                });
                this._rescan();
            } catch (err) {
                console.error('ThingSet write failed:', err);
                this.statusLine.text(`Write failed: ${err?.message || err}`);
            }
        }

        _renderPowerControls() {
            this.powerWrap.empty();
            const row = $('<div class="d-flex gap-2 flex-wrap align-items-center justify-content-start"></div>');
            const idle = $('<button class="btn btn-outline-secondary btn-sm">IDLE</button>');
            const on = $('<button class="btn btn-outline-success btn-sm">POWER ON</button>');
            const off = $('<button class="btn btn-outline-danger btn-sm">POWER OFF</button>');
            idle.on('click', () => this._writeValue('/Config/Mode', MODE_IDLE));
            on.on('click', () => this._writeValue('/Config/Mode', MODE_POWER_ON));
            off.on('click', () => this._writeValue('/Config/Mode', MODE_POWER_OFF));
            row.append(idle, on, off);
            this.powerWrap.append($('<div class="fw-semibold">Power</div>'), row);
        }

        _renderLegs() {
            this.legsWrap.empty();
            if (!this.settings.datasource) {
                this.legsWrap.append('<div class="small text-muted">Select a ThingSet datasource in the widget settings.</div>');
                return;
            }
            if (!treeWalk) return;
            const tree = this._latestData().tree;
            const legs = treeWalk.findLegGroups(tree);
            if (!legs.length) {
                this.legsWrap.append('<div class="small text-muted">No leg groups discovered yet -- rescan once the datasource has connected.</div>');
                return;
            }
            legs.forEach((leg) => {
                const section = $('<div class="d-flex flex-column gap-1"></div>');
                section.append(`<span class="badge bg-light text-dark">${leg.name}</span>`);
                const grid = $('<div class="twist-toggle-grid"></div>');
                const actionLeaves = treeWalk.findBooleanActionLeaves(leg.node);
                if (!actionLeaves.length) {
                    grid.append('<div class="small text-muted">No boolean action leaves discovered.</div>');
                } else {
                    actionLeaves.forEach((leaf) => grid.append(this._renderToggle(leaf)));
                }
                section.append(grid);
                this.legsWrap.append(section);
            });
        }

        _renderToggle(leaf) {
            const inputId = `otap_${leaf.name}_${Math.random().toString(36).slice(2)}`;
            const checkbox = $('<input type="checkbox" class="onoffswitch-checkbox">')
                .attr('id', inputId)
                .prop('checked', !!leaf.value);
            const onOffLabel = $(
                `<label class="onoffswitch-label" for="${inputId}">
                    <div class="onoffswitch-inner"><span class="on">ON</span><span class="off">OFF</span></div>
                    <div class="onoffswitch-switch"></div>
                 </label>`
            );
            const switchWrap = $('<div class="onoffswitch"></div>').append(checkbox, onOffLabel);
            // Optimistic UI: the checkbox reflects the click immediately, but
            // a successful ThingSet status code only confirms the shell
            // accepted the write syntactically -- a Rescan Tree (or the
            // datasource's next poll) is what actually confirms board state.
            checkbox.on('change', () => this._writeValue(leaf.path, checkbox.prop('checked')));
            // wDriver=false is a documented Core4 firmware bug (write doesn't
            // reliably disconnect the driver) -- flag it so a syntactically-
            // accepted write isn't mistaken for confirmed board state.
            const isWDriver = /^wDriver$/i.test(leaf.name || '');
            const labelText = isWDriver ? `${leaf.name} ⚠` : leaf.name;
            const label = $(`<label class="input-group-text" for="${inputId}">${labelText}</label>`);
            if (isWDriver) {
                label.attr('title', 'wDriver writes are not guaranteed to take effect (known firmware issue) — verify with a read/rescan.');
            }
            const box = $('<span class="input-group-text twist-toggle-switch"></span>').append(switchWrap);
            const group = $('<div class="input-group input-group-sm twist-toggle-item"></div>');
            group.append(label, box);
            return group;
        }

        onSettingsChanged(newSettings) {
            this.settings = newSettings || {};
            this._subscribeToDatasource();
            this._renderPowerControls();
            this._renderLegs();
        }

        onDispose() {
            if (this._dsSubscription) { this._dsSubscription.dispose(); this._dsSubscription = null; }
        }

        getHeight() {
            return 6;
        }
    }
})();
