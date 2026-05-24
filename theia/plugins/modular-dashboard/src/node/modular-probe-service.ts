import * as fs from 'fs';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import { ModularProbeService, ModularProbeStatus } from '../common/modular-probe-protocol';

@injectable()
export class ModularProbeServiceImpl implements ModularProbeService {
    // lib/node/ → lib → modular-dashboard → plugins → theia → repo root
    protected readonly repoRoot = path.resolve(__dirname, '../../../../..');

    async getStatus(): Promise<ModularProbeStatus> {
        const dashboardIndexPath = path.join(this.repoRoot, 'app', 'dashboard', 'index.html');
        const dashboardFixturePath = path.join(this.repoRoot, 'dashboard2.json');
        const sampledDashboardFiles = fs.readdirSync(this.repoRoot)
            .filter((entry) => entry.endsWith('.json'))
            .sort()
            .slice(0, 6);

        return {
            repoRoot: this.repoRoot,
            dashboardIndexPath,
            dashboardFixturePath,
            dashboardIndexExists: fs.existsSync(dashboardIndexPath),
            dashboardFixtureExists: fs.existsSync(dashboardFixturePath),
            sampledDashboardFiles,
        };
    }
}
