import { ContainerModule } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { ConnectionHandler, JsonRpcConnectionHandler } from '@theia/core/lib/common';
import { ModularProbeService, modularProbePath } from '../common/modular-probe-protocol';
import { ModularDashboardBackendContribution } from './modular-dashboard-backend-contribution';
import { ModularProbeServiceImpl } from './modular-probe-service';

export default new ContainerModule((bind) => {
    bind(ModularDashboardBackendContribution).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(ModularDashboardBackendContribution);

    bind(ModularProbeServiceImpl).toSelf().inSingletonScope();
    bind(ConnectionHandler).toDynamicValue((context) =>
        new JsonRpcConnectionHandler<ModularProbeService>(modularProbePath, () => context.container.get(ModularProbeServiceImpl))
    ).inSingletonScope();
});
