(function () {
    const treeWalk = window.ThingSetTreeWalk;
    const SCOPE_STATE_NAMES = ['IDLE', 'ARMED', 'TRIGGERED', 'READY'];
    const DECIMATIONS = [1, 10, 100];

    freeboard.loadWidgetPlugin({
        type_name: 'owntech_scope_capture',
        display_name: 'OwnTech Scope Capture',
        description: 'Arm/trigger and download a decimated software-scope capture over the if00 side-channel.',
        icon: 'wave-square',
        category: 'OwnTech',
        settings: [
            { name: 'title', display_name: 'Title', type: 'text' },
            {
                name: 'datasource',
                display_name: 'ThingSet Datasource (arm/trigger/status)',
                type: 'option',
                options: getThingSetDatasourceOptions,
                optionsRefreshMs: 1000
            },
            {
                name: 'scopeSerialPort',
                display_name: 'Scope Data Port (if00)',
                type: 'option',
                // if00 is a plain data port, not a ThingSet shell -- it can't be
                // auto-discovered the way if02 is, so this is a manual picker
                // over the same port list every serial datasource uses.
                options: getScopeSerialPortOptions,
                optionsRefreshMs: 2000
            }
        ],
        newInstance(settings, newInstanceCallback) {
            newInstanceCallback(new OwnTechScopeCapture(settings));
        }
    });

    function getThingSetDatasourceOptions() {
        const live = freeboard.getLiveModel?.();
        if (!live || typeof live.datasources !== 'function') return [];
        const options = [];
        live.datasources().forEach((ds) => {
            try {
                const type = ds.type && ds.type();
                if (type === 'thingset_serial_datasource' || type === 'owntech_thingset_datasource') {
                    const name = ds.name();
                    options.push({ name, value: name });
                }
            } catch (e) { /* ignore */ }
        });
        return options;
    }

    // Same -if00 USB interface classification thingset/main.js's
    // isIf00Candidate() uses for auto-detect ordering (confirmed against real
    // Core4 hardware -- ttyACM0/if00 is always the scope bulk-transfer
    // side-channel). ts-serial-detect deprioritizes it (it's never a ThingSet
    // shell); this picker wants the opposite ordering, since if00 is exactly
    // what this field is asking the user to pick.
    const IF00_SUFFIX_RE = /-if00$/i;
    function isIf00Port(port) {
        return IF00_SUFFIX_RE.test(String(port?.pnpId || ''));
    }

    // The generic settings-dialog "option" provider (freeboard.js's
    // resolveOptions()) calls this synchronously and only accepts a plain
    // array back -- an async function's returned Promise fails the
    // _.isArray() check and silently renders an empty dropdown. Serial port
    // enumeration is inherently async (an IPC round-trip), so this keeps a
    // background-refreshed cache and returns whatever's already in it,
    // exactly like the datasource/pnpId-style pickers elsewhere in this
    // codebase read a live, already-populated in-memory source synchronously.
    let scopeSerialPortCache = [];
    function refreshScopeSerialPortCache() {
        const serialApi = window.api && window.api.serial ? window.api.serial : null;
        if (!serialApi || typeof serialApi.listPorts !== 'function') return;
        serialApi.listPorts().then((ports) => {
            const list = Array.isArray(ports) ? ports : [];
            scopeSerialPortCache = list
                .map((p, index) => ({ p, index }))
                .sort((a, b) => (Number(isIf00Port(b.p)) - Number(isIf00Port(a.p))) || (a.index - b.index))
                .map(({ p }) => {
                    const value = p.value || p.name || p.path || String(p);
                    const label = isIf00Port(p) ? `${p.name || value} (likely if00)` : (p.name || value);
                    return { name: label, value };
                });
        }).catch(() => { /* keep last-known-good cache on failure */ });
    }
    refreshScopeSerialPortCache();

    function getScopeSerialPortOptions() {
        refreshScopeSerialPortCache(); // fire-and-forget refresh for the next call
        return scopeSerialPortCache;
    }

    class OwnTechScopeCapture {
        constructor(settings) {
            this.settings = settings || {};
            this.scopeApi = window.api && window.api.owntechScope ? window.api.owntechScope : null;
            this._dsSubscription = null;
            this._progressUnsub = null;
            this._downloading = false;
            this._lastCapture = null;
            this._plot = null;

            this.container = $('<div class="d-flex flex-column h-100 gap-2 overflow-auto p-2"></div>');
            this.statusLine = $('<div class="small text-muted">—</div>');
            this.actionsWrap = $('<div class="d-flex flex-wrap gap-1"></div>');

            this.decimationSelect = $('<select class="form-select form-select-sm" style="width:auto"></select>');
            DECIMATIONS.forEach((d) => this.decimationSelect.append(`<option value="${d}">${d}</option>`));
            this.pretriggerInput = $('<input type="number" step="0.1" min="0" max="0.9" class="form-control form-control-sm" style="width:5rem">');
            this.configRow = $('<div class="d-flex align-items-center gap-2"></div>');
            this.configRow.append(
                '<span class="small text-muted">Decimation</span>', this.decimationSelect,
                '<span class="small text-muted">Pre-trigger ratio</span>', this.pretriggerInput
            );

            this.downloadBtn = $('<button type="button" class="btn btn-primary btn-sm" disabled>Download</button>');
            this.saveCsvBtn = $('<button type="button" class="btn btn-outline-secondary btn-sm" disabled>Save CSV</button>');
            this.downloadRow = $('<div class="d-flex align-items-center gap-2"></div>').append(this.downloadBtn, this.saveCsvBtn);

            this.plotHost = $('<div class="flex-fill" style="min-height:180px"></div>');

            this.decimationSelect.on('change', () => this._writeScopePath('/Debug/Scope/wDecimation', parseInt(this.decimationSelect.val(), 10)));
            this.pretriggerInput.on('change', () => this._writeScopePath('/Debug/Scope/wPretriggerRatio', parseFloat(this.pretriggerInput.val()) || 0));
            this.downloadBtn.on('click', () => this._download());
            this.saveCsvBtn.on('click', () => this._saveCsv());
        }

        render(el) {
            if (!this._built) {
                this.container.append(this.statusLine, this.actionsWrap, this.configRow, this.downloadRow, this.plotHost);
                this._built = true;
            }
            $(el).empty().append(this.container);
            this._subscribeToDatasource();
            this._updateFromTree();
        }

        _dsModel() {
            const live = typeof freeboard !== 'undefined' && freeboard.getLiveModel ? freeboard.getLiveModel() : null;
            if (!live || typeof live.datasources !== 'function') return null;
            return live.datasources().find((d) => {
                try { return d.name() === this.settings.datasource; } catch (e) { return false; }
            }) || null;
        }

        _subscribeToDatasource() {
            if (this._dsSubscription) { this._dsSubscription.dispose(); this._dsSubscription = null; }
            const dsModel = this._dsModel();
            if (dsModel && dsModel.latestData && dsModel.latestData.subscribe) {
                this._dsSubscription = dsModel.latestData.subscribe(() => this._updateFromTree());
            }
        }

        _latestData() {
            const dsModel = this._dsModel();
            return (dsModel && dsModel.latestData) ? (dsModel.latestData() || {}) : {};
        }

        _scopeNode() {
            const tree = this._latestData().tree;
            return tree && tree.children && tree.children.Debug && tree.children.Debug.children
                ? tree.children.Debug.children.Scope
                : null;
        }

        _updateFromTree() {
            if (!this.settings.datasource) {
                this.statusLine.text('Select a ThingSet datasource in the widget settings.');
                this.downloadBtn.prop('disabled', true);
                this._renderActions(null);
                return;
            }
            const values = this._latestData().values || {};
            const stateNum = values['/Debug/Scope/rState'];
            const stateName = SCOPE_STATE_NAMES[stateNum] || 'Unknown';
            this.statusLine.text(`Status: ${stateName}`);
            this.downloadBtn.prop('disabled', this._downloading || stateNum !== 3);

            const decimationVal = values['/Debug/Scope/wDecimation'];
            if (decimationVal != null && String(decimationVal) !== this.decimationSelect.val()) {
                this.decimationSelect.val(String(decimationVal));
            }
            const pretriggerVal = values['/Debug/Scope/wPretriggerRatio'];
            if (pretriggerVal != null && document.activeElement !== this.pretriggerInput.get(0)) {
                this.pretriggerInput.val(pretriggerVal);
            }

            this._renderActions(this._scopeNode());
        }

        // Arm/Trigger buttons are discovery-driven (Milestone 4's
        // findBooleanActionLeaves, scoped to /Debug/Scope instead of
        // /Config/LegN) rather than hardcoded wArm/wTrigger paths.
        _renderActions(scopeNode) {
            this.actionsWrap.empty();
            if (!scopeNode || !treeWalk) {
                this.actionsWrap.append('<div class="small text-muted">No /Debug/Scope group discovered yet -- rescan the linked datasource once connected.</div>');
                return;
            }
            const leaves = treeWalk.findBooleanActionLeaves(scopeNode);
            if (!leaves.length) {
                this.actionsWrap.append('<div class="small text-muted">No writable action leaves discovered under /Debug/Scope.</div>');
                return;
            }
            leaves.forEach((leaf) => {
                const btn = $('<button type="button" class="btn btn-outline-primary btn-sm"></button>').text(leaf.name);
                btn.on('click', () => this._writeScopePath(leaf.path, true));
                this.actionsWrap.append(btn);
            });
        }

        // Writes, then refreshes the linked datasource's values so the status
        // line (and the Download button's enabled state) reflect the new
        // rState. wArm/wTrigger are one-shot: the firmware clears them once
        // acted on, so their readback is false on success -- only the write's
        // own ok decides failure.
        async _writeScopePath(path, value) {
            if (!path || !window.ThingSetWrite) return;
            const res = await window.ThingSetWrite.write({ datasource: this.settings.datasource, path, value, refresh: true });
            if (!res.ok) this.statusLine.text(`Write failed: ${res.error}`);
        }

        async _download() {
            if (!this.scopeApi || typeof this.scopeApi.download !== 'function' || this._downloading) return;
            const port = this.settings.scopeSerialPort;
            if (!port) {
                this.statusLine.text('Select a Scope Data Port (if00) in the widget settings.');
                return;
            }
            this._downloading = true;
            this.downloadBtn.prop('disabled', true).text('Downloading…');
            if (typeof this.scopeApi.onProgress === 'function') {
                this._progressUnsub = this.scopeApi.onProgress((progress) => {
                    if (!progress || progress.port !== port) return;
                    const pct = progress.total ? Math.round((progress.received / progress.total) * 100) : 0;
                    this.downloadBtn.text(`Downloading… ${pct}%`);
                });
            }
            try {
                if (typeof this.scopeApi.probe === 'function') await this.scopeApi.probe({ port });
                const result = await this.scopeApi.download({ port });
                this._lastCapture = result;
                this._renderPlot(result);
                this.saveCsvBtn.prop('disabled', false);
                this.statusLine.text(`Downloaded ${result.samples.length} samples across ${result.channels.length} channels.`);
            } catch (err) {
                this.statusLine.text(`Download failed: ${err?.message || err}`);
            } finally {
                this._downloading = false;
                this.downloadBtn.text('Download');
                if (this._progressUnsub) { this._progressUnsub(); this._progressUnsub = null; }
                // Re-derive just the button's enabled state from the last-known
                // tree data -- NOT the full _updateFromTree(), which would
                // immediately overwrite the success/failure message above with
                // "Status: ..." before the user ever sees it.
                const values = this._latestData().values || {};
                this.downloadBtn.prop('disabled', values['/Debug/Scope/rState'] !== 3);
            }
        }

        _renderPlot(result) {
            this.plotHost.empty();
            this._plot = null;
            if (!window.uPlot || !result || !Array.isArray(result.samples) || !result.samples.length) return;
            const channels = result.channels || [];
            const samplePeriodUs = Number((this._latestData().values || {})['/Debug/Scope/rSamplePeriod_us']) || 100;
            const xs = result.samples.map((_, i) => (i * samplePeriodUs) / 1e6);
            const seriesData = [xs];
            const seriesOpts = [{}];
            const colors = ['#4e79a7', '#e15759', '#59a14f', '#f28e2b', '#b07aa1', '#76b7b2', '#edc948', '#ff9da7'];
            channels.forEach((name, idx) => {
                seriesData.push(result.samples.map((row) => row[idx]));
                seriesOpts.push({ label: name, stroke: colors[idx % colors.length], width: 1 });
            });
            const opts = {
                width: this.plotHost.width() || 400,
                height: Math.max(160, this.plotHost.height() || 200),
                series: seriesOpts,
            };
            this._plot = new window.uPlot(opts, seriesData, this.plotHost.get(0));
        }

        _csvEscape(value) {
            const str = value === null || value === undefined ? '' : String(value);
            return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
        }

        async _saveCsv() {
            const result = this._lastCapture;
            if (!result) return;
            const header = ['sample_index', ...result.channels];
            const rows = [header, ...result.samples.map((row, i) => [i, ...row])];
            const content = rows.map((row) => row.map((v) => this._csvEscape(v)).join(',')).join('\r\n');
            const filename = `owntech-scope-${Date.now()}.csv`;
            const filesApi = window.api && window.api.files ? window.api.files : null;
            if (filesApi && typeof filesApi.saveExportCsv === 'function') {
                try {
                    const res = await filesApi.saveExportCsv('owntech_scope_csv', filename, content);
                    if (res && res.ok) return;
                } catch (e) { /* fall through to browser download */ }
            }
            const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
            const a = document.createElement('a');
            a.href = window.URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(a.href);
        }

        onSettingsChanged(newSettings) {
            this.settings = newSettings || {};
            this._subscribeToDatasource();
            this._updateFromTree();
        }

        onDispose() {
            if (this._dsSubscription) { this._dsSubscription.dispose(); this._dsSubscription = null; }
            if (this._progressUnsub) { this._progressUnsub(); this._progressUnsub = null; }
            if (this.scopeApi && this.settings.scopeSerialPort && typeof this.scopeApi.close === 'function') {
                this.scopeApi.close({ port: this.settings.scopeSerialPort }).catch(() => {});
            }
        }

        getHeight() {
            return 8;
        }
    }
})();
