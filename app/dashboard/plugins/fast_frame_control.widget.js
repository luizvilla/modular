(function () {
    freeboard.loadWidgetPlugin({
        type_name: "fast_frame_control",
        display_name: "Fast Frame Control",
        category: "Controls",
        icon: "circle-play",
        description: "Trigger, monitor, and export fast serial frame acquisitions",
        settings: [
            {
                name: "datasource",
                display_name: "Datasource Name",
                type: "option",
                options: getFastFrameDatasourceOptions,
                optionsRefreshMs: 1000
            },
            {
                name: "armCommand",
                display_name: "Arm Command",
                type: "text",
                default_value: "t"
            },
            {
                name: "retrieveCommand",
                display_name: "Retrieve Command",
                type: "text",
                default_value: "r"
            },
            {
                name: "retrieveDelayMs",
                display_name: "Retrieve Delay (ms)",
                type: "number",
                default_value: 100
            },
            {
                name: "filePath",
                display_name: "CSV Base File Path",
                type: "text",
                default_value: "fast_frame.csv"
            },
            {
                name: "timestampedFileName",
                display_name: "Timestamped file name",
                type: "boolean",
                default_value: true
            },
            {
                name: "autoSave",
                display_name: "Auto-save after complete",
                type: "boolean",
                default_value: false
            },
            {
                name: "pollMs",
                display_name: "Status Refresh (ms)",
                type: "number",
                default_value: 250
            }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new FastFrameControl(settings));
        }
    });

    function getFastFrameDatasourceOptions() {
        const live = freeboard.getLiveModel?.();
        if (!live || typeof live.datasources !== 'function') return [];
        const options = [];
        live.datasources().forEach(ds => {
            try {
                if (ds.type && ds.type() === 'fast_frame_datasource') {
                    const name = ds.name();
                    options.push({ name, value: name });
                }
            } catch {}
        });
        return options;
    }

    class FastFrameControl {
        constructor(settings) {
            this.settings = settings;
            this.serialApi = window.api && window.api.serial ? window.api.serial : null;
            this.ipc = !this.serialApi && window.require ? window.require("electron")?.ipcRenderer : null;
            this.pollTimer = null;
            this.autoSaveDoneForCycle = false;
            this.container = $('<div class="d-flex flex-column h-100 gap-2 overflow-auto"></div>');
            if (freeboard && typeof freeboard.addStyle === 'function') {
                freeboard.addStyle('.fast-frame-control', 'flex-wrap:nowrap!important;');
                freeboard.addStyle('.fast-frame-control .input-group-text', 'min-width:82px;justify-content:center;');
                freeboard.addStyle('.fast-frame-control .form-control, .fast-frame-control .form-select', 'min-width:0;flex:1;');
            }
            this._configHandler = () => this._refreshDatasourceOptions();
            freeboard.on && freeboard.on('config_updated', this._configHandler);
        }

        render(containerElement) {
            $(containerElement).append(this.container);
            this.container.empty();

            this.dsSelect = $('<select class="form-select form-select-sm flex-fill"></select>');
            this.armInput = $('<input type="text" class="form-control form-control-sm">');
            this.retrieveInput = $('<input type="text" class="form-control form-control-sm">');
            this.delayInput = $('<input type="number" class="form-control form-control-sm">');
            this.fileInput = $('<input type="text" class="form-control form-control-sm">');
            this.timestampedCheck = $('<input type="checkbox">');
            this.autoSaveCheck = $('<input type="checkbox">');
            this.statusBox = $('<div class="small text-muted border rounded p-2">Idle.</div>');
            this.triggerBtn = $('<button class="btn btn-primary btn-sm">Trigger + Retrieve</button>');
            this.retrieveBtn = $('<button class="btn btn-outline-primary btn-sm">Retrieve</button>');
            this.saveBtn = $('<button class="btn btn-outline-secondary btn-sm">Save Latest CSV</button>');

            this.container.append(
                this._makeRow('Datasource', this.dsSelect),
                this._makeRow('Arm', this.armInput),
                this._makeRow('Retrieve', this.retrieveInput),
                this._makeRow('Delay', this.delayInput),
                this._makeRow('CSV File', this.fileInput),
                this._makeCheckRow('Timestamped', this.timestampedCheck),
                this._makeCheckRow('Auto-save', this.autoSaveCheck),
                $('<div class="d-flex gap-1"></div>').append(this.triggerBtn, this.retrieveBtn, this.saveBtn),
                this.statusBox
            );

            this._syncControls();

            this.dsSelect.on('change', () => {
                this.settings.datasource = this.dsSelect.val();
                this.autoSaveDoneForCycle = false;
                this._refreshStatus();
            });
            this.armInput.on('change', () => { this.settings.armCommand = this.armInput.val(); });
            this.retrieveInput.on('change', () => { this.settings.retrieveCommand = this.retrieveInput.val(); });
            this.delayInput.on('change', () => { this.settings.retrieveDelayMs = parseInt(this.delayInput.val(), 10) || 100; });
            this.fileInput.on('change', () => { this.settings.filePath = this.fileInput.val(); });
            this.timestampedCheck.on('change', () => { this.settings.timestampedFileName = this.timestampedCheck.prop('checked'); });
            this.autoSaveCheck.on('change', () => { this.settings.autoSave = this.autoSaveCheck.prop('checked'); });

            this.triggerBtn.on('click', () => this._sendTrigger());
            this.retrieveBtn.on('click', () => this._sendRetrieve());
            this.saveBtn.on('click', () => this._saveLatestCsv());

            this._startPolling();
        }

        _makeRow(labelText, inputEl) {
            const row = $('<div class="input-group input-group-sm fast-frame-control"></div>');
            row.append($(`<span class="input-group-text">${labelText}</span>`), inputEl);
            return row;
        }

        _makeCheckRow(labelText, checkEl) {
            const row = $('<div class="input-group input-group-sm fast-frame-control"></div>');
            const id = `chk_${Math.random().toString(36).slice(2)}`;
            checkEl.addClass('form-check-input mt-0').attr('id', id);
            row.append($(`<label class="input-group-text" for="${id}">${labelText}</label>`), $('<span class="input-group-text"></span>').append(checkEl));
            return row;
        }

        _syncControls() {
            this._refreshDatasourceOptions();
            this.dsSelect.val(this.settings.datasource || '');
            this.armInput.val(this.settings.armCommand || 't');
            this.retrieveInput.val(this.settings.retrieveCommand || 'r');
            this.delayInput.val(this.settings.retrieveDelayMs ?? 100);
            this.fileInput.val(this.settings.filePath || 'fast_frame.csv');
            this.timestampedCheck.prop('checked', this.settings.timestampedFileName !== false);
            this.autoSaveCheck.prop('checked', !!this.settings.autoSave);
        }

        _refreshDatasourceOptions() {
            const live = freeboard.getLiveModel?.();
            if (!live || typeof live.datasources !== 'function' || !this.dsSelect) return;
            const current = this.settings.datasource;
            this.dsSelect.empty();
            live.datasources().forEach(ds => {
                try {
                    if (ds.type && ds.type() === 'fast_frame_datasource') {
                        const name = ds.name();
                        this.dsSelect.append(`<option value="${name}">${name}</option>`);
                    }
                } catch {}
            });
            if (current && this.dsSelect.find(`option[value='${current}']`).length === 0) {
                this.dsSelect.append(`<option value="${current}">${current}</option>`);
            }
            this.dsSelect.val(current);
        }

        _portPath() {
            const dsSettings = freeboard.getDatasourceSettings(this.settings.datasource) || {};
            return dsSettings.portPath || this.settings.datasource;
        }

        async _writeCommand(path, command) {
            if (!path || !command) return;
            if (this.serialApi && this.serialApi.write) {
                await this.serialApi.write(path, command);
            } else if (this.ipc) {
                await this.ipc.invoke('write-serial-port', { path, data: command });
            }
        }

        async _sendTrigger() {
            const path = this._portPath();
            const armCommand = this.armInput.val() || this.settings.armCommand || 't';
            const retrieveCommand = this.retrieveInput.val() || this.settings.retrieveCommand || 'r';
            const retrieveDelayMs = Math.max(0, parseInt(this.delayInput.val(), 10) || this.settings.retrieveDelayMs || 100);
            if (!path) return;
            this.autoSaveDoneForCycle = false;
            await this._writeCommand(path, armCommand);
            if (retrieveDelayMs > 0) {
                await new Promise(resolve => setTimeout(resolve, retrieveDelayMs));
            }
            await this._writeCommand(path, retrieveCommand);
            await this._refreshStatus();
        }

        async _sendRetrieve() {
            const path = this._portPath();
            const retrieveCommand = this.retrieveInput.val() || this.settings.retrieveCommand || 'r';
            if (!path) return;
            this.autoSaveDoneForCycle = false;
            await this._writeCommand(path, retrieveCommand);
            await this._refreshStatus();
        }

        async _saveLatestCsv() {
            const path = this._portPath();
            if (!path) return;
            const dsSettings = freeboard.getDatasourceSettings(this.settings.datasource) || {};
            const payload = {
                path,
                filePath: this.fileInput.val() || this.settings.filePath || 'fast_frame.csv',
                separator: dsSettings.separator || ':',
                eol: dsSettings.eol || '\\n',
                addHeader: true,
                timestampMode: 'relative',
                useTimestampedFileName: this.timestampedCheck.prop('checked')
            };
            if (this.serialApi && this.serialApi.saveFastCsv) {
                await this.serialApi.saveFastCsv(payload);
            } else if (this.ipc) {
                await this.ipc.invoke('save-fast-csv', payload);
            }
            this.autoSaveDoneForCycle = true;
            await this._refreshStatus();
        }

        async _getStatus(path) {
            if (this.serialApi && this.serialApi.getFastStatus) return this.serialApi.getFastStatus(path);
            if (this.ipc) return this.ipc.invoke('get-fast-frame-status', { path });
            return null;
        }

        async _refreshStatus() {
            const path = this._portPath();
            if (!path) {
                this.statusBox.text('Select a fast frame datasource.');
                return;
            }
            const status = await this._getStatus(path);
            if (!status) {
                this.statusBox.text('Status unavailable.');
                return;
            }
            const parts = [
                `State: ${status.state || 'idle'}`,
                status.message ? `Message: ${status.message}` : null,
                Number.isFinite(status.datasetPoints) ? `Points: ${status.datasetPoints}` : null,
                status.completedAt ? `Completed: ${new Date(status.completedAt).toLocaleTimeString()}` : null
            ].filter(Boolean);
            this.statusBox.text(parts.join(' | '));

            if (status.state === 'complete' && this.autoSaveCheck.prop('checked') && !this.autoSaveDoneForCycle) {
                await this._saveLatestCsv();
            }
        }

        _startPolling() {
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
                this.pollTimer = null;
            }
            const pollMs = Math.max(100, parseInt(this.settings.pollMs, 10) || 250);
            this.pollTimer = setInterval(() => this._refreshStatus(), pollMs);
            this._refreshStatus();
        }

        onSettingsChanged(newSettings) {
            this.settings = newSettings;
            this._syncControls();
            this._startPolling();
        }

        onDispose() {
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
                this.pollTimer = null;
            }
            if (this._configHandler && freeboard.off) {
                freeboard.off('config_updated', this._configHandler);
            }
        }

        getHeight() {
            return 6;
        }
    }
})();
