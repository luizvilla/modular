import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import { AbstractViewContribution, FrontendApplicationContribution, ReactWidget } from '@theia/core/lib/browser';
import { Command, CommandRegistry } from '@theia/core/lib/common';
import { ModularProbeStatus } from '../common/modular-probe-protocol';

export const ModularDashboardCommand: Command = {
    id: 'modular-dashboard.open',
    label: 'Open Modular Dashboard',
};

@injectable()
export class ModularDashboardWidget extends ReactWidget {
    static readonly ID = 'modular-dashboard:phase0-view';
    static readonly LABEL = 'Modular Dashboard';

    protected probeStatus: ModularProbeStatus | undefined;
    protected loading = true;
    protected error: string | undefined;

    @postConstruct()
    protected init(): void {
        this.id = ModularDashboardWidget.ID;
        this.title.label = ModularDashboardWidget.LABEL;
        this.title.caption = 'Theia Phase 0 dashboard embedding spike';
        this.title.closable = true;
        this.addClass('modular-dashboard-phase0');
        void this.refreshProbeStatus();
        this.update();
    }

    protected get iframeSrc(): string {
        return '/modular-phase0/dashboard.html#source=/modular-phase0/dashboard.json';
    }

    protected async refreshProbeStatus(): Promise<void> {
        this.loading = true;
        this.error = undefined;
        this.update();
        try {
            const response = await fetch('/modular-phase0/probe.json');
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

    render(): React.ReactNode {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '12px', padding: '12px' }}>
                <section style={{ border: '1px solid var(--theia-panel-border)', borderRadius: '10px', padding: '12px', background: 'var(--theia-editor-background)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                        <div>
                            <strong>Phase 0 Probe</strong>
                            <div style={{ opacity: 0.8, marginTop: '4px' }}>
                                Proves a custom Theia frontend extension can call one backend service before deeper migration.
                            </div>
                        </div>
                        <button className='theia-button secondary' onClick={() => void this.refreshProbeStatus()}>
                            Refresh Probe
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
                    <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--theia-panel-border)', color: '#f5f7ff', background: '#121a29' }}>
                        Embedded current Modular dashboard UI served through a Phase 0 compatibility route
                    </div>
                    <iframe
                        src={this.iframeSrc}
                        title='Modular Dashboard Phase 0'
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
    }
}
