import * as fs from 'fs';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';
const express = require('express');
import { ModularProbeServiceImpl } from './modular-probe-service';

@injectable()
export class ModularDashboardBackendContribution implements BackendApplicationContribution {
    protected readonly repoRoot = path.resolve(__dirname, '../../../../..');
    protected readonly dashboardRoot = path.join(this.repoRoot, 'app', 'dashboard');
    protected readonly dashboardIndexPath = path.join(this.dashboardRoot, 'index.html');
    protected readonly dashboardFixturePath = path.join(this.repoRoot, 'dashboard2.json');
    protected readonly probeService = new ModularProbeServiceImpl();

    configure(app: any): void {
        app.use('/modular-assets', express.static(this.dashboardRoot));
        app.get('/modular-phase0/probe.json', async (_request, response) => {
            response.json(await this.probeService.getStatus());
        });
        app.get('/modular-phase0/dashboard.json', (_request, response) => {
            response.sendFile(this.dashboardFixturePath);
        });
        app.get('/modular-phase0/dashboard.html', (_request, response) => {
            response.type('html').send(this.renderHostedDashboardHtml());
        });
    }

    protected renderHostedDashboardHtml(): string {
        const source = fs.readFileSync(this.dashboardIndexPath, 'utf8');
        const shim = [
            '<base href="/modular-assets/">',
            '<script>',
            '(function () {',
            '  const noop = function () {};',
            '  const asyncNull = async function () { return null; };',
            '  const asyncEmptyArray = async function () { return []; };',
            '  const asyncBootstrap = async function () { return { rendererScripts: [], widgetDocs: [], datasources: [], exampleRoots: [], courseware: [] }; };',
            '  const on = function () { return function () {}; };',
            '  window.api = {',
            '    extensions: { getBootstrap: asyncBootstrap },',
            '    dashboard: { openDashboardDialog: asyncNull, loadDashboardFromPath: asyncNull, onLoadDashboardFromPath: on, onMenuLoadDashboard: on, onMenuSaveDashboard: on, onShowWidgetCategories: on },',
            '    docs: { listReadmes: asyncEmptyArray, readMarkdown: async function () { return ""; }, openTab: noop, onOpenTab: on, setActiveTab: noop, onSelect: on, onDockPreview: on, undockTab: noop, getPendingTab: asyncNull },',
            '    files: {',
            '      readText: async function (filePath) { const response = await fetch(filePath); return response.text(); },',
            '      listDir: asyncEmptyArray,',
            '      writeText: async function () { return { ok: false, error: "Phase 0 hosted dashboard is read-only." }; },',
            '      chooseCsvFile: asyncNull',
            '    },',
            '    system: { openExternal: async function () { return { ok: false, error: "Not implemented in Phase 0." }; } },',
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
        return source.replace('</head>', `${shim}\n</head>`);
    }
}
