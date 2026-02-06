(function () {
    // Twist/Ownverter Actions control widget (power + toggles).
    const protocol = window.twistProtocol || null;
    freeboard.loadWidgetPlugin({
        type_name: 'twist_actions_panel',
        display_name: 'Twist/Ownverter Actions',
        description: 'Send power and toggle commands over serial.',
        category: 'Python Communication Protocol',
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
            { name: 'datasource', display_name: 'Datasource Name', type: 'text' }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new TwistActionsPanel(settings));
        }
    });

    class TwistActionsPanel {
        constructor(settings) {
            this.settings = settings;
            this.serialApi = window.api && window.api.serial ? window.api.serial : null;
            this.ipc = !this.serialApi && window.require ? window.require('electron')?.ipcRenderer : null;
            this.container = $('<div class="d-flex flex-column h-100 gap-2 overflow-auto p-2"></div>');
            this.lastCmd = $('<div class="small text-muted">Last command: —</div>');
            this.dsSelect = $('<select class="form-select form-select-sm flex-fill"></select>');
            this.deviceSelect = $('<select class="form-select form-select-sm" style="max-width: 160px;"></select>');
            this.deviceSelect.append('<option value="TWIST">Twist</option>');
            this.deviceSelect.append('<option value="OWNVERTER">Ownverter</option>');
            this.powerState = 'IDLE';
            this.toggleState = new Map();
            this._configHandler = () => this._refreshDatasourceOptions();
            freeboard.on && freeboard.on('config_updated', this._configHandler);
            if (freeboard && typeof freeboard.addStyle === 'function') {
                // Button alignment for I/O toggles.
                freeboard.addStyle('.twist-toggle-group .btn', 'min-width: 28px;');
            }
        }

        render(el) {
            $(el).append(this.container);
            const headerRow = $('<div class="input-group input-group-sm mb-1"></div>');
            headerRow.append('<span class="input-group-text">Datasource</span>', this.dsSelect);
            const deviceRow = $('<div class="input-group input-group-sm mb-1"></div>');
            deviceRow.append('<span class="input-group-text">Device</span>', this.deviceSelect);
            this.container.append(headerRow, deviceRow);

            this.dsSelect.on('change', () => { this.settings.datasource = this.dsSelect.val(); });
            this.deviceSelect.on('change', () => {
                this.settings.deviceType = this.deviceSelect.val();
                this._renderLegControls();
            });

            this._refreshDatasourceOptions();
            if (this.settings.datasource) this.dsSelect.val(this.settings.datasource);
            this.deviceSelect.val(this.settings.deviceType || 'TWIST');

            this._renderPowerControls();
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
            try {
                if (this.serialApi && this.serialApi.write) {
                    await this.serialApi.write(path, command);
                } else if (this.ipc) {
                    await this.ipc.invoke('write-serial-port', { path, data: command });
                }
                this.lastCmd.text(`Last command: ${command}`);
            } catch (err) {
                console.error('Twist command failed', err);
            }
        }

        _renderPowerControls() {
            if (this.powerWrap) this.powerWrap.remove();
            const row = $('<div class="d-flex gap-2 flex-wrap align-items-center"></div>');
            const idle = $('<button class="btn btn-outline-secondary btn-sm">IDLE</button>');
            const on = $('<button class="btn btn-outline-success btn-sm">POWER ON</button>');
            const off = $('<button class="btn btn-outline-danger btn-sm">POWER OFF</button>');
            row.append(idle, on, off);
            const setPower = (mode, send) => {
                this.powerState = mode;
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

        _renderLegControls() {
            if (this.legWrap) this.legWrap.remove();
            const profile = this._profile();
            const wrap = $('<div class="d-flex flex-column gap-2"></div>');
            const actions = ['LEG', 'CAPA', 'DRIVER', 'BUCK', 'BOOST'];
            for (let i = 1; i <= profile.legs; i += 1) {
                const row = $('<div class="d-flex flex-wrap gap-2 align-items-center"></div>');
                row.append(`<span class="badge bg-light text-dark">LEG${i}</span>`);
                actions.forEach(action => {
                    const group = $('<div class="btn-group btn-group-sm twist-toggle-group" role="group"></div>');
                    const onBtn = $('<button class="btn btn-outline-success">I</button>');
                    const offBtn = $('<button class="btn btn-outline-secondary">O</button>');
                    const label = $(`<span class="small text-muted ms-1">${action}</span>`);
                    const key = `${action}:${i}`;
                    const setState = (state, send) => {
                        this.toggleState.set(key, state);
                        onBtn.toggleClass('active', state === 'ON');
                        offBtn.toggleClass('active', state === 'OFF');
                        if (send) {
                            this._send(protocol.cmdToggle(action, i, state, this.settings.deviceType));
                        }
                    };
                    onBtn.on('click', () => setState('ON', true));
                    offBtn.on('click', () => setState('OFF', true));
                    const current = this.toggleState.get(key) || 'OFF';
                    setState(current, false);
                    group.append(onBtn, offBtn);
                    const cell = $('<div class="d-flex align-items-center gap-1"></div>');
                    cell.append(group, label);
                    row.append(cell);
                });
                wrap.append(row);
            }
            this.legWrap = wrap;
            this.container.append($('<div class="fw-semibold">Leg toggles</div>'), wrap);
        }

        onSettingsChanged(newSettings) {
            this.settings = newSettings;
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
