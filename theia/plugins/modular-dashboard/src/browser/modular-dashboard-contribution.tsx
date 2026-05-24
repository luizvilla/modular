import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import { AbstractViewContribution, FrontendApplicationContribution, ReactWidget } from '@theia/core/lib/browser';
import { Endpoint } from '@theia/core/lib/browser/endpoint';
import { Command, CommandRegistry, MenuModelRegistry } from '@theia/core/lib/common';
import { CommonMenus } from '@theia/core/lib/browser/common-frontend-contribution';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog/file-dialog-service';
import URI from '@theia/core/lib/common/uri';
import { ModularProbeStatus } from '../common/modular-probe-protocol';

export const ModularDashboardCommand: Command = {
    id: 'modular-dashboard.open',
    label: 'Open Modular Dashboard',
};
export const ModularOpenFileCommand: Command = {
    id: 'modular-dashboard.open-file',
    label: 'Open Dashboard File…',
    category: 'Modular',
};
export const ModularSaveFileCommand: Command = {
    id: 'modular-dashboard.save-file',
    label: 'Save Dashboard As…',
    category: 'Modular',
};

@injectable()
export class ModularDashboardWidget extends ReactWidget {
    static readonly ID = 'modular-dashboard:view';
    static readonly LABEL = 'Modular Dashboard';

    @inject(FileDialogService) protected readonly fileDialogService: FileDialogService;

    protected probeStatus: ModularProbeStatus | undefined;
    protected loading = true;
    protected error: string | undefined;
    protected currentFileUri: URI | undefined;
    protected iframeEl: HTMLIFrameElement | null = null;

    // Pending resolve for an open-dialog request coming from the iframe.
    protected pendingOpenResolve: ((url: string | null) => void) | null = null;
    // Pending resolve for a save-data response coming from the iframe.
    protected pendingSaveResolve: ((json: string | null) => void) | null = null;

    private readonly onMessage = (e: MessageEvent): void => {
        if (!e.data || typeof e.data !== 'object') return;
        // Iframe is asking the parent to show a file-open dialog.
        if (e.data.type === 'modular:openDialog') {
            void this.handleIframeOpenRequest();
        }
        // Iframe is sending dashboard JSON for saving.
        if (e.data.type === 'modular:saveData') {
            if (this.pendingSaveResolve) {
                this.pendingSaveResolve(e.data.json ?? null);
                this.pendingSaveResolve = null;
            }
        }
    };

    @postConstruct()
    protected init(): void {
        this.id = ModularDashboardWidget.ID;
        this.title.label = ModularDashboardWidget.LABEL;
        this.title.caption = 'Modular Dashboard';
        this.title.closable = true;
        this.addClass('modular-dashboard');
        window.addEventListener('message', this.onMessage);
        void this.refreshProbeStatus();
        this.update();
    }

    override dispose(): void {
        window.removeEventListener('message', this.onMessage);
        super.dispose();
    }

    protected get iframeSrc(): string {
        const htmlUrl = new Endpoint({ path: '/modular/dashboard.html' }).getRestUrl().toString();
        if (this.currentFileUri) {
            const baseUrl = new Endpoint({ path: '/modular/dashboard-file' }).getRestUrl().toString();
            const sourceUrl = `${baseUrl}?path=${encodeURIComponent(this.currentFileUri.path.toString())}`;
            // Freeboard reads the source URL raw from the hash — do not encodeURIComponent the full URL.
            return `${htmlUrl}#source=${sourceUrl}`;
        }
        // No file selected: let Freeboard initialise with an empty editable dashboard.
        return htmlUrl;
    }

    protected async refreshProbeStatus(): Promise<void> {
        this.loading = true;
        this.error = undefined;
        this.update();
        try {
            const url = new Endpoint({ path: '/modular/probe.json' }).getRestUrl().toString();
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Probe request failed with status ${response.status}`);
            }
            this.probeStatus = await response.json();
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
        } finally {
            this.loading = false;
            this.update();
        }
    }

    // Called when the iframe's Load button (or openDashboardDialog) posts modular:openDialog.
    // The iframe applies the JSON in-place via $.getJSON, so we must NOT change currentFileUri
    // here (that would reload the iframe and cause a double-load).
    protected async handleIframeOpenRequest(): Promise<void> {
        const uri = await this.fileDialogService.showOpenDialog({
            title: 'Open Dashboard File',
            filters: { 'Dashboard JSON': ['json'] },
            canSelectFiles: true,
            canSelectFolders: false,
        });
        if (!this.iframeEl?.contentWindow) return;
        if (!uri) {
            this.iframeEl.contentWindow.postMessage(
                { type: 'modular:dialogResult', _role: 'openDialog', url: null },
                '*',
            );
            return;
        }
        const filePath = (uri as URI).path.toString();
        const backendUrl = `/modular/dashboard-file?path=${encodeURIComponent(filePath)}`;
        this.iframeEl.contentWindow.postMessage(
            { type: 'modular:dialogResult', _role: 'openDialog', url: backendUrl },
            '*',
        );
    }

    // Called by the Theia "Open Dashboard File" command.
    async openDashboardFile(): Promise<void> {
        const uri = await this.fileDialogService.showOpenDialog({
            title: 'Open Dashboard File',
            filters: { 'Dashboard JSON': ['json'] },
            canSelectFiles: true,
            canSelectFolders: false,
        });
        if (!uri) return;
        this.currentFileUri = uri as URI;
        this.update(); // triggers iframeSrc change → iframe reloads
    }

    // Called by the Theia "Save Dashboard As…" command.
    async saveDashboardAs(): Promise<void> {
        if (!this.iframeEl?.contentWindow) return;

        // Ask the iframe for the current dashboard JSON.
        const json = await new Promise<string | null>((resolve) => {
            this.pendingSaveResolve = resolve;
            this.iframeEl!.contentWindow!.postMessage({ type: 'modular:requestSave' }, '*');
            // Timeout after 5 s if the iframe never responds.
            setTimeout(() => {
                if (this.pendingSaveResolve === resolve) {
                    this.pendingSaveResolve = null;
                    resolve(null);
                }
            }, 5000);
        });

        if (!json) return;

        const saveUri = await this.fileDialogService.showSaveDialog(
            { title: 'Save Dashboard As…', filters: { 'Dashboard JSON': ['json'] } },
        );
        if (!saveUri) return;

        const filePath = saveUri.path.toString();
        const postUrl = new Endpoint({ path: '/modular/dashboard-file' }).getRestUrl().toString();
        const res = await fetch(postUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath, content: json }),
        });
        if (res.ok) {
            this.currentFileUri = saveUri;
        }
    }

    render(): React.ReactNode {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '12px', padding: '12px' }}>
                <section style={{ border: '1px solid var(--theia-panel-border)', borderRadius: '10px', padding: '12px', background: 'var(--theia-editor-background)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                        <div>
                            <strong>Backend Probe</strong>
                            <div style={{ opacity: 0.8, marginTop: '4px' }}>
                                Confirms the Theia backend service is reachable from the frontend extension.
                            </div>
                        </div>
                        <button className='theia-button secondary' onClick={() => void this.refreshProbeStatus()}>
                            Refresh
                        </button>
                    </div>
                    <div style={{ marginTop: '12px', fontFamily: 'var(--theia-ui-font-family)', fontSize: '12px', lineHeight: 1.5 }}>
                        {this.loading && <div>Loading backend probe…</div>}
                        {!this.loading && this.error && <div>Probe failed: {this.error}</div>}
                        {!this.loading && !this.error && this.probeStatus && (
                            <div>
                                <div>Repo root: <code>{this.probeStatus.repoRoot}</code></div>
                                <div>Dashboard index: <code>{this.probeStatus.dashboardIndexPath}</code></div>
                                <div>Fixture JSON: <code>{this.probeStatus.dashboardFixturePath}</code></div>
                                <div>Index exists: <code>{String(this.probeStatus.dashboardIndexExists)}</code></div>
                                <div>Fixture exists: <code>{String(this.probeStatus.dashboardFixtureExists)}</code></div>
                                <div>Sample dashboards: <code>{this.probeStatus.sampledDashboardFiles.join(', ') || 'none found'}</code></div>
                            </div>
                        )}
                    </div>
                </section>
                <section style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, border: '1px solid var(--theia-panel-border)', borderRadius: '10px', overflow: 'hidden', background: '#0c1320' }}>
                    <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--theia-panel-border)', color: '#f5f7ff', background: '#121a29', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ flex: 1 }}>
                            {this.currentFileUri ? this.currentFileUri.path.base : 'Default fixture dashboard'}
                        </span>
                    </div>
                    <iframe
                        ref={(el) => { this.iframeEl = el; }}
                        src={this.iframeSrc}
                        title='Modular Dashboard'
                        style={{ border: '0', width: '100%', height: '100%', minHeight: '480px', background: '#0c1320' }}
                    />
                </section>
            </div>
        );
    }
}

@injectable()
export class ModularDashboardContribution extends AbstractViewContribution<ModularDashboardWidget> implements FrontendApplicationContribution {
    constructor() {
        super({
            widgetId: ModularDashboardWidget.ID,
            widgetName: ModularDashboardWidget.LABEL,
            defaultWidgetOptions: { area: 'main' },
            toggleCommandId: ModularDashboardCommand.id,
        });
    }

    async onStart(): Promise<void> {
        await this.openView({ activate: false, reveal: true });
    }

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(ModularDashboardCommand, {
            execute: () => this.openView({ activate: true, reveal: true }),
        });
        commands.registerCommand(ModularOpenFileCommand, {
            execute: async () => {
                const widget = await this.openView({ activate: true, reveal: true });
                await widget?.openDashboardFile();
            },
        });
        commands.registerCommand(ModularSaveFileCommand, {
            execute: async () => {
                const widget = this.tryGetWidget();
                await widget?.saveDashboardAs();
            },
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.FILE_OPEN, {
            commandId: ModularOpenFileCommand.id,
            order: 'z10',
        });
        menus.registerMenuAction(CommonMenus.FILE_SAVE, {
            commandId: ModularSaveFileCommand.id,
            order: 'z10',
        });
    }
}
