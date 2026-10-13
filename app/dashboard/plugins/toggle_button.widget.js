(function () {
    freeboard.loadWidgetPlugin({
        type_name: "toggle_button",
        display_name: "Toggle Button",
        description: "A toggle switch that sends an ON command or an OFF command over a serial port",
        icon: "power-off",
        category: "Buttons",
        settings: [
            { name: "title", display_name: "Title", type: "text" },
            { name: "onCommand", display_name: "ON Command", type: "text", description: "Sent as a raw serial command. Ignored when the datasource above is a ThingSet type -- use ON/OFF Value below instead." },
            { name: "offCommand", display_name: "OFF Command", type: "text", description: "Sent as a raw serial command. Ignored when the datasource above is a ThingSet type -- use ON/OFF Value below instead." },
            { name: "writePath", display_name: "ThingSet Write Path", type: "text", description: "Only used when the datasource above is a ThingSet type, e.g. /Config/Leg1/wEnable." },
            { name: "onValue", display_name: "ThingSet ON Value", type: "text", default_value: "true", description: "Parsed as JSON/boolean/number when possible, otherwise sent as a string." },
            { name: "offValue", display_name: "ThingSet OFF Value", type: "text", default_value: "false", description: "Parsed as JSON/boolean/number when possible, otherwise sent as a string." },
            {
                name: "datasource",
                display_name: "Datasource Name",
                type: "option",
                // Keep datasource selection aligned with the other Buttons-category widgets.
                options: getSerialDatasourceOptions,
                optionsRefreshMs: 1000
            }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new ToggleButton(settings));
        }
    });

    // Provide a datasource list for the widget settings dropdown.
    function getSerialDatasourceOptions() {
        const live = freeboard.getLiveModel?.();
        if (!live || typeof live.datasources !== 'function') return [];
        const options = [];
        live.datasources().forEach(ds => {
            try {
                const type = ds.type && ds.type();
                if (type === 'serialport_datasource' || type === 'fast_frame_datasource' || type === 'thingset_serial_datasource' || type === 'owntech_thingset_datasource') {
                    const name = ds.name();
                    options.push({ name, value: name });
                }
            } catch (e) { /* ignore */ }
        });
        return options;
    }

    function getDatasourceType(dsName) {
        const live = freeboard.getLiveModel?.();
        if (!live || typeof live.datasources !== 'function') return null;
        const ds = live.datasources().find(d => {
            try { return d.name() === dsName; } catch (e) { return false; }
        });
        return (ds && ds.type) ? ds.type() : null;
    }

    function isThingSetType(dsType) {
        return dsType === 'thingset_serial_datasource' || dsType === 'owntech_thingset_datasource';
    }

    class ToggleButton {
        constructor(settings) {
            this.settings = settings;
            this.serialApi = window.api && window.api.serial ? window.api.serial : null;
            this.ipcRenderer = !this.serialApi && window.require ? window.require("electron")?.ipcRenderer : null;
            this._isOn = false;

            this.container = $('<div class="toggle-button-widget d-flex flex-column align-items-center justify-content-center gap-1"></div>');
            this.titleElement = $('<div class="toggle-button-title"></div>');
            this.row = $('<div class="d-flex align-items-center gap-2"></div>');
            this.switchEl = $('<button type="button" class="toggle-switch"><span class="toggle-switch-knob"></span></button>');
            this.stateLabel = $('<span class="toggle-switch-label">OFF</span>');

            if (freeboard && typeof freeboard.addStyle === 'function') {
                freeboard.addStyle('.toggle-switch', 'position:relative;width:48px;height:24px;border-radius:12px;background:#555;border:none;cursor:pointer;padding:0;transition:background .15s ease;');
                freeboard.addStyle('.toggle-switch.is-on', 'background:#22c55e;');
                freeboard.addStyle('.toggle-switch-knob', 'position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .15s ease;');
                freeboard.addStyle('.toggle-switch.is-on .toggle-switch-knob', 'left:26px;');
                freeboard.addStyle('.toggle-switch-label', 'font-weight:bold;min-width:2em;');
            }

            this.switchEl.on('click', () => this._toggle());
        }

        render(containerElement) {
            if (!this._built) {
                this.row.append(this.switchEl, this.stateLabel);
                this.container.append(this.titleElement, this.row);
                this._built = true;
                this._bindRadialContextMenu();
            }
            $(containerElement).empty().append(this.container);
            this._applySettings();
        }

        // Milestone 7 of docs/GUI/02-navigation_overhaul.md: this is a
        // write-only widget -- the radial's job is picking the write target,
        // not editing a displayed value. Right-click drills any of the
        // Buttons-relevant datasource types; picking a leaf sets `datasource`
        // to that datasource, and additionally `writePath` when it's a
        // ThingSet type (the only case where a specific leaf variable, not
        // just the datasource itself, is the actual write target).
        _bindRadialContextMenu() {
            this.container.on('contextmenu', (e) => {
                if (!window.RadialContextMenu) return;
                e.preventDefault();
                e.stopPropagation();
                const kit = window.RadialWidgetKit;
                window.RadialContextMenu.show({
                    x: e.clientX, y: e.clientY,
                    root: kit.buildChannelMenuRoot({
                        includeTypes: ['serialport_datasource', 'fast_frame_datasource', 'thingset_serial_datasource', 'owntech_thingset_datasource'],
                        onLeafSelect: (def) => this._quickSetWriteTarget(def)
                    })
                });
            });
        }

        _quickSetWriteTarget(def) {
            const patch = { datasource: def.ds };
            if (isThingSetType(def.type)) patch.writePath = def.var;
            window.RadialWidgetKit.quickSetSettings(window.RadialWidgetKit.findWidgetModel(this), patch);
        }

        _applySettings() {
            const hasTitle = !_.isUndefined(this.settings.title) && this.settings.title !== "";
            this.titleElement.text(hasTitle ? this.settings.title : "").toggle(hasTitle);
        }

        _toggle() {
            this._isOn = !this._isOn;
            this._updateVisualState();
            this._send(this._isOn ? 'on' : 'off');
        }

        _updateVisualState() {
            this.switchEl.toggleClass('is-on', this._isOn);
            this.stateLabel.text(this._isOn ? 'ON' : 'OFF');
        }

        _send(kind) {
            const dsType = getDatasourceType(this.settings.datasource);
            if (isThingSetType(dsType)) {
                this._sendThingSetValue(kind);
            } else {
                this._sendCommand(kind === 'on' ? this.settings.onCommand : this.settings.offCommand);
            }
        }

        _sendThingSetValue(kind) {
            const path = this.settings.writePath;
            if (!path || !window.ThingSetWrite) return;
            const raw = kind === 'on' ? this.settings.onValue : this.settings.offValue;
            const value = window.ThingSetValueParse ? window.ThingSetValueParse.parseInputValue(raw) : raw;
            window.ThingSetWrite.write({ datasource: this.settings.datasource, path, value });
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

        onSettingsChanged(newSettings) {
            this.settings = newSettings;
            this._applySettings();
        }

        onDispose() {
        }

        getHeight() {
            return 1;
        }
    }
})();
