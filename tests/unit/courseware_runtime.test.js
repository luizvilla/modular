const assert = require('assert');
const path = require('path');

const { buildExtensionRuntime } = require('../../app/extensions/runtime');

function createSilentLogger() {
    return {
        warn() {},
        error() {},
        info() {},
    };
}

function buildRuntime(envOverrides = {}) {
    return buildExtensionRuntime({
        appRoot: path.join(__dirname, '..', '..', 'app'),
        extensionRoot: path.join(__dirname, '..', 'fixtures', 'courseware_runtime', 'extensions'),
        env: { ...envOverrides },
        logger: createSilentLogger(),
    });
}

const runtime = buildRuntime();
const inventoryIds = runtime.inventory.map((entry) => entry.id);
assert(inventoryIds.includes('courseware'), 'courseware extension should be present in inventory');
assert.strictEqual(runtime.bootstrap.coursewareRoots.length, 1, 'expected one courseware root');
assert.strictEqual(runtime.bootstrap.courseware.length, 1, 'invalid courseware labs should be skipped');
assert.deepStrictEqual(runtime.bootstrap.courseware[0], {
    id: 'Basics/Valid_Lab',
    title: 'Valid Lab',
    order: 5,
    extensionId: 'courseware',
    rootPath: path.join(__dirname, '..', 'fixtures', 'courseware_runtime', 'labs'),
    dirPath: path.join(__dirname, '..', 'fixtures', 'courseware_runtime', 'labs', 'Basics', 'Valid_Lab'),
    markdownPath: path.join(__dirname, '..', 'fixtures', 'courseware_runtime', 'labs', 'Basics', 'Valid_Lab', 'README.md'),
    dashboardPath: path.join(__dirname, '..', 'fixtures', 'courseware_runtime', 'labs', 'Basics', 'Valid_Lab', 'dashboard.json'),
    binaryPath: path.join(__dirname, '..', 'fixtures', 'courseware_runtime', 'labs', 'Basics', 'Valid_Lab', 'firmware.bin'),
    figuresDirPath: path.join(__dirname, '..', 'fixtures', 'courseware_runtime', 'labs', 'Basics', 'Valid_Lab', 'figures'),
    menuSegments: ['Basics', 'Valid Lab'],
});

const disabledRuntime = buildRuntime({ MODULAR_EXTENSION_COURSEWARE: '0' });
assert.strictEqual(disabledRuntime.isEnabled('courseware'), false, 'courseware extension should disable via env override');
assert.strictEqual(disabledRuntime.bootstrap.coursewareRoots.length, 0, 'disabled courseware should not contribute roots');
assert.strictEqual(disabledRuntime.bootstrap.courseware.length, 0, 'disabled courseware should not contribute labs');
