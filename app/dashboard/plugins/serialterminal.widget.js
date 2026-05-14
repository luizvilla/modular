(function () {
    freeboard.loadWidgetPlugin({
        type_name: "serial_terminal",
        display_name: "Serial Terminal",
        description: "Show live data from a serial datasource",
        icon: "terminal",
        settings: [
            { name: "title", display_name: "Title", type: "text" },
            // Use a live options provider so the widget settings modal shows a datasource dropdown.
            { name: "datasourceName", display_name: "Datasource Name", type: "option", options: getSerialDatasourceOptions, optionsRefreshMs: 1000 },
            { name: "colorize", display_name: "Colorize", type: "boolean", default_value: true },
            { name: "autoScroll", display_name: "Auto-scroll", type: "boolean", default_value: true },
            { name: "refresh", display_name: "Refresh (ms)", type: "number", default_value: 500 },
            { name: "maxLines", display_name: "Max Lines", type: "number", default_value: 100 }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new SerialTerminal(settings));
        }
    });

    // Provide a datasource list for the widget settings dropdown.
    function getSerialDatasourceOptions() {
        const live = freeboard.getLiveModel?.();
        if (!live || typeof live.datasources !== 'function') return [];
        const allowedTypes = new Set(['serialport_datasource', 'fast_frame_datasource', 'thingset_serial_datasource']);
        const options = [];
        live.datasources().forEach(ds => {
            try {
                if (ds.type && allowedTypes.has(ds.type())) {
                    const name = ds.name();
                    options.push({ name, value: name });
                }
            } catch (e) { /* ignore */ }
        });
        return options;
    }

    class SerialTerminal {
        constructor(settings) {
            this.settings = settings;
            this.serialApi = window.api && window.api.serial ? window.api.serial : null;
            this.ipcRenderer = !this.serialApi && window.require ? window.require("electron")?.ipcRenderer : null;
            this.timer = null;
            this.colors = [];
            this.lastColorCheck = 0;
            this.container = $('<div class="d-flex flex-column h-100 gap-2 overflow-auto"></div>');
            this.dsSelect = $('<select class="form-select form-select-sm flex-fill"></select>');
            const colorId = `chk_${Math.random().toString(36).slice(2)}`;
            this.colorCheck = $('<input class="form-check-input mt-0" type="checkbox">').attr('id', colorId);
            const scrollId = `chk_${Math.random().toString(36).slice(2)}`;
            this.autoScrollCheck = $('<input class="form-check-input mt-0" type="checkbox">').attr('id', scrollId);
            if (freeboard && typeof freeboard.addStyle === 'function') {
                // Align the toggle labels/boxes when rendered side by side.
                freeboard.addStyle('.serial-terminal-toggle .input-group-text', 'min-width:120px;justify-content:center;');
            }
            const colorWrapper = $('<div class="input-group input-group-sm"></div>');
            const colorLabel = $(`<label class="input-group-text" for="${colorId}">Colorize</label>`);
            const colorBox = $('<span class="input-group-text"></span>').append(this.colorCheck);
            colorWrapper.append(colorLabel).append(colorBox);
            const scrollWrapper = $('<div class="input-group input-group-sm"></div>');
            const scrollLabel = $(`<label class="input-group-text" for="${scrollId}">Auto-scroll</label>`);
            const scrollBox = $('<span class="input-group-text"></span>').append(this.autoScrollCheck);
            scrollWrapper.append(scrollLabel).append(scrollBox);
            const toggleRow = $('<div class="d-flex flex-wrap gap-2 mb-1 serial-terminal-toggle"></div>');
            toggleRow.append(colorWrapper, scrollWrapper);
            this.codeEl = $('<code></code>');
            this.preEl = $(
                '<pre class="serial-terminal border border-secondary rounded bg-dark text-light p-2" ' +
                'style="overflow:auto; flex:1; margin:0;"></pre>'
            ).append(this.codeEl);
            const dsRow = $('<div class="input-group input-group-sm mb-1"></div>');
            dsRow.append('<span class="input-group-text">Datasource</span>', this.dsSelect);
            this.container.append(dsRow, toggleRow, this.preEl);
            this._configHandler = () => this._refreshDatasourceOptions();
            freeboard.on && freeboard.on('config_updated', this._configHandler);
        }

        render(containerElement) {
            $(containerElement).append(this.container);
            this._refreshDatasourceOptions();
            this.dsSelect.off('change.serial-terminal').on('change.serial-terminal', () => {
                this.settings.datasourceName = this.dsSelect.val();
                this._refreshColors(true);
            });
            this.colorCheck.off('change.serial-terminal').on('change.serial-terminal', () => {
                this.settings.colorize = this.colorCheck.prop('checked');
            });
            this.autoScrollCheck.off('change.serial-terminal').on('change.serial-terminal', () => {
                this.settings.autoScroll = this.autoScrollCheck.prop('checked');
            });
            this.colorCheck.prop('checked', !!this.settings.colorize);
            this.autoScrollCheck.prop('checked', this.settings.autoScroll !== false);
            this.dsSelect.val(this.settings.datasourceName);
            this._refreshColors(true);
            this._updateTimer();
        }

        async _poll() {
            if ((!this.serialApi && !this.ipcRenderer) || !this.settings.datasourceName) return;
            const ds = freeboard.getDatasourceSettings(this.settings.datasourceName);
            if (!ds || !ds.portPath) return;
            // Keep terminal output stable while the datasource is paused.
            if (ds.paused) return;
            await this._refreshColors();
            try {
                const lines = this.serialApi && this.serialApi.getTerminalBuffer
                    ? await this.serialApi.getTerminalBuffer(ds.portPath)
                    : await this.ipcRenderer.invoke("get-terminal-buffer", { path: ds.portPath });
                if (Array.isArray(lines)) {
                    const max = parseInt(this.settings.maxLines) || 100;
                    const display = lines.slice(-max);
                    if (this.settings.colorize !== false) {
                        const formatted = this._formatLines(display, ds.separator || ":", this.colors);
                        this.codeEl.html(formatted.join("<br/>"));
                    } else {
                        this.codeEl.text(display.join("\n"));
                    }
                    // Auto-scroll by default, but let users disable it.
                    if (this.settings.autoScroll !== false) {
                        this.preEl.scrollTop(this.preEl.prop('scrollHeight'));
                    }
                }
            } catch (e) {
                console.error("Terminal polling failed", e);
            }
        }

        _formatLines(lines, separator, colors = []) {
            return lines.map(line => {
                const parts = line.trim().split(separator).filter(p => p !== "");
                return parts.map((p, idx) => {
                    const color = colors[idx] || (typeof ColorBlind10 !== "undefined" ? ColorBlind10[idx % ColorBlind10.length] : `hsl(${(idx * 60) % 360}, 70%, 50%)`);
                    return `<span style="color:${color}">${p}</span>`;
                }).join(" ");
            });
        }

        async _refreshColors(force = false) {
            const now = Date.now();
            if (!force && now - this.lastColorCheck < 1000) return;
            this.lastColorCheck = now;
            if ((!this.serialApi && !this.ipcRenderer) || !this.settings.datasourceName) {
                this.colors = [];
                return;
            }
            const ds = freeboard.getDatasourceSettings(this.settings.datasourceName) || {};
            const path = ds.portPath || this.settings.datasourceName;
            const type = this._getDatasourceType(this.settings.datasourceName);
            try {
                const fetched = this.serialApi && this.serialApi.getColors
                    ? await this.serialApi.getColors(path, type)
                    : await this.ipcRenderer.invoke('get-serial-colors', { path, type });
                if (Array.isArray(fetched) && fetched.length) {
                    this.colors = fetched;
                    return;
                }
            } catch (e) { /* ignore */ }
            if (Array.isArray(ds.headers)) {
                this.colors = ds.headers.map(h => h.color || null);
            } else {
                this.colors = [];
            }
        }

        _refreshDatasourceOptions() {
            const live = freeboard.getLiveModel?.();
            if (!live || typeof live.datasources !== 'function') return;
            const list = live.datasources();
            const current = this.settings.datasourceName;
            const allowedTypes = new Set(['serialport_datasource', 'fast_frame_datasource', 'thingset_serial_datasource']);
            this.dsSelect.empty();
            list.forEach(ds => {
                try {
                    if (ds.type && allowedTypes.has(ds.type())) {
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

        _getDatasourceType(name) {
            const live = freeboard.getLiveModel?.();
            if (!live || typeof live.datasources !== 'function') return null;
            const list = live.datasources();
            for (const ds of list) {
                try {
                    if (ds.name && ds.name() === name) {
                        return ds.type?.();
                    }
                } catch (e) { /* ignore */ }
            }
            return null;
        }

        _updateTimer() {
            if (this.timer) clearInterval(this.timer);
            const interval = parseInt(this.settings.refresh) || 1000;
            this.timer = setInterval(() => this._poll(), interval);
        }

        onSettingsChanged(newSettings) {
            this.settings = newSettings;
            this.colorCheck.prop('checked', !!this.settings.colorize);
            this.autoScrollCheck.prop('checked', this.settings.autoScroll !== false);
            this._refreshDatasourceOptions();
            this.dsSelect.val(this.settings.datasourceName);
            this._refreshColors(true);
            this._updateTimer();
        }

        onDispose() {
            if (this.timer) clearInterval(this.timer);
            if (this._configHandler && freeboard.off) {
                freeboard.off('config_updated', this._configHandler);
            }
        }

        getHeight() { return 4; }
    }
}());
