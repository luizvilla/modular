(function () {
    const protocol = window.twistProtocol || null;


    class StateMachineEditor {
        constructor(widgetModel) {
            this._model = widgetModel;
            const s = widgetModel.settings() || {};
            this._deviceType = s.deviceType || 'TWIST';
            this._states = JSON.parse(JSON.stringify(Array.isArray(s.states) ? s.states : []));
            this._transitions = JSON.parse(JSON.stringify(Array.isArray(s.transitions) ? s.transitions : []));
            this._initialState = s.initialState || (this._states[0]?.id ?? '');
            this._selected = null;
            this._selectedTransition = null;
            this._pendingFrom = null;
            this._drag = null;
            this._connector = null;
            this._legControls = {};
            this._nameInput = null;
            this._powerSelect = null;
        }

        open() {
            const form = this._buildLayout();
            new DialogBox(form, 'State Machine Editor', 'Save', 'Cancel', () => this._save());
        }

        // ── layout ────────────────────────────────────────────────────────────

        _buildLayout() {
            // Widen the modal for this editor only; other dialogs stay at 640px.
            freeboard.addStyle('#modal_overlay .modal:has(.sm-editor-modal)', 'width:820px;');

            const wrap = $('<div class="sm-editor-modal"></div>').css({
                display: 'flex', flexDirection: 'column', height: '660px'
            });

            // Top row: canvas (flex:1) + sidebar (200px fixed)
            const topRow = $('<div></div>').css({
                display: 'flex', gap: '8px', flex: '1', minHeight: '0'
            });

            // SVG canvas
            const canvasWrap = $('<div></div>').css({
                flex: '1', minWidth: '0', position: 'relative', overflow: 'hidden',
                background: '#111', border: '1px solid #444', borderRadius: '4px'
            });
            const hint = $('<div></div>').css({
                position: 'absolute', top: '4px', left: '0', right: '0',
                textAlign: 'center', fontSize: '11px', color: '#555', pointerEvents: 'none'
            }).html('Drag to reposition &bull; Click to select &bull; Shift+click two states to add transition');
            canvasWrap.append(hint);
            const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svgEl.setAttribute('class', 'sm-canvas');
            svgEl.style.width = '100%';
            svgEl.style.height = '100%';
            svgEl.style.display = 'block';
            this._svg = svgEl;
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            defs.innerHTML = `
                <marker id="sm-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                    <polygon points="0 0,8 3,0 6" fill="#888"/>
                </marker>
                <marker id="sm-arrow-sel" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                    <polygon points="0 0,8 3,0 6" fill="#6ea8fe"/>
                </marker>`;
            svgEl.appendChild(defs);
            canvasWrap.append(svgEl);

            // Sidebar (200px, flex column) — both sections always visible, no tabs
            const sidebar = $('<div class="sm-sidebar"></div>').css({
                width: '200px', flexShrink: '0', display: 'flex', flexDirection: 'column', gap: '4px',
                overflow: 'hidden', border: '1px solid #444', borderRadius: '4px', padding: '6px'
            });

            const addStateBtn = $('<button class="btn btn-sm btn-outline-success w-100">+ Add State</button>');
            this._statesList = $('<div class="d-flex flex-column gap-1" style="overflow-y:auto;flex:1;min-height:0"></div>');
            this._statesPanel = $('<div class="d-flex flex-column gap-1"></div>').css({ flex: '1', minHeight: '0' }).append(addStateBtn, this._statesList);

            const addTransBtn = $('<button class="btn btn-sm btn-outline-success w-100">+ Add Transition</button>');
            this._transList = $('<div class="d-flex flex-column gap-1" style="overflow-y:auto;flex:1;min-height:0"></div>');
            this._transPanel = $('<div class="d-flex flex-column gap-1"></div>').css({ flex: '1', minHeight: '0' }).append(addTransBtn, this._transList);

            const divider = $('<div></div>').css({ borderTop: '1px solid #444', margin: '2px 0', flexShrink: '0' });
            const divider2 = $('<div></div>').css({ borderTop: '1px solid #444', margin: '2px 0', flexShrink: '0' });
            const exportBtn = $('<button class="btn btn-sm btn-outline-secondary w-100" style="font-size:11px">&#8659; Export machine.json</button>');
            const importBtn = $('<button class="btn btn-sm btn-outline-secondary w-100" style="font-size:11px">&#8657; Import machine.json</button>');
            exportBtn.on('click', () => this._exportMachine());
            importBtn.on('click', () => this._importMachine());
            const ioRow = $('<div class="d-flex flex-column gap-1" style="flex-shrink:0"></div>').append(exportBtn, importBtn);

            sidebar.append(this._statesPanel, divider, this._transPanel, divider2, ioRow);

            topRow.append(sidebar, canvasWrap);

            // Bottom: params panel (fixed height)
            this._paramsPanel = $('<div class="sm-params-panel"></div>').css({
                height: '265px', overflowY: 'auto', flexShrink: '0',
                borderTop: '1px solid #444', paddingTop: '6px', marginTop: '4px'
            });
            this._showNoSelection();

            wrap.append(topRow, this._paramsPanel);

            addStateBtn.on('click', () => this._addState());
            addTransBtn.on('click', () => this._showTransitionForm(null, null).catch(() => {}));

            this._setupSvgEvents(svgEl);
            this._renderAll();

            return wrap;
        }

        // ── SVG events ────────────────────────────────────────────────────────

        _setupSvgEvents(svg) {
            svg.addEventListener('mousedown', (e) => {
                const stateG = e.target.closest('g[data-id]');
                const transG = e.target.closest('g[data-tid]');

                if (stateG) {
                    const id = stateG.dataset.id;
                    const state = this._states.find(s => s.id === id);
                    if (!state) return;
                    const rect = svg.getBoundingClientRect();
                    const dist = Math.hypot(e.clientX - rect.left - state.x, e.clientY - rect.top - state.y);
                    if (dist >= 20) {
                        this._connector = { fromId: id, curX: e.clientX - rect.left, curY: e.clientY - rect.top };
                    } else {
                        this._drag = { id, startX: e.clientX, startY: e.clientY, origX: state.x, origY: state.y, hasMoved: false };
                    }
                    e.preventDefault();
                } else if (transG) {
                    this._selectTransition(transG.dataset.tid);
                }
            });

            svg.addEventListener('mousemove', (e) => {
                if (this._connector) {
                    const rect = svg.getBoundingClientRect();
                    this._connector.curX = e.clientX - rect.left;
                    this._connector.curY = e.clientY - rect.top;
                    this._renderAll();
                    return;
                }
                if (!this._drag) return;
                const dx = e.clientX - this._drag.startX;
                const dy = e.clientY - this._drag.startY;
                if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this._drag.hasMoved = true;
                const state = this._states.find(s => s.id === this._drag.id);
                if (state) {
                    state.x = Math.max(32, this._drag.origX + dx);
                    state.y = Math.max(32, this._drag.origY + dy);
                    this._renderAll();
                }
            });

            svg.addEventListener('mouseup', (e) => {
                if (this._connector) {
                    const rect = svg.getBoundingClientRect();
                    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
                    const fromId = this._connector.fromId;
                    this._connector = null;
                    const target = this._states.find(s => Math.hypot(mx - s.x, my - s.y) < 35 && s.id !== fromId);
                    if (target) this._showTransitionForm(fromId, target.id).catch(() => {});
                    else this._renderAll();
                    return;
                }
                const wasDrag = this._drag?.hasMoved;
                const dragId = this._drag?.id;
                this._drag = null;
                if (!wasDrag && dragId) this._handleStateClick(dragId, e.shiftKey);
            });

            svg.addEventListener('mouseleave', () => {
                if (this._connector) { this._connector = null; this._renderAll(); }
                this._drag = null;
            });
        }

        _handleStateClick(id, isShift) {
            if (!isShift) {
                this._pendingFrom = null;
                this._selectState(id);
            } else {
                if (!this._pendingFrom) {
                    if (this._selected === id) this._readParamsPanel();
                    this._pendingFrom = id;
                    this._renderAll();
                } else if (this._pendingFrom !== id) {
                    const from = this._pendingFrom;
                    this._pendingFrom = null;
                    this._showTransitionForm(from, id).catch(() => {});
                } else {
                    this._pendingFrom = null;
                    this._renderAll();
                }
            }
        }

        // ── SVG rendering ─────────────────────────────────────────────────────

        _renderAll() {
            while (this._svg.children.length > 1) this._svg.removeChild(this._svg.lastChild);
            this._transitions.forEach(t => this._renderTransitionSvg(t));
            this._states.forEach(s => this._renderStateSvg(s));
            if (this._connector) {
                const src = this._states.find(s => s.id === this._connector.fromId);
                if (src) {
                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    line.setAttribute('x1', src.x); line.setAttribute('y1', src.y);
                    line.setAttribute('x2', this._connector.curX); line.setAttribute('y2', this._connector.curY);
                    line.setAttribute('stroke', '#6ea8fe'); line.setAttribute('stroke-width', '1.5');
                    line.setAttribute('stroke-dasharray', '5,3');
                    line.setAttribute('marker-end', 'url(#sm-arrow-sel)');
                    this._svg.appendChild(line);
                }
            }
            this._renderStatesList();
            this._renderTransitionsList();
        }

        _renderTransitionSvg(t) {
            const from = this._states.find(s => s.id === t.from);
            const to = this._states.find(s => s.id === t.to);
            if (!from || !to) return;
            const isSel = t.id === this._selectedTransition;

            let d, lx, ly;
            if (from.id === to.id) {
                const x = from.x, y = from.y - 28;
                d = `M ${x - 15} ${y} C ${x - 50} ${y - 60} ${x + 50} ${y - 60} ${x + 15} ${y}`;
                lx = x; ly = y - 52;
            } else {
                const dx = to.x - from.x, dy = to.y - from.y;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                const cpx = (from.x + to.x) / 2 - (dy / len) * 35;
                const cpy = (from.y + to.y) / 2 + (dx / len) * 35;
                const sx = from.x + (dx / len) * 28, sy = from.y + (dy / len) * 28;
                const ex = to.x - (dx / len) * 28, ey = to.y - (dy / len) * 28;
                d = `M ${sx} ${sy} Q ${cpx} ${cpy} ${ex} ${ey}`;
                lx = 0.25 * sx + 0.5 * cpx + 0.25 * ex;
                ly = 0.25 * sy + 0.5 * cpy + 0.25 * ey - 8;
            }

            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('data-tid', t.id);
            g.style.cursor = 'pointer';

            // Wide transparent hit area
            const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            hitPath.setAttribute('d', d);
            hitPath.setAttribute('stroke', 'transparent');
            hitPath.setAttribute('stroke-width', '12');
            hitPath.setAttribute('fill', 'none');
            g.appendChild(hitPath);

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d);
            path.setAttribute('stroke', isSel ? '#6ea8fe' : '#888');
            path.setAttribute('stroke-width', isSel ? '2' : '1.5');
            path.setAttribute('fill', 'none');
            path.setAttribute('marker-end', `url(#${isSel ? 'sm-arrow-sel' : 'sm-arrow'})`);
            g.appendChild(path);

            const label = this._conditionLabel(t);
            if (label) {
                const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                txt.setAttribute('x', lx); txt.setAttribute('y', ly);
                txt.setAttribute('text-anchor', 'middle');
                txt.setAttribute('fill', isSel ? '#6ea8fe' : '#888');
                txt.setAttribute('font-size', '10');
                txt.setAttribute('pointer-events', 'none');
                txt.textContent = label;
                g.appendChild(txt);
            }

            this._svg.appendChild(g);
        }

        _renderStateSvg(s) {
            const isSel = s.id === this._selected;
            const isPend = s.id === this._pendingFrom;
            const isInit = s.id === this._initialState;
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('data-id', s.id);
            g.style.cursor = 'pointer';

            if (isInit) {
                const outer = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                outer.setAttribute('cx', s.x); outer.setAttribute('cy', s.y); outer.setAttribute('r', 34);
                outer.setAttribute('stroke', isSel ? '#0d6efd' : '#6c757d');
                outer.setAttribute('stroke-width', '1.5'); outer.setAttribute('fill', 'none');
                g.appendChild(outer);
            }

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', s.x); circle.setAttribute('cy', s.y); circle.setAttribute('r', 28);
            circle.setAttribute('fill', isSel ? '#1a2a3a' : isPend ? '#0a1a2a' : '#1e1e1e');
            circle.setAttribute('stroke', isSel ? '#0d6efd' : isPend ? '#6ea8fe' : '#6c757d');
            circle.setAttribute('stroke-width', (isSel || isPend) ? '2.5' : '1.5');
            g.appendChild(circle);

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', s.x); text.setAttribute('y', s.y);
            text.setAttribute('dominant-baseline', 'middle');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('fill', isSel ? '#6ea8fe' : '#ccc');
            text.setAttribute('font-size', '11');
            text.setAttribute('pointer-events', 'none');
            text.textContent = s.name || s.id;
            g.appendChild(text);

            this._svg.appendChild(g);
        }

        // ── sidebar lists ─────────────────────────────────────────────────────

        _renderStatesList() {
            this._statesList.empty();
            if (!this._states.length) {
                this._statesList.append('<div class="small text-muted">No states. Click + Add State.</div>');
                return;
            }
            this._states.forEach(s => {
                const row = $('<div class="d-flex align-items-center gap-1 border rounded px-1 py-1"></div>');
                row.toggleClass('border-primary', s.id === this._selected);

                const lbl = $('<div class="small flex-fill" style="cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></div>').text(s.name || s.id);
                lbl.on('click', () => this._selectState(s.id));

                const initBtn = $('<button class="btn btn-sm py-0 px-1" title="Set as initial state" style="font-size:10px;min-width:22px">&#9654;</button>');
                initBtn.addClass(s.id === this._initialState ? 'btn-primary' : 'btn-outline-secondary');
                initBtn.on('click', () => { this._initialState = s.id; this._renderAll(); });

                const delBtn = $('<button class="btn btn-outline-danger btn-sm py-0 px-1" style="font-size:10px;min-width:22px">&#x2715;</button>');
                delBtn.on('click', () => this._deleteState(s.id));

                row.append(lbl, initBtn, delBtn);
                this._statesList.append(row);
            });
        }

        _renderTransitionsList() {
            this._transList.empty();
            if (!this._transitions.length) {
                this._transList.append('<div class="small text-muted">No transitions. Shift+click two states or use + Add Transition.</div>');
                return;
            }
            this._transitions.forEach(t => {
                const row = $('<div class="d-flex align-items-start gap-1 border rounded px-1 py-1"></div>');
                row.toggleClass('border-primary', t.id === this._selectedTransition);
                const from = this._stateName(t.from), to = this._stateName(t.to);
                const lbl = $('<div class="small flex-fill" style="cursor:pointer"></div>').html(
                    `<strong>${this._esc(from)}</strong> &#x2192; <strong>${this._esc(to)}</strong><br>`
                    + `<span class="text-muted">${this._esc(this._conditionLabel(t) || '—')}</span>`
                );
                lbl.on('click', () => this._selectTransition(t.id));
                const delBtn = $('<button class="btn btn-outline-danger btn-sm py-0 px-1 align-self-start" style="font-size:10px;min-width:22px">&#x2715;</button>');
                delBtn.on('click', () => {
                    if (this._selectedTransition === t.id) { this._selectedTransition = null; this._showNoSelection(); }
                    this._transitions = this._transitions.filter(tr => tr.id !== t.id);
                    this._renderAll();
                });
                row.append(lbl, delBtn);
                this._transList.append(row);
            });
        }

        // ── state selection / params panel ────────────────────────────────────

        _selectTransition(id) {
            if (this._selected) this._readParamsPanel();
            this._selected = null;
            this._selectedTransition = id;
            this._renderAll();
            const t = this._transitions.find(tr => tr.id === id);
            if (!t) { this._showNoSelection(); return; }
            this._showTransitionForm(t.from, t.to, t).catch(() => {});
        }

        _selectState(id) {
            if (this._selected) this._readParamsPanel();
            this._selected = id;
            this._selectedTransition = null;
            this._renderAll();
            const state = this._states.find(s => s.id === id);
            if (state) this._showStateParams(state);
            else this._showNoSelection();
        }

        _showNoSelection() {
            this._paramsPanel.empty().append(
                $('<div class="small text-muted p-2">Select a state to edit its setpoints.</div>')
            );
            this._nameInput = null;
            this._powerSelect = null;
            this._legControls = {};
        }

        _showStateParams(state) {
            this._paramsPanel.empty();
            const profile = protocol?.getProfile(this._deviceType) || { legs: 2 };
            const numLegs = profile.legs || 2;

            // Ensure all legs are present
            if (!Array.isArray(state.legs)) state.legs = [];
            for (let i = 1; i <= numLegs; i++) {
                if (!state.legs.find(l => l.leg === i)) {
                    state.legs.push({
                        leg: i,
                        toggles: { LEG: 'OFF', CAPA: 'OFF', DRIVER: 'OFF', BUCK: 'OFF', BOOST: 'OFF' },
                        setpoints: { reference_var: protocol?.getProfile(this._deviceType)?.variables[0] || 'V1', reference_val: 0, duty: 0, phase_shift: 0, frequency: 200000, dead_time_rising: 200, dead_time_falling: 200 }
                    });
                }
            }

            // Header: name + power mode
            const header = $('<div class="d-flex flex-wrap gap-2 align-items-center px-2 pt-1 pb-1"></div>');
            this._nameInput = $('<input type="text" class="form-control form-control-sm" style="max-width:140px">').val(state.name || '');
            header.append($('<div class="input-group input-group-sm" style="max-width:260px"></div>').append(
                '<span class="input-group-text">Name</span>', this._nameInput
            ));
            this._powerSelect = $('<select class="form-select form-select-sm" style="max-width:110px"></select>');
            this._powerSelect.append('<option value="">— (no change)</option>');
            ['IDLE', 'ON', 'OFF'].forEach(m => this._powerSelect.append(`<option value="${m}">${m}</option>`));
            this._powerSelect.val(state.powerMode || '');
            header.append($('<div class="input-group input-group-sm" style="max-width:200px"></div>').append(
                '<span class="input-group-text">Power</span>', this._powerSelect
            ));
            this._paramsPanel.append(header);

            // Per-leg controls — all legs side by side, equal width
            this._legControls = {};
            const legRow = $('<div class="d-flex gap-2 px-2 pb-1"></div>');
            for (let i = 1; i <= numLegs; i++) {
                const legData = state.legs.find(l => l.leg === i);
                const legBox = $(`<div class="border rounded p-1 d-flex flex-column gap-1 sm-leg-box" data-leg="${i}" style="flex:1;min-width:0;font-size:12px"></div>`);
                legBox.append($(`<div class="fw-semibold" style="font-size:11px">Leg ${i}</div>`));

                const ctrl = { toggles: {}, setpoints: {} };

                // Toggles — tight single row; wraps to 2 lines only if truly needed (e.g. very narrow)
                const toggleRow = $('<div class="d-flex gap-1 flex-wrap"></div>');
                ['LEG', 'CAPA', 'DRIVER', 'BUCK', 'BOOST'].forEach(action => {
                    const cb = $('<input type="checkbox" class="form-check-input mt-0" style="width:12px;height:12px">').prop('checked', legData.toggles[action] === 'ON');
                    const lbl = $(`<label style="font-size:11px;cursor:pointer">${action}</label>`);
                    cb.on('change', () => {});
                    lbl.on('click', () => cb.prop('checked', !cb.prop('checked')));
                    toggleRow.append($('<div class="d-flex align-items-center gap-1"></div>').append(cb, lbl));
                    ctrl.toggles[action] = cb;
                });
                legBox.append(toggleRow);

                // Reference (variable selector + value)
                const refVars = protocol?.getProfile(this._deviceType)?.variables || ['V1', 'V2', 'VH', 'I1', 'I2', 'IH'];
                const refVarSel = $(`<select class="form-select form-select-sm" style="max-width:70px;font-size:11px"></select>`);
                refVars.forEach(v => refVarSel.append(`<option value="${v}">${v}</option>`));
                refVarSel.val(legData.setpoints.reference_var || refVars[0]);
                const refValInput = $('<input type="number" class="form-control form-control-sm" step="0.01">').val(legData.setpoints.reference_val ?? 0);
                legBox.append($('<div class="input-group input-group-sm"></div>').append(
                    $('<span class="input-group-text" style="width:72px;font-size:11px;flex-shrink:0">Ref</span>'),
                    refVarSel, refValInput
                ));
                ctrl.setpoints.reference_var = refVarSel;
                ctrl.setpoints.reference_val = refValInput;

                // Setpoints
                const spDefs = [
                    ['Duty', 'duty', 0], ['Phase °', 'phase_shift', 0],
                    ['Freq Hz', 'frequency', 200000], ['DT Rise ns', 'dead_time_rising', 200], ['DT Fall ns', 'dead_time_falling', 200]
                ];
                spDefs.forEach(([label, key, def]) => {
                    const input = $('<input type="number" class="form-control form-control-sm">').val(legData.setpoints[key] ?? def);
                    legBox.append($('<div class="input-group input-group-sm"></div>').append(
                        $('<span class="input-group-text" style="width:72px;font-size:11px;flex-shrink:0"></span>').text(label),
                        input
                    ));
                    ctrl.setpoints[key] = input;
                });

                this._legControls[i] = ctrl;
                legRow.append(legBox);
            }
            this._paramsPanel.append(legRow);
        }

        _readParamsPanel() {
            const state = this._states.find(s => s.id === this._selected);
            if (!state || !this._nameInput) return;
            const name = this._nameInput.val().trim();
            if (name) state.name = name;
            state.powerMode = this._powerSelect?.val() || null;
            (state.legs || []).forEach(leg => {
                const ctrl = this._legControls[leg.leg];
                if (!ctrl) return;
                Object.keys(ctrl.toggles).forEach(a => { leg.toggles[a] = ctrl.toggles[a].prop('checked') ? 'ON' : 'OFF'; });
                Object.keys(ctrl.setpoints).forEach(k => {
                    if (k === 'reference_var') { leg.setpoints[k] = ctrl.setpoints[k].val(); return; }
                    const v = parseFloat(ctrl.setpoints[k].val());
                    if (Number.isFinite(v)) leg.setpoints[k] = v;
                });
            });
        }

        // ── add / delete ──────────────────────────────────────────────────────

        _addState() {
            const id = 's' + Date.now();
            const idx = this._states.length;
            const profile = protocol?.getProfile(this._deviceType) || { legs: 2 };
            const numLegs = profile.legs || 2;
            const legs = [];
            for (let i = 1; i <= numLegs; i++) {
                legs.push({
                    leg: i,
                    toggles: { LEG: 'OFF', CAPA: 'OFF', DRIVER: 'OFF', BUCK: 'OFF', BOOST: 'OFF' },
                    setpoints: { reference_var: protocol?.getProfile(this._deviceType)?.variables[0] || 'V1', reference_val: 0, duty: 0, phase_shift: 0, frequency: 200000, dead_time_rising: 200, dead_time_falling: 200 }
                });
            }
            this._states.push({ id, name: `State ${idx + 1}`, x: 80 + (idx % 5) * 130, y: 80 + Math.floor(idx / 5) * 110, powerMode: null, legs });
            if (!this._initialState) this._initialState = id;
            this._renderAll();
            this._selectState(id);
        }

        _deleteState(id) {
            if (this._selected === id) { this._selected = null; this._showNoSelection(); }
            this._states = this._states.filter(s => s.id !== id);
            this._transitions = this._transitions.filter(t => t.from !== id && t.to !== id);
            if (this._initialState === id) this._initialState = this._states[0]?.id ?? '';
            if (this._pendingFrom === id) this._pendingFrom = null;
            this._renderAll();
        }

        // ── import / export ──────────────────────────────────────────────────

        _ipc() {
            return window.require?.('electron')?.ipcRenderer ?? null;
        }

        async _exportMachine() {
            const data = {
                version: 1,
                deviceType: this._deviceType,
                initialState: this._initialState,
                states: this._states,
                transitions: this._transitions
            };
            const json = JSON.stringify(data, null, 2);
            const ipc = this._ipc();
            if (ipc) {
                await ipc.invoke('show-save-machine', { content: json });
                return;
            }
            // Fallback: browser Blob download
            const blob = new Blob([json], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'machine.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        async _importMachine() {
            const ipc = this._ipc();
            if (ipc) {
                const content = await ipc.invoke('show-open-machine');
                if (content) this._loadMachineJson(content);
                return;
            }
            // Fallback: browser file input
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => this._loadMachineJson(ev.target.result);
                reader.readAsText(file);
            };
            input.click();
        }

        _loadMachineJson(jsonText) {
            try {
                const data = JSON.parse(jsonText);
                if (!Array.isArray(data.states)) throw new Error('Missing states array');
                this._states = data.states;
                this._transitions = Array.isArray(data.transitions) ? data.transitions : [];
                this._initialState = data.initialState || (this._states[0]?.id ?? '');
                this._selected = null;
                this._selectedTransition = null;
                this._pendingFrom = null;
                this._renderAll();
                this._showNoSelection();
            } catch (err) {
                alert('Could not load machine: ' + err.message);
            }
        }

        // ── transition form ───────────────────────────────────────────────────

        // existingTransition: pass when editing an existing transition (null = add new)
        async _showTransitionForm(fromId, toId, existingTransition = null) {
            this._paramsPanel.empty();
            const stateOpts = this._states.map(s => `<option value="${s.id}">${this._esc(s.name || s.id)}</option>`).join('');
            if (!stateOpts) {
                this._paramsPanel.append('<div class="small text-muted p-2">Add at least two states first.</div>');
                return;
            }

            // Fetch channel list from the datasource (same mechanism as the integrated plot editor)
            const shared = freeboard.getPlotEditorShared?.();
            const dsName = this._model.settings()?.datasource;
            let varOptions = (shared && dsName)
                ? (await shared.fetchDatasourceVariableOptions(dsName, '').catch(() => []))
                : [];
            // Append locally-tracked power state as a special option
            varOptions = [...varOptions, { value: '__state__', label: 'State (IDLE=0  ON=1  OFF=2)' }];
            const varOptsHtml = varOptions.map(o => `<option value="${this._esc(o.value)}">${this._esc(o.label)}</option>`).join('');

            const isEdit = existingTransition !== null;
            const mathOptsHtml = ['x', '-x', 'k*x', 'x+b', 'k*x+b'].map(op => `<option value="${op}">${op}</option>`).join('');
            const cmpOptsHtml  = ['>', '<', '>=', '<=', '==', '!='].map(op => `<option value="${op}">${op}</option>`).join('');

            const form = $('<div class="p-2 d-flex flex-column gap-1" style="overflow-y:auto"></div>');

            const fromSel = $(`<select class="form-select form-select-sm" style="max-width:120px">${stateOpts}</select>`);
            fromSel.val(isEdit ? existingTransition.from : (fromId || ''));
            const toSel = $(`<select class="form-select form-select-sm" style="max-width:120px">${stateOpts}</select>`);
            toSel.val(isEdit ? existingTransition.to : (toId || ''));

            // Conditions list — each entry: { joinSel, varSel, mathSel, kInput, bInput, opSel, thrInput, row }
            const condList = [];
            const condContainer = $('<div class="d-flex flex-column gap-1 mb-1"></div>');

            const addCondRow = (initJoin) => {
                const row = $('<div class="d-flex gap-1 align-items-center"></div>');
                let joinSel = null;
                if (condList.length > 0) {
                    joinSel = $('<select class="form-select form-select-sm" style="width:62px;flex-shrink:0"><option value="AND">AND</option><option value="OR">OR</option></select>');
                    joinSel.val(initJoin || 'AND');
                    row.append(joinSel);
                } else {
                    row.append($('<div style="width:62px;flex-shrink:0"></div>'));
                }
                const varSel   = $(`<select class="form-select form-select-sm" style="flex:1;min-width:80px">${varOptsHtml}</select>`);
                const mathSel  = $(`<select class="form-select form-select-sm" style="width:72px;flex-shrink:0">${mathOptsHtml}</select>`);
                const kWrap = $('<div class="input-group input-group-sm" style="width:78px;flex-shrink:0;display:none"></div>')
                    .append('<span class="input-group-text px-1">k</span>', $('<input type="number" class="form-control" value="1" step="0.1">'));
                const bWrap = $('<div class="input-group input-group-sm" style="width:78px;flex-shrink:0;display:none"></div>')
                    .append('<span class="input-group-text px-1">b</span>', $('<input type="number" class="form-control" value="0" step="0.1">'));
                const kInput = kWrap.find('input'), bInput = bWrap.find('input');
                mathSel.on('change', () => {
                    const op = mathSel.val();
                    kWrap.toggle(op === 'k*x' || op === 'k*x+b');
                    bWrap.toggle(op === 'x+b' || op === 'k*x+b');
                });
                const opSel    = $(`<select class="form-select form-select-sm" style="width:56px;flex-shrink:0">${cmpOptsHtml}</select>`);
                const thrInput = $('<input type="number" class="form-control form-control-sm" value="0" step="0.1" style="width:78px;flex-shrink:0">');
                const removeBtn = $('<button class="btn btn-outline-danger btn-sm py-0 px-1" style="font-size:11px">&#x2715;</button>');

                const condObj = { joinSel, varSel, mathSel, kInput, bInput, opSel, thrInput, row };
                condList.push(condObj);

                removeBtn.on('click', () => {
                    const i = condList.indexOf(condObj);
                    if (i < 0) return;
                    condList.splice(i, 1);
                    row.remove();
                });

                row.append(varSel, mathSel, kWrap, bWrap, opSel, thrInput, removeBtn);
                condContainer.append(row);
            };

            // Populate rows: pre-fill if editing, otherwise one empty row
            if (isEdit) {
                const existing = (existingTransition.conditions?.length > 0)
                    ? existingTransition.conditions
                    : [{ variable: existingTransition.variable, mathOp: existingTransition.mathOp || 'x',
                         mathK: existingTransition.mathK ?? 1, mathB: existingTransition.mathB ?? 0,
                         operator: existingTransition.operator || '>', threshold: existingTransition.threshold ?? 0 }];
                existing.forEach((cond, i) => {
                    addCondRow(i === 0 ? null : (cond.join || 'AND'));
                    const c = condList[condList.length - 1];
                    if (c.joinSel && cond.join) c.joinSel.val(cond.join);
                    c.varSel.val(cond.variable || '');
                    c.mathSel.val(cond.mathOp || 'x').trigger('change');
                    c.kInput.val(cond.mathK ?? 1);
                    c.bInput.val(cond.mathB ?? 0);
                    c.opSel.val(cond.operator || '>');
                    c.thrInput.val(cond.threshold ?? 0);
                });
            } else {
                addCondRow(null);
            }

            // Apply button — defined before topRow so handler can reference condList
            const applyBtn = $('<button class="btn btn-sm btn-primary ms-auto">Apply</button>');
            const cancelBtn = $('<button class="btn btn-sm btn-outline-secondary">Cancel</button>');
            cancelBtn.on('click', () => { this._pendingFrom = null; this._renderAll(); this._showNoSelection(); });

            // Top row: From / To / Apply — all inline
            form.append(
                $('<div class="d-flex gap-1 align-items-center mb-1"></div>').append(
                    $('<div class="input-group input-group-sm" style="width:auto"></div>').append('<span class="input-group-text">From</span>', fromSel),
                    $('<div class="input-group input-group-sm" style="width:auto"></div>').append('<span class="input-group-text">To</span>', toSel),
                    applyBtn
                )
            );

            form.append(condContainer);

            // Bottom row: + Add Condition | [Delete] [Cancel]
            const addCondBtn = $('<button class="btn btn-outline-secondary btn-sm" style="font-size:11px">+ Add Condition</button>');
            addCondBtn.on('click', () => addCondRow('AND'));
            const bottomRow = $('<div class="d-flex gap-1 align-items-center mt-1"></div>').append(addCondBtn);

            if (isEdit) {
                const deleteBtn = $('<button class="btn btn-sm btn-outline-danger ms-auto">Delete</button>');
                deleteBtn.on('click', () => {
                    this._transitions = this._transitions.filter(tr => tr.id !== existingTransition.id);
                    this._selectedTransition = null;
                    this._renderAll();
                    this._showNoSelection();
                });
                bottomRow.append(deleteBtn, cancelBtn);

                applyBtn.on('click', () => {
                    const idx = this._transitions.findIndex(tr => tr.id === existingTransition.id);
                    if (idx >= 0) {
                        this._transitions[idx] = {
                            id: existingTransition.id, from: fromSel.val(), to: toSel.val(),
                            conditions: this._collectConditions(condList)
                        };
                    }
                    this._renderAll();
                    this._selectTransition(existingTransition.id);
                });
            } else {
                bottomRow.append(cancelBtn);
                applyBtn.on('click', () => {
                    this._transitions.push({ id: 't' + Date.now(), from: fromSel.val(), to: toSel.val(), conditions: this._collectConditions(condList) });
                    this._renderAll();
                    this._showNoSelection();
                });
            }

            form.append(bottomRow);
            this._paramsPanel.append(form);
        }

        _collectConditions(condList) {
            return condList.map((c, i) => {
                const op = c.mathSel.val();
                const item = {
                    variable: c.varSel.val(),
                    variableLabel: c.varSel.find(':selected').text(),
                    mathOp: op,
                    mathK: parseFloat(c.kInput.val()) || 1,
                    mathB: parseFloat(c.bInput.val()) || 0,
                    operator: c.opSel.val(),
                    threshold: parseFloat(c.thrInput.val()) || 0
                };
                if (i > 0 && c.joinSel) item.join = c.joinSel.val();
                return item;
            });
        }

        // ── save ──────────────────────────────────────────────────────────────

        _save() {
            if (this._selected) this._readParamsPanel();
            const updated = {
                ...this._model.settings(),
                states: this._states,
                transitions: this._transitions,
                initialState: this._initialState
            };
            this._model.settings(updated);
            this._model.widgetInstance?.onSettingsChanged(updated);
        }

        // ── helpers ───────────────────────────────────────────────────────────

        _stateName(id) { return this._states.find(s => s.id === id)?.name || id || '?'; }
        _esc(str) { return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

        // Returns a short label for a transition (from first condition, backwards-compat with old format)
        _conditionLabel(t) {
            const c = (t.conditions && t.conditions.length > 0) ? t.conditions[0] : t;
            if (!c?.variable) return '';
            const name = c.variableLabel || c.variable;
            const extra = (t.conditions && t.conditions.length > 1) ? ` +${t.conditions.length - 1}` : '';
            return `${name} ${c.operator || '>'} ${c.threshold ?? 0}${extra}`;
        }
    }

    window.ModularStateMachineEditor = {
        open(widgetModel) {
            if (!widgetModel) return;
            new StateMachineEditor(widgetModel).open();
        }
    };
}());
