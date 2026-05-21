const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    DEFAULT_MANAGED_PLATFORMIO_STATE,
    getManagedPlatformioCoreDir,
    getManagedPlatformioExecutable,
    getManagedPlatformioPython,
    getManagedPlatformioRoot,
    getManagedPlatformioStatePath,
    getManagedPlatformioVenvDir,
    readManagedPlatformioState,
    writeManagedPlatformioState,
} = require('../../app/firmware/toolchain');

function runManagedToolchainTests() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modular-firmware-toolchain-'));
    try {
        const emptyState = readManagedPlatformioState(tempRoot);
        assert.deepStrictEqual(emptyState, DEFAULT_MANAGED_PLATFORMIO_STATE);

        const writtenState = writeManagedPlatformioState(tempRoot, {
            status: 'installed',
            version: 'PlatformIO Core, version 6.1.19',
            path: '/tmp/fake-pio',
            coreDir: '/tmp/fake-core',
            installedAt: '2026-05-21T10:00:00.000Z',
        });
        assert.strictEqual(writtenState.status, 'installed');
        assert.strictEqual(readManagedPlatformioState(tempRoot).path, '/tmp/fake-pio');

        const statePath = getManagedPlatformioStatePath(tempRoot);
        assert.strictEqual(statePath.endsWith(path.join('toolchains', 'platformio', 'state.json')), true);
        assert.strictEqual(getManagedPlatformioRoot(tempRoot).endsWith(path.join('toolchains', 'platformio')), true);
        assert.strictEqual(getManagedPlatformioVenvDir(tempRoot).includes(path.join('toolchains', 'platformio', 'penv')), true);
        assert.strictEqual(getManagedPlatformioCoreDir(tempRoot).includes(path.join('toolchains', 'platformio', 'core')), true);
        assert.strictEqual(typeof getManagedPlatformioExecutable(tempRoot), 'string');
        assert.strictEqual(typeof getManagedPlatformioPython(tempRoot), 'string');
        assert.strictEqual(fs.existsSync(path.dirname(statePath)), true);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

runManagedToolchainTests();
console.log('All firmware toolchain helper tests passed.');
