import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, WidgetFactory } from '@theia/core/lib/browser';
import { bindViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { ModularDashboardContribution, ModularDashboardWidget } from './modular-dashboard-contribution';

export default new ContainerModule((bind) => {
    bind(ModularDashboardWidget).toSelf();
    bind(WidgetFactory).toDynamicValue((context) => ({
        id: ModularDashboardWidget.ID,
        createWidget: () => context.container.get(ModularDashboardWidget),
    })).inSingletonScope();

    bindViewContribution(bind, ModularDashboardContribution);
    bind(FrontendApplicationContribution).toService(ModularDashboardContribution);
});
