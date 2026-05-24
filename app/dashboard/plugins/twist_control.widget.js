(function () {
    // Twist/Ownverter Actions control widget (power + toggles).
    const protocol = window.twistProtocol || null;
    freeboard.loadWidgetPlugin({
        type_name: 'twist_actions_panel',
        display_name: 'Twist/Ownverter Actions',
        description: 'Send power and toggle commands over serial.',
        icon: 'bolt',
        category: 'OwnTech',
        settings: [
            { name: 'title', display_name: 'Title', type: 'text' },
            {
                name: 'deviceType',
                display_name: 'Device Type',
                type: 'option',
                default_value: 'TWIST',
                options: [
                    { name: 'Twist', value: 'TWIST' },
                    { name: 'Ownverter', value: 'OWNVERTER' }
                ]
            },
            {
                name: 'datasource',
                display_name: 'Datasource Name',
                type: 'option',
                // Use a live options provider so the widget settings modal shows a datasource dropdown.
                options: getSerialDatasourceOptions,
                optionsRefreshMs: 1000
            }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new TwistActionsPanel(settings));
        }
    });

    // Provide a datasource list for the widget settings dropdown.
    function getSerialDatasourceOptions() {
        const live = freeboard.getLiveModel?.();
        if (!live || typeof live.datasources !== 'function') return [];
        const options = [];
        live.datasources().forEach(ds => {
            try {
                if (ds.type && ds.type() === 'serialport_datasource') {
                    const name = ds.name();
                    options.push({ name, value: name });
                }
            } catch (e) { /* ignore */ }
        });
        return options;
    }

    class TwistActionsPanel {
        constructor(settings) {
            this.settings = settings;
            this.serialApi = window.api && window.api.serial ? window.api.serial : null;
            this.ipc = !this.serialApi && window.require ? window.require('electron')?.ipcRenderer : null;
            this.container = $('<div class="d-flex flex-column h-100 gap-2 overflow-auto p-2"></div>');
            this.lastCmd = $('<div class="small text-muted">Last command: —</div>');
            this.dsSelect = $('<select class="form-select form-select-sm flex-fill"></select>');
            this.deviceSelect = $('<select class="form-select form-select-sm flex-fill"></select>');
            this.dsRefreshBtn = $('<button class="btn btn-outline-secondary btn-sm">Refresh</button>');
            this.deviceSelect.append('<option value="TWIST">Twist</option>');
            this.deviceSelect.append('<option value="OWNVERTER">Ownverter</option>');
            this.powerState = settings.powerState || 'IDLE';
            this.toggleState = new Map();
            if (settings._toggleState && typeof settings._toggleState === 'object') {
                Object.entries(settings._toggleState).forEach(([k, v]) => this.toggleState.set(k, v));
            }
            this._configHandler = () => this._refreshDatasourceOptions();
            freeboard.on && freeboard.on('config_updated', this._configHandler);
            if (freeboard && typeof freeboard.addStyle === 'function') {
                // Flex-wrap row for leg toggles — items sit at natural width and wrap freely.
                freeboard.addStyle('.twist-toggle-grid', 'display:flex;flex-wrap:wrap;gap:8px;');
                // Bootstrap .input-group has width:100% by default which forces one item per row.
                // width:auto lets each item shrink to content size so they can reflow horizontally.
                // flex-wrap:nowrap prevents the label+switch inside a single item from splitting.
                freeboard.addStyle('.twist-toggle-item', 'flex-shrink:0;width:auto!important;flex-wrap:nowrap!important;');
                freeboard.addStyle('.twist-toggle-item .input-group-text', 'min-width:64px;justify-content:center;');
                // Let the toggle switch size to its content (onoffswitch is 78 px wide).
                freeboard.addStyle('.twist-toggle-switch', 'display:flex;align-items:center;justify-content:center;flex-shrink:0;');
                // Keep header labels aligned and inputs sized consistently.
                freeboard.addStyle('.twist-header-row .input-group-text', 'min-width:96px;justify-content:center;');
            }
        }

        render(el) {
            $(el).append(this.container);
            const headerRow = $('<div class="input-group input-group-sm mb-1 twist-header-row"></div>');
            headerRow.append('<span class="input-group-text">Datasource</span>', this.dsSelect, this.dsRefreshBtn);
            const deviceRow = $('<div class="input-group input-group-sm mb-1 twist-header-row"></div>');
            deviceRow.append('<span class="input-group-text">Device</span>', this.deviceSelect);
            this.container.append(headerRow, deviceRow);

            this.dsSelect.on('change', () => { this.settings.datasource = this.dsSelect.val(); });
            this.dsRefreshBtn.on('click', () => this._refreshDatasourceOptions());
            this.deviceSelect.on('change', () => {
                this.settings.deviceType = this.deviceSelect.val();
                this._renderLegControls();
            });

            this._refreshDatasourceOptions();
            if (this.settings.datasource) this.dsSelect.val(this.settings.datasource);
            this.deviceSelect.val(this.settings.deviceType || 'TWIST');

            this._renderPowerControls();
            this._renderScopeControls();
            this._renderLegControls();
            this.container.append(this.lastCmd);
        }

        _profile() {
            return protocol ? protocol.getProfile(this.settings.deviceType || 'TWIST') : { legs: 2, variables: [] };
        }

        _refreshDatasourceOptions() {
            const live = freeboard.getLiveModel?.();
            if (!live || typeof live.datasources !== 'function') return;
            const list = live.datasources();
            const current = this.settings.datasource;
            this.dsSelect.empty();
            list.forEach(ds => {
                try {
                    if (ds.type && ds.type() === 'serialport_datasource') {
                        const name = ds.name();
                        this.dsSelect.append(`<option value="${name}">${name}</option>`);
                    }
                } catch (e) { /* ignore */ }
            });
            if (current && this.dsSelect.find(`option[value='${current}']`).length === 0) {
                this.dsSelect.append(`<option value="${current}">${current}</option>`);
            }
            this.dsSelect.val(current);
        }

        _getPortPath() {
            const dsSettings = freeboard.getDatasourceSettings(this.settings.datasource) || {};
            return dsSettings.portPath || this.settings.datasource;
        }

        async _send(command) {
            if (!command) return;
            const path = this._getPortPath();
            if (!path) return;
            const CHUNK = 10;
            const DELAY = 100;
            const write = async (data) => {
                if (this.serialApi && this.serialApi.write) {
                    await this.serialApi.write(path, data);
                } else if (this.ipc) {
                    await this.ipc.invoke('write-serial-port', { path, data });
                }
            };
            try {
                for (let i = 0; i < command.length; i += CHUNK) {
                    await write(command.slice(i, i + CHUNK));
                    await new Promise(r => setTimeout(r, DELAY));
                }
                await write('\r\n');
                this.lastCmd.text(`Last command: ${command}`);
            } catch (err) {
                console.error('Twist command failed', err);
            }
        }

        _renderPowerControls() {
            if (this.powerWrap) this.powerWrap.remove();
            const row = $('<div class="d-flex gap-2 flex-wrap align-items-center justify-content-start"></div>');
            const idle = $('<button class="btn btn-outline-secondary btn-sm">IDLE</button>');
            const on = $('<button class="btn btn-outline-success btn-sm">POWER ON</button>');
            const off = $('<button class="btn btn-outline-danger btn-sm">POWER OFF</button>');
            row.append(idle, on, off);
            const setPower = (mode, send) => {
                this.powerState = mode;
                this.settings.powerState = mode;
                idle.toggleClass('active', mode === 'IDLE');
                on.toggleClass('active', mode === 'ON');
                off.toggleClass('active', mode === 'OFF');
                if (send) {
                    if (mode === 'IDLE') this._send(protocol.cmdIdle());
                    if (mode === 'ON') this._send(protocol.cmdPowerOn());
                    if (mode === 'OFF') this._send(protocol.cmdPowerOff());
                }
            };
            idle.on('click', () => setPower('IDLE', true));
            on.on('click', () => setPower('ON', true));
            off.on('click', () => setPower('OFF', true));
            setPower(this.powerState || 'IDLE', false);
            this.powerWrap = $('<div></div>').append($('<div class="fw-semibold">Power</div>'), row);
            this.container.append(this.powerWrap);
        }

        _renderScopeControls() {
            if (this.scopeWrap) this.scopeWrap.remove();
            const row = $('<div class="d-flex gap-2 flex-wrap align-items-center justify-content-start"></div>');
            const trigger = $('<button class="btn btn-outline-warning btn-sm">Trigger</button>');
            const acquire = $('<button class="btn btn-outline-info btn-sm">Acquire</button>');
            const status = $('<div class="small text-muted">—</div>');
            row.append(trigger, acquire);

            trigger.on('click', () => this._send(protocol.cmdScopeTrigger()));

            acquire.on('click', async () => {
                const portPath = this._getPortPath();
                if (!portPath) return;

                const call = async (method, ipcName, ...args) => {
                    if (this.serialApi && this.serialApi[method]) return this.serialApi[method](...args);
                    if (this.ipc) return this.ipc.invoke(ipcName, ...args);
                };

                acquire.prop('disabled', true).text('Acquiring…');
                status.text('Waiting for scope data…');
                try {
                    // Enable fast-frame tracking on this port (no-op if already enabled).
                    await call('enableFastCapture', 'enable-fast-capture', portPath);

                    // Send command — write-serial-port will set status → awaiting_record.
                    await this._send(protocol.cmdScopeAcquire());

                    // Poll until the fast-frame handler sees 'end record'.
                    const MAX_WAIT_MS = 10000;
                    const POLL_MS = 250;
                    const deadline = Date.now() + MAX_WAIT_MS;
                    let complete = false;
                    while (Date.now() < deadline) {
                        await new Promise(r => setTimeout(r, POLL_MS));
                        const st = await call('getFastStatus', 'get-fast-frame-status', portPath);
                        if (st && st.state === 'complete') { complete = true; break; }
                        status.text(`Acquiring… (${Math.round((Date.now() - (deadline - MAX_WAIT_MS)) / 1000)}s)`);
                    }

                    if (complete) {
                        const dsSettings = freeboard.getDatasourceSettings(this.settings.datasource) || {};
                        await call('saveFastCsv', 'save-fast-csv', {
                            path: portPath,
                            filePath: 'scope.csv',
                            separator: dsSettings.separator || ':',
                            eol: dsSettings.eol || '\\n',
                            addHeader: true,
                            timestampMode: 'relative',
                            useTimestampedFileName: true
                        });
                        status.text('Saved: scope CSV (timestamped)');
                    } else {
                        status.text('Timeout — no scope data received.');
                    }
                } catch (err) {
                    console.error('Scope capture failed', err);
                    status.text(`Error: ${err.message || err}`);
                } finally {
                    acquire.prop('disabled', false).text('Acquire');
                }
            });

            this.scopeWrap = $('<div></div>').append($('<div class="fw-semibold">Scope</div>'), row, status);
            this.container.append(this.scopeWrap);
        }

        _renderLegControls() {
            if (this.legWrap) this.legWrap.remove();
            const profile = this._profile();
            const section = $('<div class="d-flex flex-column gap-2"></div>');
            const wrap = $('<div class="d-flex flex-column gap-2"></div>');
            const topActions = ['LEG', 'CAPA', 'DRIVER'];
            const bottomActions = ['BUCK', 'BOOST'];
            for (let i = 1; i <= profile.legs; i += 1) {
                const row = $('<div class="d-flex flex-column gap-2"></div>');
                row.append(`<span class="badge bg-light text-dark">LEG${i}</span>`);

                const grid = $('<div class="twist-toggle-grid"></div>');
                const renderAction = (action) => {
                    const key = `${action}:${i}`;
                    const current = this.toggleState.get(key) || 'OFF';
                    const isOn = current === 'ON';
                    const inputId = `tw_${action}_${i}_${Math.random().toString(36).slice(2)}`;
                    // Use the same on/off switch markup as freeboard's boolean settings.
                    const checkbox = $('<input type="checkbox" class="onoffswitch-checkbox">')
                        .attr('id', inputId)
                        .prop('checked', isOn);
                    const onOffLabel = $(
                        `<label class="onoffswitch-label" for="${inputId}">
                            <div class="onoffswitch-inner"><span class="on">ON</span><span class="off">OFF</span></div>
                            <div class="onoffswitch-switch"></div>
                         </label>`
                    );
                    const switchWrap = $('<div class="onoffswitch"></div>').append(checkbox, onOffLabel);
                    checkbox.on('change', () => {
                        const state = checkbox.prop('checked') ? 'ON' : 'OFF';
                        this.toggleState.set(key, state);
                        this._persistToggleState();
                        this._send(protocol.cmdToggle(action, i, state, this.settings.deviceType));
                    });
                    const label = $(`<label class="input-group-text" for="${inputId}">${action}</label>`);
                    const box = $('<span class="input-group-text twist-toggle-switch"></span>').append(switchWrap);
                    const group = $('<div class="input-group input-group-sm twist-toggle-item"></div>');
                    group.append(label, box);
                    grid.append(group);
                };

                topActions.forEach(renderAction);
                bottomActions.forEach(renderAction);
                row.append(grid);
                wrap.append(row);
            }
            section.append($('<div class="fw-semibold">Leg toggles</div>'), wrap);
            this.legWrap = section;
            this.lastCmd.detach();
            this.container.append(section, this.lastCmd);
        }

        _persistToggleState() {
            const obj = {};
            this.toggleState.forEach((v, k) => { obj[k] = v; });
            this.settings._toggleState = obj;
        }

        onSettingsChanged(newSettings) {
            this.settings = newSettings;
            // Re-apply runtime state so it survives the settings modal round-trip.
            this.settings.powerState = this.powerState;
            this._persistToggleState();
            this.deviceSelect.val(this.settings.deviceType || 'TWIST');
            if (this.settings.datasource) this.dsSelect.val(this.settings.datasource);
            this._renderPowerControls();
            this._renderLegControls();
        }

        onDispose() {
            if (this._configHandler && freeboard.off) {
                freeboard.off('config_updated', this._configHandler);
            }
        }

        getHeight() { return 6; }
    }
})();
