(function () {
    // Milestone 11 of docs/GUI/02-navigation_overhaul.md: every variable the
    // board exposes, as its ThingSet hierarchy. Rendered from the linked
    // datasource's already-walked tree (no serial traffic of its own); the
    // model (owntech_variable_table_model.js) owns naming conventions,
    // formatting and filtering.
    const Model = window.OwntechVariableTableModel;

    freeboard.loadWidgetPlugin({
        type_name: 'owntech_variable_table',
        display_name: 'OwnTech Variable Table',
        description: 'Every variable the board exposes, grouped as its ThingSet tree, with live values, units and access.',
        icon: 'table-list',
        category: 'OwnTech',
        settings: [
            { name: 'title', display_name: 'Title', type: 'text' },
            {
                name: 'datasource',
                display_name: 'Datasource Name',
                type: 'option',
                options: getThingSetDatasourceOptions,
                optionsRefreshMs: 1000
            },
            { name: 'showInternal', display_name: 'Show internal (_) nodes', type: 'boolean', default_value: false }
        ],
        newInstance: function (settings, newInstanceCallback) {
            newInstanceCallback(new OwnTechVariableTable(settings));
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

    const FILTERS = [
        { id: 'all', label: 'All' },
        { id: 'writable', label: 'Writable' },
        { id: 'readonly', label: 'Read-only' },
        { id: 'changed', label: 'Changed' },
    ];
    const FLASH_MS = 900;

    let stylesAdded = false;
    function addStyles() {
        if (stylesAdded || !freeboard || typeof freeboard.addStyle !== 'function') return;
        stylesAdded = true;
        const s = (sel, css) => freeboard.addStyle(sel, css);
        s('.ovt', 'display:flex;flex-direction:column;height:100%;min-height:0;font-size:13px;');
        s('.ovt-toolbar', 'flex:0 0 auto;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--bs-border-color);');
        // The app's Bootstrap overrides size inputs/buttons for forms; the
        // table's toolbar is denser.
        s('.ovt .btn', 'padding:1px 8px;font-size:12px;line-height:1.6;min-width:0 !important;min-height:0 !important;width:auto !important;height:24px !important;');
        s('.ovt input.ovt-search', 'flex:1 1 140px;min-width:120px;max-width:260px;padding:2px 8px;font-size:12px;height:24px !important;');
        s('.ovt-status', 'flex:0 0 auto;padding:3px 8px;color:var(--bs-secondary-color);font-size:11px;border-bottom:1px solid var(--bs-border-color);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;');
        s('.ovt-scroll', 'flex:1 1 auto;min-height:0;overflow:auto;');
        s('.ovt-table', 'width:100%;border-collapse:collapse;table-layout:fixed;');
        s('.ovt-table th', 'position:sticky;top:0;z-index:1;background:var(--bs-tertiary-bg);color:var(--bs-secondary-color);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding:4px 8px;text-align:left;border-bottom:1px solid var(--bs-border-color);');
        s('.ovt-table td', 'padding:3px 8px;border-bottom:1px solid var(--bs-border-color-translucent);vertical-align:middle;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;');
        s('.ovt-col-value', 'width:34%;');
        s('.ovt-col-unit', 'width:56px;');
        s('.ovt-col-access', 'width:96px;');
        s('.ovt-group', 'cursor:pointer;background:var(--bs-tertiary-bg);');
        s('.ovt-group:hover', 'background:var(--bs-secondary-bg);');
        s('.ovt-group .ovt-name', 'font-weight:600;color:var(--bs-emphasis-color);');
        s('.ovt-group[data-depth="0"] .ovt-name', 'text-transform:none;font-size:13.5px;');
        s('.ovt-summary', 'color:var(--bs-secondary-color);font-size:11px;font-weight:400;margin-left:8px;');
        s('.ovt-chevron', 'display:inline-block;width:14px;color:var(--bs-secondary-color);transition:transform .12s;');
        s('.ovt-group.ovt-collapsed .ovt-chevron', 'transform:rotate(-90deg);');
        s('.ovt-var:hover', 'background:var(--bs-secondary-bg);');
        s('.ovt-var .ovt-name', 'color:var(--bs-body-color);');
        s('.ovt-caveat', 'color:var(--bs-warning);margin-left:6px;font-size:11px;');
        s('.ovt-power', 'color:var(--bs-warning-text-emphasis);margin-left:6px;font-size:10px;opacity:.8;');
        s('.ovt-value', 'font-family:var(--bs-font-monospace);color:var(--bs-emphasis-color);');
        s('.ovt-value.ovt-num', 'font-variant-numeric:tabular-nums;');
        s('.ovt-value .ovt-muted', 'color:var(--bs-secondary-color);');
        s('.ovt-pill', 'display:inline-block;padding:0 7px;border-radius:9px;font-size:11px;font-family:var(--bs-body-font-family);border:1px solid var(--bs-border-color);');
        s('.ovt-pill-true', 'background:rgba(var(--bs-success-rgb),.18);border-color:rgba(var(--bs-success-rgb),.55);color:var(--bs-success-text-emphasis);');
        s('.ovt-pill-false', 'color:var(--bs-secondary-color);');
        s('.ovt-chip', 'display:inline-block;padding:0 6px;border-radius:4px;background:var(--bs-secondary-bg);color:var(--bs-secondary-color);font-size:11px;');
        s('.ovt-flash', 'animation:ovt-flash ' + FLASH_MS + 'ms ease-out;');
        s('@keyframes ovt-flash', '0%{background:rgba(var(--bs-info-rgb),.35);}100%{background:transparent;}');
        s('.ovt-unit', 'color:var(--bs-secondary-color);');
        s('.ovt-badge', 'display:inline-block;padding:1px 6px;border-radius:4px;font-size:10.5px;font-weight:600;border:1px solid transparent;');
        s('.ovt-badge-read, .ovt-badge-constant, .ovt-badge-record, .ovt-badge-function, .ovt-badge-internal', 'color:var(--bs-secondary-color);border-color:var(--bs-border-color);');
        s('.ovt-badge-write, .ovt-badge-stored', 'color:var(--bs-primary-text-emphasis);background:rgba(var(--bs-primary-rgb),.15);border-color:rgba(var(--bs-primary-rgb),.45);');
        s('.ovt-badge-control, .ovt-badge-persistent', 'color:var(--bs-info-text-emphasis);background:rgba(var(--bs-info-rgb),.12);border-color:rgba(var(--bs-info-rgb),.4);');
        s('.ovt-badge-unknown', 'color:var(--bs-secondary-color);border:1px dashed var(--bs-border-color);');
        s('.ovt-empty', 'padding:16px;color:var(--bs-secondary-color);text-align:center;');
        s('.ovt-unlocked .ovt-editable', 'cursor:text;');
        s('.ovt-unlocked .ovt-editable:hover', 'outline:1px dashed rgba(var(--bs-primary-rgb),.6);outline-offset:-2px;');
        s('.ovt-unlocked .ovt-editable.ovt-bool', 'cursor:pointer;');
        s('.ovt input.ovt-editor', 'width:100%;padding:0 4px;font-family:var(--bs-font-monospace);font-size:12.5px;background:var(--bs-body-bg);color:var(--bs-emphasis-color);border:1px solid var(--bs-primary);border-radius:3px;outline:none;');
        s('.ovt-editor-error', 'border-color:var(--bs-danger) !important;');
        s('.ovt-result', 'margin-left:8px;font-family:var(--bs-body-font-family);font-size:11px;');
        s('.ovt-result-ok', 'color:var(--bs-success-text-emphasis);');
        s('.ovt-result-fail', 'color:var(--bs-danger-text-emphasis);');
        s('.ovt-result-note', 'color:var(--bs-warning-text-emphasis);');
        s('.ovt-lock.ovt-lock-open', 'color:var(--bs-warning-text-emphasis) !important;border-color:rgba(var(--bs-warning-rgb),.6) !important;background:rgba(var(--bs-warning-rgb),.12) !important;');
        s('.ovt-confirm p', 'margin:0 0 8px;');
        s('.ovt-confirm code', 'font-size:13px;');
        s('.ovt-confirm .ovt-confirm-change', 'font-family:var(--bs-font-monospace);font-size:15px;margin:10px 0;');
    }

    class OwnTechVariableTable {
        constructor(settings) {
            this.settings = settings || {};
            this._dsSubscription = null;
            this.query = '';
            this.filter = 'all';
            // Top-level groups start open, deeper ones closed; the user's
            // toggles then win. A search or filter shows every match.
            this.expanded = new Map(); // group path -> bool
            this.prevValues = new Map(); // path -> last rendered value
            this.changedPaths = new Set(); // paths whose value changed since the widget opened
            this.rows = [];
            this.structureKey = '';
            // Writes are off until unlocked from the toolbar; not saved, so a
            // reload always comes back locked.
            this.unlocked = false;
            this.editingPath = null; // value cell with an open editor
            this.pending = new Set(); // paths with a write in flight
            this.results = new Map(); // path -> { kind, text, title, at } shown next to the value
            addStyles();
            this._build();
        }

        _build() {
            this.container = $('<div class="ovt"></div>');
            const toolbar = $('<div class="ovt-toolbar"></div>');
            this.search = $('<input type="search" class="form-control form-control-sm ovt-search" placeholder="Search name or path…" aria-label="Search variables">');
            this.search.on('input', () => { this.query = this.search.val(); this._render(true); });
            // bootstrap-overrides.css forces input heights with !important.
            ['height:24px', 'padding:2px 8px', 'font-size:12px'].forEach((d) => {
                const [prop, val] = d.split(':');
                this.search[0].style.setProperty(prop, val, 'important');
            });
            const chips = $('<div class="btn-group btn-group-sm" role="group" aria-label="Filter"></div>');
            this.filterButtons = {};
            FILTERS.forEach((f) => {
                const b = $(`<button type="button" class="btn btn-outline-secondary"></button>`).text(f.label).attr('data-filter', f.id);
                b.on('click', () => { this.filter = f.id; this._syncFilterButtons(); this._render(true); });
                this.filterButtons[f.id] = b;
                chips.append(b);
            });
            const expandAll = $('<button type="button" class="btn btn-sm btn-outline-secondary" title="Expand all"><i class="fa-solid fa-angles-down"></i></button>');
            const collapseAll = $('<button type="button" class="btn btn-sm btn-outline-secondary" title="Collapse all"><i class="fa-solid fa-angles-up"></i></button>');
            expandAll.on('click', () => this._setAllExpanded(true));
            collapseAll.on('click', () => this._setAllExpanded(false));
            const refresh = $('<button type="button" class="btn btn-sm btn-outline-secondary" title="Refresh values"><i class="fa-solid fa-rotate"></i></button>');
            const rescan = $('<button type="button" class="btn btn-sm btn-outline-secondary" title="Rescan tree (full walk)"><i class="fa-solid fa-sitemap"></i></button>');
            refresh.on('click', () => { const i = this._dsInstance(); if (i && i.updateNow) i.updateNow(); });
            rescan.on('click', () => { const i = this._dsInstance(); if (i && i.rescan) i.rescan(); else if (i && i.updateNow) i.updateNow(); });
            this.lockBtn = $('<button type="button" class="btn btn-sm btn-outline-secondary ovt-lock"></button>');
            this.lockBtn.on('click', () => { this.unlocked = !this.unlocked; this._syncLock(); });
            this.toolbarRight = $('<div class="d-flex align-items-center gap-1 ms-auto"></div>').append(this.lockBtn, expandAll, collapseAll, refresh, rescan);
            toolbar.append(this.search, chips, this.toolbarRight);
            this.statusLine = $('<div class="ovt-status">—</div>');
            this.scroll = $('<div class="ovt-scroll"></div>');
            this.table = $('<table class="ovt-table"><colgroup><col><col class="ovt-col-value"><col class="ovt-col-unit"><col class="ovt-col-access"></colgroup><thead><tr><th>Name</th><th>Value</th><th>Unit</th><th>Access</th></tr></thead><tbody></tbody></table>');
            this.tbody = this.table.find('tbody');
            this.emptyNote = $('<div class="ovt-empty"></div>');
            this.scroll.append(this.table, this.emptyNote);
            this.container.append(toolbar, this.statusLine, this.scroll);
            this.tbody.on('click', 'tr.ovt-group', (e) => {
                const path = $(e.currentTarget).attr('data-path');
                this.expanded.set(path, !this._isExpanded(path, Number($(e.currentTarget).attr('data-depth'))));
                this._render(true);
            });
            this.tbody.on('click', 'td.ovt-editable', (e) => {
                if (!this.unlocked) return;
                this._beginEdit($(e.currentTarget).closest('tr').attr('data-path'));
            });
            this._bindRadialContextMenu();
            this._syncFilterButtons();
            this._syncLock();
        }

        // Same patterns as M1-M8: right-click a variable for what to do with
        // it, right-click the status line to reassign the datasource.
        _bindRadialContextMenu() {
            this.tbody.on('contextmenu', 'tr.ovt-var', (e) => {
                if (!window.RadialContextMenu) return;
                e.preventDefault();
                e.stopPropagation();
                const row = this.rows.find((r) => r.path === $(e.currentTarget).attr('data-path'));
                if (row) window.RadialContextMenu.show({ x: e.clientX, y: e.clientY, items: this._rowMenuItems(row) });
            });
            this.statusLine.on('contextmenu', (e) => {
                if (!window.RadialContextMenu) return;
                e.preventDefault();
                e.stopPropagation();
                window.RadialContextMenu.show({
                    x: e.clientX, y: e.clientY,
                    items: getThingSetDatasourceOptions().map((opt) => ({
                        id: opt.value, label: opt.name, icon: 'database',
                        onSelect: () => window.RadialWidgetKit.quickSetSetting(window.RadialWidgetKit.findWidgetModel(this), 'datasource', opt.value)
                    }))
                });
            });
        }

        _rowMenuItems(row) {
            const items = [{ id: 'copy', label: 'Copy path', icon: 'copy', description: row.path, onSelect: () => this._copyPath(row.path) }];
            const bound = this._boundWidgetFor(row);
            if (bound) items.push({ id: 'add', label: bound.label, icon: bound.icon, description: `Add ${bound.label.replace(/^Add /, 'a ')} bound to ${row.path} to this pane`, onSelect: () => this._addBoundWidget(row, bound) });
            items.push({ id: 'refresh', label: 'Refresh', icon: 'rotate', description: 'Refresh values from the board', onSelect: () => { const i = this._dsInstance(); if (i && i.updateNow) i.updateNow(); } });
            return items;
        }

        // Which existing widget to bind: writable number -> +/- button,
        // writable boolean -> toggle, read-only number -> gauge.
        _boundWidgetFor(row) {
            const kind = Model.valueKind(row.value);
            if (kind === 'number' && row.access.editable) return { type: 'plus_minus_button', label: 'Add +/− button', icon: 'plus-minus' };
            if (kind === 'bool' && row.access.editable) return { type: 'toggle_button', label: 'Add toggle', icon: 'toggle-on' };
            if (kind === 'number') return { type: 'vertical_gauge', label: 'Add gauge', icon: 'gauge' };
            return null;
        }

        _addBoundWidget(row, bound) {
            const live = freeboard.getLiveModel ? freeboard.getLiveModel() : null;
            const me = window.RadialWidgetKit ? window.RadialWidgetKit.findWidgetModel(this) : null;
            const pane = live && me ? live.panes().find((p) => p.widgets().indexOf(me) >= 0) : null;
            if (!pane || typeof freeboard.addWidgetToPane !== 'function') return;
            const ds = this.settings.datasource;
            const dsType = (this._dsModel() && this._dsModel().type && this._dsModel().type()) || 'owntech_thingset_datasource';
            const sourceDef = { ds, type: dsType, device: null, device_uid: null, var: row.path };
            const title = row.label + (row.unit ? ` (${row.unit})` : '');
            let settings;
            if (bound.type === 'plus_minus_button') {
                const step = Model.stepFor(row.value, row.unit);
                settings = { title, units: row.unit || '', datasource: ds, writePath: row.path, step, sourceDef };
            } else if (bound.type === 'toggle_button') {
                settings = { title, datasource: ds, writePath: row.path, onValue: 'true', offValue: 'false', onCommand: '', offCommand: '' };
            } else {
                const span = Math.max(1, Math.abs(Number(row.value)) * 2);
                settings = { title, min: Number(row.value) < 0 ? -Math.ceil(span) : 0, max: Math.ceil(span), barColor: 'blue', alarmEnabled: false, refreshRate: 200, sourceDef };
            }
            freeboard.addWidgetToPane(pane, bound.type, settings);
            this._flashStatus(`Added ${bound.label.replace(/^Add /, '')} for ${row.path}`);
        }

        _copyPath(path) {
            const done = () => this._flashStatus(`Copied ${path}`);
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(path).then(done, () => this._copyFallback(path, done));
            } else {
                this._copyFallback(path, done);
            }
        }

        _copyFallback(path, done) {
            const ta = $('<textarea style="position:fixed;left:-9999px"></textarea>').val(path).appendTo(document.body);
            ta[0].select();
            try { document.execCommand('copy'); done(); } catch (e) { /* nothing to copy into */ }
            ta.remove();
        }

        _flashStatus(text) {
            this._statusHoldUntil = Date.now() + 2500;
            this.statusLine.text(text);
            clearTimeout(this._statusTimer);
            this._statusTimer = setTimeout(() => this._render(false), 2500);
        }

        _syncLock() {
            this.lockBtn.toggleClass('ovt-lock-open', this.unlocked)
                .html(this.unlocked ? '<i class="fa-solid fa-lock-open"></i> Writes on' : '<i class="fa-solid fa-lock"></i> Locked')
                .attr('title', this.unlocked ? 'Click a writable value to edit it. Click to lock.' : 'Unlock to edit writable values');
            this.container.toggleClass('ovt-unlocked', this.unlocked);
            if (!this.unlocked && this.editingPath) this._endEdit();
        }

        render(el) {
            $(el).empty().append(this.container);
            this._subscribeToDatasource();
            this._render(true);
        }

        _syncFilterButtons() {
            Object.entries(this.filterButtons).forEach(([id, b]) => b.toggleClass('active', id === this.filter));
        }

        _dsModel() {
            const live = typeof freeboard !== 'undefined' && freeboard.getLiveModel ? freeboard.getLiveModel() : null;
            if (!live || typeof live.datasources !== 'function') return null;
            return live.datasources().find((d) => {
                try { return d.name() === this.settings.datasource; } catch (e) { return false; }
            }) || null;
        }

        _dsInstance() {
            const m = this._dsModel();
            return m ? m.datasourceInstance : null;
        }

        _subscribeToDatasource() {
            if (this._dsSubscription) { this._dsSubscription.dispose(); this._dsSubscription = null; }
            const dsModel = this._dsModel();
            if (dsModel && dsModel.latestData && dsModel.latestData.subscribe) {
                this._dsSubscription = dsModel.latestData.subscribe(() => this._render(false));
            }
        }

        _isExpanded(path, depth) {
            return this.expanded.has(path) ? this.expanded.get(path) : depth === 0;
        }

        _setAllExpanded(open) {
            this.rows.filter((r) => r.kind === 'group').forEach((r) => this.expanded.set(r.path, open));
            this._render(true);
        }

        _statusText(data) {
            if (!this.settings.datasource) return 'Select an OwnTech ThingSet datasource in the widget settings.';
            if (!data) return 'Waiting for data…';
            if (data.status === 'no-port') return 'Shell not detected.';
            if (data.status === 'error') return `Error: ${data.error || 'unknown'}`;
            if (data.status !== 'ok') return 'Waiting for data…';
            const vars = this.rows.filter((r) => r.kind === 'variable');
            const node = data.node_name || data.address_hex || data.node_uid || '';
            const time = new Date().toLocaleTimeString();
            const ds = freeboard.getDatasourceSettings(this.settings.datasource) || {};
            const live = ds.autoRefresh === true ? `live every ${Number(ds.refresh) || 1000} ms` : 'live updates off (enable Auto Refresh on the datasource, or use Refresh)';
            return `${data.portPath || ''}${node ? ` · ${node}` : ''} · ${vars.length} variables · ${vars.filter((r) => r.access.editable).length} writable · ${live} · updated ${time}`;
        }

        // force: rebuild the rows' DOM (structure, filter or expansion
        // changed). Otherwise only changed value cells are patched, so a
        // values refresh every ~150ms never disturbs scrolling or an open
        // editor.
        _render(force) {
            const dsModel = this._dsModel();
            const data = dsModel && dsModel.latestData ? dsModel.latestData() : null;
            const tree = data && data.status === 'ok' ? data.tree : null;
            this.rows = tree ? Model.buildRows(tree, { showInternal: !!this.settings.showInternal }) : [];
            // The datasource's values map is what a write's readback updates
            // immediately (ThingSetWrite -> applyWrite), so prefer it.
            const values = (data && data.values) || {};
            this.rows.forEach((r) => { if (r.kind === 'variable' && Object.prototype.hasOwnProperty.call(values, r.path)) r.value = values[r.path]; });
            const changed = this._trackChanges();
            if (!(this._statusHoldUntil > Date.now())) this.statusLine.text(this._statusText(data));
            const key = this.rows.map((r) => r.path).join('|');
            const editing = !!this.editingPath || this.pending.size > 0;
            if (force || key !== this.structureKey || (this.filter === 'changed' && !editing)) {
                this.structureKey = key;
                this._rebuild();
            } else {
                changed.forEach((path) => this._patchValue(path));
            }
        }

        _trackChanges() {
            const changed = [];
            for (const row of this.rows) {
                if (row.kind !== 'variable') continue;
                const next = JSON.stringify(row.value);
                if (this.prevValues.has(row.path) && this.prevValues.get(row.path) !== next) {
                    changed.push(row.path);
                    this.changedPaths.add(row.path);
                }
                this.prevValues.set(row.path, next);
            }
            return changed;
        }

        _rebuild() {
            const scrollTop = this.scroll.scrollTop();
            this.tbody.empty();
            const searching = String(this.query || '').trim() || this.filter !== 'all';
            const visible = Model.visibleRows(this.rows, { query: this.query, filter: this.filter, changedPaths: this.changedPaths });
            const collapsedUnder = [];
            const frag = document.createDocumentFragment();
            for (const row of visible) {
                // Skip rows under a collapsed ancestor (ignored while searching).
                while (collapsedUnder.length && !row.path.startsWith(collapsedUnder[collapsedUnder.length - 1] + '/')) collapsedUnder.pop();
                if (collapsedUnder.length && !searching) continue;
                if (row.kind === 'group') {
                    const open = searching || this._isExpanded(row.path, row.depth);
                    frag.appendChild(this._groupRow(row, open)[0]);
                    if (!open) collapsedUnder.push(row.path);
                } else {
                    frag.appendChild(this._variableRow(row)[0]);
                }
            }
            this.tbody[0].appendChild(frag);
            this.emptyNote.toggle(!visible.length).text(this.rows.length ? 'No variables match.' : (this.settings.datasource ? 'No tree yet — waiting for the datasource.' : 'Select a datasource in the widget settings.'));
            this.scroll.scrollTop(scrollTop);
        }

        _indent(depth, isGroup) {
            return `${8 + depth * 16 + (isGroup ? 0 : 14)}px`;
        }

        _groupRow(row, open) {
            const tr = $('<tr class="ovt-group"></tr>').attr({ 'data-path': row.path, 'data-depth': row.depth, title: row.path }).toggleClass('ovt-collapsed', !open);
            const td = $('<td colspan="4"></td>').css('padding-left', this._indent(row.depth, true));
            td.append('<span class="ovt-chevron"><i class="fa-solid fa-chevron-down fa-xs"></i></span>');
            td.append($('<span class="ovt-name"></span>').text(row.label));
            td.append($('<span class="ovt-summary"></span>').text(Model.groupSummary(row)));
            return tr.append(td);
        }

        _variableRow(row) {
            const tr = $('<tr class="ovt-var"></tr>').attr({ 'data-path': row.path, 'data-depth': row.depth });
            const name = $('<td class="ovt-name-cell"></td>').css('padding-left', this._indent(row.depth, false)).attr('title', `${row.path}\n(${row.name})`);
            name.append($('<span class="ovt-name"></span>').text(row.label));
            if (row.power) name.append($('<i class="fa-solid fa-bolt ovt-power"></i>').attr('title', 'Affects the power stage'));
            if (row.caveat) name.append($('<i class="fa-solid fa-triangle-exclamation ovt-caveat"></i>').attr('title', row.caveat));
            const value = $('<td class="ovt-value"></td>');
            const kind = Model.valueKind(row.value);
            if (row.access.editable && ['bool', 'number', 'string'].includes(kind)) {
                value.addClass('ovt-editable').toggleClass('ovt-bool', kind === 'bool');
            }
            this._fillValue(value, row.value, row.path);
            const unit = $('<td class="ovt-unit"></td>').text(row.unit || '');
            const access = $('<td></td>');
            access.append($(`<span class="ovt-badge ovt-badge-${row.access.key}"></span>`).text(row.access.label));
            return tr.append(name, value, unit, access);
        }

        _fillValue(cell, value, path) {
            const f = Model.formatValue(value);
            cell.empty().toggleClass('ovt-num', f.kind === 'number');
            if (f.kind === 'bool') cell.append($(`<span class="ovt-pill ovt-pill-${value ? 'true' : 'false'}"></span>`).text(f.text));
            else if (f.kind === 'array' || f.kind === 'object') cell.append($('<span class="ovt-chip"></span>').text(f.text).attr('title', JSON.stringify(value)));
            else if (f.kind === 'null') cell.append($('<span class="ovt-muted"></span>').text(f.text));
            else cell.append($('<span></span>').text(f.text)).attr('title', f.kind === 'string' ? f.text : '');
            if (path && this.pending.has(path)) cell.append('<i class="fa-solid fa-spinner fa-spin ovt-result" title="Writing…"></i>');
            const res = path && this.results.get(path);
            if (res && Date.now() - res.at < 8000) {
                cell.append($(`<span class="ovt-result ovt-result-${res.kind}"></span>`).html(res.html).attr('title', res.title || ''));
            }
        }

        _patchValue(path) {
            if (path === this.editingPath) return;
            const row = this.rows.find((r) => r.path === path);
            const tr = this.tbody.find(`tr.ovt-var[data-path="${CSS.escape(path)}"]`);
            if (!row || !tr.length) return;
            const cell = tr.children('.ovt-value');
            this._fillValue(cell, row.value, path);
            cell.removeClass('ovt-flash');
            void cell[0].offsetWidth; // restart the animation
            cell.addClass('ovt-flash');
        }

        _cell(path) {
            return this.tbody.find(`tr.ovt-var[data-path="${CSS.escape(path)}"]`).children('.ovt-value');
        }

        _beginEdit(path) {
            const row = this.rows.find((r) => r.path === path);
            if (!row || !row.access.editable || this.pending.has(path)) return;
            if (this.editingPath && this.editingPath !== path) this._endEdit();
            const kind = Model.valueKind(row.value);
            // A boolean is a switch: one click proposes the flipped value.
            if (kind === 'bool') { this._commit(row, !row.value); return; }
            if (kind !== 'number' && kind !== 'string') return;
            if (this.editingPath === path) return;
            this.editingPath = path;
            const cell = this._cell(path);
            const input = $('<input type="text" class="ovt-editor" spellcheck="false" autocomplete="off">').val(row.value);
            cell.empty().append(input);
            input.trigger('focus').trigger('select');
            input.on('keydown', (e) => {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this._endEdit(); return; }
                if (e.key === 'Enter') {
                    // Stop it here: DialogBox binds Enter on the document to
                    // confirm, and this keypress must not confirm a write.
                    e.preventDefault(); e.stopPropagation();
                    const parsed = Model.parseEditorValue(input.val(), row.value);
                    if (!parsed.ok) { input.addClass('ovt-editor-error').attr('title', parsed.error); return; }
                    this._endEdit();
                    setTimeout(() => this._commit(row, parsed.value), 0);
                    return;
                }
                if (kind === 'number' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                    e.preventDefault();
                    const current = Number(input.val());
                    if (!Number.isFinite(current)) return;
                    const step = Model.stepFor(current, row.unit);
                    const next = current + (e.key === 'ArrowUp' ? step : -step);
                    input.val(Number(next.toPrecision(10))).removeClass('ovt-editor-error');
                }
            });
            input.on('blur', () => { if (this.editingPath === path) this._endEdit(); });
        }

        _endEdit() {
            const path = this.editingPath;
            this.editingPath = null;
            if (!path) return;
            const row = this.rows.find((r) => r.path === path);
            if (row) this._fillValue(this._cell(path), row.value, path);
        }

        _confirm(row, next) {
            return new Promise((resolve) => {
                if (typeof DialogBox !== 'function') { resolve(window.confirm(`Write ${row.path} = ${JSON.stringify(next)}?`)); return; }
                const ds = freeboard.getDatasourceSettings(this.settings.datasource) || {};
                const body = $('<div class="ovt-confirm"></div>');
                body.append($('<p></p>').append('Write ', $('<code></code>').text(row.path), ds.portPath ? ` on ${ds.portPath}?` : '?'));
                body.append($('<div class="ovt-confirm-change"></div>').text(`${Model.formatValue(row.value).text}  →  ${Model.formatValue(next).text}${row.unit ? ' ' + row.unit : ''}`));
                body.append($('<p></p>').html('<i class="fa-solid fa-bolt"></i> This changes what the power stage does.'));
                if (row.caveat) body.append($('<p class="text-warning"></p>').append('<i class="fa-solid fa-triangle-exclamation"></i> ', document.createTextNode(row.caveat)));
                let settled = false;
                const done = (v) => { if (!settled) { settled = true; resolve(v); } };
                new DialogBox(body, 'Confirm write', 'Write', 'Cancel', () => { done(true); });
                // DialogBox has no cancel callback: Cancel, Escape or closing
                // it any other way means no write.
                const watch = setInterval(() => {
                    if (!document.querySelector('#modal_overlay .ovt-confirm')) { clearInterval(watch); done(false); }
                }, 100);
            });
        }

        async _commit(row, next) {
            if (row.power && !(await this._confirm(row, next))) return;
            const path = row.path;
            this.pending.add(path);
            this.results.delete(path);
            this._fillValue(this._cell(path), row.value, path);
            const res = window.ThingSetWrite
                ? await window.ThingSetWrite.write({ datasource: this.settings.datasource, path, value: next, refresh: true })
                : { ok: false, error: 'ThingSet extension not loaded' };
            this.pending.delete(path);
            if (!res.ok) {
                this.results.set(path, { kind: 'fail', html: '<i class="fa-solid fa-xmark"></i> rejected', title: res.error || 'write failed', at: Date.now() });
            } else if (res.readBack !== undefined && res.readBack !== null && JSON.stringify(res.readBack) !== JSON.stringify(next)) {
                // Accepted, but the board holds something else: a clamp
                // (duty < 0.1) or a one-shot flag the firmware cleared.
                this.results.set(path, { kind: 'note', html: `<i class="fa-solid fa-check"></i> board holds ${$('<i>').text(Model.formatValue(res.readBack).text).html()}`, title: row.caveat || 'The board accepted the write but reads back a different value.', at: Date.now() });
            } else {
                this.results.set(path, { kind: 'ok', html: '<i class="fa-solid fa-check"></i>', title: 'Written and read back', at: Date.now() });
            }
            const current = this.rows.find((r) => r.path === path);
            this._fillValue(this._cell(path), current ? current.value : row.value, path);
            setTimeout(() => {
                const r = this.results.get(path);
                if (r && Date.now() - r.at >= 8000) {
                    this.results.delete(path);
                    const cur = this.rows.find((x) => x.path === path);
                    if (cur && path !== this.editingPath) this._fillValue(this._cell(path), cur.value, path);
                }
            }, 8100);
        }

        onSettingsChanged(newSettings) {
            this.settings = newSettings || {};
            this.prevValues.clear();
            this.changedPaths.clear();
            this._subscribeToDatasource();
            this._render(true);
        }

        onDispose() {
            if (this._dsSubscription) { this._dsSubscription.dispose(); this._dsSubscription = null; }
        }

        getHeight() {
            return 10;
        }
    }
})();
