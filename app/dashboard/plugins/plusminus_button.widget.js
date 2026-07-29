(function () {
    function getShared() {
        return window.ModularPlotEditorShared
            || (window.freeboard && typeof freeboard.getPlotEditorShared === 'function' ? freeboard.getPlotEditorShared() : null);
    }

    freeboard.loadWidgetPlugin({
        type_name: "plus_minus_button",
        display_name: "+/- Button",
        description: "A +/- button pair that sends serial commands and shows a variable's value",
        icon: "toggle-on",
        category: "Buttons",
        settings: [
            { name: "title", display_name: "Title", type: "text" }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new PlusMinusButton(settings));
        }
    });

    const POLL_MS = 500;

    class PlusMinusButton {
        constructor(settings) {
            this.settings = settings;
            this.shared = getShared();
            this.serialApi = window.api && window.api.serial ? window.api.serial : null;
            this.ipcRenderer = !this.serialApi && window.require ? window.require("electron")?.ipcRenderer : null;

            this.timer = null;
            this._dsSubscription = null;

            this.container = $('<div class="plus-minus-button d-flex align-items-center justify-content-center gap-2"></div>');
            this.minusBtn = $('<button class="btn btn-primary btn-sm plus-minus-btn"></button>');
            this.plusBtn = $('<button class="btn btn-primary btn-sm plus-minus-btn"></button>');
            this.valueWrapper = $('<div class="plus-minus-value-wrapper d-flex flex-column align-items-center"></div>');
            this.titleElement = $('<div class="plus-minus-title"></div>');
            this.valueRow = $('<div class="d-flex align-items-baseline gap-1"></div>');
            this.valueElement = $('<div class="plus-minus-value">--</div>');
            this.unitsElement = $('<span class="plus-minus-units"></span>');

            if (freeboard && typeof freeboard.addStyle === 'function') {
                freeboard.addStyle('.plus-minus-btn', 'font-weight:bold;min-width:2.5em;');
                freeboard.addStyle('.plus-minus-value', 'font-size:24px;font-weight:bold;');
            }

            this.minusBtn.on('click', () => this._sendCommand(this.settings.minusCommand));
            this.plusBtn.on('click', () => this._sendCommand(this.settings.plusCommand));
        }

        render(containerElement) {
            if (!this._built) {
                this.valueRow.append(this.valueElement, this.unitsElement);
                this.valueWrapper.append(this.titleElement, this.valueRow);
                this.container.append(this.minusBtn, this.valueWrapper, this.plusBtn);
                this._built = true;
            }
            $(containerElement).empty().append(this.container);
            this._applySettings();
            this._restartSource();
        }

        _applySettings() {
            const hasTitle = !_.isUndefined(this.settings.title) && this.settings.title !== "";
            this.titleElement.text(hasTitle ? this.settings.title : "").toggle(hasTitle);

            const hasUnits = !_.isUndefined(this.settings.units) && this.settings.units !== "";
            this.unitsElement.text(hasUnits ? this.settings.units : "").toggle(hasUnits);

            // Legend shows the step size on the button (e.g. "+1"); an empty
            // legend renders the bare +/- symbol with no step-size text.
            const plusLegend = this.settings.plusLegend;
            const hasPlusLegend = !_.isUndefined(plusLegend) && plusLegend !== "";
            this.plusBtn.text(hasPlusLegend ? `+${plusLegend}` : "+");

            const minusLegend = this.settings.minusLegend;
            const hasMinusLegend = !_.isUndefined(minusLegend) && minusLegend !== "";
            this.minusBtn.text(hasMinusLegend ? `−${minusLegend}` : "−");
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

        // Source reading mirrors the gauge family's sourceDef mechanism so the
        // "Value Source" picker behaves the same as it does on gauge widgets.
        _getSourceDef() {
            const def = this.settings.sourceDef;
            return (def && def.ds) ? def : null;
        }

        _restartSource() {
            if (this.timer) { clearInterval(this.timer); this.timer = null; }
            if (this._dsSubscription) { this._dsSubscription.dispose(); this._dsSubscription = null; }

            const sourceDef = this._getSourceDef();
            if (!sourceDef) {
                this.valueElement.text('--');
                return;
            }

            if (sourceDef.type === 'serialport_datasource') {
                this._subscribeToSerialDatasource(sourceDef);
            } else {
                this.timer = setInterval(() => this._pollOnce(), POLL_MS);
                this._pollOnce();
            }
        }

        _subscribeToSerialDatasource(sourceDef) {
            try {
                const live = typeof freeboard !== 'undefined' && freeboard.getLiveModel ? freeboard.getLiveModel() : null;
                const dsModel = live?.datasources().find(d => {
                    try { return d.name() === sourceDef.ds; } catch { return false; }
                });
                if (dsModel?.latestData) {
                    this._dsSubscription = dsModel.latestData.subscribe(data => {
                        this._applyDatasourceData(data, sourceDef);
                    });
                    const cur = dsModel.latestData();
                    if (cur) this._applyDatasourceData(cur, sourceDef);
                    return;
                }
            } catch (e) { /* ignore */ }
            this.timer = setInterval(() => this._pollOnce(), POLL_MS);
            this._pollOnce();
        }

        _applyDatasourceData(data, sourceDef) {
            try {
                const idx = Number(sourceDef.var);
                const raw = data ? Number(data[`y${idx + 1}`]) : null;
                if (raw != null && Number.isFinite(raw)) this.valueElement.text(raw);
            } catch (e) { /* ignore */ }
        }

        async _pollOnce() {
            const sourceDef = this._getSourceDef();
            if (!sourceDef) return;
            try {
                const value = await this._readInstantValue(sourceDef);
                if (value != null && Number.isFinite(value)) this.valueElement.text(value);
            } catch (e) { /* ignore */ }
        }

        async _readInstantValue(sourceDef) {
            const shared = this.shared || getShared();
            if (!sourceDef || !sourceDef.ds || !shared || typeof shared.invoke !== 'function') return null;
            if (sourceDef.type === 'serialport_datasource') {
                const dsSettings = shared.getDatasourceSettings(sourceDef.ds) || {};
                const path = dsSettings.portPath || sourceDef.ds;
                const arr = await shared.invoke('get-serial-buffer', { path });
                const idx = Number(sourceDef.var);
                return Array.isArray(arr) ? Number(arr[idx]) : null;
            }
            if (sourceDef.type === 'fast_frame_datasource') {
                const dsSettings = shared.getDatasourceSettings(sourceDef.ds) || {};
                const path = dsSettings.portPath || sourceDef.ds;
                const data = await shared.invoke('get-fast-dataset', { path });
                const idx = Number(sourceDef.var);
                const arr = (data && Array.isArray(data.series) && Array.isArray(data.series[idx])) ? data.series[idx] : [];
                return arr.length ? Number(arr[arr.length - 1]) : null;
            }
            if (sourceDef.type === 'can_datasource') {
                const dsSettings = shared.getDatasourceSettings(sourceDef.ds) || {};
                const channel = dsSettings.channel || 'can0';
                const snap = await shared.invoke('can-aggregate-snapshot', { channel });
                const nodes = snap && snap.nodes ? snap.nodes : {};
                const resolved = this._resolveDeviceKey(nodes, sourceDef.device, sourceDef.device_uid);
                if (!resolved) return null;
                const flat = nodes[resolved] && nodes[resolved].flat ? nodes[resolved].flat : {};
                return Number(flat[sourceDef.var]);
            }
            if (sourceDef.type === 'signal_generator_datasource') {
                const live = window.freeboard && freeboard.getLiveModel ? freeboard.getLiveModel() : null;
                const data = live && live.datasourceData ? live.datasourceData[sourceDef.ds] : null;
                if (data && data.y1 != null) return Number(data.y1);
                if (data && data.value != null) return Number(data.value);
                return null;
            }
            return null;
        }

        _resolveDeviceKey(nodes, desired, desiredUid) {
            if (!nodes) return null;
            if (desired && nodes[desired]) return desired;
            if (desiredUid) {
                const key = Object.keys(nodes).find((candidate) => nodes[candidate] && nodes[candidate].node_uid === desiredUid);
                if (key) return key;
            }
            return Object.keys(nodes)[0] || null;
        }

        onSettingsChanged(newSettings) {
            this.settings = newSettings;
            this._applySettings();
            this._restartSource();
        }

        onDispose() {
            if (this.timer) { clearInterval(this.timer); this.timer = null; }
            if (this._dsSubscription) { this._dsSubscription.dispose(); this._dsSubscription = null; }
        }

        getHeight() {
            return 1;
        }
    }
})();
