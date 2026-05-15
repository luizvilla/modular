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

    // widgetDocs: all three extensions contribute entries
    assert.strictEqual(Array.isArray(runtime.bootstrap.widgetDocs), true);
    assert.strictEqual(runtime.bootstrap.widgetDocs.some((e) => e.type === 'fast_frame_plot'), true);
    assert.strictEqual(runtime.bootstrap.widgetDocs.some((e) => e.type === 'time_plot_uplot'), true);
    assert.strictEqual(runtime.bootstrap.widgetDocs.some((e) => e.type === 'twist_actions_panel'), true);
    assert.strictEqual(runtime.bootstrap.widgetDocs.some((e) => e.type === 'thingset_device_ui'), true);
    // icon and preferredOrder are present
    const ffPlot = runtime.bootstrap.widgetDocs.find((e) => e.type === 'fast_frame_plot');
    assert.strictEqual(ffPlot.icon, 'chart-area');
    assert.strictEqual(typeof ffPlot.preferredOrder, 'number');
    assert.strictEqual(ffPlot.extensionId, 'core');

    // datasources: core contributes fast_frame and serialport; owntech and thingset add theirs
    assert.strictEqual(Array.isArray(runtime.bootstrap.datasources), true);
    assert.strictEqual(runtime.bootstrap.datasources.some((e) => e.type === 'fast_frame_datasource'), true);
    assert.strictEqual(runtime.bootstrap.datasources.some((e) => e.type === 'serialport_datasource'), true);
    assert.strictEqual(runtime.bootstrap.datasources.some((e) => e.type === 'thingset_serial_datasource'), true);
    const ffDs = runtime.bootstrap.datasources.find((e) => e.type === 'fast_frame_datasource');
    assert.strictEqual(ffDs.icon, 'bolt');
    assert.strictEqual(ffDs.extensionId, 'core');
    const spDs = runtime.bootstrap.datasources.find((e) => e.type === 'serialport_datasource');
    assert.strictEqual(spDs.icon, 'plug');
    assert.strictEqual(spDs.extensionId, 'core');
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

    // widgetDocs: only core entries when owntech and thingset are disabled
    assert.strictEqual(runtime.bootstrap.widgetDocs.some((e) => e.type === 'time_plot_uplot'), true);
    assert.strictEqual(runtime.bootstrap.widgetDocs.some((e) => e.type === 'twist_actions_panel'), false);
    assert.strictEqual(runtime.bootstrap.widgetDocs.some((e) => e.type === 'thingset_device_ui'), false);

    // datasources: serialport_datasource is in core (always present); owntech/thingset entries absent
    assert.strictEqual(runtime.bootstrap.datasources.some((e) => e.type === 'fast_frame_datasource'), true);
    assert.strictEqual(runtime.bootstrap.datasources.some((e) => e.type === 'serialport_datasource'), true);
    assert.strictEqual(runtime.bootstrap.datasources.some((e) => e.type === 'thingset_serial_datasource'), false);
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

// ── Installed bundle tests ────────────────────────────────────────────────────

function makeInstalledBundle(dir, { id = 'testpkg', version = '1.0.0', enabled = true, extra = {} } = {}) {
    const bundleDir = path.join(dir, id, version);
    fs.mkdirSync(bundleDir, { recursive: true });
    const manifest = {
        apiVersion: 1,
        id,
        displayName: 'Test Package',
        version,
        enabledByDefault: enabled,
        ...extra,
    };
    fs.writeFileSync(path.join(bundleDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');
    return bundleDir;
}

function runInstalledBundleDiscovery() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modular-installed-'));
    try {
        makeInstalledBundle(tempRoot, { id: 'testpkg', version: '1.2.0' });

        const runtime = buildExtensionRuntime({ appRoot, env: { ...process.env, ENABLE_THINGSET: '1' }, installedRoot: tempRoot });

        const entry = runtime.inventory.find((e) => e.id === 'testpkg');
        assert.ok(entry, 'installed bundle should appear in inventory');
        assert.strictEqual(entry.isInstalled, true);
        assert.strictEqual(entry.version, '1.2.0');
        assert.strictEqual(entry.enabled, true);
        assert.strictEqual(runtime.installedRoot, tempRoot);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

function runInstalledBundleStateOverride() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modular-installed-'));
    try {
        makeInstalledBundle(tempRoot, { id: 'testpkg', version: '1.0.0', enabled: true });
        // Write a state.json that disables it
        fs.writeFileSync(path.join(tempRoot, 'state.json'), JSON.stringify({ testpkg: { enabled: false, version: '1.0.0' } }), 'utf8');

        const runtime = buildExtensionRuntime({ appRoot, env: { ...process.env, ENABLE_THINGSET: '1' }, installedRoot: tempRoot });

        const entry = runtime.inventory.find((e) => e.id === 'testpkg');
        assert.ok(entry, 'bundle should be in inventory even when disabled');
        assert.strictEqual(entry.enabled, false);
        assert.strictEqual(runtime.bootstrap.rendererScripts.some((s) => s.path.includes('testpkg')), false);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

function runInstalledBundleIntegrityFailure() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modular-installed-'));
    const warnings = [];
    try {
        const bundleDir = makeInstalledBundle(tempRoot, { id: 'badpkg', version: '1.0.0' });
        // Write a checksums.json with a wrong hash
        fs.writeFileSync(path.join(bundleDir, 'checksums.json'), JSON.stringify({ files: { 'manifest.json': 'deadbeef' } }), 'utf8');

        const runtime = buildExtensionRuntime({
            appRoot,
            env: { ...process.env, ENABLE_THINGSET: '1' },
            installedRoot: tempRoot,
            logger: { warn: (...args) => warnings.push(args.join(' ')), error: () => {}, info: () => {} },
        });

        assert.strictEqual(runtime.inventory.find((e) => e.id === 'badpkg'), undefined, 'bundle with bad checksum should be skipped');
        assert.strictEqual(runtime.invalidManifests.length, 1);
        assert.ok(warnings.some((m) => m.includes('Skipping invalid installed bundle')));
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

function runInstalledBundleDuplicateId() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modular-installed-'));
    const warnings = [];
    try {
        // 'core' is already a source-loaded extension — collision should be rejected
        makeInstalledBundle(tempRoot, { id: 'core', version: '1.0.0' });

        const runtime = buildExtensionRuntime({
            appRoot,
            env: { ...process.env, ENABLE_THINGSET: '1' },
            installedRoot: tempRoot,
            logger: { warn: (...args) => warnings.push(args.join(' ')), error: () => {}, info: () => {} },
        });

        assert.strictEqual(runtime.invalidManifests.some((m) => m.error.includes('Duplicate extension id')), true);
        assert.ok(warnings.some((m) => m.includes('Duplicate extension id')));
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

function runInstalledBundleMissingRoot() {
    // Non-existent installedRoot should be tolerated silently
    const runtime = buildExtensionRuntime({
        appRoot,
        env: { ...process.env, ENABLE_THINGSET: '1' },
        installedRoot: path.join(os.tmpdir(), 'modular-nonexistent-' + Date.now()),
    });
    assert.strictEqual(runtime.inventory.find((e) => e.isInstalled), undefined, 'no installed bundles when root is missing');
}

runDefaultRuntimeAssertions();
runDisabledRuntimeAssertions();
runInvalidManifestAssertions();
runInstalledBundleDiscovery();
runInstalledBundleStateOverride();
runInstalledBundleIntegrityFailure();
runInstalledBundleDuplicateId();
runInstalledBundleMissingRoot();

console.log('All extension runtime tests passed.');
