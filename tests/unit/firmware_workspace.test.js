const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    FIRMWARE_FOCUSED_FILES,
    getFirmwareWorkspaceStatePath,
    listAdvancedWorkspaceEntries,
    listFocusedWorkspaceEntries,
    pickDefaultActiveFile,
    readFirmwareWorkspaceState,
    readWorkspaceTextFile,
    resolveWorkspacePath,
    validateFirmwareWorkspaceRoot,
    writeFirmwareWorkspaceState,
    writeWorkspaceTextFile,
} = require('../../app/firmware/workspace');

function makeWorkspaceFixture(rootDir) {
    fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'owntech', 'include'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'zephyr'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, '.git'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'old'), { recursive: true });

    fs.writeFileSync(
        path.join(rootDir, 'platformio.ini'),
        '[platformio]\ndefault_envs = USB\n\n[env:USB]\nplatform = native\n\n[env:SIM]\nplatform = native\n',
        'utf8'
    );
    fs.writeFileSync(path.join(rootDir, 'src', 'main.cpp'), 'int main() { return 0; }\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, 'src', 'app.ini'), '[app]\nmode = test\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, 'docs', 'notes.md'), '# Notes\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, 'owntech', 'include', 'fixture.hpp'), '#pragma once\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, 'zephyr', 'app.overlay'), '/ { };\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, '.git', 'config'), '[core]\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, 'old', 'legacy.txt'), 'legacy\n', 'utf8');
}

function runWorkspaceTests() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modular-firmware-workspace-'));
    const workspaceRoot = path.join(tempRoot, 'workspace');
    makeWorkspaceFixture(workspaceRoot);

    try {
        const validatedRoot = validateFirmwareWorkspaceRoot(workspaceRoot);
        assert.strictEqual(validatedRoot, path.resolve(workspaceRoot));

        const focused = listFocusedWorkspaceEntries(validatedRoot);
        assert.deepStrictEqual(focused.map((entry) => entry.relativePath), FIRMWARE_FOCUSED_FILES);
        assert.strictEqual(focused.every((entry) => entry.exists), true);

        const advanced = listAdvancedWorkspaceEntries(validatedRoot, { maxDepth: 4 });
        assert.strictEqual(advanced.some((entry) => entry.relativePath === 'docs/notes.md'), true);
        assert.strictEqual(advanced.some((entry) => entry.relativePath === 'owntech/include/fixture.hpp'), true);
        assert.strictEqual(advanced.some((entry) => entry.relativePath === 'zephyr/app.overlay'), true);
        assert.strictEqual(advanced.some((entry) => entry.relativePath.startsWith('.git')), false);
        assert.strictEqual(advanced.some((entry) => entry.relativePath.startsWith('old')), false);

        const defaultFile = pickDefaultActiveFile(validatedRoot);
        assert.strictEqual(defaultFile, 'src/main.cpp');

        const file = readWorkspaceTextFile(validatedRoot, 'src/main.cpp');
        assert.strictEqual(file.content.includes('return 0;'), true);

        writeWorkspaceTextFile(validatedRoot, 'src/main.cpp', 'int main() { return 7; }\n');
        const updatedFile = readWorkspaceTextFile(validatedRoot, 'src/main.cpp');
        assert.strictEqual(updatedFile.content.includes('return 7;'), true);

        assert.throws(() => resolveWorkspacePath(validatedRoot, '../outside.txt'), /inside workspace root/i);

        const userDataDir = path.join(tempRoot, 'userdata');
        const statePath = getFirmwareWorkspaceStatePath(userDataDir);
        const emptyState = readFirmwareWorkspaceState(statePath);
        assert.strictEqual(emptyState.workspaceRoot, null);
        const writtenState = writeFirmwareWorkspaceState(statePath, {
            workspaceRoot: validatedRoot,
            advancedMode: true,
            activeFile: 'src/main.cpp',
        });
        assert.strictEqual(writtenState.advancedMode, true);
        const roundTrippedState = readFirmwareWorkspaceState(statePath);
        assert.strictEqual(roundTrippedState.workspaceRoot, validatedRoot);
        assert.strictEqual(roundTrippedState.activeFile, 'src/main.cpp');
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

runWorkspaceTests();
console.log('All firmware workspace helper tests passed.');
