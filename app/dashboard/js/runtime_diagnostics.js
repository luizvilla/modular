(function () {
    const nativeSetTimeout = window.setTimeout.bind(window);
    const nativeClearTimeout = window.clearTimeout.bind(window);
    const nativeSetInterval = window.setInterval.bind(window);
    const nativeClearInterval = window.clearInterval.bind(window);
    const nativeRequestAnimationFrame = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : null;
    const nativeCancelAnimationFrame = typeof window.cancelAnimationFrame === 'function'
        ? window.cancelAnimationFrame.bind(window)
        : null;

    const activeTimeouts = new Map();
    const activeIntervals = new Map();
    const activeAnimationFrames = new Map();
    const listenerCounts = new Map();

    let totalAdds = 0;
    let totalRemoves = 0;

    function clampNumber(value) {
        return Number.isFinite(value) ? value : null;
    }

    function updateCounter(map, key, delta) {
        if (!key) return;
        const next = Math.max(0, (map.get(key) || 0) + delta);
        if (next === 0) map.delete(key);
        else map.set(key, next);
    }

    window.setTimeout = function (handler, timeout) {
        const startedAt = Date.now();
        const delay = Number(timeout) || 0;
        let handle = null;
        const wrapped = function () {
            activeTimeouts.delete(handle);
            if (typeof handler === 'function') return handler.apply(this, arguments);
            return window.eval(handler);
        };
        handle = nativeSetTimeout(wrapped, timeout);
        activeTimeouts.set(handle, { startedAt, delay });
        return handle;
    };

    window.clearTimeout = function (handle) {
        activeTimeouts.delete(handle);
        return nativeClearTimeout(handle);
    };

    window.setInterval = function (handler, timeout) {
        const handle = nativeSetInterval(handler, timeout);
        activeIntervals.set(handle, {
            startedAt: Date.now(),
            delay: Number(timeout) || 0
        });
        return handle;
    };

    window.clearInterval = function (handle) {
        activeIntervals.delete(handle);
        return nativeClearInterval(handle);
    };

    if (nativeRequestAnimationFrame && nativeCancelAnimationFrame) {
        window.requestAnimationFrame = function (callback) {
            let handle = null;
            const wrapped = function (ts) {
                activeAnimationFrames.delete(handle);
                return callback(ts);
            };
            handle = nativeRequestAnimationFrame(wrapped);
            activeAnimationFrames.set(handle, { startedAt: Date.now() });
            return handle;
        };

        window.cancelAnimationFrame = function (handle) {
            activeAnimationFrames.delete(handle);
            return nativeCancelAnimationFrame(handle);
        };
    }

    if (window.EventTarget && window.EventTarget.prototype) {
        const originalAddEventListener = window.EventTarget.prototype.addEventListener;
        const originalRemoveEventListener = window.EventTarget.prototype.removeEventListener;

        window.EventTarget.prototype.addEventListener = function (type, listener, options) {
            totalAdds += 1;
            updateCounter(listenerCounts, String(type || 'unknown'), 1);
            return originalAddEventListener.call(this, type, listener, options);
        };

        window.EventTarget.prototype.removeEventListener = function (type, listener, options) {
            totalRemoves += 1;
            updateCounter(listenerCounts, String(type || 'unknown'), -1);
            return originalRemoveEventListener.call(this, type, listener, options);
        };
    }

    const lagSamples = [];
    let lastLagTick = performance.now();
    nativeSetInterval(function () {
        const now = performance.now();
        const lag = Math.max(0, now - lastLagTick - 1000);
        lastLagTick = now;
        lagSamples.push(lag);
        if (lagSamples.length > 120) lagSamples.shift();
    }, 1000);

    function topEntries(map, limit) {
        return Array.from(map.entries())
            .sort(function (a, b) { return b[1] - a[1]; })
            .slice(0, limit)
            .map(function (entry) {
                return { key: entry[0], count: entry[1] };
            });
    }

    function collectRuntimeSnapshot() {
        const memory = performance && performance.memory ? {
            usedJSHeapSize: clampNumber(performance.memory.usedJSHeapSize),
            totalJSHeapSize: clampNumber(performance.memory.totalJSHeapSize),
            jsHeapSizeLimit: clampNumber(performance.memory.jsHeapSizeLimit)
        } : null;
        const lagAverage = lagSamples.length
            ? lagSamples.reduce(function (sum, value) { return sum + value; }, 0) / lagSamples.length
            : 0;
        const lagMax = lagSamples.length ? Math.max.apply(null, lagSamples) : 0;

        return {
            timestamp: Date.now(),
            memory,
            domNodes: document.getElementsByTagName('*').length,
            timers: {
                timeouts: activeTimeouts.size,
                intervals: activeIntervals.size,
                animationFrames: activeAnimationFrames.size
            },
            listeners: {
                activeTotal: Array.from(listenerCounts.values()).reduce(function (sum, value) { return sum + value; }, 0),
                totalAdds,
                totalRemoves,
                byType: topEntries(listenerCounts, 8)
            },
            eventLoop: {
                sampleCount: lagSamples.length,
                averageLagMs: clampNumber(Number(lagAverage.toFixed(2))),
                maxLagMs: clampNumber(Number(lagMax.toFixed(2)))
            }
        };
    }

    function formatBytes(bytes) {
        if (!Number.isFinite(bytes)) return '--';
        const mb = bytes / (1024 * 1024);
        return mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : mb.toFixed(1) + ' MB';
    }

    function formatNumber(value) {
        return Number.isFinite(value) ? value.toLocaleString() : '--';
    }

    function shortTime(timestamp) {
        if (!Number.isFinite(timestamp)) return '--';
        return new Date(timestamp).toLocaleTimeString();
    }

    function collectFreeboardSnapshot() {
        const model = window.freeboard && typeof window.freeboard.getLiveModel === 'function'
            ? window.freeboard.getLiveModel()
            : window.freeboardModel || null;
        if (!model) {
            return { panes: 0, widgets: 0, datasources: 0 };
        }
        const panes = typeof model.panes === 'function' ? model.panes() : [];
        const datasources = typeof model.datasources === 'function' ? model.datasources() : [];
        const widgets = panes.reduce(function (sum, pane) {
            if (!pane || typeof pane.widgets !== 'function') return sum;
            return sum + pane.widgets().length;
        }, 0);
        return {
            panes: panes.length,
            widgets,
            datasources: datasources.length
        };
    }

    const state = {
        history: [],
        maxSamples: 180,
        panelVisible: false,
        takingSample: false,
        latestSample: null
    };

    function buildSample(rendererOnly) {
        return Promise.resolve().then(async function () {
            const renderer = collectRuntimeSnapshot();
            const freeboard = collectFreeboardSnapshot();
            let main = null;
            try {
                const diagnosticsApi = window.api && window.api.diagnostics ? window.api.diagnostics : null;
                if (!rendererOnly && diagnosticsApi && diagnosticsApi.captureSnapshot) {
                    main = await diagnosticsApi.captureSnapshot();
                }
            } catch (err) {
                main = { error: err && err.message ? err.message : String(err) };
            }
            return {
                capturedAt: Date.now(),
                renderer,
                freeboard,
                main
            };
        });
    }

    function pushSample(sample) {
        state.latestSample = sample;
        state.history.push(sample);
        if (state.history.length > state.maxSamples) {
            state.history.splice(0, state.history.length - state.maxSamples);
        }
    }

    async function takeSample(reason) {
        if (state.takingSample) return state.latestSample;
        state.takingSample = true;
        try {
            const sample = await buildSample(false);
            sample.reason = reason || 'manual';
            pushSample(sample);
            renderPanel();
            return sample;
        } finally {
            state.takingSample = false;
        }
    }

    function slopeText(getValue) {
        if (state.history.length < 2) return '--';
        const first = getValue(state.history[0]);
        const last = getValue(state.history[state.history.length - 1]);
        if (!Number.isFinite(first) || !Number.isFinite(last)) return '--';
        const delta = last - first;
        const sign = delta > 0 ? '+' : '';
        return sign + formatBytes(delta);
    }

    function createPanel() {
        if (document.getElementById('modular-diagnostics-panel')) return;

        const style = document.createElement('style');
        style.textContent = [
            '#modular-diagnostics-panel { position: fixed; right: 16px; bottom: 16px; width: 420px; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); overflow: auto; z-index: 20000; background: rgba(14,18,24,0.96); color: #dce6f2; border: 1px solid rgba(120,140,160,0.45); border-radius: 12px; box-shadow: 0 18px 48px rgba(0,0,0,0.35); font: 12px/1.45 Consolas, Monaco, monospace; }',
            '#modular-diagnostics-panel[hidden] { display: none !important; }',
            '#modular-diagnostics-panel .diag-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px; border-bottom: 1px solid rgba(120,140,160,0.25); }',
            '#modular-diagnostics-panel .diag-title { font-size: 13px; font-weight: 700; letter-spacing: 0.02em; }',
            '#modular-diagnostics-panel .diag-actions { display: flex; gap: 6px; flex-wrap: wrap; }',
            '#modular-diagnostics-panel button { background: #223043; color: #eef4fb; border: 1px solid rgba(140,170,200,0.3); border-radius: 8px; padding: 5px 8px; cursor: pointer; }',
            '#modular-diagnostics-panel button:hover { background: #2b4058; }',
            '#modular-diagnostics-panel .diag-body { padding: 12px 14px 14px; }',
            '#modular-diagnostics-panel .diag-note { color: #97a8bb; margin-bottom: 10px; }',
            '#modular-diagnostics-panel .diag-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px; }',
            '#modular-diagnostics-panel .diag-card { border: 1px solid rgba(120,140,160,0.22); border-radius: 8px; padding: 8px; background: rgba(255,255,255,0.02); }',
            '#modular-diagnostics-panel .diag-card strong { display: block; color: #8bb8ff; margin-bottom: 4px; }',
            '#modular-diagnostics-panel .diag-meta { color: #97a8bb; margin-bottom: 10px; }',
            '#modular-diagnostics-panel pre { margin: 0; white-space: pre-wrap; word-break: break-word; color: #dce6f2; }'
        ].join('');
        document.head.appendChild(style);

        const panel = document.createElement('aside');
        panel.id = 'modular-diagnostics-panel';
        panel.hidden = true;
        panel.innerHTML = [
            '<div class="diag-head">',
            '  <div class="diag-title">Runtime Diagnostics</div>',
            '  <div class="diag-actions">',
            '    <button type="button" data-action="sample">Snapshot</button>',
            '    <button type="button" data-action="export">Export JSON</button>',
            '    <button type="button" data-action="clear">Clear</button>',
            '    <button type="button" data-action="hide">Close</button>',
            '  </div>',
            '</div>',
            '<div class="diag-body">',
            '  <div class="diag-note">Toggle with Ctrl+Shift+M. Reproduce the slowdown, then export the report.</div>',
            '  <div class="diag-meta" id="modular-diagnostics-meta">Collecting samples...</div>',
            '  <div class="diag-grid" id="modular-diagnostics-grid"></div>',
            '  <pre id="modular-diagnostics-details"></pre>',
            '</div>'
        ].join('');
        document.body.appendChild(panel);

        panel.addEventListener('click', function (event) {
            const button = event.target.closest('button[data-action]');
            if (!button) return;
            const action = button.getAttribute('data-action');
            if (action === 'sample') {
                takeSample('manual');
            } else if (action === 'export') {
                exportReport();
            } else if (action === 'clear') {
                state.history = [];
                state.latestSample = null;
                renderPanel();
            } else if (action === 'hide') {
                hidePanel();
            }
        });
    }

    function renderPanel() {
        const panel = document.getElementById('modular-diagnostics-panel');
        if (!panel) return;
        const meta = document.getElementById('modular-diagnostics-meta');
        const grid = document.getElementById('modular-diagnostics-grid');
        const details = document.getElementById('modular-diagnostics-details');
        const sample = state.latestSample;

        if (!sample) {
            meta.textContent = 'No samples yet.';
            grid.innerHTML = '';
            details.textContent = '';
            return;
        }

        const mainMemory = sample.main && sample.main.process && sample.main.process.memory ? sample.main.process.memory : null;
        const rendererMemory = sample.renderer && sample.renderer.memory ? sample.renderer.memory : null;
        const eventLoop = sample.renderer ? sample.renderer.eventLoop : null;
        const timers = sample.renderer ? sample.renderer.timers : null;
        const listeners = sample.renderer ? sample.renderer.listeners : null;

        meta.textContent = [
            'Last sample: ' + shortTime(sample.capturedAt),
            'History: ' + state.history.length,
            'Main RSS drift: ' + slopeText(function (entry) { return entry.main && entry.main.process && entry.main.process.memory ? entry.main.process.memory.rss : NaN; }),
            'Renderer heap drift: ' + slopeText(function (entry) { return entry.renderer && entry.renderer.memory ? entry.renderer.memory.usedJSHeapSize : NaN; })
        ].join(' | ');

        const cards = [
            { label: 'Main RSS', value: mainMemory ? formatBytes(mainMemory.rss) : '--', extra: mainMemory ? 'heap ' + formatBytes(mainMemory.heapUsed) : 'no main snapshot' },
            { label: 'Renderer Heap', value: rendererMemory ? formatBytes(rendererMemory.usedJSHeapSize) : '--', extra: rendererMemory ? 'limit ' + formatBytes(rendererMemory.jsHeapSizeLimit) : 'performance.memory unavailable' },
            { label: 'DOM Nodes', value: formatNumber(sample.renderer.domNodes), extra: 'panes ' + formatNumber(sample.freeboard.panes) + ' | widgets ' + formatNumber(sample.freeboard.widgets) },
            { label: 'Datasources', value: formatNumber(sample.freeboard.datasources), extra: 'timeouts ' + formatNumber(timers ? timers.timeouts : NaN) + ' | intervals ' + formatNumber(timers ? timers.intervals : NaN) },
            { label: 'Listeners', value: formatNumber(listeners ? listeners.activeTotal : NaN), extra: 'adds ' + formatNumber(listeners ? listeners.totalAdds : NaN) + ' | removes ' + formatNumber(listeners ? listeners.totalRemoves : NaN) },
            { label: 'Event Loop Lag', value: eventLoop ? formatNumber(eventLoop.averageLagMs) + ' ms' : '--', extra: eventLoop ? 'max ' + formatNumber(eventLoop.maxLagMs) + ' ms' : '--' }
        ];

        grid.innerHTML = cards.map(function (card) {
            return '<div class="diag-card"><strong>' + card.label + '</strong><div>' + card.value + '</div><div>' + card.extra + '</div></div>';
        }).join('');

        details.textContent = JSON.stringify({
            rendererListenersByType: listeners ? listeners.byType : [],
            mainState: sample.main ? sample.main.state : null,
            rendererTimers: timers,
            rendererEventLoop: eventLoop
        }, null, 2);
    }

    function showPanel() {
        createPanel();
        const panel = document.getElementById('modular-diagnostics-panel');
        if (!panel) return;
        panel.hidden = false;
        state.panelVisible = true;
        renderPanel();
    }

    function hidePanel() {
        const panel = document.getElementById('modular-diagnostics-panel');
        if (!panel) return;
        panel.hidden = true;
        state.panelVisible = false;
    }

    function togglePanel() {
        if (state.panelVisible) hidePanel();
        else showPanel();
    }

    async function exportReport() {
        if (!state.history.length) {
            await takeSample('export');
        }
        const report = {
            exportedAt: Date.now(),
            userAgent: navigator.userAgent,
            history: state.history
        };
        const json = JSON.stringify(report, null, 2);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = 'modular-diagnostics-' + stamp + '.json';

        try {
            if (window.api && window.api.files && window.api.files.writeText && window.api.paths && window.api.paths.join && window.api.paths.cwd) {
                const outputPath = window.api.paths.join(window.api.paths.cwd(), fileName);
                const result = await window.api.files.writeText(outputPath, json);
                if (result && result.ok) {
                    console.log('[diagnostics] report saved to', outputPath);
                    await takeSample('post-export');
                    return;
                }
            }
        } catch (err) {
            console.error('[diagnostics] failed to write report', err);
        }

        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        nativeSetTimeout(function () { URL.revokeObjectURL(url); }, 0);
    }

    nativeSetInterval(function () {
        takeSample('interval');
    }, 5000);

    window.addEventListener('keydown', function (event) {
        const isToggle = (event.ctrlKey || event.metaKey) && event.shiftKey && String(event.key).toLowerCase() === 'm';
        if (!isToggle) return;
        event.preventDefault();
        togglePanel();
    });

    window.__modularDiagnosticsRuntime = {
        collectRuntimeSnapshot: collectRuntimeSnapshot,
        takeSample: takeSample,
        togglePanel: togglePanel,
        showPanel: showPanel,
        hidePanel: hidePanel,
        getHistory: function () { return state.history.slice(); }
    };

    document.addEventListener('DOMContentLoaded', function () {
        createPanel();
        takeSample('startup');
    });
}());
