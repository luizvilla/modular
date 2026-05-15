const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildExtensionRuntime } = require('../../app/extensions/runtime');

const appRoot = path.join(__dirname, '..', '..', 'app');

function runDefaultRuntimeAssertions() {
    const runtime = buildExtensionRuntime({
        appRoot,
        env: {
            ...process.env,
            ENABLE_THINGSET: '1',
        },
    });

    assert.deepStrictEqual(runtime.inventory.map((entry) => entry.id), ['core', 'owntech', 'thingset']);
    assert.strictEqual(runtime.isEnabled('core'), true);
    assert.strictEqual(runtime.isEnabled('owntech'), true);
    assert.strictEqual(runtime.isEnabled('thingset'), true);
    assert.strictEqual(runtime.bootstrap.rendererScripts.some((entry) => entry.path === 'plugins/fast_frame_plot.widget.js'), true);
    assert.strictEqual(runtime.bootstrap.rendererScripts.some((entry) => entry.path === 'js/twist_protocol.js'), true);
    assert.strictEqual(runtime.bootstrap.rendererScripts.some((entry) => entry.path === 'plugins/ts_device_ui.widget.js'), true);
}

function runDisabledRuntimeAssertions() {
    const runtime = buildExtensionRuntime({
        appRoot,
        env: {
            ...process.env,
            MODULAR_EXTENSION_CORE: '0',
            MODULAR_EXTENSION_OWNTECH: '0',
            ENABLE_THINGSET: '0',
        },
    });

    assert.strictEqual(runtime.isEnabled('core'), true);
    assert.strictEqual(runtime.isEnabled('owntech'), false);
    assert.strictEqual(runtime.isEnabled('thingset'), false);
    assert.strictEqual(runtime.bootstrap.rendererScripts.some((entry) => entry.path === 'plugins/fast_frame_plot.widget.js'), true);
    assert.strictEqual(runtime.bootstrap.rendererScripts.some((entry) => entry.path === 'js/twist_protocol.js'), false);
    assert.strictEqual(runtime.bootstrap.rendererScripts.some((entry) => entry.path === 'plugins/ts_device_ui.widget.js'), false);
}

function runInvalidManifestAssertions() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modular-extensions-'));
    const warnings = [];

    try {
        fs.cpSync(path.join(appRoot, 'extensions'), tempRoot, { recursive: true });
        const brokenDir = path.join(tempRoot, 'broken');
        fs.mkdirSync(brokenDir, { recursive: true });
        fs.writeFileSync(path.join(brokenDir, 'manifest.json'), '{ invalid json', 'utf8');

        const runtime = buildExtensionRuntime({
            appRoot,
            extensionRoot: tempRoot,
            env: {
                ...process.env,
                ENABLE_THINGSET: '1',
            },
            logger: {
                warn: (...args) => warnings.push(args.join(' ')),
            },
        });

        assert.strictEqual(runtime.invalidManifests.length, 1);
        assert.strictEqual(runtime.inventory.map((entry) => entry.id).includes('core'), true);
        assert.strictEqual(warnings.some((message) => message.includes('Skipping invalid manifest')), true);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

runDefaultRuntimeAssertions();
runDisabledRuntimeAssertions();
runInvalidManifestAssertions();
