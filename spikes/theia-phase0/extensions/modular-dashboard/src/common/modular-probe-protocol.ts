export const modularProbePath = '/services/modular-phase0-probe';

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
