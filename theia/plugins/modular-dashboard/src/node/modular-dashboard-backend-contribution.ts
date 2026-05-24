import * as fs from 'fs';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';
const express = require('express');
import { ModularProbeServiceImpl } from './modular-probe-service';

@injectable()
export class ModularDashboardBackendContribution implements BackendApplicationContribution {
    // lib/node/ → lib → modular-dashboard → plugins → theia → repo root
    protected readonly repoRoot = path.resolve(__dirname, '../../../../..');
    protected readonly dashboardRoot = path.join(this.repoRoot, 'app', 'dashboard');
    protected readonly dashboardIndexPath = path.join(this.dashboardRoot, 'index.html');
    protected readonly dashboardFixturePath = path.join(this.repoRoot, 'dashboard2.json');
    protected readonly probeService = new ModularProbeServiceImpl();

    configure(app: any): void {
        app.use('/modular-assets', express.static(this.dashboardRoot));

        app.get('/modular/probe.json', async (_request: any, response: any) => {
            response.json(await this.probeService.getStatus());
        });

        // Serve any dashboard JSON file by absolute path (read).
        app.get('/modular/dashboard-file', (request: any, response: any) => {
            const filePath = request.query.path as string;
            if (!filePath || path.extname(filePath) !== '.json') {
                response.status(400).json({ error: 'path must be an absolute path to a .json file' });
                return;
            }
            if (!fs.existsSync(filePath)) {
                response.status(404).json({ error: 'File not found' });
                return;
            }
            response.sendFile(filePath);
        });

        // Write a dashboard JSON file by absolute path (save).
        app.post('/modular/dashboard-file', express.json({ limit: '10mb' }), (request: any, response: any) => {
            const { path: filePath, content } = request.body || {};
            if (!filePath || path.extname(filePath) !== '.json') {
                response.status(400).json({ error: 'path must be an absolute path to a .json file' });
                return;
            }
            try {
                fs.writeFileSync(filePath, content, 'utf8');
                response.json({ ok: true });
            } catch (err: any) {
                response.status(500).json({ error: err?.message || 'Write failed' });
            }
        });

        app.get('/modular/dashboard.json', (_request: any, response: any) => {
            response.sendFile(this.dashboardFixturePath);
        });

        app.get('/modular/dashboard.html', (_request: any, response: any) => {
            response.type('html').send(this.renderHostedDashboardHtml());
        });
    }

    protected buildRendererScripts(): Array<{ path: string; order: number }> {
        const pluginsDir = path.join(this.dashboardRoot, 'plugins');
        const scripts: Array<{ path: string; order: number }> = [];

        // Thirdparty dependencies load first (order 0).
        const thirdpartyDir = path.join(pluginsDir, 'thirdparty');
        if (fs.existsSync(thirdpartyDir)) {
            for (const f of fs.readdirSync(thirdpartyDir).filter(n => n.endsWith('.js'))) {
                scripts.push({ path: `plugins/thirdparty/${f}`, order: 0 });
            }
        }

        // Shared / manager scripts load before their dependents (order 10).
        const sharedPatterns = ['.shared.js', '.manager.js', 'integrated_plot_editor.js'];
        // Widget and datasource scripts load last (order 20).
        for (const f of fs.readdirSync(pluginsDir).filter(n => n.endsWith('.js'))) {
            const isShared = sharedPatterns.some(p => f.endsWith(p) || f === p);
            scripts.push({ path: `plugins/${f}`, order: isShared ? 10 : 20 });
        }

        return scripts;
    }

    protected renderHostedDashboardHtml(): string {
        const source = fs.readFileSync(this.dashboardIndexPath, 'utf8');
        // <base href> MUST be the first child of <head> so that all subsequent relative
        // resource links (CSS, JS) resolve via /modular-assets/ rather than /modular/.
        // If injected at the end of <head> (before </head>) it has no effect on the links
        // that were already parsed above it.
        const baseTag = '<base href="/modular-assets/">';
        const rendererScripts = JSON.stringify(this.buildRendererScripts());
        const shim = [
            '<script>',
            '(function () {',
            '  const noop = function () {};',
            '  const asyncNull = async function () { return null; };',
            '  const asyncEmptyArray = async function () { return []; };',
            `  const asyncBootstrap = async function () { return { rendererScripts: ${rendererScripts}, widgetDocs: [], datasources: [], exampleRoots: [], courseware: [] }; };`,
            '  const on = function () { return function () {}; };',
            '',
            '  // postMessage bridge — used by Theia\'s save/open commands.',
            '  window.addEventListener("message", function (e) {',
            '    if (!e.data || typeof e.data !== "object") return;',
            '    // Parent widget requests the current dashboard JSON for saving.',
            '    if (e.data.type === "modular:requestSave") {',
            '      var json = null;',
            '      if (window.freeboard && typeof window.freeboard.serialize === "function") {',
            '        json = JSON.stringify(window.freeboard.serialize(), null, 2);',
            '      } else if (window.freeboardModel && typeof window.freeboardModel.serialize === "function") {',
            '        json = JSON.stringify(window.freeboardModel.serialize(), null, 2);',
            '      }',
            '      if (json !== null) {',
            '        window.parent.postMessage({ type: "modular:saveData", json: json }, "*");',
            '      }',
            '    }',
            '    // Parent widget resolved an open-file dialog.',
            '    if (e.data.type === "modular:dialogResult" && e.data._role === "openDialog") {',
            '      var url = e.data.url || null;',
            '      var openResolve = window._modularOpenResolve;',
            '      window._modularOpenResolve = null;',
            '      if (typeof openResolve === "function") {',
            '        // Path via openDashboardDialog() — resolve the waiting Promise.',
            '        openResolve(url);',
            '      } else if (url && typeof $ !== "undefined" && window.freeboard) {',
            '        // Path via the Load-button interceptor — apply JSON in-place.',
            '        $.getJSON(url, function (data) {',
            '          window.freeboard.loadDashboard(data, function () {',
            '            window.freeboard.setEditing(false);',
            '          });',
            '        });',
            '      }',
            '    }',
            '  });',
            '',
            '  // Intercept Freeboard\'s "Open dashboard" button.',
            '  // The default implementation creates a hidden <input type="file"> and triggers a',
            '  // synthetic click on it. In an Electron iframe that click is not a trusted user',
            '  // gesture and the browser silently ignores it. We intercept it in the capture',
            '  // phase (before Knockout handles the click) and use the postMessage bridge instead.',
            '  document.addEventListener("DOMContentLoaded", function () {',
            '    document.addEventListener("click", function (ev) {',
            '      var t = ev.target;',
            '      var el = t && t.closest ? t.closest(\'[title="Open dashboard"]\') : null;',
            '      if (!el) return;',
            '      ev.preventDefault();',
            '      ev.stopImmediatePropagation();',
            '      window.parent.postMessage({ type: "modular:openDialog" }, "*");',
            '    }, true);',
            '  });',
            '',
            '  window.api = {',
            '    extensions: { getBootstrap: asyncBootstrap },',
            '    dashboard: {',
            '      // Opens a file dialog in the Theia parent widget via postMessage.',
            '      openDashboardDialog: function () {',
            '        return new Promise(function (resolve) {',
            '          window._modularOpenResolve = resolve;',
            '          window.parent.postMessage({ type: "modular:openDialog" }, "*");',
            '        });',
            '      },',
            '      loadDashboardFromPath: asyncNull,',
            '      onLoadDashboardFromPath: on,',
            '      onMenuLoadDashboard: on,',
            '      onMenuSaveDashboard: on,',
            '      onShowWidgetCategories: on',
            '    },',
            '    docs: { listReadmes: asyncEmptyArray, readMarkdown: async function () { return ""; }, openTab: noop, onOpenTab: on, setActiveTab: noop, onSelect: on, onDockPreview: on, undockTab: noop, getPendingTab: asyncNull },',
            '    files: {',
            '      readText: async function (filePath) { const response = await fetch(filePath); return response.text(); },',
            '      listDir: asyncEmptyArray,',
            '      writeText: async function () { return { ok: false, error: "Not yet implemented in Phase 2." }; },',
            '      chooseCsvFile: asyncNull',
            '    },',
            '    system: { openExternal: async function () { return { ok: false, error: "Not yet implemented." }; } },',
            '    examples: { openExampleTab: noop, onOpenExampleTab: on, setActiveExampleId: noop, onExampleSelect: on, onDockPreview: on, undockDocTab: noop, getPendingExampleTab: asyncNull },',
            '    widgets: { openDocTab: noop, onOpenDocTab: on, getPendingDoc: asyncNull, notifyReady: noop },',
            '    flash: { chooseFirmwareFile: asyncNull, startFlash: asyncNull, cancelFlash: asyncNull, startFlashCan: asyncNull, cancelFlashCan: asyncNull, onProgress: on, onComplete: on },',
            '    serial: { listPorts: asyncEmptyArray, openPort: asyncNull, closePort: asyncNull, reopenPort: asyncNull, releasePort: asyncNull, isOpen: async function () { return false; }, write: asyncNull, getBuffer: asyncEmptyArray, getTerminalBuffer: asyncEmptyArray, getFastDataset: asyncEmptyArray, getFastStatus: asyncNull, getHeaders: asyncEmptyArray, setHeaders: asyncNull, getColors: asyncEmptyArray, setColors: asyncNull, flush: asyncNull, startCsvRecord: asyncNull, stopCsvRecord: asyncNull, saveFastCsv: asyncNull },',
            '    thingsetSerial: { detect: asyncNull, tree: asyncNull, getValue: asyncNull, setValue: asyncNull, create: asyncNull, delete: asyncNull, exec: asyncNull },',
            '    can: { getInterfaces: asyncEmptyArray, getThingSetNodes: asyncEmptyArray, open: asyncNull, close: asyncNull, scanNodes: asyncEmptyArray, buildTrees: asyncEmptyArray, aggregateStart: asyncNull, aggregateStop: asyncNull, aggregateSetDebug: asyncNull, aggregateSnapshot: asyncNull, setupLinux: asyncNull, isUp: async function () { return false; } },',
            '    thingset: { get: asyncNull, fetch: asyncNull, update: asyncNull, create: asyncNull, delete: asyncNull, exec: asyncNull, pathsForIds: asyncEmptyArray, idsForPaths: asyncEmptyArray },',
            '    paths: { dirname: function (input) { return String(input || "").split("/").slice(0, -1).join("/") || "/"; }, resolve: function () { return Array.prototype.join.call(arguments, "/"); }, join: function () { return Array.prototype.join.call(arguments, "/"); }, relative: function () { return ""; }, isAbsolute: function (input) { return String(input || "").startsWith("/"); }, sep: "/", cwd: function () { return "/"; }, appDir: function () { return "/"; }, toFileUrl: function (input) { return String(input || ""); } },',
            '    logger: { log: function (level, args) { try { const method = console[level] || console.log; method.apply(console, args || []); } catch {} } },',
            '    diagnostics: { captureSnapshot: asyncNull },',
            '    theme: { setTheme: noop }',
            '  };',
            '})();',
            '</script>',
        ].join('\n');
        return source
            .replace('<head>', `<head>\n${baseTag}`)
            .replace('</head>', `${shim}\n</head>`);
    }
}
