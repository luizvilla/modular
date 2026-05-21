const fs = require('fs');
const path = require('path');

const DEFAULT_MANAGED_PLATFORMIO_STATE = Object.freeze({
    status: 'not-installed',
    version: null,
    path: null,
    coreDir: null,
    installedAt: null,
    lastError: null,
});

function getToolchainsRoot(userDataDir) {
    return path.join(userDataDir, 'toolchains');
}

function getManagedPlatformioRoot(userDataDir) {
    return path.join(getToolchainsRoot(userDataDir), 'platformio');
}

function getManagedPlatformioVenvDir(userDataDir) {
    return path.join(getManagedPlatformioRoot(userDataDir), 'penv');
}

function getManagedPlatformioCoreDir(userDataDir) {
    return path.join(getManagedPlatformioRoot(userDataDir), 'core');
}

function getManagedPlatformioExecutable(userDataDir) {
    return process.platform === 'win32'
        ? path.join(getManagedPlatformioVenvDir(userDataDir), 'Scripts', 'pio.exe')
        : path.join(getManagedPlatformioVenvDir(userDataDir), 'bin', 'pio');
}

function getManagedPlatformioPython(userDataDir) {
    return process.platform === 'win32'
        ? path.join(getManagedPlatformioVenvDir(userDataDir), 'Scripts', 'python.exe')
        : path.join(getManagedPlatformioVenvDir(userDataDir), 'bin', 'python');
}

function getManagedPlatformioStatePath(userDataDir) {
    return path.join(getManagedPlatformioRoot(userDataDir), 'state.json');
}

function readManagedPlatformioState(userDataDir) {
    try {
        const raw = fs.readFileSync(getManagedPlatformioStatePath(userDataDir), 'utf8');
        const parsed = JSON.parse(raw);
        return {
            ...DEFAULT_MANAGED_PLATFORMIO_STATE,
            ...(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}),
        };
    } catch {
        return { ...DEFAULT_MANAGED_PLATFORMIO_STATE };
    }
}

function writeManagedPlatformioState(userDataDir, nextState) {
    const statePath = getManagedPlatformioStatePath(userDataDir);
    const normalized = {
        ...DEFAULT_MANAGED_PLATFORMIO_STATE,
        ...(nextState && typeof nextState === 'object' && !Array.isArray(nextState) ? nextState : {}),
    };
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(normalized, null, 2), 'utf8');
    return normalized;
}

module.exports = {
    DEFAULT_MANAGED_PLATFORMIO_STATE,
    getManagedPlatformioCoreDir,
    getManagedPlatformioExecutable,
    getManagedPlatformioPython,
    getManagedPlatformioRoot,
    getManagedPlatformioStatePath,
    getManagedPlatformioVenvDir,
    getToolchainsRoot,
    readManagedPlatformioState,
    writeManagedPlatformioState,
};
