const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const MANIFEST_FILENAME = 'manifest.json';
const MANIFEST_API_VERSION = 1;

function parseBooleanToken(value) {
    if (value === true || value === false) return value;
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return null;
}

function createLogger(logger) {
    const target = logger || console;
    return {
        warn: (...args) => (typeof target.warn === 'function' ? target.warn(...args) : console.warn(...args)),
        error: (...args) => (typeof target.error === 'function' ? target.error(...args) : console.error(...args)),
        info: (...args) => (typeof target.info === 'function' ? target.info(...args) : console.log(...args)),
    };
}

function normalizeCapabilities(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const result = [];
    for (const item of value) {
        if (typeof item !== 'string') continue;
        const token = item.trim();
        if (!token || seen.has(token)) continue;
        seen.add(token);
        result.push(token);
    }
    return result;
}

function normalizeDatasources(manifest) {
    if (!Array.isArray(manifest.datasources)) return [];
    const result = [];
    for (let index = 0; index < manifest.datasources.length; index++) {
        const entry = manifest.datasources[index];
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        if (typeof entry.type !== 'string' || !entry.type.trim()) {
            throw new Error(`datasources[${index}].type must be a non-empty string`);
        }
        result.push({
            type: entry.type.trim(),
            icon: typeof entry.icon === 'string' ? entry.icon.trim() : '',
        });
    }
    return result;
}

function normalizeCompatibilityTypes(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const result = [];
    for (const item of value) {
        if (typeof item !== 'string') continue;
        const token = item.trim();
        if (!token || seen.has(token)) continue;
        seen.add(token);
        result.push(token);
    }
    return result;
}

function toPosixPath(input) {
    return String(input || '').replace(/\\/g, '/');
}

function resolveManifestPaths(extensionRoot) {
    if (!fs.existsSync(extensionRoot)) return [];
    return fs.readdirSync(extensionRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(extensionRoot, entry.name, MANIFEST_FILENAME))
        .filter((manifestPath) => fs.existsSync(manifestPath))
        .sort((left, right) => left.localeCompare(right));
}

function ensureObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value;
}

function ensureRelativeFile(baseDir, relPath, label) {
    if (typeof relPath !== 'string' || !relPath.trim()) {
        throw new Error(`${label} must be a non-empty string`);
    }
    const absolutePath = path.resolve(baseDir, relPath);
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`${label} does not exist: ${absolutePath}`);
    }
    return absolutePath;
}

function ensureAppFile(appRoot, relPath, label) {
    if (typeof relPath !== 'string' || !relPath.trim()) {
        throw new Error(`${label} must be a non-empty string`);
    }
    const absolutePath = path.resolve(appRoot, relPath);
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`${label} does not exist: ${absolutePath}`);
    }
    return absolutePath;
}

function ensureDashboardScript(appRoot, relPath, label) {
    if (typeof relPath !== 'string' || !relPath.trim()) {
        throw new Error(`${label} must be a non-empty string`);
    }
    const normalizedPath = toPosixPath(relPath);
    const absolutePath = path.resolve(appRoot, 'dashboard', normalizedPath);
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`${label} does not exist: ${absolutePath}`);
    }
    return normalizedPath;
}

function readManifest(manifestPath) {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(raw);
}

function envKeyForExtension(id) {
    return `MODULAR_EXTENSION_${String(id || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')}`;
}

function resolveEnabled(manifest, env, persistedState) {
    if (manifest.id === 'core') return true;

    const genericOverride = parseBooleanToken(env[envKeyForExtension(manifest.id)]);
    if (genericOverride !== null) return genericOverride;

    if (manifest.id === 'thingset') {
        const legacyThingsetOverride = parseBooleanToken(env.ENABLE_THINGSET);
        if (legacyThingsetOverride !== null) return legacyThingsetOverride;
    }

    const persisted = persistedState && persistedState[manifest.id];
    if (persisted && typeof persisted.enabled === 'boolean') return persisted.enabled;

    return !!manifest.enabledByDefault;
}

function normalizeRendererScripts(manifest, appRoot) {
    if (!Array.isArray(manifest.rendererScripts)) return [];
    return manifest.rendererScripts.map((entry, index) => {
        const source = typeof entry === 'string'
            ? { path: entry, order: index + 1 }
            : ensureObject(entry, `rendererScripts[${index}]`);
        const order = Number(source.order);
        if (!Number.isFinite(order)) {
            throw new Error(`rendererScripts[${index}].order must be a finite number`);
        }
        return {
            path: ensureDashboardScript(appRoot, source.path, `rendererScripts[${index}].path`),
            order,
        };
    });
}

function normalizeWidgetDocsRoots(manifest, appRoot) {
    const raw = manifest.widgetDocsIndex;
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : [raw];
    return list.map((indexPath, index) => {
        const absoluteIndexPath = ensureAppFile(appRoot, indexPath, `widgetDocsIndex[${index}]`);
        return {
            extensionId: manifest.id,
            path: path.dirname(absoluteIndexPath),
            indexPath: absoluteIndexPath,
        };
    });
}

function normalizeExampleRoots(manifest, appRoot) {
    if (!Array.isArray(manifest.exampleRoots)) return [];
    return manifest.exampleRoots.map((entry, index) => {
        const source = ensureObject(entry, `exampleRoots[${index}]`);
        const docsRoot = ensureAppFile(appRoot, source.path, `exampleRoots[${index}].path`);
        const dashboardRoot = source.dashboardRoot
            ? ensureAppFile(appRoot, source.dashboardRoot, `exampleRoots[${index}].dashboardRoot`)
            : null;
        const firmwareRoot = source.firmwareRoot
            ? ensureAppFile(appRoot, source.firmwareRoot, `exampleRoots[${index}].firmwareRoot`)
            : null;
        return {
            extensionId: manifest.id,
            path: docsRoot,
            dashboardRoot,
            firmwareRoot,
        };
    });
}

function normalizeCoursewareRoots(manifest, appRoot) {
    if (!Array.isArray(manifest.coursewareRoots)) return [];
    return manifest.coursewareRoots.map((entry, index) => {
        const relPath = typeof entry === 'string'
            ? entry
            : ensureObject(entry, `coursewareRoots[${index}]`).path;
        const absolutePath = ensureAppFile(appRoot, relPath, `coursewareRoots[${index}]`);
        return {
            extensionId: manifest.id,
            path: absolutePath,
        };
    });
}

function normalizeTutorialRoots(manifest, appRoot) {
    if (!Array.isArray(manifest.tutorialRoots)) return [];
    return manifest.tutorialRoots.map((entry, index) => {
        const relPath = typeof entry === 'string'
            ? entry
            : ensureObject(entry, `tutorialRoots[${index}]`).path;
        const absolutePath = ensureAppFile(appRoot, relPath, `tutorialRoots[${index}]`);
        return {
            extensionId: manifest.id,
            path: absolutePath,
        };
    });
}

function normalizeDashboardWelcomePaths(manifest, appRoot) {
    const raw = manifest.dashboardWelcomePaths || manifest.dashboardWelcomePath;
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : [raw];
    return list.map((entry, index) => {
        const relPath = typeof entry === 'string'
            ? entry
            : ensureObject(entry, `dashboardWelcomePaths[${index}]`).path;
        return {
            extensionId: manifest.id,
            path: ensureAppFile(appRoot, relPath, `dashboardWelcomePaths[${index}]`),
        };
    });
}

function normalizeDashboardRoots(manifest, appRoot) {
    if (!Array.isArray(manifest.dashboardRoots)) return [];
    return manifest.dashboardRoots.map((entry, index) => {
        const relPath = typeof entry === 'string'
            ? entry
            : ensureObject(entry, `dashboardRoots[${index}]`).path;
        const absolutePath = ensureAppFile(appRoot, relPath, `dashboardRoots[${index}]`);
        return {
            extensionId: manifest.id,
            path: absolutePath,
        };
    });
}

function normalizePreloadFlags(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const flags = {};
    for (const [key, rawValue] of Object.entries(value)) {
        if (!key) continue;
        if (rawValue === undefined) continue;
        flags[key] = rawValue;
    }
    return flags;
}

function normalizeRequiredExtensions(value, label = 'requiresExtensions') {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    const result = [];
    value.forEach((entry, index) => {
        if (typeof entry !== 'string' || !entry.trim()) {
            throw new Error(`${label}[${index}] must be a non-empty string`);
        }
        const id = entry.trim();
        if (seen.has(id)) return;
        seen.add(id);
        result.push(id);
    });
    return result;
}

function normalizeManifestRecord(manifestPath, options) {
    const { appRoot, env, persistedState } = options;
    const manifestDir = path.dirname(manifestPath);
    const manifest = ensureObject(readManifest(manifestPath), manifestPath);

    if (manifest.apiVersion !== MANIFEST_API_VERSION) {
        throw new Error(`Unsupported apiVersion ${manifest.apiVersion} in ${manifestPath}`);
    }
    if (typeof manifest.id !== 'string' || !manifest.id.trim()) {
        throw new Error(`Manifest ${manifestPath} must declare a non-empty id`);
    }
    if (typeof manifest.displayName !== 'string' || !manifest.displayName.trim()) {
        throw new Error(`Manifest ${manifestPath} must declare a non-empty displayName`);
    }
    if (typeof manifest.enabledByDefault !== 'boolean') {
        throw new Error(`Manifest ${manifestPath} must declare enabledByDefault as a boolean`);
    }

    const mainEntryPath = manifest.mainEntry
        ? ensureRelativeFile(manifestDir, manifest.mainEntry, 'mainEntry')
        : null;

    return {
        id: manifest.id.trim(),
        displayName: manifest.displayName.trim(),
        version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
        manifestPath,
        manifestDir,
        manifest,
        enabled: resolveEnabled(manifest, env, persistedState),
        mainEntryPath,
        rendererScripts: normalizeRendererScripts(manifest, appRoot),
        widgetDocsRoots: normalizeWidgetDocsRoots(manifest, appRoot),
        exampleRoots: normalizeExampleRoots(manifest, appRoot),
        coursewareRoots: normalizeCoursewareRoots(manifest, appRoot),
        tutorialRoots: normalizeTutorialRoots(manifest, appRoot),
        dashboardWelcomePaths: normalizeDashboardWelcomePaths(manifest, appRoot),
        dashboardRoots: normalizeDashboardRoots(manifest, appRoot),
        preloadFlags: normalizePreloadFlags(manifest.preloadFlags),
        requiresExtensions: normalizeRequiredExtensions(manifest.requiresExtensions),
        capabilities: normalizeCapabilities(manifest.capabilities),
        compatibilityTypes: normalizeCompatibilityTypes(manifest.compatibilityTypes),
        datasources: normalizeDatasources(manifest),
    };
}

function sortExtensions(records) {
    const rank = new Map([
        ['core', 0],
        ['courseware', 1],
        ['tutorials', 2],
        ['owntech', 3],
        ['owntech-workspace', 4],
        ['thingset', 5],
    ]);
    return records.slice().sort((left, right) => {
        const leftRank = rank.has(left.id) ? rank.get(left.id) : 100;
        const rightRank = rank.has(right.id) ? rank.get(right.id) : 100;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return left.id.localeCompare(right.id);
    });
}

function applyRequiredExtensionConstraints(records, logger) {
    const byId = new Map(records.map((record) => [record.id, record]));
    let changed = true;
    while (changed) {
        changed = false;
        for (const record of records) {
            if (!record.enabled) continue;
            if (!Array.isArray(record.requiresExtensions) || !record.requiresExtensions.length) continue;
            const missingId = record.requiresExtensions.find((dependencyId) => {
                const dependency = byId.get(dependencyId);
                return !dependency || !dependency.enabled;
            });
            if (!missingId) continue;
            record.enabled = false;
            record.disabledByDependency = missingId;
            logger.warn(`[extensions] Disabling ${record.id}: requires enabled extension "${missingId}"`);
            changed = true;
        }
    }
}

function createContributionRegistry() {
    const rendererScriptKeys = new Set();
    const widgetDocsKeys = new Set();
    const exampleRootKeys = new Set();
    const coursewareRootKeys = new Set();
    const tutorialRootKeys = new Set();
    const dashboardWelcomeKeys = new Set();
    const dashboardRootKeys = new Set();
    const rendererScripts = [];
    const widgetDocsRoots = [];
    const exampleRoots = [];
    const coursewareRoots = [];
    const tutorialRoots = [];
    const dashboardWelcomePaths = [];
    const dashboardRoots = [];
    const flags = {};

    function addRendererScripts(extension, list) {
        for (const script of list || []) {
            const key = `${extension.id}:${script.order}:${script.path}`;
            if (rendererScriptKeys.has(key)) continue;
            rendererScriptKeys.add(key);
            rendererScripts.push({
                extensionId: extension.id,
                order: script.order,
                path: script.path,
            });
        }
    }

    function addWidgetDocsRoots(list) {
        for (const entry of list || []) {
            const key = entry.indexPath;
            if (widgetDocsKeys.has(key)) continue;
            widgetDocsKeys.add(key);
            widgetDocsRoots.push({ ...entry });
        }
    }

    function addExampleRoots(list) {
        for (const entry of list || []) {
            const key = `${entry.path}::${entry.dashboardRoot || ''}::${entry.firmwareRoot || ''}`;
            if (exampleRootKeys.has(key)) continue;
            exampleRootKeys.add(key);
            exampleRoots.push({ ...entry });
        }
    }

    function addCoursewareRoots(list) {
        for (const entry of list || []) {
            const key = entry.path;
            if (coursewareRootKeys.has(key)) continue;
            coursewareRootKeys.add(key);
            coursewareRoots.push({ ...entry });
        }
    }

    function addTutorialRoots(list) {
        for (const entry of list || []) {
            const key = entry.path;
            if (tutorialRootKeys.has(key)) continue;
            tutorialRootKeys.add(key);
            tutorialRoots.push({ ...entry });
        }
    }

    function addDashboardWelcomePaths(list) {
        for (const entry of list || []) {
            const key = entry.path;
            if (dashboardWelcomeKeys.has(key)) continue;
            dashboardWelcomeKeys.add(key);
            dashboardWelcomePaths.push({ ...entry });
        }
    }

    function addDashboardRoots(list) {
        for (const entry of list || []) {
            const key = entry.path;
            if (dashboardRootKeys.has(key)) continue;
            dashboardRootKeys.add(key);
            dashboardRoots.push({ ...entry });
        }
    }

    function addFlags(nextFlags) {
        for (const [key, value] of Object.entries(nextFlags || {})) {
            flags[key] = value;
        }
    }

    function addManifestContribution(extension) {
        addRendererScripts(extension, extension.rendererScripts);
        addWidgetDocsRoots(extension.widgetDocsRoots);
        addExampleRoots(extension.exampleRoots);
        addCoursewareRoots(extension.coursewareRoots);
        addTutorialRoots(extension.tutorialRoots);
        addDashboardWelcomePaths(extension.dashboardWelcomePaths);
        addDashboardRoots(extension.dashboardRoots);
        addFlags(extension.preloadFlags);
    }

    function addBootstrapContribution(extension, contribution) {
        if (!contribution || typeof contribution !== 'object') return;
        if (Array.isArray(contribution.rendererScripts)) {
            addRendererScripts(extension, contribution.rendererScripts.map((entry, index) => {
                const source = typeof entry === 'string'
                    ? { path: entry, order: index + 1 }
                    : ensureObject(entry, `rendererScripts[${index}]`);
                return {
                    path: toPosixPath(source.path),
                    order: Number(source.order),
                };
            }));
        }
        addWidgetDocsRoots(contribution.widgetDocsRoots);
        addExampleRoots(contribution.exampleRoots);
        addCoursewareRoots(contribution.coursewareRoots);
        addTutorialRoots(contribution.tutorialRoots);
        addDashboardWelcomePaths(contribution.dashboardWelcomePaths);
        addDashboardRoots(contribution.dashboardRoots);
        addFlags(contribution.flags);
    }

    function buildBootstrap(inventory) {
        return {
            rendererScripts: rendererScripts.slice().sort((left, right) => {
                if (left.order !== right.order) return left.order - right.order;
                return left.path.localeCompare(right.path);
            }),
            flags: { ...flags },
            extensions: inventory.map((entry) => ({ ...entry })),
            widgetDocsRoots: widgetDocsRoots.map((entry) => ({ ...entry })),
            exampleRoots: exampleRoots.map((entry) => ({ ...entry })),
            coursewareRoots: coursewareRoots.map((entry) => ({ ...entry })),
            tutorialRoots: tutorialRoots.map((entry) => ({ ...entry })),
            dashboardWelcomePaths: dashboardWelcomePaths.map((entry) => ({ ...entry })),
            dashboardRoots: dashboardRoots.map((entry) => ({ ...entry })),
        };
    }

    return {
        addManifestContribution,
        addBootstrapContribution,
        buildBootstrap,
    };
}

// ── Installed bundle support ──────────────────────────────────────────────────

function resolveInstalledScript(bundleDir, relPath, label) {
    if (typeof relPath !== 'string' || !relPath.trim()) {
        throw new Error(`${label} must be a non-empty string`);
    }
    const absolutePath = path.resolve(bundleDir, relPath);
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`${label} does not exist: ${absolutePath}`);
    }
    return pathToFileURL(absolutePath).toString();
}

function resolveInstalledManifestPaths(installedRoot) {
    if (!installedRoot || !fs.existsSync(installedRoot)) return [];
    const result = [];
    try {
        for (const idEntry of fs.readdirSync(installedRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
            const idPath = path.join(installedRoot, idEntry.name);
            const versions = fs.readdirSync(idPath, { withFileTypes: true })
                .filter((e) => e.isDirectory())
                .map((e) => e.name)
                .sort();
            if (!versions.length) continue;
            const manifestPath = path.join(idPath, versions[versions.length - 1], MANIFEST_FILENAME);
            if (fs.existsSync(manifestPath)) result.push(manifestPath);
        }
    } catch { /* ignore scan errors */ }
    return result;
}

function readInstalledState(installedRoot) {
    try {
        const raw = fs.readFileSync(path.join(installedRoot, 'state.json'), 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
}

function verifyBundleIntegrity(bundleDir, logger) {
    const checksumsPath = path.join(bundleDir, 'checksums.json');
    if (!fs.existsSync(checksumsPath)) return true;
    try {
        const checksums = JSON.parse(fs.readFileSync(checksumsPath, 'utf8'));
        if (!checksums || typeof checksums.files !== 'object') return true;
        const crypto = require('crypto');
        for (const [relPath, expectedHash] of Object.entries(checksums.files)) {
            const filePath = path.join(bundleDir, relPath);
            if (!fs.existsSync(filePath)) {
                logger.warn(`[extensions] Integrity: missing file ${relPath} in ${bundleDir}`);
                return false;
            }
            const actual = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
            if (actual !== expectedHash) {
                logger.warn(`[extensions] Integrity: checksum mismatch for ${relPath}`);
                return false;
            }
        }
        return true;
    } catch (err) {
        logger.warn(`[extensions] Integrity check error: ${err?.message || err}`);
        return false;
    }
}

function normalizeInstalledRendererScripts(manifest, bundleDir) {
    if (!Array.isArray(manifest.rendererScripts)) return [];
    return manifest.rendererScripts.map((entry, index) => {
        const source = typeof entry === 'string'
            ? { path: entry, order: index + 1 }
            : ensureObject(entry, `rendererScripts[${index}]`);
        const order = Number(source.order);
        if (!Number.isFinite(order)) {
            throw new Error(`rendererScripts[${index}].order must be a finite number`);
        }
        return {
            path: resolveInstalledScript(bundleDir, source.path, `rendererScripts[${index}].path`),
            order,
        };
    });
}

function normalizeInstalledWidgetDocsRoots(manifest, bundleDir) {
    const raw = manifest.widgetDocsIndex;
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : [raw];
    return list.map((indexPath, index) => {
        const absoluteIndexPath = ensureRelativeFile(bundleDir, indexPath, `widgetDocsIndex[${index}]`);
        return {
            extensionId: manifest.id,
            path: path.dirname(absoluteIndexPath),
            indexPath: absoluteIndexPath,
        };
    });
}

function normalizeInstalledExampleRoots(manifest, bundleDir) {
    if (!Array.isArray(manifest.exampleRoots)) return [];
    return manifest.exampleRoots.map((entry, index) => {
        const source = ensureObject(entry, `exampleRoots[${index}]`);
        const docsRoot = ensureRelativeFile(bundleDir, source.path, `exampleRoots[${index}].path`);
        const dashboardRoot = source.dashboardRoot
            ? ensureRelativeFile(bundleDir, source.dashboardRoot, `exampleRoots[${index}].dashboardRoot`)
            : null;
        const firmwareRoot = source.firmwareRoot
            ? ensureRelativeFile(bundleDir, source.firmwareRoot, `exampleRoots[${index}].firmwareRoot`)
            : null;
        return { extensionId: manifest.id, path: docsRoot, dashboardRoot, firmwareRoot };
    });
}

function normalizeInstalledCoursewareRoots(manifest, bundleDir) {
    if (!Array.isArray(manifest.coursewareRoots)) return [];
    return manifest.coursewareRoots.map((entry, index) => {
        const relPath = typeof entry === 'string'
            ? entry
            : ensureObject(entry, `coursewareRoots[${index}]`).path;
        return {
            extensionId: manifest.id,
            path: ensureRelativeFile(bundleDir, relPath, `coursewareRoots[${index}]`),
        };
    });
}

function normalizeInstalledTutorialRoots(manifest, bundleDir) {
    if (!Array.isArray(manifest.tutorialRoots)) return [];
    return manifest.tutorialRoots.map((entry, index) => {
        const relPath = typeof entry === 'string'
            ? entry
            : ensureObject(entry, `tutorialRoots[${index}]`).path;
        return {
            extensionId: manifest.id,
            path: ensureRelativeFile(bundleDir, relPath, `tutorialRoots[${index}]`),
        };
    });
}

function normalizeInstalledDashboardWelcomePaths(manifest, bundleDir) {
    const raw = manifest.dashboardWelcomePaths || manifest.dashboardWelcomePath;
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : [raw];
    return list.map((entry, index) => {
        const relPath = typeof entry === 'string'
            ? entry
            : ensureObject(entry, `dashboardWelcomePaths[${index}]`).path;
        return {
            extensionId: manifest.id,
            path: ensureRelativeFile(bundleDir, relPath, `dashboardWelcomePaths[${index}]`),
        };
    });
}

function normalizeInstalledDashboardRoots(manifest, bundleDir) {
    if (!Array.isArray(manifest.dashboardRoots)) return [];
    return manifest.dashboardRoots.map((entry, index) => {
        const relPath = typeof entry === 'string'
            ? entry
            : ensureObject(entry, `dashboardRoots[${index}]`).path;
        return {
            extensionId: manifest.id,
            path: ensureRelativeFile(bundleDir, relPath, `dashboardRoots[${index}]`),
        };
    });
}

function normalizeInstalledBundleRecord(manifestPath, options) {
    const { env, installedState, logger } = options;
    const bundleDir = path.dirname(manifestPath);
    const manifest = ensureObject(readManifest(manifestPath), manifestPath);

    if (manifest.apiVersion !== MANIFEST_API_VERSION) {
        throw new Error(`Unsupported apiVersion ${manifest.apiVersion} in ${manifestPath}`);
    }
    if (typeof manifest.id !== 'string' || !manifest.id.trim()) {
        throw new Error(`Manifest ${manifestPath} must declare a non-empty id`);
    }
    if (typeof manifest.displayName !== 'string' || !manifest.displayName.trim()) {
        throw new Error(`Manifest ${manifestPath} must declare a non-empty displayName`);
    }
    if (typeof manifest.enabledByDefault !== 'boolean') {
        throw new Error(`Manifest ${manifestPath} must declare enabledByDefault as a boolean`);
    }

    if (!verifyBundleIntegrity(bundleDir, logger)) {
        throw new Error(`Bundle integrity check failed for ${bundleDir}`);
    }

    const stateEntry = installedState[manifest.id.trim()];
    const enabled = stateEntry && typeof stateEntry.enabled === 'boolean'
        ? stateEntry.enabled
        : !!manifest.enabledByDefault;

    const mainEntryPath = manifest.mainEntry
        ? ensureRelativeFile(bundleDir, manifest.mainEntry, 'mainEntry')
        : null;

    return {
        id: manifest.id.trim(),
        displayName: manifest.displayName.trim(),
        version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
        manifestPath,
        manifestDir: bundleDir,
        manifest,
        enabled,
        mainEntryPath,
        rendererScripts: normalizeInstalledRendererScripts(manifest, bundleDir),
        widgetDocsRoots: normalizeInstalledWidgetDocsRoots(manifest, bundleDir),
        exampleRoots: normalizeInstalledExampleRoots(manifest, bundleDir),
        coursewareRoots: normalizeInstalledCoursewareRoots(manifest, bundleDir),
        tutorialRoots: normalizeInstalledTutorialRoots(manifest, bundleDir),
        dashboardWelcomePaths: normalizeInstalledDashboardWelcomePaths(manifest, bundleDir),
        dashboardRoots: normalizeInstalledDashboardRoots(manifest, bundleDir),
        preloadFlags: normalizePreloadFlags(manifest.preloadFlags),
        requiresExtensions: normalizeRequiredExtensions(manifest.requiresExtensions),
        capabilities: normalizeCapabilities(manifest.capabilities),
        compatibilityTypes: normalizeCompatibilityTypes(manifest.compatibilityTypes),
        datasources: normalizeDatasources(manifest),
        isInstalled: true,
        bundleDir,
    };
}

// ─────────────────────────────────────────────────────────────────────────────

function toInventoryEntry(record) {
    return {
        id: record.id,
        displayName: record.displayName,
        version: record.version || '0.0.0',
        enabled: record.enabled,
        capabilities: record.capabilities.slice(),
        requiresExtensions: Array.isArray(record.requiresExtensions) ? record.requiresExtensions.slice() : [],
        isInstalled: !!record.isInstalled,
    };
}

function loadExtensionEntries(records, registry, logger, extensionContext) {
    for (const record of records) {
        if (record.id === 'core') {
            registry.addManifestContribution(record);
            continue;
        }
        if (!record.enabled) continue;
        if (!record.mainEntryPath) {
            registry.addManifestContribution(record);
            continue;
        }
        try {
            delete require.cache[record.mainEntryPath];
            const entry = require(record.mainEntryPath);
            if (typeof entry !== 'function') {
                throw new Error(`Expected ${record.mainEntryPath} to export a function`);
            }
            entry({
                manifest: record.manifest,
                extension: toInventoryEntry(record),
                registerManifestContribution: () => registry.addManifestContribution(record),
                registerBootstrapContribution: (contribution) => registry.addBootstrapContribution(record, contribution),
                ...(extensionContext || {}),
            });
        } catch (err) {
            logger.warn(`[extensions] Failed to load ${record.id}: ${err?.message || err}`);
        }
    }
}

function loadWidgetDocs(widgetDocsRoots, logger) {
    const seen = new Set();
    const result = [];
    for (const source of widgetDocsRoots) {
        if (!source || !source.indexPath || !source.path) continue;
        let raw;
        try {
            raw = fs.readFileSync(source.indexPath, 'utf8');
        } catch (err) {
            logger.warn(`[extensions] Could not read widget docs index ${source.indexPath}: ${err?.message || err}`);
            continue;
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (err) {
            logger.warn(`[extensions] Could not parse widget docs index ${source.indexPath}: ${err?.message || err}`);
            continue;
        }
        const entries = Array.isArray(parsed?.widgets) ? parsed.widgets : [];
        for (const entry of entries) {
            if (!entry || typeof entry.type !== 'string' || !entry.type || !entry.doc) continue;
            if (seen.has(entry.type)) {
                logger.warn(`[extensions] Duplicate widget type "${entry.type}" in ${source.indexPath} — skipped`);
                continue;
            }
            seen.add(entry.type);
            result.push({
                type: entry.type,
                title: typeof entry.title === 'string' ? entry.title : entry.type,
                category: typeof entry.category === 'string' ? entry.category : 'Other',
                icon: typeof entry.icon === 'string' ? entry.icon : '',
                preferredOrder: typeof entry.preferredOrder === 'number' ? entry.preferredOrder : 999,
                doc: entry.doc,
                docPath: path.join(source.path, entry.doc),
                compatibilityOnly: !!entry.compatibilityOnly,
                extensionId: source.extensionId,
            });
        }
    }
    return result;
}

function isPathInside(baseDir, candidatePath) {
    const relative = path.relative(baseDir, candidatePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function humanizePathSegment(segment) {
    return String(segment || '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function resolveCoursewareEntryPath(labDir, relativePath, label, kind) {
    if (typeof relativePath !== 'string' || !relativePath.trim()) {
        throw new Error(`${label} must be a non-empty string`);
    }
    const absolutePath = path.resolve(labDir, relativePath);
    if (!isPathInside(labDir, absolutePath)) {
        throw new Error(`${label} must stay inside ${labDir}`);
    }
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`${label} does not exist: ${absolutePath}`);
    }
    const stat = fs.statSync(absolutePath);
    if (kind === 'directory' && !stat.isDirectory()) {
        throw new Error(`${label} must be a directory: ${absolutePath}`);
    }
    if (kind === 'file' && !stat.isFile()) {
        throw new Error(`${label} must be a file: ${absolutePath}`);
    }
    return absolutePath;
}

function resolveTutorialEntryPath(tutorialDir, relativePath, label, kind) {
    if (typeof relativePath !== 'string' || !relativePath.trim()) {
        throw new Error(`${label} must be a non-empty string`);
    }
    const absolutePath = path.resolve(tutorialDir, relativePath);
    if (!isPathInside(tutorialDir, absolutePath)) {
        throw new Error(`${label} must stay inside ${tutorialDir}`);
    }
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`${label} does not exist: ${absolutePath}`);
    }
    const stat = fs.statSync(absolutePath);
    if (kind === 'file' && !stat.isFile()) {
        throw new Error(`${label} must be a file: ${absolutePath}`);
    }
    if (kind === 'directory' && !stat.isDirectory()) {
        throw new Error(`${label} must be a directory: ${absolutePath}`);
    }
    return absolutePath;
}

function normalizeTutorialCompletion(step, index) {
    const completion = ensureObject(step.completion, `steps[${index}].completion`);
    const kind = typeof completion.kind === 'string' ? completion.kind.trim() : '';
    if (!kind) {
        throw new Error(`steps[${index}].completion.kind must be a non-empty string`);
    }
    if (kind === 'manual' || kind === 'time_plot_series_bound') {
        return { kind };
    }
    if (kind === 'pane_count_at_least') {
        const count = Math.max(1, Math.floor(Number(completion.count)));
        if (!Number.isFinite(count)) {
            throw new Error(`steps[${index}].completion.count must be a positive number`);
        }
        return { kind, count };
    }
    if (kind === 'datasource_type_exists') {
        const datasourceType = typeof completion.datasourceType === 'string'
            ? completion.datasourceType.trim()
            : '';
        if (!datasourceType) {
            throw new Error(`steps[${index}].completion.datasourceType must be a non-empty string`);
        }
        return { kind, datasourceType };
    }
    if (kind === 'widget_type_exists') {
        const widgetType = typeof completion.widgetType === 'string'
            ? completion.widgetType.trim()
            : '';
        if (!widgetType) {
            throw new Error(`steps[${index}].completion.widgetType must be a non-empty string`);
        }
        return { kind, widgetType };
    }
    throw new Error(`steps[${index}].completion.kind "${kind}" is not supported`);
}

function normalizeTutorialStep(step, index, tutorialDir) {
    const source = ensureObject(step, `steps[${index}]`);
    const id = typeof source.id === 'string' ? source.id.trim() : '';
    const title = typeof source.title === 'string' ? source.title.trim() : '';
    const markdown = typeof source.markdown === 'string' ? source.markdown.trim() : '';
    if (!id) {
        throw new Error(`steps[${index}].id must be a non-empty string`);
    }
    if (!title) {
        throw new Error(`steps[${index}].title must be a non-empty string`);
    }
    if (!markdown) {
        throw new Error(`steps[${index}].markdown must be a non-empty string`);
    }
    return {
        id,
        title,
        markdown,
        illustrationPath: source.illustration
            ? resolveTutorialEntryPath(tutorialDir, source.illustration, `steps[${index}].illustration`, 'file')
            : null,
        focusKey: typeof source.focusKey === 'string' && source.focusKey.trim()
            ? source.focusKey.trim()
            : null,
        autoAdvance: source.autoAdvance === true,
        completion: normalizeTutorialCompletion(source, index),
    };
}

function normalizeDashboardWelcomeAction(action, index) {
    const source = ensureObject(action, `actions[${index}]`);
    const tutorialId = typeof source.tutorialId === 'string' ? source.tutorialId.trim() : '';
    const label = typeof source.label === 'string' ? source.label.trim() : '';
    if (!tutorialId) {
        throw new Error(`actions[${index}].tutorialId must be a non-empty string`);
    }
    if (!label) {
        throw new Error(`actions[${index}].label must be a non-empty string`);
    }
    return {
        id: typeof source.id === 'string' && source.id.trim() ? source.id.trim() : tutorialId,
        tutorialId,
        label,
        description: typeof source.description === 'string' && source.description.trim()
            ? source.description.trim()
            : '',
    };
}

function loadCourseware(coursewareRoots, logger) {
    const seen = new Set();
    const result = [];

    function collectManifests(baseDir) {
        const manifests = [];
        if (!baseDir || !fs.existsSync(baseDir)) return manifests;
        const walk = (currentDir) => {
            let entries = [];
            try {
                entries = fs.readdirSync(currentDir, { withFileTypes: true });
            } catch (err) {
                logger.warn(`[extensions] Could not read courseware directory ${currentDir}: ${err?.message || err}`);
                return;
            }
            for (const entry of entries) {
                const full = path.join(currentDir, entry.name);
                if (entry.isDirectory()) {
                    walk(full);
                } else if (entry.isFile() && entry.name === 'courseware.json') {
                    manifests.push(full);
                }
            }
        };
        walk(baseDir);
        return manifests;
    }

    for (const root of coursewareRoots || []) {
        if (!root || !root.path) continue;
        const manifests = collectManifests(root.path).sort((left, right) => left.localeCompare(right));
        for (const manifestPath of manifests) {
            const labDir = path.dirname(manifestPath);
            try {
                const raw = fs.readFileSync(manifestPath, 'utf8');
                const parsed = ensureObject(JSON.parse(raw), manifestPath);
                const relativeDir = path.relative(root.path, labDir);
                const rawSegments = relativeDir.split(path.sep).filter(Boolean);
                const menuSegments = rawSegments.length ? rawSegments.slice() : [path.basename(labDir)];
                const id = menuSegments.join('/');
                if (seen.has(id)) {
                    logger.warn(`[extensions] Duplicate courseware id "${id}" in ${manifestPath} — skipped`);
                    continue;
                }
                const title = typeof parsed.title === 'string' && parsed.title.trim()
                    ? parsed.title.trim()
                    : null;
                if (!title) {
                    throw new Error('title must be a non-empty string');
                }
                const order = Number.isFinite(Number(parsed.order)) ? Number(parsed.order) : 999;
                const markdownPath = resolveCoursewareEntryPath(labDir, parsed.markdown, 'markdown', 'file');
                const dashboardPath = resolveCoursewareEntryPath(labDir, parsed.dashboard, 'dashboard', 'file');
                const binaryPath = resolveCoursewareEntryPath(labDir, parsed.binary, 'binary', 'file');
                const figuresDirPath = resolveCoursewareEntryPath(labDir, parsed.figuresDir, 'figuresDir', 'directory');

                seen.add(id);
                result.push({
                    id,
                    title,
                    order,
                    extensionId: root.extensionId,
                    rootPath: root.path,
                    dirPath: labDir,
                    markdownPath,
                    dashboardPath,
                    binaryPath,
                    figuresDirPath,
                    menuSegments: menuSegments.map(humanizePathSegment),
                });
            } catch (err) {
                logger.warn(`[extensions] Invalid courseware entry ${manifestPath}: ${err?.message || err}`);
            }
        }
    }

    return result.sort((left, right) => {
        if (left.extensionId !== right.extensionId) return left.extensionId.localeCompare(right.extensionId);
        const leftMenu = left.menuSegments.join('/');
        const rightMenu = right.menuSegments.join('/');
        if (leftMenu !== rightMenu) return leftMenu.localeCompare(rightMenu);
        if (left.order !== right.order) return left.order - right.order;
        return left.title.localeCompare(right.title);
    });
}

function loadDashboardWelcome(dashboardWelcomePaths, logger) {
    const seen = new Set();
    const result = [];

    for (const source of dashboardWelcomePaths || []) {
        if (!source || !source.path) continue;
        try {
            const raw = fs.readFileSync(source.path, 'utf8');
            const parsed = ensureObject(JSON.parse(raw), source.path);
            const title = typeof parsed.title === 'string' && parsed.title.trim()
                ? parsed.title.trim()
                : null;
            const markdown = typeof parsed.markdown === 'string' && parsed.markdown.trim()
                ? parsed.markdown.trim()
                : null;
            if (!title) {
                throw new Error('title must be a non-empty string');
            }
            if (!markdown) {
                throw new Error('markdown must be a non-empty string');
            }
            const trigger = typeof parsed.trigger === 'string' ? parsed.trigger.trim() : 'startup';
            const showWhen = typeof parsed.showWhen === 'string' ? parsed.showWhen.trim() : 'empty_default_dashboard';
            if (trigger !== 'startup') {
                throw new Error(`trigger "${trigger}" is not supported`);
            }
            if (showWhen !== 'empty_default_dashboard') {
                throw new Error(`showWhen "${showWhen}" is not supported`);
            }
            const actions = Array.isArray(parsed.actions) ? parsed.actions : null;
            if (!actions || !actions.length) {
                throw new Error('actions must be a non-empty array');
            }
            const id = typeof parsed.id === 'string' && parsed.id.trim()
                ? parsed.id.trim()
                : `${source.extensionId}:${path.basename(source.path, path.extname(source.path))}`;
            if (seen.has(id)) {
                logger.warn(`[extensions] Duplicate dashboard welcome id "${id}" in ${source.path} — skipped`);
                continue;
            }
            seen.add(id);
            result.push({
                id,
                extensionId: source.extensionId,
                path: source.path,
                title,
                markdown,
                trigger,
                showWhen,
                order: Number.isFinite(Number(parsed.order)) ? Number(parsed.order) : 999,
                actions: actions.map((action, index) => normalizeDashboardWelcomeAction(action, index)),
            });
        } catch (err) {
            logger.warn(`[extensions] Invalid dashboard welcome entry ${source.path}: ${err?.message || err}`);
        }
    }

    return result.sort((left, right) => {
        if (left.extensionId !== right.extensionId) return left.extensionId.localeCompare(right.extensionId);
        if (left.order !== right.order) return left.order - right.order;
        return left.title.localeCompare(right.title);
    });
}

function loadTutorials(tutorialRoots, logger) {
    const seen = new Set();
    const result = [];

    function collectManifests(baseDir) {
        const manifests = [];
        if (!baseDir || !fs.existsSync(baseDir)) return manifests;
        const walk = (currentDir) => {
            let entries = [];
            try {
                entries = fs.readdirSync(currentDir, { withFileTypes: true });
            } catch (err) {
                logger.warn(`[extensions] Could not read tutorial directory ${currentDir}: ${err?.message || err}`);
                return;
            }
            for (const entry of entries) {
                const full = path.join(currentDir, entry.name);
                if (entry.isDirectory()) {
                    walk(full);
                } else if (entry.isFile() && entry.name === 'tutorial.json') {
                    manifests.push(full);
                }
            }
        };
        walk(baseDir);
        return manifests;
    }

    for (const root of tutorialRoots || []) {
        if (!root || !root.path) continue;
        const manifests = collectManifests(root.path).sort((left, right) => left.localeCompare(right));
        for (const manifestPath of manifests) {
            const tutorialDir = path.dirname(manifestPath);
            try {
                const raw = fs.readFileSync(manifestPath, 'utf8');
                const parsed = ensureObject(JSON.parse(raw), manifestPath);
                const relativeDir = path.relative(root.path, tutorialDir);
                const rawSegments = relativeDir.split(path.sep).filter(Boolean);
                const menuSegments = rawSegments.length ? rawSegments.slice() : [path.basename(tutorialDir)];
                const id = menuSegments.join('/');
                if (seen.has(id)) {
                    logger.warn(`[extensions] Duplicate tutorial id "${id}" in ${manifestPath} — skipped`);
                    continue;
                }
                const title = typeof parsed.title === 'string' && parsed.title.trim()
                    ? parsed.title.trim()
                    : null;
                if (!title) {
                    throw new Error('title must be a non-empty string');
                }
                const steps = Array.isArray(parsed.steps) ? parsed.steps : null;
                if (!steps || !steps.length) {
                    throw new Error('steps must be a non-empty array');
                }
                const order = Number.isFinite(Number(parsed.order)) ? Number(parsed.order) : 999;
                const normalizedSteps = steps.map((step, index) => normalizeTutorialStep(step, index, tutorialDir));
                const stepIds = new Set();
                normalizedSteps.forEach((step, index) => {
                    if (stepIds.has(step.id)) {
                        throw new Error(`steps[${index}].id "${step.id}" is duplicated`);
                    }
                    stepIds.add(step.id);
                });

                seen.add(id);
                result.push({
                    id,
                    title,
                    order,
                    overlayMode: parsed.overlayMode === true,
                    extensionId: root.extensionId,
                    rootPath: root.path,
                    dirPath: tutorialDir,
                    manifestPath,
                    menuSegments: menuSegments.map(humanizePathSegment),
                    steps: normalizedSteps,
                });
            } catch (err) {
                logger.warn(`[extensions] Invalid tutorial entry ${manifestPath}: ${err?.message || err}`);
            }
        }
    }

    return result.sort((left, right) => {
        if (left.extensionId !== right.extensionId) return left.extensionId.localeCompare(right.extensionId);
        const leftMenu = left.menuSegments.join('/');
        const rightMenu = right.menuSegments.join('/');
        if (leftMenu !== rightMenu) return leftMenu.localeCompare(rightMenu);
        if (left.order !== right.order) return left.order - right.order;
        return left.title.localeCompare(right.title);
    });
}

function mergeDatasources(sortedRecords) {
    const seen = new Set();
    const result = [];
    for (const record of sortedRecords) {
        if (!record.enabled && record.id !== 'core') continue;
        for (const ds of record.datasources) {
            if (seen.has(ds.type)) continue;
            seen.add(ds.type);
            result.push({ ...ds, extensionId: record.id });
        }
    }
    return result;
}

function buildExtensionRuntime(options = {}) {
    const logger = createLogger(options.logger);
    const appRoot = path.resolve(options.appRoot || path.join(__dirname, '..'));
    const env = options.env || process.env;
    const extensionRoot = path.resolve(
        options.extensionRoot
            || env.MODULAR_EXTENSION_ROOT
            || path.join(appRoot, 'extensions')
    );

    const invalidManifests = [];
    const records = [];
    const seenIds = new Set();

    // Read state.json once — used for both source-loaded enable overrides and installed bundle state.
    const installedRoot = options.installedRoot || null;
    const installedState = installedRoot ? readInstalledState(installedRoot) : {};

    for (const manifestPath of resolveManifestPaths(extensionRoot)) {
        try {
            const record = normalizeManifestRecord(manifestPath, { appRoot, env, persistedState: installedState });
            if (seenIds.has(record.id)) {
                throw new Error(`Duplicate extension id ${record.id}`);
            }
            seenIds.add(record.id);
            records.push(record);
        } catch (err) {
            invalidManifests.push({
                manifestPath,
                error: err?.message || String(err),
            });
            logger.warn(`[extensions] Skipping invalid manifest ${manifestPath}: ${err?.message || err}`);
        }
    }

    // Discover installed bundles alongside source-loaded extensions.
    if (installedRoot) {
        for (const manifestPath of resolveInstalledManifestPaths(installedRoot)) {
            try {
                const record = normalizeInstalledBundleRecord(manifestPath, { env, installedState, logger });
                if (seenIds.has(record.id)) {
                    throw new Error(`Duplicate extension id ${record.id} (conflicts with source-loaded extension)`);
                }
                seenIds.add(record.id);
                records.push(record);
            } catch (err) {
                invalidManifests.push({ manifestPath, error: err?.message || String(err) });
                logger.warn(`[extensions] Skipping invalid installed bundle ${manifestPath}: ${err?.message || err}`);
            }
        }
    }

    applyRequiredExtensionConstraints(records, logger);
    const sortedRecords = sortExtensions(records);
    const registry = createContributionRegistry();
    loadExtensionEntries(sortedRecords, registry, logger, options.extensionContext);

    const inventory = sortedRecords.map(toInventoryEntry);
    const bootstrap = registry.buildBootstrap(inventory);
    bootstrap.widgetDocs = loadWidgetDocs(bootstrap.widgetDocsRoots, logger);
    bootstrap.courseware = loadCourseware(bootstrap.coursewareRoots, logger);
    bootstrap.tutorials = loadTutorials(bootstrap.tutorialRoots, logger);
    bootstrap.dashboardWelcomeEntries = loadDashboardWelcome(bootstrap.dashboardWelcomePaths, logger);
    bootstrap.datasources = mergeDatasources(sortedRecords);

    return {
        appRoot,
        extensionRoot,
        installedRoot,
        invalidManifests,
        records: sortedRecords,
        inventory,
        bootstrap,
        isEnabled(id) {
            return sortedRecords.some((record) => record.id === id && record.enabled);
        },
    };
}

module.exports = {
    MANIFEST_API_VERSION,
    MANIFEST_FILENAME,
    buildExtensionRuntime,
    readInstalledState,
};
