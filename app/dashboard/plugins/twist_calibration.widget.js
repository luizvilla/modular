(function () {
    // Twist/Ownverter calibration widget (gain/offset).
    const protocol = window.twistProtocol || null;
    freeboard.loadWidgetPlugin({
        type_name: 'twist_calibration_panel',
        display_name: 'Twist/Ownverter Calibration',
        description: 'Send gain/offset calibration commands over serial.',
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
            newInstanceCallback(new TwistCalibrationPanel(settings));
        }
    });

    class TwistCalibrationPanel {
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
            this.varSelect = $('<select class="form-select form-select-sm" style="max-width: 160px;"></select>');
            this.gainInput = $('<input type="number" step="any" class="form-control form-control-sm" placeholder="Gain">');
            this.offsetInput = $('<input type="number" step="any" class="form-control form-control-sm" placeholder="Offset">');
            this._configHandler = () => this._refreshDatasourceOptions();
            freeboard.on && freeboard.on('config_updated', this._configHandler);
        }

        render(el) {
            $(el).append(this.container);
            const dsRow = $('<div class="input-group input-group-sm mb-1"></div>');
            dsRow.append('<span class="input-group-text">Datasource</span>', this.dsSelect);
            const deviceRow = $('<div class="input-group input-group-sm mb-1"></div>');
            deviceRow.append('<span class="input-group-text">Device</span>', this.deviceSelect);
            const calRow = $('<div class="input-group input-group-sm"></div>');
            calRow.append('<span class="input-group-text">Variable</span>', this.varSelect, this.gainInput, this.offsetInput);
            const sendBtn = $('<button class="btn btn-primary btn-sm">Send Calibration</button>');
            const sendRow = $('<div class="d-flex gap-2 align-items-center"></div>').append(sendBtn);

            this.container.append(dsRow, deviceRow, calRow, sendRow, this.lastCmd);

            this.dsSelect.on('change', () => { this.settings.datasource = this.dsSelect.val(); });
            this.deviceSelect.on('change', () => {
                this.settings.deviceType = this.deviceSelect.val();
                this._refreshVariables();
            });
            sendBtn.on('click', () => this._sendCalibration());

            this._refreshDatasourceOptions();
            if (this.settings.datasource) this.dsSelect.val(this.settings.datasource);
            this.deviceSelect.val(this.settings.deviceType || 'TWIST');
            this._refreshVariables();
        }

        _profile() {
            return protocol ? protocol.getProfile(this.settings.deviceType || 'TWIST') : { variables: [] };
        }

        _refreshVariables() {
            const profile = this._profile();
            this.varSelect.empty();
            (profile.variables || []).forEach(v => this.varSelect.append(`<option value="${v}">${v}</option>`));
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

        async _sendCalibration() {
            const variable = this.varSelect.val();
            const gain = this.gainInput.val();
            const offset = this.offsetInput.val();
            if (!variable) return;
            const cmd = protocol.cmdCalibrate(variable, gain, offset, this.settings.deviceType);
            const path = this._getPortPath();
            if (!path) return;
            try {
                if (this.serialApi && this.serialApi.write) {
                    await this.serialApi.write(path, cmd);
                } else if (this.ipc) {
                    await this.ipc.invoke('write-serial-port', { path, data: cmd });
                }
                this.lastCmd.text(`Last command: ${cmd}`);
            } catch (err) {
                console.error('Twist calibration failed', err);
            }
        }

        onSettingsChanged(newSettings) {
            this.settings = newSettings;
            this.deviceSelect.val(this.settings.deviceType || 'TWIST');
            if (this.settings.datasource) this.dsSelect.val(this.settings.datasource);
            this._refreshVariables();
        }

        onDispose() {
            if (this._configHandler && freeboard.off) {
                freeboard.off('config_updated', this._configHandler);
            }
        }

        getHeight() { return 4; }
    }
})();
