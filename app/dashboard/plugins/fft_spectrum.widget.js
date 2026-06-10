(function () {
    const shared = window.FastFrameShared;
    const DEFAULT_COLORS = ['#4e9fd4', '#e6862a', '#5cb85c', '#d9534f', '#9b59b6', '#1abc9c'];
    const DEFAULT_POLL_MS = 2000;

    if (!window.__fftSpectrumWidgetStyles && freeboard?.addStyle) {
        window.__fftSpectrumWidgetStyles = true;
        freeboard.addStyle('.fft-spectrum-widget', 'overflow-y:auto;');
        freeboard.addStyle('.fft-spectrum-toolbar', 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;');
        freeboard.addStyle('.fft-spectrum-status', 'flex:1 1 260px;min-width:0;');
        freeboard.addStyle('.fft-spectrum-panel', 'background:rgba(255,255,255,0.02);');
        freeboard.addStyle('.fft-spectrum-title', 'font-size:12px;font-weight:600;letter-spacing:0.02em;margin-bottom:6px;');
        freeboard.addStyle('.fft-spectrum-chart-host', 'width:100%;min-height:160px;');
        freeboard.addStyle('.fft-spectrum-resize-handle', 'height:8px;cursor:ns-resize;margin-top:6px;border-radius:999px;background:linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0.22), rgba(255,255,255,0.08));');
        freeboard.addStyle('.fft-spectrum-resize-handle:hover', 'background:linear-gradient(90deg, rgba(120,180,255,0.18), rgba(120,180,255,0.38), rgba(120,180,255,0.18));');
        freeboard.addStyle('.fft-spectrum-thd-table table', 'margin-bottom:0;');
        freeboard.addStyle('.fft-spectrum-empty', 'border:1px dashed rgba(255,255,255,0.12);border-radius:6px;padding:14px;color:#a9afb8;font-size:12px;');
    }

    freeboard.loadWidgetPlugin({
        type_name: 'fft_spectrum_plot',
        display_name: 'FFT Spectrum Widget',
        category: 'Plots',
        icon: 'wave-square',
        description: 'Analyze a fast-frame CSV with time-domain, FFT spectrum, harmonic bars, and THD.',
        settings: [
            { name: 'title', display_name: 'Title', type: 'text', default_value: 'FFT Spectrum' },
            { name: 'csvPath', display_name: 'CSV File', type: 'text', default_value: '' },
            { name: 'csvDirectory', display_name: 'CSV Directory', type: 'text', default_value: '' },
            { name: 'signalColumns', display_name: 'Signal Columns', type: 'text', default_value: '' },
            { name: 'timeColumn', display_name: 'Time Column', type: 'text', default_value: '' },
            { name: 'samplingPeriodUs', display_name: 'Sampling Period (us)', type: 'text', default_value: '100' },
            { name: 'fundamentalFreqHz', display_name: 'Fundamental Frequency (Hz)', type: 'text', default_value: '50' },
            { name: 'maxFreqHz', display_name: 'Max Frequency (Hz)', type: 'text', default_value: '1000' },
            { name: 'maxHarmonic', display_name: 'Max Harmonic', type: 'text', default_value: '11' },
            { name: 'showTimeDomain', display_name: 'Show Time Domain', type: 'boolean', default_value: true },
            { name: 'showSpectrum', display_name: 'Show Spectrum', type: 'boolean', default_value: true },
            { name: 'showHarmonicBars', display_name: 'Show Harmonic Bars', type: 'boolean', default_value: true },
            { name: 'logScaleSpectrum', display_name: 'Log Scale Spectrum', type: 'boolean', default_value: true }
        ],
        newInstance: function (settings, cb) {
            const UPLOT_JS = 'https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.iife.min.js';
            const UPLOT_CSS = 'https://cdn.jsdelivr.net/npm/uplot@1.6.24/dist/uPlot.min.css';
            if (window.uPlot) {
                cb(new FftSpectrumPlot(settings));
            } else {
                head.js([UPLOT_JS, UPLOT_CSS], function () {
                    cb(new FftSpectrumPlot(settings));
                });
            }
        }
    });

    function nextPow2(n) {
        let out = 1;
        while (out < n) out <<= 1;
        return out;
    }

    function fftComplex(re, im) {
        const size = re.length;
        let j = 0;

        for (let i = 1; i < size; i++) {
            let bit = size >> 1;
            while (j & bit) {
                j ^= bit;
                bit >>= 1;
            }
            j ^= bit;
            if (i < j) {
                const tr = re[i];
                re[i] = re[j];
                re[j] = tr;
                const ti = im[i];
                im[i] = im[j];
                im[j] = ti;
            }
        }

        for (let len = 2; len <= size; len <<= 1) {
            const half = len >> 1;
            const angle = -2 * Math.PI / len;
            const stepRe = Math.cos(angle);
            const stepIm = Math.sin(angle);

            for (let start = 0; start < size; start += len) {
                let wRe = 1;
                let wIm = 0;

                for (let k = 0; k < half; k++) {
                    const even = start + k;
                    const odd = even + half;
                    const oddRe = re[odd] * wRe - im[odd] * wIm;
                    const oddIm = re[odd] * wIm + im[odd] * wRe;

                    re[odd] = re[even] - oddRe;
                    im[odd] = im[even] - oddIm;
                    re[even] += oddRe;
                    im[even] += oddIm;

                    const nextRe = wRe * stepRe - wIm * stepIm;
                    wIm = wRe * stepIm + wIm * stepRe;
                    wRe = nextRe;
                }
            }
        }
    }

    function fftReal(signal, sampleRate) {
        const originalLength = signal.length;
        const paddedLength = nextPow2(Math.max(1, originalLength));
        const re = new Float64Array(paddedLength);
        const im = new Float64Array(paddedLength);

        for (let i = 0; i < originalLength; i++) {
            const value = Number(signal[i]);
            re[i] = Number.isFinite(value) ? value : 0;
        }

        fftComplex(re, im);

        const bins = Math.floor(paddedLength / 2) + 1;
        const freqs = new Array(bins);
        const magnitudes = new Array(bins);
        const df = sampleRate / paddedLength;

        for (let k = 0; k < bins; k++) {
            const scale = (k === 0 || (paddedLength % 2 === 0 && k === paddedLength / 2)) ? 1 : 2;
            freqs[k] = k * df;
            magnitudes[k] = scale * Math.hypot(re[k], im[k]) / originalLength;
        }

        return { freqs, magnitudes, df, paddedLength };
    }

    function parseList(value) {
        return String(value || '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }

    function parsePositiveNumber(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }

    function parsePositiveInteger(value, fallback) {
        const parsed = parseInt(value, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    }

    function hasFiniteValue(values) {
        return Array.isArray(values) && values.some((value) => Number.isFinite(value));
    }

    function resolveSignalColumns(dataset, rawColumns, timeColumn) {
        const requested = parseList(rawColumns);
        const explicit = [];
        const missing = [];

        if (requested.length) {
            requested.forEach((column) => {
                if (hasFiniteValue(dataset.columns[column])) explicit.push(column);
                else missing.push(column);
            });
            return { columns: explicit, missing };
        }

        const headers = Array.isArray(dataset.headers) ? dataset.headers : [];
        const excluded = new Set(['k_acquire']);
        if (timeColumn) excluded.add(timeColumn);
        const timeLike = /(^time($|[_A-Z]))|(^timestamp$)|(^sample($|_))/i;
        const candidates = headers.filter((header) => {
            if (excluded.has(header)) return false;
            if (timeLike.test(header)) return false;
            return hasFiniteValue(dataset.columns[header]);
        });

        const preferred = ['Vgrid', 'Igrid'].filter((header) => candidates.includes(header));
        const auto = preferred.concat(candidates.filter((header) => !preferred.includes(header)));
        return { columns: auto.slice(0, Math.min(4, auto.length)), missing: [] };
    }

    function paddedExtent(minValue, maxValue) {
        if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return { min: 0, max: 1 };
        if (minValue === maxValue) {
            const pad = Math.abs(minValue) * 0.1 || 1;
            return { min: minValue - pad, max: maxValue + pad };
        }
        const span = maxValue - minValue;
        const pad = span * 0.08;
        return { min: minValue - pad, max: maxValue + pad };
    }

    function computeTimeExtent(seriesList) {
        let minValue = Infinity;
        let maxValue = -Infinity;

        seriesList.forEach((series) => {
            series.forEach((value) => {
                if (!Number.isFinite(value)) return;
                if (value < minValue) minValue = value;
                if (value > maxValue) maxValue = value;
            });
        });

        return paddedExtent(minValue, maxValue);
    }

    function computePositiveExtent(seriesList) {
        let minValue = Infinity;
        let maxValue = 0;

        seriesList.forEach((series) => {
            series.forEach((value) => {
                if (!Number.isFinite(value) || value <= 0) return;
                if (value < minValue) minValue = value;
                if (value > maxValue) maxValue = value;
            });
        });

        if (!Number.isFinite(minValue)) minValue = 1e-6;
        if (!Number.isFinite(maxValue) || maxValue <= 0) maxValue = 1;
        if (minValue === maxValue) {
            minValue *= 0.5;
            maxValue *= 1.5;
        }

        return { min: minValue, max: maxValue * 1.1 };
    }

    function formatNumber(value, digits = 3) {
        if (!Number.isFinite(value)) return '---';
        const abs = Math.abs(value);
        if (abs >= 10000 || (abs > 0 && abs < 0.001)) return value.toExponential(2);
        return Number(value.toFixed(digits)).toString();
    }

    function signalPalette(columns) {
        return columns.map((_column, index) => DEFAULT_COLORS[index % DEFAULT_COLORS.length]);
    }

    function normalizeFftChannelDefs(settings) {
        const rawDefs = Array.isArray(settings && settings.channelDefs) ? settings.channelDefs : [];
        if (rawDefs.length) {
            return rawDefs.filter((d) => d && (
                (d.variable && typeof d.variable === 'string') ||
                (d.type === 'math' && d.operandA && d.operator && d.operandB !== undefined && d.operandB !== '')
            ));
        }
        return parseList(settings && settings.signalColumns || '').map((col) => ({ variable: col }));
    }

    function computeMathValues(dataset, operandA, operator, operandB) {
        const colA = Array.isArray(dataset.columns[operandA]) ? dataset.columns[operandA] : [];
        const bNum = parseFloat(operandB);
        const bIsConst = !Array.isArray(dataset.columns[operandB]) && Number.isFinite(bNum);
        const colB = bIsConst ? null : (Array.isArray(dataset.columns[operandB]) ? dataset.columns[operandB] : []);
        const len = Math.max(colA.length, colB ? colB.length : 0);
        const out = new Array(len);
        for (let i = 0; i < len; i++) {
            const a = Number.isFinite(Number(colA[i])) ? Number(colA[i]) : NaN;
            const b = bIsConst ? bNum : (Number.isFinite(Number(colB[i])) ? Number(colB[i]) : NaN);
            if (!Number.isFinite(a) || !Number.isFinite(b)) { out[i] = null; continue; }
            switch (operator) {
                case '+': out[i] = a + b; break;
                case '-': out[i] = a - b; break;
                case '*': out[i] = a * b; break;
                case '/': out[i] = b !== 0 ? a / b : null; break;
                default: out[i] = a;
            }
        }
        return out;
    }

    class FftSpectrumPlot {
        constructor(settings) {
            this.settings = { ...settings };
            this.hostElement = null;
            this.container = $('<div class="fft-spectrum-widget h-100 d-flex flex-column gap-2 p-2"></div>');
            this.toolbar = $('<div class="fft-spectrum-toolbar"></div>');
            this.chooseButton = $('<button class="btn btn-outline-secondary btn-sm" type="button">Choose CSV</button>');
            this.refreshButton = $('<button class="btn btn-outline-secondary btn-sm" type="button">Refresh</button>');
            this.status = $('<div class="fft-spectrum-status small text-muted border rounded p-2">Configure a CSV file or leave it blank to follow the latest CSV in a directory.</div>');
            this.plotsHost = $('<div class="d-flex flex-column gap-2"></div>');
            this.tableHost = $('<div class="fft-spectrum-thd-table border rounded p-2"></div>');

            this.dataset = null;
            this.availableColumns = [];
            this.availableFiles = [];
            this.lastFileSignature = '';
            this.lastRenderedSignature = '';
            this.lastResolvedPath = '';
            this.lastComputation = null;
            this.pollTimer = null;
            this._resizeObs = null;
            this._resizeRAF = 0;
            this._refreshSeq = 0;
            this._dragCleanup = [];
            this.plots = {
                time: null,
                spectrum: null,
                harmonics: null
            };

            this.slots = {
                time: this._createSlot('Time domain', 220),
                spectrum: this._createSlot('FFT spectrum', 260),
                harmonics: this._createSlot('Harmonic amplitudes', 220)
            };

            this.toolbar.append(this.chooseButton, this.refreshButton, this.status);
            this.plotsHost.append(this.slots.time.shell, this.slots.spectrum.shell, this.slots.harmonics.shell);
            this.tableHost.html('<div class="small text-muted">No analysis yet.</div>');
            this.container.append(this.toolbar, this.plotsHost, this.tableHost);

            this.chooseButton.on('click', () => this._chooseCsvFile());
            this.refreshButton.on('click', () => this._refresh(true));
        }

        _createSlot(title, defaultHeight) {
            const shell = $('<div class="fft-spectrum-panel border rounded p-2"></div>');
            const titleEl = $(`<div class="fft-spectrum-title">${title}</div>`);
            const host = $('<div class="fft-spectrum-chart-host"></div>');
            const legendHost = $('<div class="fft-spectrum-legend"></div>');
            const handle = $('<div class="fft-spectrum-resize-handle" title="Drag to resize plot"></div>');
            shell.append(titleEl, host, legendHost, handle);

            const slot = {
                shell,
                host,
                legendHost,
                handle,
                plot: null,
                heightPx: defaultHeight
            };

            this._applySlotHeight(slot);
            this._bindHeightDrag(slot);
            return slot;
        }

        render(el) {
            this.hostElement = el || null;
            $(el).append(this.container);
            this._applyVisibility();
            this._bindResize();
            this._restartPolling();
            this._requestResize();
        }

        async _chooseCsvFile() {
            const chooser = shared?.fileApi?.chooseCsvFile || window.api?.files?.chooseCsvFile;
            if (!chooser) return;
            const chosen = await chooser();
            if (!chosen) return;

            const csvDirectory = shared?.pathApi?.dirname ? shared.pathApi.dirname(chosen) : (this.settings.csvDirectory || shared.defaultCsvDirectory());
            this._persistSettings({
                csvPath: chosen,
                csvDirectory,
                csvSourceMode: 'fixed'
            });
        }

        _persistSettings(partial) {
            const widget = this._getWidgetModel();
            if (widget) {
                widget.settings({ ...(widget.settings() || {}), ...partial });
                return;
            }

            this.settings = { ...this.settings, ...partial };
            this.onSettingsChanged(this.settings);
        }

        _getWidgetModel() {
            const model = freeboard.getLiveModel?.();
            if (!model || typeof model.panes !== 'function') return null;

            for (const pane of model.panes()) {
                if (!pane || typeof pane.widgets !== 'function') continue;
                for (const widget of pane.widgets()) {
                    if (widget?.widgetInstance === this) return widget;
                }
            }
            return null;
        }

        _bindHeightDrag(slot) {
            slot.handle.on('mousedown', (event) => {
                event.preventDefault();
                const startY = event.clientY;
                const startHeight = slot.heightPx;

                const onMove = (moveEvent) => {
                    slot.heightPx = Math.max(160, startHeight + (moveEvent.clientY - startY));
                    this._applySlotHeight(slot);
                    this._requestResize();
                };

                const onUp = () => {
                    $(window)
                        .off('mousemove.fft-spectrum-resize', onMove)
                        .off('mouseup.fft-spectrum-resize', onUp);
                };

                $(window)
                    .on('mousemove.fft-spectrum-resize', onMove)
                    .on('mouseup.fft-spectrum-resize', onUp);

                this._dragCleanup.push(onUp);
            });
        }

        _applySlotHeight(slot) {
            slot.host.css('height', `${Math.max(160, slot.heightPx)}px`);
        }

        _bindResize() {
            if (this._resizeObs) {
                try { this._resizeObs.disconnect(); } catch {}
                this._resizeObs = null;
            }

            if (typeof ResizeObserver !== 'function' || !this.hostElement) return;
            this._resizeObs = new ResizeObserver(() => this._requestResize());
            this._resizeObs.observe(this.hostElement);
        }

        _requestResize() {
            if (this._resizeRAF) cancelAnimationFrame(this._resizeRAF);
            this._resizeRAF = requestAnimationFrame(() => {
                this._resizeRAF = 0;
                this._resizeAllPlots();
            });
        }

        _resizeAllPlots() {
            Object.values(this.slots).forEach((slot) => {
                if (!slot.plot) return;
                try {
                    slot.plot.setSize({
                        width: Math.max(320, slot.host.width() || this.container.width() || 640),
                        height: Math.max(160, slot.host.height() || slot.heightPx)
                    });
                } catch {}
            });
        }

        _applyVisibility() {
            this.slots.time.shell.toggle(this.settings.showTimeDomain !== false);
            this.slots.spectrum.shell.toggle(this.settings.showSpectrum !== false);
            this.slots.harmonics.shell.toggle(this.settings.showHarmonicBars !== false);
        }

        _restartPolling() {
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
                this.pollTimer = null;
            }

            this._refresh();

            const explicitPath = shared.normalizePath(this.settings.csvPath || this.settings.csvFile);
            const shouldPoll = !explicitPath || shared.getCsvSourceMode(this.settings) === 'latest';
            if (shouldPoll) {
                this.pollTimer = setInterval(() => this._refresh(), DEFAULT_POLL_MS);
            }
        }

        async _resolveSource() {
            const explicitPath = shared.normalizePath(this.settings.csvPath || this.settings.csvFile);
            let sourceMode = shared.getCsvSourceMode(this.settings);
            if (!this.settings.csvSourceMode) sourceMode = explicitPath ? 'fixed' : 'latest';
            if (!explicitPath && sourceMode === 'fixed') sourceMode = 'latest';

            const csvDirectory = shared.normalizePath(this.settings.csvDirectory) || (explicitPath && shared.pathApi?.dirname ? shared.pathApi.dirname(explicitPath) : shared.defaultCsvDirectory());
            const availableFiles = sourceMode === 'latest' ? await shared.listCsvFiles(csvDirectory) : [];
            const source = shared.resolveCsvSource({
                csvSourceMode: sourceMode,
                csvPath: explicitPath
            }, availableFiles);

            return {
                mode: sourceMode,
                filePath: source.filePath,
                directory: csvDirectory,
                files: availableFiles
            };
        }

        async _refresh(force = false) {
            const refreshId = ++this._refreshSeq;
            const source = await this._resolveSource();
            if (refreshId !== this._refreshSeq) return;

            this.availableFiles = source.files;

            if (!source.filePath) {
                const message = source.mode === 'latest'
                    ? `No CSV files found in ${shared.displayPath(source.directory)}.`
                    : 'Choose a CSV file to analyze.';
                this.dataset = null;
                this.availableColumns = [];
                this.lastComputation = null;
                this.lastResolvedPath = '';
                this._renderEmpty(message);
                return;
            }

            const loadSignature = (force || source.filePath !== this.lastResolvedPath) ? '' : this.lastFileSignature;
            const loaded = await shared.loadCsvDataset(source.filePath, loadSignature);
            if (refreshId !== this._refreshSeq) return;

            this.lastResolvedPath = source.filePath;

            if (loaded.changed) {
                this.dataset = loaded.dataset;
                this.lastFileSignature = loaded.signature;
                this.availableColumns = this.dataset ? this.dataset.headers.filter((header) => header !== 'k_acquire') : [];
                this.lastRenderedSignature = '';
            }

            if (!this.dataset || !Array.isArray(this.dataset.headers) || this.dataset.headers.length === 0 || !Array.isArray(this.dataset.rows) || !this.dataset.rows.length) {
                this.lastComputation = null;
                this._renderEmpty(`Unable to read data from ${shared.displayPath(source.filePath)}.`);
                return;
            }

            const renderSignature = JSON.stringify({
                filePath: source.filePath,
                fileSignature: this.lastFileSignature,
                channelDefs: this.settings.channelDefs || [],
                signalColumns: this.settings.signalColumns || '',
                timeColumn: this.settings.timeColumn || '',
                samplingPeriodUs: this.settings.samplingPeriodUs || '',
                fundamentalFreqHz: this.settings.fundamentalFreqHz || '',
                maxFreqHz: this.settings.maxFreqHz || '',
                maxHarmonic: this.settings.maxHarmonic || '',
                showTimeDomain: this.settings.showTimeDomain !== false,
                showSpectrum: this.settings.showSpectrum !== false,
                showHarmonicBars: this.settings.showHarmonicBars !== false,
                logScaleSpectrum: this.settings.logScaleSpectrum !== false
            });

            if (!force && renderSignature === this.lastRenderedSignature) return;
            this.lastRenderedSignature = renderSignature;

            const result = this._computeAnalysis(this.dataset, source);
            if (!result.ok) {
                this.lastComputation = null;
                this._renderEmpty(result.message);
                return;
            }

            this.lastComputation = result;
            this._renderResult(result);
        }

        _computeAnalysis(dataset, source) {
            const samplePeriodUs = parsePositiveNumber(this.settings.samplingPeriodUs, 100);
            const samplePeriodSec = samplePeriodUs / 1e6;
            const sampleRate = 1 / samplePeriodSec;
            const fundamentalFreqHz = parsePositiveNumber(this.settings.fundamentalFreqHz, 50);
            const maxFreqHz = parsePositiveNumber(this.settings.maxFreqHz, 1000);
            const maxHarmonic = parsePositiveInteger(this.settings.maxHarmonic, 11);
            const timeColumn = shared.normalizePath(this.settings.timeColumn);
            const warnings = [];

            let channelDefs = normalizeFftChannelDefs(this.settings);
            if (!channelDefs.length) {
                const autoSel = resolveSignalColumns(dataset, '', timeColumn);
                if (!autoSel.columns.length) {
                    return { ok: false, message: 'No numeric signal columns were found to analyze.' };
                }
                channelDefs = autoSel.columns.map((col) => ({ variable: col }));
            } else {
                const missing = channelDefs
                    .filter((d) => !d.type || d.type !== 'math')
                    .filter((d) => d.variable && !hasFiniteValue(dataset.columns[d.variable]))
                    .map((d) => d.variable);
                if (missing.length) warnings.push(`Missing columns ignored: ${missing.join(', ')}`);
                channelDefs = channelDefs.filter((def) => {
                    if (def.type === 'math') return true;
                    return def.variable && hasFiniteValue(dataset.columns[def.variable]);
                });
                if (!channelDefs.length) {
                    return { ok: false, message: `Signal columns not found in CSV. ${warnings.join(' ')}` };
                }
            }

            const timeSource = timeColumn && Array.isArray(dataset.columns[timeColumn]) ? dataset.columns[timeColumn] : null;
            const timeAxis = (timeSource || dataset.rows.map((_row, index) => index * samplePeriodSec * 1000))
                .map((value, index) => Number.isFinite(value) ? value : index * samplePeriodSec * 1000);
            const timeLabel = timeSource ? timeColumn : 'Time (ms)';
            if (timeColumn && !timeSource) {
                warnings.push(`Time column "${timeColumn}" was not found. Using sample index × TS.`);
            }

            const harmonicOrders = Array.from({ length: maxHarmonic }, (_value, index) => index + 1);
            const signalResults = [];
            let spectrumAxis = [];

            channelDefs.forEach((def, index) => {
                const color = def.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length];
                let rawValues, label;
                if (def.type === 'math') {
                    rawValues = computeMathValues(dataset, def.operandA, def.operator, def.operandB);
                    label = def.label || `${def.operandA} ${def.operator} ${def.operandB}`;
                } else {
                    rawValues = Array.isArray(dataset.columns[def.variable]) ? dataset.columns[def.variable] : [];
                    label = def.label || def.variable;
                }

                const plotValues = rawValues.map((value) => Number.isFinite(value) ? value : null);
                const fftInput = rawValues.map((value) => Number.isFinite(value) ? value : 0);
                const fft = fftReal(fftInput, sampleRate);
                const cutoffIndex = fft.freqs.findIndex((freq) => freq > maxFreqHz);
                const lastIndex = cutoffIndex === -1 ? fft.freqs.length : Math.max(2, cutoffIndex);
                const freqs = fft.freqs.slice(0, lastIndex);
                const magnitudes = fft.magnitudes.slice(0, lastIndex);
                if (!spectrumAxis.length) spectrumAxis = freqs;

                const harmonics = harmonicOrders.map((order) => {
                    const frequencyHz = order * fundamentalFreqHz;
                    const bin = Math.round(frequencyHz / fft.df);
                    const amplitude = bin >= 0 && bin < fft.magnitudes.length ? fft.magnitudes[bin] : 0;
                    return { order, frequencyHz, amplitude };
                });

                const fundamental = harmonics[0]?.amplitude || 0;
                const thdNumerator = Math.sqrt(harmonics.slice(1).reduce((sum, harmonic) => sum + harmonic.amplitude * harmonic.amplitude, 0));
                const thdPercent = fundamental > 0 ? (thdNumerator / fundamental) * 100 : null;

                signalResults.push({
                    signal: label,
                    color,
                    timeSeries: plotValues,
                    spectrum: magnitudes,
                    harmonics,
                    fundamentalAmplitude: fundamental,
                    thdPercent
                });
            });

            return {
                ok: true,
                sourcePath: source.filePath,
                sourceMode: source.mode,
                sourceDirectory: source.directory,
                rowCount: dataset.rows.length,
                sampleRate,
                samplePeriodUs,
                fundamentalFreqHz,
                maxFreqHz,
                maxHarmonic,
                timeAxis,
                timeLabel,
                signalColumns: channelDefs.map((d) => d.variable || d.label || ''),
                spectrumAxis,
                harmonicOrders,
                signals: signalResults,
                warnings
            };
        }

        _renderEmpty(message) {
            this.status.text(message);
            this._destroyAllPlots();
            this.tableHost.html(`<div class="fft-spectrum-empty">${_.escape(message)}</div>`);
        }

        _renderResult(result) {
            this._applyVisibility();

            const prefix = result.sourceMode === 'latest' ? 'Latest CSV' : 'Loaded CSV';
            const statusParts = [
                `${prefix}: ${shared.displayPath(result.sourcePath)}`,
                `${result.rowCount} rows`,
                `Fs ${formatNumber(result.sampleRate, 2)} Hz`,
                `F0 ${formatNumber(result.fundamentalFreqHz, 2)} Hz`
            ];
            if (result.warnings.length) statusParts.push(result.warnings.join(' | '));
            this.status.text(statusParts.join(' | '));

            if (this.settings.showTimeDomain !== false) {
                const timeSeries = result.signals.map((entry) => entry.timeSeries);
                const yExtent = computeTimeExtent(timeSeries);
                this._renderLinePlot(this.slots.time, {
                    xLabel: result.timeLabel,
                    yLabel: 'Amplitude',
                    xValues: result.timeAxis,
                    ySeries: result.signals.map((entry) => ({
                        label: entry.signal,
                        color: entry.color,
                        values: entry.timeSeries
                    })),
                    yScale: { min: yExtent.min, max: yExtent.max }
                });
                this.plots.time = this.slots.time.plot;
            } else {
                this._destroySlot(this.slots.time);
                this.plots.time = null;
            }

            if (this.settings.showSpectrum !== false) {
                const positiveSpectra = result.signals.map((entry) => entry.spectrum.map((value) => value > 0 ? value : 1e-12));
                const yExtent = computePositiveExtent(positiveSpectra);
                this._renderSpectrumPlot(this.slots.spectrum, {
                    xValues: result.spectrumAxis,
                    xMax: result.maxFreqHz,
                    ySeries: result.signals.map((entry) => ({
                        label: entry.signal,
                        color: entry.color,
                        values: entry.spectrum.map((value) => value > 0 ? value : 1e-12)
                    })),
                    yScale: yExtent,
                    fundamentalFreqHz: result.fundamentalFreqHz,
                    maxHarmonic: result.maxHarmonic,
                    logScale: this.settings.logScaleSpectrum !== false
                });
                this.plots.spectrum = this.slots.spectrum.plot;
            } else {
                this._destroySlot(this.slots.spectrum);
                this.plots.spectrum = null;
            }

            if (this.settings.showHarmonicBars !== false) {
                this._renderHarmonicPlot(this.slots.harmonics, result);
                this.plots.harmonics = this.slots.harmonics.plot;
            } else {
                this._destroySlot(this.slots.harmonics);
                this.plots.harmonics = null;
            }

            this.tableHost.html(this._buildTableHtml(result));
            this._requestResize();
        }

        _renderLinePlot(slot, config) {
            this._destroySlot(slot);
            const host = slot.host.get(0);
            if (!host || !window.uPlot) return;
            host.innerHTML = '';

            const data = [config.xValues].concat(config.ySeries.map((series) => series.values));
            const series = [{ label: config.xLabel }];
            config.ySeries.forEach((entry) => {
                series.push({
                    label: entry.label,
                    stroke: entry.color,
                    width: 2,
                    spanGaps: true
                });
            });

            slot.plot = new uPlot({
                width: Math.max(320, slot.host.width() || this.container.width() || 640),
                height: Math.max(160, slot.host.height() || slot.heightPx),
                legend: { show: true, mount: (u, el) => slot.legendHost[0].appendChild(el) },
                scales: {
                    x: { time: false },
                    y: config.yScale
                },
                axes: [
                    { stroke: '#666', grid: { show: true }, label: config.xLabel },
                    { stroke: '#666', grid: { show: true }, label: config.yLabel }
                ],
                series
            }, data, host);
        }

        _renderSpectrumPlot(slot, config) {
            this._destroySlot(slot);
            const host = slot.host.get(0);
            if (!host || !window.uPlot) return;
            host.innerHTML = '';

            const data = [config.xValues].concat(config.ySeries.map((series) => series.values));
            const series = [{ label: 'Frequency (Hz)' }];
            config.ySeries.forEach((entry) => {
                series.push({
                    label: entry.label,
                    stroke: entry.color,
                    width: 2
                });
            });

            slot.plot = new uPlot({
                width: Math.max(320, slot.host.width() || this.container.width() || 640),
                height: Math.max(160, slot.host.height() || slot.heightPx),
                legend: { show: true, mount: (u, el) => slot.legendHost[0].appendChild(el) },
                scales: {
                    x: { time: false, min: 0, max: config.xMax },
                    y: config.logScale
                        ? { min: config.yScale.min, max: config.yScale.max, distr: 3, log: 10 }
                        : { min: config.yScale.min, max: config.yScale.max }
                },
                axes: [
                    { stroke: '#666', grid: { show: true }, label: 'Frequency (Hz)' },
                    { stroke: '#666', grid: { show: true }, label: 'Amplitude' }
                ],
                series,
                hooks: {
                    draw: [
                        (u) => {
                            const ctx = u.ctx;
                            const left = u.bbox.left;
                            const right = left + u.bbox.width;
                            const top = u.bbox.top;
                            const bottom = top + u.bbox.height;

                            ctx.save();
                            ctx.setLineDash([4, 4]);
                            ctx.strokeStyle = 'rgba(220, 80, 80, 0.35)';
                            ctx.fillStyle = 'rgba(220, 80, 80, 0.75)';
                            ctx.font = '10px sans-serif';

                            for (let harmonic = 1; harmonic <= config.maxHarmonic; harmonic++) {
                                const freq = harmonic * config.fundamentalFreqHz;
                                if (freq > config.xMax) break;
                                const xPos = u.valToPos(freq, 'x', true);
                                if (xPos < left || xPos > right) continue;
                                ctx.beginPath();
                                ctx.moveTo(xPos, top);
                                ctx.lineTo(xPos, bottom);
                                ctx.stroke();
                                ctx.fillText(`h${harmonic}`, xPos + 3, top + 12);
                            }

                            ctx.restore();
                        }
                    ]
                }
            }, data, host);
        }

        _renderHarmonicPlot(slot, result) {
            this._destroySlot(slot);
            const host = slot.host.get(0);
            if (!host || !window.uPlot) return;
            host.innerHTML = '';

            const data = [result.harmonicOrders];
            result.signals.forEach((entry) => data.push(entry.harmonics.map((harmonic) => harmonic.amplitude)));

            const yMax = Math.max(1, ...result.signals.flatMap((entry) => entry.harmonics.map((harmonic) => harmonic.amplitude)));
            const signalColors = result.signals.map((entry) => entry.color);
            const series = [{ label: 'Harmonic' }];
            result.signals.forEach((entry) => {
                series.push({
                    label: entry.signal,
                    stroke: entry.color,
                    width: 0,
                    points: { show: false },
                    paths: () => null
                });
            });

            slot.plot = new uPlot({
                width: Math.max(320, slot.host.width() || this.container.width() || 640),
                height: Math.max(160, slot.host.height() || slot.heightPx),
                legend: { show: false },
                scales: {
                    x: { time: false, min: 0.5, max: result.maxHarmonic + 0.5 },
                    y: { min: 0, max: yMax * 1.15 }
                },
                axes: [
                    {
                        stroke: '#666',
                        grid: { show: false },
                        label: 'Harmonic number',
                        values: (_u, values) => values.map((value) => `h${Math.round(value)}`)
                    },
                    { stroke: '#666', grid: { show: true }, label: 'Amplitude' }
                ],
                series,
                hooks: {
                    drawSeries: [
                        (u, seriesIdx) => {
                            if (seriesIdx === 0) return;

                            const ctx = u.ctx;
                            const values = u.data[seriesIdx];
                            const xs = u.data[0];
                            const seriesCount = u.data.length - 1;
                            const baseY = u.valToPos(0, 'y', true);
                            const step = xs.length > 1
                                ? Math.abs(u.valToPos(xs[1], 'x', true) - u.valToPos(xs[0], 'x', true))
                                : u.bbox.width * 0.6;
                            const groupWidth = Math.max(16, step * 0.72);
                            const gap = Math.min(4, groupWidth * 0.08);
                            const barWidth = Math.max(6, (groupWidth - gap * Math.max(0, seriesCount - 1)) / Math.max(1, seriesCount));
                            const offsetBase = -groupWidth / 2;
                            const xOffset = offsetBase + (seriesIdx - 1) * (barWidth + gap);

                            ctx.save();
                            ctx.fillStyle = signalColors[seriesIdx - 1] || DEFAULT_COLORS[(seriesIdx - 1) % DEFAULT_COLORS.length];
                            ctx.font = '10px sans-serif';
                            ctx.textAlign = 'center';

                            values.forEach((value, index) => {
                                if (!Number.isFinite(value)) return;
                                const centerX = u.valToPos(xs[index], 'x', true);
                                const topY = u.valToPos(value, 'y', true);
                                const x = centerX + xOffset;
                                const height = Math.max(1, baseY - topY);
                                ctx.fillRect(x, topY, barWidth, height);
                                ctx.fillText(formatNumber(value, 2), x + barWidth / 2, topY - 4);
                            });

                            ctx.restore();
                        }
                    ]
                }
            }, data, host);
        }

        _buildTableHtml(result) {
            const rows = result.signals.map((entry) => (
                `<tr>` +
                `<td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${_.escape(entry.color)};margin-right:8px;"></span>${_.escape(entry.signal)}</td>` +
                `<td>${_.escape(formatNumber(entry.fundamentalAmplitude, 3))}</td>` +
                `<td>${entry.thdPercent === null ? '---' : _.escape(formatNumber(entry.thdPercent, 2))}</td>` +
                `</tr>`
            )).join('');

            return (
                `<div class="small text-muted mb-2">THD summary (h2-h${_.escape(String(result.maxHarmonic))})</div>` +
                `<table class="table table-sm table-dark table-striped mb-0">` +
                `<thead><tr><th>Signal</th><th>h1 amplitude</th><th>THD (%)</th></tr></thead>` +
                `<tbody>${rows}</tbody>` +
                `</table>`
            );
        }

        _destroySlot(slot) {
            if (!slot?.plot) return;
            try { slot.plot.destroy(); } catch {}
            slot.plot = null;
            if (slot.host?.[0]) slot.host[0].innerHTML = '';
            if (slot.legendHost) slot.legendHost.empty();
        }

        _destroyAllPlots() {
            Object.values(this.slots).forEach((slot) => this._destroySlot(slot));
            this.plots.time = null;
            this.plots.spectrum = null;
            this.plots.harmonics = null;
        }

        onSettingsChanged(newSettings) {
            this.settings = { ...newSettings };
            this.lastFileSignature = '';
            this.lastRenderedSignature = '';
            this.lastResolvedPath = '';
            this._applyVisibility();
            this._restartPolling();
        }

        onSizeChanged() {
            this._requestResize();
        }

        onDispose() {
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
                this.pollTimer = null;
            }
            if (this._resizeObs) {
                try { this._resizeObs.disconnect(); } catch {}
                this._resizeObs = null;
            }
            if (this._resizeRAF) {
                cancelAnimationFrame(this._resizeRAF);
                this._resizeRAF = 0;
            }
            while (this._dragCleanup.length) {
                const cleanup = this._dragCleanup.pop();
                try { cleanup(); } catch {}
            }
            this._destroyAllPlots();
        }

        getHeight() {
            const visibleCount = [
                this.settings.showTimeDomain !== false,
                this.settings.showSpectrum !== false,
                this.settings.showHarmonicBars !== false
            ].filter(Boolean).length;
            return Math.max(8, 2 + visibleCount * 6);
        }
    }
}());
