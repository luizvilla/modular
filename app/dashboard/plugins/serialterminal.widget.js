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
            { name: "wrapLines", display_name: "Wrap Lines", type: "boolean", default_value: false },
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
            this.headers = [];
            this.lastHeaderCheck = 0;
            this._paused = false;

            this.container = $('<div class="d-flex flex-column h-100 gap-2 overflow-auto"></div>');
            this.dsSelect = $('<select class="form-select form-select-sm flex-fill"></select>');

            const colorId = `chk_${Math.random().toString(36).slice(2)}`;
            this.colorCheck = $('<input class="form-check-input mt-0" type="checkbox">').attr('id', colorId);
            const wrapId = `chk_${Math.random().toString(36).slice(2)}`;
            this.wrapCheck = $('<input class="form-check-input mt-0" type="checkbox">').attr('id', wrapId);
            this.pauseBtn = $('<button class="btn btn-outline-secondary btn-sm">Pause</button>');

            if (freeboard && typeof freeboard.addStyle === 'function') {
                freeboard.addStyle('.serial-terminal-toggle .input-group-text', 'min-width:120px;justify-content:center;');
                freeboard.addStyle('.serial-terminal-header-pre', [
                    'overflow:hidden',
                    'margin:0',
                    'padding:2px 8px',
                    'font-size:inherit',
                    'border:1px solid #6c757d',
                    'border-bottom:none',
                    'border-radius:4px 4px 0 0',
                    'background:#212529',
                    'white-space:pre',
                    'line-height:inherit',
                    'opacity:0.55'
                ].join(';'));
                freeboard.addStyle('.serial-terminal-with-header', 'border-radius:0 0 4px 4px !important;border-top:none !important;');
            }

            const colorWrapper = $('<div class="input-group input-group-sm"></div>');
            colorWrapper.append($(`<label class="input-group-text" for="${colorId}">Colorize</label>`));
            colorWrapper.append($('<span class="input-group-text"></span>').append(this.colorCheck));

            const wrapWrapper = $('<div class="input-group input-group-sm"></div>');
            wrapWrapper.append($(`<label class="input-group-text" for="${wrapId}">Wrap lines</label>`));
            wrapWrapper.append($('<span class="input-group-text"></span>').append(this.wrapCheck));

            const toggleRow = $('<div class="d-flex flex-wrap gap-2 mb-1 serial-terminal-toggle align-items-center"></div>');
            toggleRow.append(colorWrapper, wrapWrapper, this.pauseBtn);

            this.headerCode = $('<code></code>');
            this.headerPre = $('<pre class="serial-terminal-header-pre text-light"></pre>').append(this.headerCode);

            this.codeEl = $('<code></code>');
            this.preEl = $(
                '<pre class="serial-terminal border border-secondary rounded bg-dark text-light p-2" ' +
                'style="overflow:auto; flex:1; margin:0;"></pre>'
            ).append(this.codeEl);

            const dsRow = $('<div class="input-group input-group-sm mb-1"></div>');
            dsRow.append('<span class="input-group-text">Datasource</span>', this.dsSelect);
            this.container.append(dsRow, toggleRow, this.headerPre, this.preEl);
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
            this.wrapCheck.off('change.serial-terminal').on('change.serial-terminal', () => {
                this.settings.wrapLines = this.wrapCheck.prop('checked');
                this._applyWrapStyle();
            });
            this.pauseBtn.off('click.serial-terminal').on('click.serial-terminal', () => {
                this._paused = !this._paused;
                this._syncPauseBtn();
            });

            this.colorCheck.prop('checked', !!this.settings.colorize);
            this.wrapCheck.prop('checked', !!this.settings.wrapLines);
            this.dsSelect.val(this.settings.datasourceName);
            this._applyWrapStyle();
            this._syncPauseBtn();
            this._refreshColors(true);
            this._refreshHeaders(true);
            this._updateTimer();

            // Sync horizontal scroll so header stays aligned with terminal content
            this.preEl.off('scroll.header').on('scroll.header', () => {
                this.headerPre[0].scrollLeft = this.preEl[0].scrollLeft;
            });
        }

        _syncPauseBtn() {
            this.pauseBtn
                .toggleClass('btn-outline-secondary', !this._paused)
                .toggleClass('btn-warning', this._paused)
                .text(this._paused ? 'Resume' : 'Pause');
        }

        _applyWrapStyle() {
            if (this.settings.wrapLines) {
                this.preEl.css({ 'white-space': 'pre-wrap', 'word-break': 'break-all' });
            } else {
                this.preEl.css({ 'white-space': 'pre', 'word-break': '' });
            }
        }

        async _poll() {
            if (this._paused) return;
            if ((!this.serialApi && !this.ipcRenderer) || !this.settings.datasourceName) return;
            const ds = freeboard.getDatasourceSettings(this.settings.datasourceName);
            if (!ds || !ds.portPath) return;
            if (ds.paused) return;
            await this._refreshColors();
            await this._refreshHeaders();
            try {
                const lines = this.serialApi && this.serialApi.getTerminalBuffer
                    ? await this.serialApi.getTerminalBuffer(ds.portPath)
                    : await this.ipcRenderer.invoke("get-terminal-buffer", { path: ds.portPath });
                if (Array.isArray(lines)) {
                    const max = parseInt(this.settings.maxLines) || 100;
                    const display = lines.slice(-max);
                    const separator = ds.separator || ":";
                    if (this.settings.colorize !== false) {
                        const formatted = this._formatLines(display, separator, this.colors);
                        this.codeEl.html(formatted.join("<br/>"));
                    } else {
                        this.codeEl.text(display.join("\n"));
                    }
                    if (display.length) this._buildHeader(display[display.length - 1], separator);
                    this.preEl.scrollTop(this.preEl.prop('scrollHeight'));
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
                    const trimmed = p.trim();
                    // Keep numeric columns aligned when values alternate between positive and
                    // negative: positive numbers get a leading space to match the '-' width.
                    const isNumeric = /^-?[\d.]+(?:[eE][+-]?\d+)?$/.test(trimmed);
                    const display = isNumeric && !trimmed.startsWith('-') ? ' ' + trimmed : trimmed;
                    return `<span style="color:${color}">${display}</span>`;
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

        async _refreshHeaders(force = false) {
            const now = Date.now();
            if (!force && now - this.lastHeaderCheck < 1000) return;
            this.lastHeaderCheck = now;
            if ((!this.serialApi && !this.ipcRenderer) || !this.settings.datasourceName) {
                this.headers = [];
                return;
            }
            const ds = freeboard.getDatasourceSettings(this.settings.datasourceName) || {};
            const path = ds.portPath || this.settings.datasourceName;
            const type = this._getDatasourceType(this.settings.datasourceName);
            try {
                const fetched = this.serialApi && this.serialApi.getHeaders
                    ? await this.serialApi.getHeaders(path, type)
                    : await this.ipcRenderer.invoke('get-serial-headers', { path, type });
                this.headers = Array.isArray(fetched) ? fetched : [];
            } catch (e) {
                this.headers = [];
            }
        }

        _buildHeader(sampleLine, separator) {
            const parts = sampleLine.trim().split(separator).filter(p => p !== '');
            const colCount = Math.max(this.headers.length, parts.length);
            if (!colCount) { this.headerCode.empty(); return; }

            const spans = [];
            for (let i = 0; i < colCount; i++) {
                const alpha = String.fromCharCode(65 + (i % 26));
                const sfx = i >= 26 ? ' ' + (Math.floor(i / 26) + 1) : '';
                const defaultLabel = 'Channel ' + alpha + sfx;
                const label = (this.headers[i] || '').trim() || defaultLabel;

                // Mirror the display-width logic from _formatLines so columns line up
                let fieldWidth = label.length;
                if (i < parts.length) {
                    const trimmed = parts[i].trim();
                    const isNumeric = /^-?[\d.]+(?:[eE][+-]?\d+)?$/.test(trimmed);
                    const display = isNumeric && !trimmed.startsWith('-') ? ' ' + trimmed : trimmed;
                    fieldWidth = Math.max(fieldWidth, display.length);
                }

                const color = this.colors[i] || (typeof ColorBlind10 !== 'undefined'
                    ? ColorBlind10[i % ColorBlind10.length]
                    : `hsl(${(i * 60) % 360}, 70%, 50%)`);

                const padded = label.length > fieldWidth
                    ? label.slice(0, fieldWidth)
                    : label.padEnd(fieldWidth);

                spans.push(`<span style="color:${color}">${padded}</span>`);
            }

            // Show header pre only when there is content, and round terminal top accordingly
            if (spans.length) {
                this.headerCode.html(spans.join(' '));
                this.headerPre.show();
                this.preEl.addClass('serial-terminal-with-header');
            } else {
                this.headerPre.hide();
                this.preEl.removeClass('serial-terminal-with-header');
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
            this.wrapCheck.prop('checked', !!this.settings.wrapLines);
            this._applyWrapStyle();
            this._refreshDatasourceOptions();
            this.dsSelect.val(this.settings.datasourceName);
            this._refreshColors(true);
            this._refreshHeaders(true);
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
