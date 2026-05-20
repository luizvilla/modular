const fs = require('fs');
const path = require('path');

const FIRMWARE_FOCUSED_FILES = Object.freeze([
    'src/main.cpp',
    'src/app.ini',
    'platformio.ini',
]);

const DEFAULT_WORKSPACE_STATE = Object.freeze({
    workspaceRoot: null,
    advancedMode: false,
    activeFile: null,
});

const ADVANCED_SKIP_DIRS = new Set([
    '.git',
    '.pio',
    '.vscode',
    'old',
    'venv',
]);

function toPosixPath(input) {
    return String(input || '').replace(/\\/g, '/');
}

function getFirmwareWorkspaceStatePath(userDataDir) {
    return path.join(userDataDir, 'firmware-workspace', 'state.json');
}

function readFirmwareWorkspaceState(statePath) {
    try {
        const raw = fs.readFileSync(statePath, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            ...DEFAULT_WORKSPACE_STATE,
            ...(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}),
        };
    } catch {
        return { ...DEFAULT_WORKSPACE_STATE };
    }
}

function writeFirmwareWorkspaceState(statePath, nextState) {
    const normalized = {
        ...DEFAULT_WORKSPACE_STATE,
        ...(nextState && typeof nextState === 'object' && !Array.isArray(nextState) ? nextState : {}),
    };
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(normalized, null, 2), 'utf8');
    return normalized;
}

function validateFirmwareWorkspaceRoot(rootPath) {
    if (typeof rootPath !== 'string' || !rootPath.trim()) {
        throw new Error('Workspace path is required');
    }
    const resolvedRoot = path.resolve(rootPath);
    let stats;
    try {
        stats = fs.statSync(resolvedRoot);
    } catch {
        throw new Error(`Workspace path does not exist: ${resolvedRoot}`);
    }
    if (!stats.isDirectory()) {
        throw new Error(`Workspace path must be a directory: ${resolvedRoot}`);
    }
    const platformioPath = path.join(resolvedRoot, 'platformio.ini');
    if (!fs.existsSync(platformioPath) || !fs.statSync(platformioPath).isFile()) {
        throw new Error(`Workspace root must contain platformio.ini: ${resolvedRoot}`);
    }
    return resolvedRoot;
}

function isPathInsideWorkspace(rootPath, candidatePath) {
    const relative = path.relative(rootPath, candidatePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeRelativeWorkspacePath(relativePath) {
    if (typeof relativePath !== 'string' || !relativePath.trim()) {
        throw new Error('relativePath is required');
    }
    const parts = toPosixPath(relativePath)
        .split('/')
        .map((segment) => segment.trim())
        .filter(Boolean);
    if (!parts.length) {
        throw new Error('relativePath is required');
    }
    return parts.join('/');
}

function resolveWorkspacePath(rootPath, relativePath) {
    const normalizedRoot = validateFirmwareWorkspaceRoot(rootPath);
    const normalizedRelativePath = normalizeRelativeWorkspacePath(relativePath);
    const absolutePath = path.resolve(normalizedRoot, normalizedRelativePath);
    if (!isPathInsideWorkspace(normalizedRoot, absolutePath)) {
        throw new Error(`Path must stay inside workspace root: ${normalizedRelativePath}`);
    }
    return {
        rootPath: normalizedRoot,
        relativePath: toPosixPath(path.relative(normalizedRoot, absolutePath)),
        absolutePath,
    };
}

function readWorkspaceTextFile(rootPath, relativePath) {
    const resolved = resolveWorkspacePath(rootPath, relativePath);
    let stats;
    try {
        stats = fs.statSync(resolved.absolutePath);
    } catch {
        throw new Error(`Workspace file does not exist: ${resolved.relativePath}`);
    }
    if (!stats.isFile()) {
        throw new Error(`Workspace path is not a file: ${resolved.relativePath}`);
    }
    return {
        ...resolved,
        content: fs.readFileSync(resolved.absolutePath, 'utf8'),
    };
}

function writeWorkspaceTextFile(rootPath, relativePath, content) {
    const resolved = resolveWorkspacePath(rootPath, relativePath);
    let stats;
    try {
        stats = fs.statSync(resolved.absolutePath);
    } catch {
        throw new Error(`Workspace file does not exist: ${resolved.relativePath}`);
    }
    if (!stats.isFile()) {
        throw new Error(`Workspace path is not a file: ${resolved.relativePath}`);
    }
    fs.writeFileSync(resolved.absolutePath, content ?? '', 'utf8');
    return resolved;
}

function makeFileEntry(relativePath, exists) {
    return {
        type: 'file',
        name: path.posix.basename(relativePath),
        relativePath,
        displayPath: relativePath,
        depth: Math.max(0, relativePath.split('/').length - 1),
        exists: !!exists,
        missing: !exists,
    };
}

function listFocusedWorkspaceEntries(rootPath) {
    const normalizedRoot = validateFirmwareWorkspaceRoot(rootPath);
    return FIRMWARE_FOCUSED_FILES.map((relativePath) => {
        const absolutePath = path.join(normalizedRoot, ...relativePath.split('/'));
        const exists = fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
        return makeFileEntry(relativePath, exists);
    });
}

function compareDirEntries(left, right) {
    const leftDir = left.isDirectory() ? 0 : 1;
    const rightDir = right.isDirectory() ? 0 : 1;
    if (leftDir !== rightDir) return leftDir - rightDir;
    return left.name.localeCompare(right.name);
}

function listAdvancedWorkspaceEntries(rootPath, options = {}) {
    const normalizedRoot = validateFirmwareWorkspaceRoot(rootPath);
    const maxDepth = Number.isFinite(options.maxDepth) ? Math.max(1, options.maxDepth) : 4;
    const result = [];

    function walk(currentPath, depth) {
        let entries = [];
        try {
            entries = fs.readdirSync(currentPath, { withFileTypes: true }).sort(compareDirEntries);
        } catch {
            return;
        }

        for (const entry of entries) {
            const absolutePath = path.join(currentPath, entry.name);
            const relativePath = toPosixPath(path.relative(normalizedRoot, absolutePath));
            if (!relativePath) continue;

            if (entry.isDirectory()) {
                if (ADVANCED_SKIP_DIRS.has(entry.name)) continue;
                result.push({
                    type: 'directory',
                    name: entry.name,
                    relativePath,
                    displayPath: relativePath,
                    depth,
                    exists: true,
                    missing: false,
                });
                if (depth + 1 < maxDepth) {
                    walk(absolutePath, depth + 1);
                }
                continue;
            }

            if (entry.isFile()) {
                result.push(makeFileEntry(relativePath, true));
            }
        }
    }

    walk(normalizedRoot, 0);
    return result;
}

function pickDefaultActiveFile(rootPath) {
    const focused = listFocusedWorkspaceEntries(rootPath);
    const preferred = focused.find((entry) => entry.exists);
    if (preferred) return preferred.relativePath;
    const advanced = listAdvancedWorkspaceEntries(rootPath, { maxDepth: 3 });
    const fallback = advanced.find((entry) => entry.type === 'file');
    return fallback ? fallback.relativePath : null;
}

module.exports = {
    ADVANCED_SKIP_DIRS,
    DEFAULT_WORKSPACE_STATE,
    FIRMWARE_FOCUSED_FILES,
    getFirmwareWorkspaceStatePath,
    isPathInsideWorkspace,
    listAdvancedWorkspaceEntries,
    listFocusedWorkspaceEntries,
    pickDefaultActiveFile,
    readFirmwareWorkspaceState,
    readWorkspaceTextFile,
    resolveWorkspacePath,
    toPosixPath,
    validateFirmwareWorkspaceRoot,
    writeFirmwareWorkspaceState,
    writeWorkspaceTextFile,
};
