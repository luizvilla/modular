(function () {
    // Twist/Ownverter Setpoints widget (reference/duty/phase/etc).
    const protocol = window.twistProtocol || null;
    freeboard.loadWidgetPlugin({
        type_name: 'twist_setpoints_panel',
        display_name: 'Twist/Ownverter Setpoints',
        description: 'Send reference, duty, frequency, phase, and dead-time setpoints over serial.',
        icon: 'sliders',
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
            newInstanceCallback(new TwistSetpointsPanel(settings));
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

    class TwistSetpointsPanel {
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
            this.autoSend = false;
            this._configHandler = () => this._refreshDatasourceOptions();
            freeboard.on && freeboard.on('config_updated', this._configHandler);
            if (freeboard && typeof freeboard.addStyle === 'function') {
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
                this._renderSetpoints();
            });

            this._refreshDatasourceOptions();
            if (this.settings.datasource) this.dsSelect.val(this.settings.datasource);
            this.deviceSelect.val(this.settings.deviceType || 'TWIST');

            this._renderSetpoints();
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
            // Mirror Shield_Class.py sendMessage(): 10-byte chunks + 100 ms delay each,
            // then \r\n sent separately. The Zephyr console ring buffer is small (~16 B);
            // sending the full frame in one write overflows it and drops the \n, leaving
            // console_read_line() blocked until the next command's \n arrives.
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
                console.error('Twist setpoint failed', err);
            }
        }

        _renderSetpoints() {
            if (this.setpointWrap) this.setpointWrap.remove();
            const profile = this._profile();
            const wrap = $('<div class="d-flex flex-column gap-2"></div>');
            if (freeboard && typeof freeboard.addStyle === 'function') {
                freeboard.addStyle('.twist-setpoints .input-group-text', 'min-width:140px;');
                freeboard.addStyle('.twist-setpoints .form-control', 'min-width:100px;flex:1;');
                freeboard.addStyle('.twist-setpoints .form-select', 'min-width:100px;flex:1;');
            }

            const autoSendBtn = $('<button class="btn btn-sm">Auto Send</button>');
            const syncAutoBtn = () => {
                autoSendBtn
                    .toggleClass('btn-outline-secondary', !this.autoSend)
                    .toggleClass('btn-success', this.autoSend)
                    .text(this.autoSend ? 'Auto: ON' : 'Auto: OFF');
            };
            syncAutoBtn();
            autoSendBtn.on('click', () => { this.autoSend = !this.autoSend; syncAutoBtn(); });

            const sectionHeader = $('<div class="d-flex align-items-center justify-content-between"></div>');
            sectionHeader.append($('<span class="fw-semibold">Setpoints</span>'), autoSendBtn);

            for (let legNum = 1; legNum <= profile.legs; legNum += 1) {
                const leg = legNum;
                const legSection = $('<div class="d-flex flex-column gap-1"></div>');
                legSection.append(`<span class="badge bg-light text-dark">LEG${leg}</span>`);

                const makeRow = (label, inputs, onSend) => {
                    let debounceTimer = null;
                    const row = $('<div class="input-group input-group-sm twist-setpoints"></div>');
                    row.append(`<span class="input-group-text">${label}</span>`);
                    inputs.forEach(inp => {
                        row.append(inp);
                        if (inp.is('input[type=number]')) {
                            inp.on('change', () => {
                                if (!this.autoSend) return;
                                // Debounce: wait until the user stops clicking before sending.
                                // 300 ms > 200 ms chunk-send time, preventing interleaved writes.
                                clearTimeout(debounceTimer);
                                debounceTimer = setTimeout(() => onSend(), 300);
                            });
                        }
                    });
                    const btn = $('<button class="btn btn-primary btn-sm">Send</button>');
                    btn.on('click', onSend);
                    row.append(btn);
                    legSection.append(row);
                };

                const variableOptions = () => {
                    const sel = $('<select class="form-select form-select-sm"></select>');
                    profile.variables.forEach(v => sel.append(`<option value="${v}">${v}</option>`));
                    return sel;
                };

                const refVar = variableOptions();
                const refVal = $('<input type="number" step="0.1" class="form-control form-control-sm" placeholder="V or A">');
                makeRow('Reference', [refVar, refVal], () => {
                    this._send(protocol.cmdReference(leg, refVar.val(), refVal.val(), this.settings.deviceType));
                });

                const dutyVal = $('<input type="number" step="0.01" min="0" max="1" class="form-control form-control-sm" placeholder="0 to 1">');
                makeRow('Duty', [dutyVal], () => {
                    this._send(protocol.cmdDuty(leg, dutyVal.val(), this.settings.deviceType));
                });

                const freqVal = $('<input type="number" step="1" min="0" class="form-control form-control-sm" placeholder="Hz">');
                makeRow('Frequency', [freqVal], () => {
                    this._send(protocol.cmdFrequency(leg, freqVal.val(), this.settings.deviceType));
                });

                const phaseVal = $('<input type="number" step="1" class="form-control form-control-sm" placeholder="Degrees">');
                makeRow('Phase Shift', [phaseVal], () => {
                    this._send(protocol.cmdPhaseShift(leg, phaseVal.val(), this.settings.deviceType));
                });

                const dtRiseVal = $('<input type="number" step="1" min="0" class="form-control form-control-sm" placeholder="ns">');
                makeRow('Dead Time Rising', [dtRiseVal], () => {
                    this._send(protocol.cmdDeadTimeRising(leg, dtRiseVal.val(), this.settings.deviceType));
                });

                const dtFallVal = $('<input type="number" step="1" min="0" class="form-control form-control-sm" placeholder="ns">');
                makeRow('Dead Time Falling', [dtFallVal], () => {
                    this._send(protocol.cmdDeadTimeFalling(leg, dtFallVal.val(), this.settings.deviceType));
                });

                wrap.append(legSection);
            }

            this.setpointWrap = $('<div class="d-flex flex-column gap-1"></div>').append(sectionHeader, wrap);
            this.container.append(this.setpointWrap);
        }

        onSettingsChanged(newSettings) {
            this.settings = newSettings;
            this.deviceSelect.val(this.settings.deviceType || 'TWIST');
            if (this.settings.datasource) this.dsSelect.val(this.settings.datasource);
            this._renderSetpoints();
        }

        onDispose() {
            if (this._configHandler && freeboard.off) {
                freeboard.off('config_updated', this._configHandler);
            }
        }

        getHeight() { return 10; }
    }
})();
