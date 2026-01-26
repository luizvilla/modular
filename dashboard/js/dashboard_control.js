(function () {
    // Wire the app Edit menu to open the widget category manager in the renderer.
    const { ipcRenderer } = require('electron');
    const fs = require('fs');

    // Forward renderer console logs to the main process terminal.
    (function bridgeRendererLogs() {
        const levels = ['log', 'warn', 'error'];
        levels.forEach((level) => {
            const original = console[level];
            console[level] = function () {
                try {
                    ipcRenderer.send('renderer-log', { level, args: Array.from(arguments) });
                } catch { /* ignore */ }
                if (typeof original === 'function') {
                    original.apply(console, arguments);
                }
            };
        });
    })();

    // Capture uncaught errors so they show up in the terminal.
    window.addEventListener('error', (event) => {
        try {
            const msg = event && event.message ? event.message : 'Unknown error';
            const stack = event && event.error && event.error.stack ? event.error.stack : '';
            console.error('Renderer error:', msg, stack);
        } catch { /* ignore */ }
    });

    window.addEventListener('unhandledrejection', (event) => {
        try {
            const reason = event && event.reason ? event.reason : 'Unknown rejection';
            console.error('Unhandled rejection:', reason);
        } catch { /* ignore */ }
    });

    ipcRenderer.on('show-widget-categories', () => {
        if (window.freeboardModel && typeof window.freeboardModel.showWidgetCategoryManager === 'function') {
            window.freeboardModel.showWidgetCategoryManager();
        }
    });

    // File menu actions: load/save dashboard via Freeboard API.
    ipcRenderer.on('menu-load-dashboard', async () => {
        // Use main-process dialog so file chooser is treated as a user activation.
        try {
            const filePath = await ipcRenderer.invoke('show-open-dashboard');
            if (!filePath) return;
            const text = await fs.promises.readFile(filePath, 'utf8');
            const jsonObject = JSON.parse(text);
            if (window.freeboard && typeof window.freeboard.loadDashboard === 'function') {
                window.freeboard.loadDashboard(jsonObject, function () {
                    window.freeboard.setEditing(false);
                });
            } else if (window.freeboardModel && typeof window.freeboardModel.loadDashboard === 'function') {
                window.freeboardModel.loadDashboard(jsonObject, function () {
                    window.freeboardModel.setEditing(false);
                });
            }
        } catch (err) {
            console.error('Menu load dashboard failed:', err);
        }
    });

    ipcRenderer.on('menu-save-dashboard', () => {
        if (window.freeboardModel && typeof window.freeboardModel.saveDashboard === 'function') {
            window.freeboardModel.saveDashboard(null, { currentTarget: { dataset: { pretty: "true" } } });
        } else if (window.freeboard && typeof window.freeboard.getLiveModel === 'function') {
            const model = window.freeboard.getLiveModel();
            if (model && typeof model.saveDashboard === 'function') {
                model.saveDashboard(null, { currentTarget: { dataset: { pretty: "true" } } });
            }
        }
    });
    // 🔍 Widget lookup
    function getWidgetByTitle(title) {
        return freeboardModel.panes()
            .flatMap(pane => pane.widgets())
            .find(widget => widget.settings().title === title);
    }

    // 🔍 Datasource lookup
    function getDatasourceByName(name) {
        return freeboardModel.datasources()
            .find(ds => ds.name() === name);
    }

    // 🔧 Global Dashboard Control API
    window.DashboardControl = {
        updateWidgetSetting(title, key, value) {
            const widget = getWidgetByTitle(title);
            if (widget && widget.settings()[key] !== undefined) {
                const newSettings = Object.assign({}, widget.settings());
                newSettings[key] = value;
                widget.settings(newSettings);
                // freeboard's subscription on settings will invoke onSettingsChanged
            }
        },

        updateDatasourceSetting(name, key, value) {
            const ds = getDatasourceByName(name);
            if (ds && ds.settings()[key] !== undefined) {
                const newSettings = Object.assign({}, ds.settings());
                newSettings[key] = value;
                ds.settings(newSettings);
                // datasource instance will be notified via Knockout
            }
        }
    };
})();
