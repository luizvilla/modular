(function () {
    // Wire the app Edit menu to open the widget category manager in the renderer.
    const api = window.api || null;
    const dashboardApi = api && api.dashboard ? api.dashboard : null;
    const filesApi = api && api.files ? api.files : null;
    const loggerApi = api && api.logger ? api.logger : null;

    const { ipcRenderer } = !api && window.require ? window.require('electron') : { ipcRenderer: null };
    const fs = !api && window.require ? window.require('fs') : null;

    // Forward renderer console logs to the main process terminal.
    (function bridgeRendererLogs() {
        const levels = ['log', 'warn', 'error'];
        levels.forEach((level) => {
            const original = console[level];
            console[level] = function () {
                try {
                    if (loggerApi && loggerApi.log) {
                        loggerApi.log(level, Array.from(arguments));
                    } else if (ipcRenderer) {
                        ipcRenderer.send('renderer-log', { level, args: Array.from(arguments) });
                    }
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

    function applyDashboardJson(jsonObject) {
        var allowEdit = jsonObject && jsonObject.allow_edit !== false;
        if (window.freeboard && typeof window.freeboard.loadDashboard === 'function') {
            window.freeboard.loadDashboard(jsonObject, function () {
                window.freeboard.setEditing(allowEdit);
            });
        } else if (window.freeboardModel && typeof window.freeboardModel.loadDashboard === 'function') {
            window.freeboardModel.loadDashboard(jsonObject, function () {
                window.freeboardModel.setEditing(allowEdit);
            });
        }
    }

    function resetDashboardToNew() {
        console.log('New dashboard requested');

        if (window.freeboard && typeof window.freeboard.newDashboard === 'function') {
            console.log('Resetting via freeboard.newDashboard()');
            window.freeboard.newDashboard();
            window.freeboard.setEditing(false);
            return;
        }

        if (window.freeboardModel && typeof window.freeboardModel.loadDashboard === 'function') {
            console.log('Resetting via freeboardModel.loadDashboard() fallback');
            window.freeboardModel.loadDashboard({ allow_edit: true }, function () {
                window.freeboardModel.setEditing(false);
            });
            return;
        }

        console.warn('New dashboard reset unavailable: freeboard API not ready');
    }

    async function readTextFile(filePath) {
        if (!filePath) return '';
        if (filesApi && filesApi.readText) return filesApi.readText(filePath);
        if (fs) return fs.promises.readFile(filePath, 'utf8');
        return '';
    }

    async function loadDashboardFromPath(dashboardPath) {
        if (!dashboardPath) return;
        try {
            const text = await readTextFile(dashboardPath);
            const jsonObject = JSON.parse(text);
            applyDashboardJson(jsonObject);
        } catch (err) {
            console.error('Load dashboard from path failed:', err);
        }
    }

    if (dashboardApi && dashboardApi.onShowWidgetCategories) {
        dashboardApi.onShowWidgetCategories(() => {
            if (window.freeboardModel && typeof window.freeboardModel.showWidgetCategoryManager === 'function') {
                window.freeboardModel.showWidgetCategoryManager();
            }
        });
    } else if (ipcRenderer) {
        ipcRenderer.on('show-widget-categories', () => {
            if (window.freeboardModel && typeof window.freeboardModel.showWidgetCategoryManager === 'function') {
                window.freeboardModel.showWidgetCategoryManager();
            }
        });
    }

    // File menu actions: delegate to the tabs system (window.dashboardTabs).
    if (dashboardApi && dashboardApi.onMenuLoadDashboard) {
        dashboardApi.onMenuLoadDashboard(() => {
            window.dashboardTabs ? window.dashboardTabs.openDialog() : applyDashboardJson({});
        });
    } else if (ipcRenderer) {
        ipcRenderer.on('menu-new-dashboard', () => {
            if (window.dashboardTabs) window.dashboardTabs.openNew();
            else resetDashboardToNew();
        });
        ipcRenderer.on('menu-load-dashboard', () => {
            if (window.dashboardTabs) window.dashboardTabs.openDialog();
        });
    }

    if (dashboardApi && dashboardApi.onMenuSaveDashboard) {
        dashboardApi.onMenuSaveDashboard(() => {
            if (window.freeboardModel && typeof window.freeboardModel.saveDashboard === 'function') {
                window.freeboardModel.saveDashboard(null, { currentTarget: { dataset: { pretty: "true" } } });
            } else if (window.freeboard && typeof window.freeboard.getLiveModel === 'function') {
                const model = window.freeboard.getLiveModel();
                if (model && typeof model.saveDashboard === 'function') {
                    model.saveDashboard(null, { currentTarget: { dataset: { pretty: "true" } } });
                }
            }
        });
    } else if (ipcRenderer) {
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
    }

    // Load a dashboard JSON from a specific path (used by the Examples window).
    if (dashboardApi && dashboardApi.onLoadDashboardFromPath) {
        dashboardApi.onLoadDashboardFromPath(async ({ dashboardPath } = {}) => {
            await loadDashboardFromPath(dashboardPath);
        });
    } else if (ipcRenderer) {
        ipcRenderer.on('load-dashboard-from-path', async (_event, { dashboardPath } = {}) => {
            await loadDashboardFromPath(dashboardPath);
        });
    }
    // \ud83d\udd0d Widget lookup
    function getWidgetByTitle(title) {
        return freeboardModel.panes()
            .flatMap(pane => pane.widgets())
            .find(widget => widget.settings().title === title);
    }

    // \ud83d\udd0d Datasource lookup
    function getDatasourceByName(name) {
        return freeboardModel.datasources()
            .find(ds => ds.name() === name);
    }

    // \ud83d\udd27 Global Dashboard Control API
    window.DashboardControl = {
        resetDashboard() {
            resetDashboardToNew();
        },

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

    // Redirect the freeboard header "Load" button to open in a new tab.
    if (typeof freeboard !== 'undefined' && typeof freeboard.on === 'function') {
        freeboard.on('initialized', function () {
            const model = typeof freeboard.getLiveModel === 'function'
                ? freeboard.getLiveModel() : null;
            if (model && typeof model.loadDashboardFromLocalFile === 'function') {
                model.loadDashboardFromLocalFile = function () {
                    if (window.dashboardTabs) window.dashboardTabs.openDialog();
                };
            }
        });
    }

    if (!window.__modularNewDashboardDelegated) {
        document.addEventListener('click', function (event) {
            const clickedButton = event.target && event.target.closest
                ? event.target.closest('#new-dashboard-btn')
                : null;

            if (!clickedButton) return;

            console.log('New dashboard button clicked', {
                targetTag: event.target && event.target.tagName ? event.target.tagName : 'unknown'
            });
            resetDashboardToNew();
        });
        window.__modularNewDashboardDelegated = true;
        console.log('New dashboard delegated click handler bound');
    } else {
        console.log('New dashboard delegated click handler already bound');
    }
})();
