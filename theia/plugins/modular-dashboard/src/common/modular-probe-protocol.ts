export const modularProbePath = '/services/modular-probe';

export const ModularProbeService = Symbol('ModularProbeService');

export interface ModularProbeStatus {
    repoRoot: string;
    dashboardIndexPath: string;
    dashboardFixturePath: string;
    dashboardIndexExists: boolean;
    dashboardFixtureExists: boolean;
    sampledDashboardFiles: string[];
}

export interface ModularProbeService {
    getStatus(): Promise<ModularProbeStatus>;
}
