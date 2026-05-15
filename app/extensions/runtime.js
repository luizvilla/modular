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

function resolveEnabled(manifest, env) {
    if (manifest.id === 'core') return true;

    const genericOverride = parseBooleanToken(env[envKeyForExtension(manifest.id)]);
    if (genericOverride !== null) return genericOverride;

    if (manifest.id === 'thingset') {
        const legacyThingsetOverride = parseBooleanToken(env.ENABLE_THINGSET);
        if (legacyThingsetOverride !== null) return legacyThingsetOverride;
    }

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

function normalizeManifestRecord(manifestPath, options) {
    const { appRoot, env } = options;
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
        enabled: resolveEnabled(manifest, env),
        mainEntryPath,
        rendererScripts: normalizeRendererScripts(manifest, appRoot),
        widgetDocsRoots: normalizeWidgetDocsRoots(manifest, appRoot),
        exampleRoots: normalizeExampleRoots(manifest, appRoot),
        dashboardRoots: normalizeDashboardRoots(manifest, appRoot),
        preloadFlags: normalizePreloadFlags(manifest.preloadFlags),
        capabilities: normalizeCapabilities(manifest.capabilities),
        compatibilityTypes: normalizeCompatibilityTypes(manifest.compatibilityTypes),
        datasources: normalizeDatasources(manifest),
    };
}

function sortExtensions(records) {
    const rank = new Map([
        ['core', 0],
        ['owntech', 1],
        ['thingset', 2],
    ]);
    return records.slice().sort((left, right) => {
        const leftRank = rank.has(left.id) ? rank.get(left.id) : 100;
        const rightRank = rank.has(right.id) ? rank.get(right.id) : 100;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return left.id.localeCompare(right.id);
    });
}

function createContributionRegistry() {
    const rendererScriptKeys = new Set();
    const widgetDocsKeys = new Set();
    const exampleRootKeys = new Set();
    const dashboardRootKeys = new Set();
    const rendererScripts = [];
    const widgetDocsRoots = [];
    const exampleRoots = [];
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
        dashboardRoots: normalizeInstalledDashboardRoots(manifest, bundleDir),
        preloadFlags: normalizePreloadFlags(manifest.preloadFlags),
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

    for (const manifestPath of resolveManifestPaths(extensionRoot)) {
        try {
            const record = normalizeManifestRecord(manifestPath, { appRoot, env });
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
    const installedRoot = options.installedRoot || null;
    if (installedRoot) {
        const installedState = readInstalledState(installedRoot);
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

    const sortedRecords = sortExtensions(records);
    const registry = createContributionRegistry();
    loadExtensionEntries(sortedRecords, registry, logger, options.extensionContext);

    const inventory = sortedRecords.map(toInventoryEntry);
    const bootstrap = registry.buildBootstrap(inventory);
    bootstrap.widgetDocs = loadWidgetDocs(bootstrap.widgetDocsRoots, logger);
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
