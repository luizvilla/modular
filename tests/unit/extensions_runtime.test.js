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

    const extensionIds = runtime.inventory.map((entry) => entry.id);
    ['core', 'courseware', 'tutorials', 'owntech', 'owntech-workspace', 'thingset'].forEach((id) => {
        assert.strictEqual(extensionIds.includes(id), true, `${id} should be present in inventory`);
    });
    assert.strictEqual(runtime.isEnabled('core'), true);
    assert.strictEqual(runtime.isEnabled('courseware'), true);
    assert.strictEqual(runtime.isEnabled('tutorials'), true);
    assert.strictEqual(runtime.isEnabled('owntech'), true);
    assert.strictEqual(runtime.isEnabled('owntech-workspace'), true);
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
    assert.strictEqual(Array.isArray(runtime.bootstrap.tutorials), true);
    const basicsTutorial = runtime.bootstrap.tutorials.find((entry) => entry.id === 'core/dashboard-basics');
    assert.ok(basicsTutorial, 'dashboard basics tutorial should be loaded');
    assert.deepStrictEqual(basicsTutorial.menuSegments, ['Core', 'Dashboard Basics']);
    assert.strictEqual(basicsTutorial.steps.length, 7);
    assert.strictEqual(basicsTutorial.steps.some((step) => step.focusKey === 'modal.timePlotEditor'), true);
    const xyTutorial = runtime.bootstrap.tutorials.find((entry) => entry.id === 'core/xy-signal-generator');
    assert.ok(xyTutorial, 'xy-signal-generator tutorial should be loaded');
    assert.deepStrictEqual(xyTutorial.menuSegments, ['Core', 'Xy Signal Generator']);
    assert.strictEqual(xyTutorial.steps.length, 7);
    assert.strictEqual(xyTutorial.steps.some((step) => step.completion && step.completion.kind === 'xy_plot_sources_bound'), true);
    const countStep = xyTutorial.steps.find((step) => step.completion && step.completion.kind === 'datasource_type_exists' && step.completion.count === 2);
    assert.ok(countStep, 'xy tutorial should have a datasource_type_exists step with count:2');
    const ffTutorial = runtime.bootstrap.tutorials.find((entry) => entry.id === 'core/fast-frame-from-csv');
    assert.ok(ffTutorial, 'fast-frame-from-csv tutorial should be loaded');
    assert.strictEqual(ffTutorial.title, 'Fast Frame From CSV');
    assert.deepStrictEqual(ffTutorial.menuSegments, ['Core', 'Fast Frame From Csv']);
    assert.strictEqual(ffTutorial.steps.length, 5);
    assert.strictEqual(ffTutorial.steps.some((step) => step.completion && step.completion.kind === 'fast_frame_plot_configured'), true);
    assert.ok(ffTutorial.resources, 'fast-frame tutorial should have resources');
    assert.strictEqual(typeof ffTutorial.resources.csv, 'string');
    assert.strictEqual(path.isAbsolute(ffTutorial.resources.csv), true, 'resources.csv should be an absolute path');
    assert.strictEqual(ffTutorial.resources.csv.endsWith('sample_data.csv'), true, 'resources.csv should end with sample_data.csv');
    assert.strictEqual(fs.existsSync(ffTutorial.resources.csv), true, 'resources.csv file should exist on disk');
    const ffAddWidgetStep = ffTutorial.steps.find((step) => step.id === 'add-fast-frame-widget');
    assert.ok(ffAddWidgetStep, 'fast-frame tutorial should have an add-fast-frame-widget step');
    assert.ok(Array.isArray(ffAddWidgetStep.actions), 'add-fast-frame-widget step should have actions array');
    assert.strictEqual(ffAddWidgetStep.actions.length, 1);
    assert.strictEqual(ffAddWidgetStep.actions[0].kind, 'apply_tutorial_csv');
    const ffNoActionSteps = ffTutorial.steps.filter((step) => step.id !== 'add-fast-frame-widget');
    assert.strictEqual(ffNoActionSteps.every((step) => Array.isArray(step.actions) && step.actions.length === 0), true, 'other ff steps should have empty actions arrays');
    const fftTutorial = runtime.bootstrap.tutorials.find((entry) => entry.id === 'core/fft-spectrum-from-csv');
    assert.ok(fftTutorial, 'fft-spectrum-from-csv tutorial should be loaded');
    assert.strictEqual(fftTutorial.title, 'FFT Spectrum From CSV');
    assert.deepStrictEqual(fftTutorial.menuSegments, ['Core', 'Fft Spectrum From Csv']);
    assert.strictEqual(fftTutorial.steps.length, 5);
    assert.strictEqual(fftTutorial.steps.some((step) => step.completion && step.completion.kind === 'fft_spectrum_configured'), true);
    assert.ok(fftTutorial.resources, 'fft-spectrum tutorial should have resources');
    assert.strictEqual(typeof fftTutorial.resources.csv, 'string');
    assert.strictEqual(path.isAbsolute(fftTutorial.resources.csv), true, 'fft resources.csv should be absolute');
    assert.strictEqual(fftTutorial.resources.csv.endsWith('sample_data.csv'), true, 'fft resources.csv should end with sample_data.csv');
    assert.strictEqual(fs.existsSync(fftTutorial.resources.csv), true, 'fft resources.csv should exist on disk');
    const fftAddWidgetStep = fftTutorial.steps.find((step) => step.id === 'add-fft-widget');
    assert.ok(fftAddWidgetStep, 'fft tutorial should have an add-fft-widget step');
    assert.ok(Array.isArray(fftAddWidgetStep.actions), 'add-fft-widget step should have actions array');
    assert.strictEqual(fftAddWidgetStep.actions.length, 1);
    assert.strictEqual(fftAddWidgetStep.actions[0].kind, 'apply_tutorial_csv');
    const fftNoActionSteps = fftTutorial.steps.filter((step) => step.id !== 'add-fft-widget');
    assert.strictEqual(fftNoActionSteps.every((step) => Array.isArray(step.actions) && step.actions.length === 0), true, 'other fft steps should have empty actions arrays');
    assert.strictEqual(Array.isArray(runtime.bootstrap.dashboardWelcomeEntries), true);
    const startupWelcome = runtime.bootstrap.dashboardWelcomeEntries.find((entry) => entry.id === 'tutorials-startup');
    assert.ok(startupWelcome, 'tutorial startup welcome should be loaded');
    assert.strictEqual(startupWelcome.trigger, 'startup');
    assert.strictEqual(startupWelcome.showWhen, 'empty_default_dashboard');
    assert.strictEqual(startupWelcome.actions.length, 5, 'startup welcome should have 5 tutorial actions');
    assert.strictEqual(startupWelcome.actions.some((action) => action.tutorialId === 'core/dashboard-basics'), true);
    assert.strictEqual(startupWelcome.actions.some((action) => action.tutorialId === 'core/xy-signal-generator'), true);
    assert.strictEqual(startupWelcome.actions.some((action) => action.tutorialId === 'core/fast-frame-from-csv'), true);
    assert.strictEqual(startupWelcome.actions.some((action) => action.tutorialId === 'core/fft-spectrum-from-csv'), true);
    assert.strictEqual(startupWelcome.actions.some((action) => action.tutorialId === 'core/vertical-gauge-basics'), true);
    const gaugeTutorial = runtime.bootstrap.tutorials.find((entry) => entry.id === 'core/vertical-gauge-basics');
    assert.ok(gaugeTutorial, 'vertical-gauge-basics tutorial should be loaded');
    assert.strictEqual(gaugeTutorial.title, 'Vertical Gauge Basics');
    assert.deepStrictEqual(gaugeTutorial.menuSegments, ['Core', 'Vertical Gauge Basics']);
    assert.strictEqual(gaugeTutorial.steps.length, 7);
    assert.strictEqual(gaugeTutorial.steps.some((step) => step.completion && step.completion.kind === 'gauge_source_bound'), true);
    assert.strictEqual(gaugeTutorial.steps.some((step) => step.completion && step.completion.kind === 'gauge_runtime_offset_adjusted'), true);
    assert.strictEqual(gaugeTutorial.steps.some((step) => step.completion && step.completion.kind === 'datasource_type_exists' && step.completion.datasourceType === 'signal_generator_datasource'), true);
    const spinTutorial = runtime.bootstrap.tutorials.find((entry) => entry.id === 'hardware/spin-serial-basics');
    assert.ok(spinTutorial, 'spin-serial-basics tutorial should be loaded');
    assert.strictEqual(spinTutorial.title, 'SPIN Serial Basics');
    assert.deepStrictEqual(spinTutorial.menuSegments, ['Hardware', 'Spin Serial Basics']);
    assert.strictEqual(spinTutorial.steps.length, 9);
    assert.strictEqual(spinTutorial.steps.some((step) => step.completion && step.completion.kind === 'serialport_datasource_connected'), true);
    assert.strictEqual(spinTutorial.steps.some((step) => step.completion && step.completion.kind === 'flash_completed'), true);
    assert.strictEqual(spinTutorial.steps.some((step) => step.completion && step.completion.kind === 'serial_command_buttons_configured'), true);
    assert.strictEqual(spinTutorial.steps.some((step) => step.completion && step.completion.kind === 'serial_csv_recorder_started'), true);
    assert.ok(spinTutorial.resources, 'spin tutorial should have resources');
    assert.strictEqual(typeof spinTutorial.resources.firmware, 'string');
    assert.strictEqual(path.isAbsolute(spinTutorial.resources.firmware), true, 'resources.firmware should be an absolute path');
    assert.strictEqual(spinTutorial.resources.firmware.endsWith('duty_cycle_setting.mcuboot.bin'), true, 'resources.firmware should end with duty_cycle_setting.mcuboot.bin');
    assert.strictEqual(fs.existsSync(spinTutorial.resources.firmware), true, 'resources.firmware file should exist on disk');
    const addFlasherStep = spinTutorial.steps.find((step) => step.id === 'add-flasher');
    assert.ok(addFlasherStep, 'spin tutorial should have an add-flasher step');
    assert.ok(Array.isArray(addFlasherStep.actions), 'add-flasher step should have actions array');
    assert.strictEqual(addFlasherStep.actions.length, 1);
    assert.strictEqual(addFlasherStep.actions[0].kind, 'apply_tutorial_firmware');
}

function runDisabledRuntimeAssertions() {
    const runtime = buildExtensionRuntime({
        appRoot,
        env: {
            ...process.env,
            MODULAR_EXTENSION_CORE: '0',
            MODULAR_EXTENSION_COURSEWARE: '0',
            MODULAR_EXTENSION_TUTORIALS: '0',
            MODULAR_EXTENSION_OWNTECH: '0',
            ENABLE_THINGSET: '0',
        },
    });

    assert.strictEqual(runtime.isEnabled('core'), true);
    assert.strictEqual(runtime.isEnabled('courseware'), false);
    assert.strictEqual(runtime.isEnabled('tutorials'), false);
    assert.strictEqual(runtime.isEnabled('owntech'), false);
    assert.strictEqual(runtime.isEnabled('owntech-workspace'), false);
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
    assert.strictEqual(runtime.bootstrap.exampleRoots.length, 0);
    assert.strictEqual(runtime.bootstrap.coursewareRoots.length, 0);
    assert.strictEqual(runtime.bootstrap.tutorialRoots.length, 0);
    assert.strictEqual(runtime.bootstrap.tutorials.length, 0);
    assert.strictEqual(runtime.bootstrap.dashboardWelcomePaths.length, 0);
    assert.strictEqual(runtime.bootstrap.dashboardWelcomeEntries.length, 0);
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

function runInvalidTutorialAssertions() {
    const tempAppRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modular-app-'));
    const warnings = [];

    try {
        fs.cpSync(appRoot, tempAppRoot, { recursive: true });
        const badTutorialDir = path.join(tempAppRoot, 'extensions', 'tutorials', 'tutorials', 'core', 'broken');
        fs.mkdirSync(badTutorialDir, { recursive: true });
        fs.writeFileSync(path.join(badTutorialDir, 'tutorial.json'), JSON.stringify({
            title: '',
            order: 99,
            steps: []
        }), 'utf8');

        const runtime = buildExtensionRuntime({
            appRoot: tempAppRoot,
            env: {
                ...process.env,
                ENABLE_THINGSET: '1',
            },
            logger: {
                warn: (...args) => warnings.push(args.join(' ')),
            },
        });

        assert.ok(runtime.bootstrap.tutorials.some((entry) => entry.id === 'core/dashboard-basics'));
        assert.strictEqual(runtime.bootstrap.tutorials.some((entry) => entry.id === 'core/broken'), false);
        assert.strictEqual(warnings.some((message) => message.includes('Invalid tutorial entry')), true);
    } finally {
        fs.rmSync(tempAppRoot, { recursive: true, force: true });
    }
}

function runInvalidDashboardWelcomeAssertions() {
    const tempAppRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modular-app-'));
    const warnings = [];

    try {
        fs.cpSync(appRoot, tempAppRoot, { recursive: true });
        const welcomePath = path.join(tempAppRoot, 'extensions', 'tutorials', 'welcome', 'dashboard-welcome.json');
        fs.writeFileSync(welcomePath, JSON.stringify({
            title: '',
            markdown: '',
            trigger: 'startup',
            showWhen: 'empty_default_dashboard',
            actions: []
        }), 'utf8');

        const runtime = buildExtensionRuntime({
            appRoot: tempAppRoot,
            env: {
                ...process.env,
                ENABLE_THINGSET: '1',
            },
            logger: {
                warn: (...args) => warnings.push(args.join(' ')),
            },
        });

        assert.strictEqual(runtime.bootstrap.dashboardWelcomeEntries.length, 0);
        assert.strictEqual(warnings.some((message) => message.includes('Invalid dashboard welcome entry')), true);
    } finally {
        fs.rmSync(tempAppRoot, { recursive: true, force: true });
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

// ── Built-in enable/disable persistence tests ─────────────────────────────────

function runBuiltinOverrideDisable() {
    // state.json in installedRoot disables a source-loaded extension
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modular-state-'));
    try {
        fs.writeFileSync(
            path.join(tempRoot, 'state.json'),
            JSON.stringify({ owntech: { enabled: false } }),
            'utf8'
        );
        const env = { ...process.env, ENABLE_THINGSET: '1' };
        delete env.MODULAR_EXTENSION_OWNTECH;
        const runtime = buildExtensionRuntime({ appRoot, env, installedRoot: tempRoot });

        const entry = runtime.inventory.find((e) => e.id === 'owntech');
        assert.ok(entry, 'owntech should be in inventory');
        assert.strictEqual(entry.enabled, false, 'state.json should disable owntech');
        const workspaceEntry = runtime.inventory.find((e) => e.id === 'owntech-workspace');
        assert.ok(workspaceEntry, 'owntech-workspace should be in inventory');
        assert.strictEqual(workspaceEntry.enabled, false, 'owntech-workspace should disable when owntech is disabled');
        assert.strictEqual(
            runtime.bootstrap.rendererScripts.some((s) => s.path.includes('twist')),
            false,
            'owntech renderer scripts should be absent when disabled via state.json'
        );
        assert.strictEqual(runtime.bootstrap.exampleRoots.length, 0, 'dependent examples roots should be absent when owntech is disabled');
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

function runBuiltinOverrideEnable() {
    // state.json enables a source-loaded extension whose manifest has enabledByDefault: false
    const extRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modular-extroot-'));
    const instRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modular-state-'));
    try {
        fs.cpSync(path.join(appRoot, 'extensions'), extRoot, { recursive: true });
        const customDir = path.join(extRoot, 'custom-off');
        fs.mkdirSync(customDir, { recursive: true });
        fs.writeFileSync(path.join(customDir, 'manifest.json'), JSON.stringify({
            apiVersion: 1,
            id: 'custom-off',
            displayName: 'Custom Off',
            version: '1.0.0',
            enabledByDefault: false,
        }), 'utf8');
        fs.writeFileSync(
            path.join(instRoot, 'state.json'),
            JSON.stringify({ 'custom-off': { enabled: true } }),
            'utf8'
        );

        const runtime = buildExtensionRuntime({
            appRoot,
            extensionRoot: extRoot,
            installedRoot: instRoot,
            env: { ...process.env, ENABLE_THINGSET: '1' },
        });

        const entry = runtime.inventory.find((e) => e.id === 'custom-off');
        assert.ok(entry, 'custom-off should be in inventory');
        assert.strictEqual(entry.enabled, true, 'state.json should override enabledByDefault:false to enabled');
    } finally {
        fs.rmSync(extRoot, { recursive: true, force: true });
        fs.rmSync(instRoot, { recursive: true, force: true });
    }
}

function runEnvVarWinsOverPersistedState() {
    // env var override beats state.json
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modular-state-'));
    try {
        fs.writeFileSync(
            path.join(tempRoot, 'state.json'),
            JSON.stringify({ owntech: { enabled: true } }),
            'utf8'
        );
        const runtime = buildExtensionRuntime({
            appRoot,
            env: { ...process.env, MODULAR_EXTENSION_OWNTECH: '0', MODULAR_EXTENSION_TUTORIALS: '0' },
            installedRoot: tempRoot,
        });

        const entry = runtime.inventory.find((e) => e.id === 'owntech');
        assert.ok(entry, 'owntech should be in inventory');
        assert.strictEqual(entry.enabled, false, 'env var should win over state.json');
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

function runCoreAlwaysEnabled() {
    // state.json cannot disable core
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modular-state-'));
    try {
        fs.writeFileSync(
            path.join(tempRoot, 'state.json'),
            JSON.stringify({ core: { enabled: false } }),
            'utf8'
        );
        const runtime = buildExtensionRuntime({
            appRoot,
            env: { ...process.env, ENABLE_THINGSET: '1' },
            installedRoot: tempRoot,
        });
        assert.strictEqual(runtime.isEnabled('core'), true, 'core must remain enabled regardless of state.json');
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

function runTutorialCompletionKindAssertions() {
    // Verify that the xy-signal-generator tutorial loads with all expected completion kinds.
    const runtime = buildExtensionRuntime({
        appRoot,
        env: { ...process.env, ENABLE_THINGSET: '1' },
    });

    const xyTutorial = runtime.bootstrap.tutorials.find((entry) => entry.id === 'core/xy-signal-generator');
    assert.ok(xyTutorial, 'xy-signal-generator tutorial must be present');

    const kinds = xyTutorial.steps.map((step) => step.completion && step.completion.kind).filter(Boolean);
    assert.ok(kinds.includes('manual'), 'manual kind must be present');
    assert.ok(kinds.includes('pane_count_at_least'), 'pane_count_at_least kind must be present');
    assert.ok(kinds.includes('datasource_type_exists'), 'datasource_type_exists kind must be present');
    assert.ok(kinds.includes('widget_type_exists'), 'widget_type_exists kind must be present');
    assert.ok(kinds.includes('xy_plot_sources_bound'), 'xy_plot_sources_bound kind must be present');

    // count:2 on datasource_type_exists must be preserved
    const countedStep = xyTutorial.steps.find(
        (step) => step.completion && step.completion.kind === 'datasource_type_exists' && step.completion.count === 2
    );
    assert.ok(countedStep, 'datasource_type_exists step with count:2 must normalise correctly');

    // count:1 default when count is omitted
    const defaultCountStep = xyTutorial.steps.find(
        (step) => step.completion && step.completion.kind === 'datasource_type_exists' && step.completion.count === 1
    );
    assert.ok(defaultCountStep, 'datasource_type_exists step without count should default to count:1');

    // widget_type_exists steps carry the correct type names
    const xyWidgetStep = xyTutorial.steps.find(
        (step) => step.completion && step.completion.kind === 'widget_type_exists' && step.completion.widgetType === 'xy_plot_uplot'
    );
    assert.ok(xyWidgetStep, 'widget_type_exists step for xy_plot_uplot must be present');

    // Verify that an unsupported completion kind throws during normalisation
    const tempAppRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modular-ck-'));
    const warnings = [];
    try {
        fs.cpSync(appRoot, tempAppRoot, { recursive: true });
        const badDir = path.join(tempAppRoot, 'extensions', 'tutorials', 'tutorials', 'core', 'bad-kind');
        fs.mkdirSync(badDir, { recursive: true });
        fs.writeFileSync(path.join(badDir, 'tutorial.json'), JSON.stringify({
            title: 'Bad Kind',
            order: 99,
            steps: [{ id: 's1', title: 'S1', markdown: 'x', completion: { kind: 'unknown_kind_xyz' } }]
        }), 'utf8');

        const rt = buildExtensionRuntime({
            appRoot: tempAppRoot,
            env: { ...process.env, ENABLE_THINGSET: '1' },
            logger: { warn: (...args) => warnings.push(args.join(' ')), error: () => {}, info: () => {} },
        });

        assert.strictEqual(rt.bootstrap.tutorials.some((e) => e.id === 'core/bad-kind'), false, 'bad-kind tutorial must be rejected');
        assert.ok(warnings.some((m) => m.includes('Invalid tutorial entry')), 'warning must mention invalid tutorial entry');
    } finally {
        fs.rmSync(tempAppRoot, { recursive: true, force: true });
    }
}

runDefaultRuntimeAssertions();
runDisabledRuntimeAssertions();
runInvalidManifestAssertions();
runInvalidTutorialAssertions();
runInvalidDashboardWelcomeAssertions();
runInstalledBundleDiscovery();
runInstalledBundleStateOverride();
runInstalledBundleIntegrityFailure();
runInstalledBundleDuplicateId();
runInstalledBundleMissingRoot();
runBuiltinOverrideDisable();
runBuiltinOverrideEnable();
runEnvVarWinsOverPersistedState();
runCoreAlwaysEnabled();
runTutorialCompletionKindAssertions();

console.log('All extension runtime tests passed.');
