(function () {
    freeboard.loadWidgetPlugin({
        type_name: "serial_command_buttons",
        display_name: "Push Buttons",
        description: "Buttons to send commands over a serial port",
        icon: "terminal",
        category: "Buttons",
        // Configured via the dedicated openPushButtonsEditor custom editor
        // (registered in integrated_plot_editor.js) so the buttons list can
        // reshape between serial commands and ThingSet path/value targets
        // depending on the selected datasource's type.
        settings: [
            { name: "title", display_name: "Title", type: "text" }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new SerialCommandButtons(settings));
        }
    });

    class SerialCommandButtons {
        constructor(settings) {
            this.settings = settings;
            this.serialApi = window.api && window.api.serial ? window.api.serial : null;
            this.ipcRenderer = !this.serialApi && window.require ? window.require("electron")?.ipcRenderer : null;
            this.container = $('<div class="serial-command-buttons d-flex flex-column gap-2 overflow-auto"></div>');
            this.dsSelect = $('<select class="form-select form-select-sm flex-fill"></select>');
            this.btnContainer = $('<div class="d-flex flex-wrap"></div>');
            this._configHandler = () => this._refreshDatasourceOptions();
            if (freeboard && typeof freeboard.addStyle === 'function') {
                freeboard.addStyle('.serial-command-buttons .btn', 'white-space:normal;word-break:break-word;');
                freeboard.addStyle('.serial-command-buttons .d-flex', 'min-width:0;');
            }
            freeboard.on && freeboard.on('config_updated', this._configHandler);
        }

        render(containerElement) {
            if (!this._built) {
                const dsRow = $('<div class="input-group input-group-sm mb-1"></div>');
                dsRow.append('<span class="input-group-text">Datasource</span>', this.dsSelect);
                this.container.append(dsRow, this.btnContainer);
                this.dsSelect.on('change', () => {
                    this.settings.datasource = this.dsSelect.val();
                });
                this._refreshDatasourceOptions();
                if (this.settings.datasource) this.dsSelect.val(this.settings.datasource);
                this._renderButtons();
                this._built = true;
                this._bindRadialContextMenu();
            }
            $(containerElement).append(this.container);
        }

        // Milestone 7 of docs/GUI/02-navigation_overhaul.md: narrower scope
        // than the other Buttons-family widgets -- a button's own target
        // (path + value, or a raw command) genuinely varies per situation
        // and stays dialog-only (Design Principle 2). The radial only covers
        // + Add Button (a blank target in whichever mode -- serial command
        // or ThingSet path/value -- is currently active) and renaming an
        // existing button's label in place.
        _bindRadialContextMenu() {
            // Bound on the whole widget rather than just btnContainer: an
            // empty button list collapses to zero height, leaving nothing to
            // right-click inside it specifically.
            this.container.on('contextmenu', (e) => {
                if ($(e.target).is('button') || $(e.target).closest('.input-group').length) return;
                if (!window.RadialContextMenu) return;
                e.preventDefault();
                e.stopPropagation();
                window.RadialContextMenu.show({
                    x: e.clientX, y: e.clientY,
                    items: [{ id: 'add-button', label: '+ Add Button', onSelect: () => this._quickAddButton() }]
                });
            });
            this.btnContainer.on('dblclick', 'button', (e) => {
                e.stopPropagation();
                const idx = $(e.currentTarget).index();
                this._startRenameButton(idx, e.currentTarget);
            });
        }

        _quickAddButton() {
            const { mode, rows } = this._activeButtonRows();
            if (mode === 'thingset') {
                this._persistSettings({ buttonTargets: [...rows, { path: '', value: '', label: '' }] });
            } else {
                this._persistSettings({ buttons: [...rows, { command: '', label: '' }] });
            }
        }

        _startRenameButton(idx, btnEl) {
            const { mode, rows } = this._activeButtonRows();
            const row = rows[idx];
            if (!row) return;
            window.RadialWidgetKit.floatingInput({
                anchorEl: btnEl,
                value: row.label || '',
                placeholder: $(btnEl).text(),
                onCommit: (val) => {
                    const key = mode === 'thingset' ? 'buttonTargets' : 'buttons';
                    const updated = rows.map((r, i) => (i === idx ? { ...r, label: val } : r));
                    this._persistSettings({ [key]: updated });
                }
            });
        }

        _persistSettings(patch) {
            window.RadialWidgetKit.quickSetSettings(window.RadialWidgetKit.findWidgetModel(this), patch);
        }

        _refreshDatasourceOptions() {
            const live = freeboard.getLiveModel?.();
            if (!live || typeof live.datasources !== 'function') return;
            const list = live.datasources();
            const current = this.settings.datasource;
            this.dsSelect.empty();
            list.forEach(ds => {
                try {
                    const type = ds.type && ds.type();
                    if (type === 'serialport_datasource' || type === 'fast_frame_datasource' || type === 'thingset_serial_datasource' || type === 'owntech_thingset_datasource') {
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

        // buttonTargets (ThingSet path/value) and buttons (raw serial command)
        // are additive settings -- whichever one is populated wins, so a
        // widget saved in one mode isn't clobbered by switching datasource
        // type back and forth in the editor.
        _activeButtonRows() {
            const targets = Array.isArray(this.settings.buttonTargets) ? this.settings.buttonTargets : [];
            if (targets.length) return { mode: 'thingset', rows: targets };
            return { mode: 'serial', rows: Array.isArray(this.settings.buttons) ? this.settings.buttons : [] };
        }

        _renderButtons() {
            this.btnContainer.empty();
            const layout = this.settings.layout || "vertical";
            const { mode, rows } = this._activeButtonRows();
            this.btnContainer.toggleClass('flex-column', layout !== 'horizontal');
            this.btnContainer.toggleClass('flex-row', layout === 'horizontal');
            rows.forEach(cfg => {
                const btn = $('<button class="btn btn-primary btn-sm"></button>')
                    .text(cfg.label || (mode === 'thingset' ? cfg.path : cfg.command));
                if (layout === "horizontal") {
                    btn.addClass('me-1 mb-1');
                } else {
                    btn.addClass('mb-1 w-100');
                }
                btn.on('click', () => {
                    if (mode === 'thingset') {
                        this._sendThingSetValue(cfg.path, cfg.value);
                    } else {
                        this._sendCommand(cfg.command);
                    }
                });
                this.btnContainer.append(btn);
            });
        }

        _sendCommand(command) {
            if (!command) return;
            const dsSettings = freeboard.getDatasourceSettings(this.settings.datasource) || {};
            const path = dsSettings.portPath || this.settings.datasource;
            const payload = { data: command };
            if (path) payload.path = path;
            if (this.serialApi && this.serialApi.write) {
                this.serialApi.write(payload.path, payload.data)
                    .catch(err => console.error("Serial command failed:", err));
            } else if (this.ipcRenderer) {
                this.ipcRenderer.invoke("write-serial-port", payload)
                    .catch(err => console.error("Serial command failed:", err));
            }
        }

        _sendThingSetValue(path, rawValue) {
            if (!path) return;
            const tsSerialApi = window.api && window.api.thingsetSerial ? window.api.thingsetSerial : null;
            if (!tsSerialApi || !tsSerialApi.setValue) return;
            const dsSettings = freeboard.getDatasourceSettings(this.settings.datasource) || {};
            if (!dsSettings.portPath) return;
            const value = window.ThingSetValueParse ? window.ThingSetValueParse.parseInputValue(rawValue) : rawValue;
            tsSerialApi.setValue({
                port: dsSettings.portPath,
                path,
                value,
                baudRate: Number(dsSettings.baudRate) || 115200,
                usePrefix: !!dsSettings.usePrefix,
            }).catch(err => console.error("ThingSet write failed:", err));
        }

        onSettingsChanged(newSettings) {
            this.settings = newSettings;
            this._refreshDatasourceOptions();
            this._renderButtons();
        }

        onDispose() {
            if (this._configHandler && freeboard.off) {
                freeboard.off('config_updated', this._configHandler);
            }
        }

        getHeight() {
            const { rows } = this._activeButtonRows();
            const count = rows.length;
            let height = 1; // datasource selector row
            if (this.settings.layout === "horizontal") {
                height += 1;
            } else {
                height += Math.max(1, count);
            }
            return height;
        }
    }
})();
