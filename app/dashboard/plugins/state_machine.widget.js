(function () {
    const protocol = window.twistProtocol || null;

    freeboard.loadWidgetPlugin({
        type_name: 'state_machine',
        display_name: 'State Machine',
        description: 'Visual state machine with Twist/Ownverter setpoints per state and variable-based transitions.',
        icon: 'diagram-project',
        category: 'OwnTech',
        settings: [
            { name: 'title', display_name: 'Title', type: 'text' },
            {
                name: 'datasource',
                display_name: 'Datasource',
                type: 'option',
                options: getSerialDatasourceOptions,
                optionsRefreshMs: 1000
            },
            {
                name: 'deviceType',
                display_name: 'Device Type',
                type: 'option',
                default_value: 'TWIST',
                options: [
                    { name: 'Twist', value: 'TWIST' },
                    { name: 'Ownverter', value: 'OWNVERTER' }
                ]
            }
        ],
        newInstance: function (settings, cb) { cb(new StateMachineWidget(settings)); }
    });

    function getSerialDatasourceOptions() {
        const live = freeboard.getLiveModel?.();
        if (!live || typeof live.datasources !== 'function') return [];
        const out = [];
        live.datasources().forEach(ds => {
            try {
                if (ds.type?.() === 'serialport_datasource') out.push({ name: ds.name(), value: ds.name() });
            } catch { /* ignore */ }
        });
        return out;
    }

    class StateMachineWidget {
        constructor(settings) {
            this.settings = settings;
            this.serialApi = window.api?.serial || null;
            this.ipc = !this.serialApi && window.require ? window.require('electron')?.ipcRenderer : null;
            this._running = false;
            this._ticker = null;
            this._ticking = false;
            this._currentState = null;
            this._powerState = null;  // 0=IDLE, 1=ON, 2=OFF — tracked locally

            this.container = $('<div class="state-machine-widget h-100 d-flex flex-column gap-2 p-2 overflow-auto"></div>');
            this._runBtn = $('<button class="btn btn-sm btn-outline-success">&#9654; Run</button>');
            this._stopBtn = $('<button class="btn btn-sm btn-outline-danger" style="display:none">&#9632; Stop</button>');
            this._statusEl = $('<div class="small text-muted">State: —</div>');
            this._svgEl = $('<svg class="sm-pane-svg w-100 flex-fill" style="min-height:60px"></svg>');

            const toolbar = $('<div class="d-flex gap-2 align-items-center flex-wrap"></div>')
                .append(this._runBtn, this._stopBtn, this._statusEl);

            this.container.append(toolbar, this._svgEl);

            this._runBtn.on('click', () => this._start());
            this._stopBtn.on('click', () => this._stop());
        }

        render(el) {
            $(el).append(this.container);
            this._renderSvg();
            this._updateButtons();
        }

        onSettingsChanged(s) {
            this.settings = s;
            if (this._running) this._stop();
            this._currentState = null;
            this._renderSvg();
            this._updateButtons();
        }

        getHeight() { return 4; }

        onDispose() {
            this._stop();
        }

        // ── pane SVG ──────────────────────────────────────────────────────────

        _renderSvg() {
            const svg = this._svgEl[0];
            while (svg.firstChild) svg.removeChild(svg.firstChild);

            const states = Array.isArray(this.settings.states) ? this.settings.states : [];
            const transitions = Array.isArray(this.settings.transitions) ? this.settings.transitions : [];

            if (!states.length) {
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', '50%');
                text.setAttribute('y', '50%');
                text.setAttribute('dominant-baseline', 'middle');
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('fill', '#888');
                text.setAttribute('font-size', '12');
                text.textContent = 'No states — open editor (wrench) to build the state machine';
                svg.appendChild(text);
                return;
            }

            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            defs.innerHTML = `
                <marker id="sm-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                    <polygon points="0 0, 8 3, 0 6" fill="#888"/>
                </marker>`;
            svg.appendChild(defs);

            transitions.forEach(t => {
                const from = states.find(s => s.id === t.from);
                const to = states.find(s => s.id === t.to);
                if (!from || !to) return;

                const dx = to.x - from.x, dy = to.y - from.y;
                const len = Math.sqrt(dx * dx + dy * dy) || 1;
                const cpx = (from.x + to.x) / 2 - (dy / len) * 25;
                const cpy = (from.y + to.y) / 2 + (dx / len) * 25;
                const sx = from.x + (dx / len) * 28, sy = from.y + (dy / len) * 28;
                const ex = to.x - (dx / len) * 28, ey = to.y - (dy / len) * 28;
                const d = `M ${sx} ${sy} Q ${cpx} ${cpy} ${ex} ${ey}`;

                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', d);
                path.setAttribute('stroke', '#888');
                path.setAttribute('stroke-width', '1.5');
                path.setAttribute('fill', 'none');
                path.setAttribute('marker-end', 'url(#sm-arrow)');
                svg.appendChild(path);

                const c0 = (t.conditions && t.conditions.length > 0) ? t.conditions[0] : t;
                if (c0.variable) {
                    const lx = 0.25 * sx + 0.5 * cpx + 0.25 * ex;
                    const ly = 0.25 * sy + 0.5 * cpy + 0.25 * ey - 6;
                    const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    lbl.setAttribute('x', lx); lbl.setAttribute('y', ly);
                    lbl.setAttribute('text-anchor', 'middle');
                    lbl.setAttribute('fill', '#666');
                    lbl.setAttribute('font-size', '9');
                    const name = c0.variableLabel || c0.variable;
                    const extra = (t.conditions && t.conditions.length > 1) ? ` +${t.conditions.length - 1}` : '';
                    lbl.textContent = `${name} ${c0.operator || '>'} ${c0.threshold ?? 0}${extra}`;
                    svg.appendChild(lbl);
                }
            });

            states.forEach(s => {
                const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                const isCurrent = this._running && s.id === this._currentState;
                const isInitial = s.id === this.settings.initialState;

                if (isInitial) {
                    const outer = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    outer.setAttribute('cx', s.x); outer.setAttribute('cy', s.y);
                    outer.setAttribute('r', 34);
                    outer.setAttribute('stroke', '#6c757d'); outer.setAttribute('stroke-width', '1.5');
                    outer.setAttribute('fill', 'none');
                    g.appendChild(outer);
                }

                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', s.x); circle.setAttribute('cy', s.y);
                circle.setAttribute('r', 28);
                circle.setAttribute('fill', isCurrent ? '#1a3a1a' : '#1e1e1e');
                circle.setAttribute('stroke', isCurrent ? '#28a745' : '#6c757d');
                circle.setAttribute('stroke-width', isCurrent ? '2.5' : '1.5');
                g.appendChild(circle);

                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', s.x); text.setAttribute('y', s.y);
                text.setAttribute('dominant-baseline', 'middle');
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('fill', isCurrent ? '#28a745' : '#ccc');
                text.setAttribute('font-size', '11');
                text.textContent = s.name || s.id;
                g.appendChild(text);

                svg.appendChild(g);
            });
        }

        _updateButtons() {
            const hasStates = Array.isArray(this.settings.states) && this.settings.states.length > 0;
            const hasInitial = hasStates && this.settings.states.some(s => s.id === this.settings.initialState);
            this._runBtn.prop('disabled', !hasInitial || this._running).toggle(!this._running);
            this._stopBtn.toggle(this._running);
            this._statusEl.text(this._running
                ? `State: ${this._stateName(this._currentState)}`
                : (hasInitial ? 'Ready' : hasStates ? 'Set initial state in editor' : 'No states defined'));
        }

        _stateName(id) {
            const s = (this.settings.states || []).find(s => s.id === id);
            return s ? (s.name || s.id) : '—';
        }

        // ── execution ─────────────────────────────────────────────────────────

        _start() {
            if (!this.settings.initialState) return;
            this._running = true;
            this._ticking = false;
            this._currentState = this.settings.initialState;
            this._statusEl.text(`State: ${this._stateName(this._currentState)}`);
            this._renderSvg();
            this._ticker = setInterval(() => this._tick(), 200);
            this._updateButtons();
        }

        _stop() {
            this._running = false;
            this._ticking = false;
            if (this._ticker) { clearInterval(this._ticker); this._ticker = null; }
            this._renderSvg();
            this._updateButtons();
        }

        async _tick() {
            if (!this._running || this._ticking) return;
            this._ticking = true;
            try {
                const transitions = (this.settings.transitions || []).filter(t => t.from === this._currentState);
                for (const t of transitions) {
                    if (await this._evaluateTransition(t)) { await this._enterState(t.to); break; }
                }
            } finally {
                this._ticking = false;
            }
        }

        async _evaluateTransition(t) {
            // Support both new format (conditions[]) and old format (top-level variable/operator/threshold)
            const conditions = (t.conditions && t.conditions.length > 0) ? t.conditions : [{
                variable: t.variable, mathOp: t.mathOp, mathK: t.mathK, mathB: t.mathB,
                operator: t.operator, threshold: t.threshold
            }];
            let result = null;
            for (const cond of conditions) {
                const raw = await this._readVariable(cond.variable);
                if (raw === null) return false;
                const val = this._applyMath(raw, cond);
                const matches = this._compare(val, cond.operator, cond.threshold);
                result = result === null ? matches : (cond.join === 'OR' ? result || matches : result && matches);
            }
            return result ?? false;
        }

        async _enterState(id) {
            const state = (this.settings.states || []).find(s => s.id === id);
            if (!state) return;
            this._currentState = id;
            this._statusEl.text(`State: ${this._stateName(id)}`);
            this._renderSvg();

            // Notify action/setpoint widgets immediately so their UI reflects the new state
            window.dispatchEvent(new CustomEvent('sm:state-entered', {
                detail: {
                    powerMode: state.powerMode,
                    legs: state.legs || [],
                    datasource: this.settings.datasource,
                    deviceType: this.settings.deviceType || 'TWIST'
                }
            }));

            if (!protocol) return;
            const deviceType = this.settings.deviceType || 'TWIST';

            if (state.powerMode === 'IDLE') { this._powerState = 0; await this._send(protocol.cmdIdle()); }
            else if (state.powerMode === 'ON') { this._powerState = 1; await this._send(protocol.cmdPowerOn()); }
            else if (state.powerMode === 'OFF') { this._powerState = 2; await this._send(protocol.cmdPowerOff()); }

            for (const leg of (state.legs || [])) {
                const n = leg.leg;
                const t = leg.toggles || {};
                for (const action of ['LEG', 'CAPA', 'DRIVER', 'BUCK', 'BOOST']) {
                    if (t[action] !== undefined) {
                        await this._send(protocol.cmdToggle(action, n, t[action], deviceType));
                    }
                }
                const sp = leg.setpoints || {};
                if (sp.reference_var !== undefined && sp.reference_val !== undefined)
                    await this._send(protocol.cmdReference(n, sp.reference_var, sp.reference_val, deviceType));
                if (sp.duty !== undefined) await this._send(protocol.cmdDuty(n, sp.duty, deviceType));
                if (sp.phase_shift !== undefined) await this._send(protocol.cmdPhaseShift(n, sp.phase_shift, deviceType));
                if (sp.frequency !== undefined) await this._send(protocol.cmdFrequency(n, sp.frequency, deviceType));
                if (sp.dead_time_rising !== undefined) await this._send(protocol.cmdDeadTimeRising(n, sp.dead_time_rising, deviceType));
                if (sp.dead_time_falling !== undefined) await this._send(protocol.cmdDeadTimeFalling(n, sp.dead_time_falling, deviceType));
            }
        }

        async _readVariable(varName) {
            if (varName === '__state__') return this._powerState ?? null;
            try {
                const shared = freeboard.getPlotEditorShared?.();
                if (!shared) return null;
                const dsSettings = freeboard.getDatasourceSettings?.(this.settings.datasource) || {};
                const path = dsSettings.portPath || this.settings.datasource;
                if (!path) return null;
                const arr = await shared.invoke('get-serial-buffer', { path });
                if (!Array.isArray(arr)) return null;
                // New format: variable is a numeric index string ("0", "1", ...)
                // Legacy format: variable is a protocol name ("V1", "V2", ...)
                let idx;
                if (/^\d+$/.test(String(varName))) {
                    idx = Number(varName);
                } else {
                    const profVars = protocol?.getProfile(this.settings.deviceType || 'TWIST')?.variables || [];
                    idx = profVars.indexOf(varName);
                }
                if (idx < 0 || idx >= arr.length) return null;
                const v = Number(arr[idx]);
                return Number.isFinite(v) ? v : null;
            } catch {
                return null;
            }
        }

        _applyMath(raw, t) {
            const k = Number(t.mathK ?? 1);
            const b = Number(t.mathB ?? 0);
            switch (t.mathOp) {
                case '-x':    return -raw;
                case 'k*x':   return k * raw;
                case 'x+b':   return raw + b;
                case 'k*x+b': return k * raw + b;
                default:      return raw;
            }
        }

        _compare(val, op, threshold) {
            const thr = Number(threshold);
            switch (op) {
                case '>':  return val > thr;
                case '<':  return val < thr;
                case '>=': return val >= thr;
                case '<=': return val <= thr;
                case '==': return val === thr;
                case '!=': return val !== thr;
            }
            return false;
        }

        async _send(command) {
            if (!command) return;
            const dsSettings = freeboard.getDatasourceSettings?.(this.settings.datasource) || {};
            const path = dsSettings.portPath || this.settings.datasource;
            if (!path) return;
            const CHUNK = 10, DELAY = 100;
            const write = async (data) => {
                if (this.serialApi?.write) await this.serialApi.write(path, data);
                else if (this.ipc) await this.ipc.invoke('write-serial-port', { path, data });
            };
            try {
                for (let i = 0; i < command.length; i += CHUNK) {
                    await write(command.slice(i, i + CHUNK));
                    await new Promise(r => setTimeout(r, DELAY));
                }
                await write('\r\n');
            } catch (err) {
                console.error('State machine send failed', err);
            }
        }
    }
}());
