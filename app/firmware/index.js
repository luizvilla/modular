const state = {
    workspace: null,
    build: null,
    toolchain: null,
    fileEntries: [],
    tabs: new Map(),
    tabOrder: [],
    activeTabId: null,
    editor: null,
    monaco: null,
    monacoReady: false,
    monacoLoadingPromise: null,
    consoleLines: [],
};

function appendConsoleLine(message) {
    const lines = String(message || '')
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => line.trimEnd())
        .filter((line) => line.trim().length > 0);
    if (!lines.length) return;
    state.consoleLines.push(...lines);
    if (state.consoleLines.length > 220) {
        state.consoleLines.splice(0, state.consoleLines.length - 220);
    }
    document.getElementById('console-output').textContent = state.consoleLines.join('\n');
}

function setStatusChip(id, message) {
    const element = document.getElementById(id);
    if (element) element.textContent = message;
}

function formatToolchainSummary(toolchainState) {
    if (!toolchainState || typeof toolchainState !== 'object') {
        return 'Toolchain status unavailable';
    }
    if (toolchainState.platformio?.status === 'available') {
        const version = toolchainState.platformio?.version || 'PlatformIO available';
        return `PlatformIO ready · ${version}`;
    }
    return `PlatformIO unavailable · ${toolchainState.platformio?.error || 'No working local CLI detected'}`;
}

function formatBuildSummary(buildState) {
    if (!buildState || typeof buildState !== 'object') {
        return 'Build status unavailable';
    }
    if (buildState.activeJob) {
        const action = String(buildState.activeJob.action || 'build').toUpperCase();
        return `${action} running for ${buildState.activeJob.env || 'unknown env'}`;
    }
    if (buildState.supported) {
        return `Ready on ${buildState.selectedEnv || 'no env selected'}`;
    }
    return buildState.placeholderMessage || 'Build actions disabled';
}

function getTab(relativePath) {
    return relativePath ? state.tabs.get(relativePath) || null : null;
}

function getActiveTab() {
    return getTab(state.activeTabId);
}

function hasAnyDirtyTabs() {
    return Array.from(state.tabs.values()).some((tab) => tab.dirty);
}

function pickInitialFileFromState() {
    if (state.workspace?.workspace?.activeFile) {
        return state.workspace.workspace.activeFile;
    }
    const candidate = state.fileEntries.find((entry) => entry.type === 'file' && !entry.missing);
    return candidate ? candidate.relativePath : null;
}

function confirmDiscardDirtyTabs(reason) {
    if (!hasAnyDirtyTabs()) return true;
    return window.confirm(`Discard unsaved Monaco tabs before ${reason}?`);
}

function ensureMonacoStylesheet(vsBaseUrl) {
    if (document.getElementById('monaco-editor-styles')) return;
    const link = document.createElement('link');
    link.id = 'monaco-editor-styles';
    link.rel = 'stylesheet';
    link.href = `${vsBaseUrl}/editor/editor.main.css`;
    document.head.appendChild(link);
}

function loadMonaco() {
    if (state.monacoLoadingPromise) return state.monacoLoadingPromise;
    if (!window.api?.paths) {
        return Promise.reject(new Error('Path helpers are unavailable in preload.'));
    }

    const appDir = window.api.paths.appDir();
    const vsBaseUrl = window.api.paths.toFileUrl(
        window.api.paths.join(appDir, '..', 'node_modules', 'monaco-editor', 'min', 'vs')
    ).replace(/\/$/, '');

    ensureMonacoStylesheet(vsBaseUrl);

    state.monacoLoadingPromise = new Promise((resolve, reject) => {
        const finish = () => {
            state.monaco = window.monaco;
            state.monacoReady = true;
            resolve(window.monaco);
        };

        if (window.monaco?.editor) {
            finish();
            return;
        }

        window.MonacoEnvironment = {
            getWorkerUrl() {
                const workerCode = [
                    `self.MonacoEnvironment = { baseUrl: ${JSON.stringify(`${vsBaseUrl}/`)} };`,
                    `importScripts(${JSON.stringify(`${vsBaseUrl}/base/worker/workerMain.js`)});`
                ].join('\n');
                return URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
            }
        };

        const script = document.createElement('script');
        script.src = `${vsBaseUrl}/loader.js`;
        script.onload = () => {
            if (typeof window.require !== 'function') {
                reject(new Error('Monaco AMD loader did not initialize.'));
                return;
            }
            window.require.config({ paths: { vs: vsBaseUrl } });
            window.require(['vs/editor/editor.main'], finish, reject);
        };
        script.onerror = () => reject(new Error('Could not load Monaco loader script.'));
        document.head.appendChild(script);
    });

    return state.monacoLoadingPromise;
}

function languageForPath(relativePath) {
    const lower = String(relativePath || '').toLowerCase();
    if (/\.(c|cc|cpp|cxx|h|hh|hpp|hxx)$/.test(lower)) return 'cpp';
    if (/\.(ini|cfg|conf)$/.test(lower)) return 'ini';
    if (/\.json$/.test(lower)) return 'json';
    if (/\.md$/.test(lower)) return 'markdown';
    if (/\.ya?ml$/.test(lower)) return 'yaml';
    return 'plaintext';
}

function createTabModel(relativePath, content) {
    const monaco = state.monaco;
    const workspaceRoot = state.workspace?.workspace?.root || 'detached';
    const normalizedRoot = String(workspaceRoot).replace(/\\/g, '/');
    const normalizedRelativePath = String(relativePath || '').replace(/\\/g, '/');
    const joinedPath = `${normalizedRoot.replace(/\/$/, '')}/${normalizedRelativePath.replace(/^\//, '')}`;
    const uri = monaco.Uri.file(joinedPath);
    return monaco.editor.createModel(content, languageForPath(relativePath), uri);
}

function saveCurrentViewState() {
    const activeTab = getActiveTab();
    if (!activeTab || !state.editor) return;
    activeTab.viewState = state.editor.saveViewState();
}

function showEditorEmptyState(message) {
    const emptyState = document.getElementById('editor-empty-state');
    const editorHost = document.getElementById('editor-surface');
    if (message) {
        emptyState.innerHTML = `<strong>Monaco is ready.</strong><span>${message}</span>`;
        emptyState.classList.remove('hidden');
        editorHost.style.visibility = 'hidden';
    } else {
        emptyState.classList.add('hidden');
        editorHost.style.visibility = 'visible';
    }
}

function updateWorkspaceSummary() {
    const workspaceSummary = document.getElementById('workspace-summary');
    const workspaceRoot = document.getElementById('workspace-root');
    const filePanelTitle = document.getElementById('file-panel-title');
    const toggleAdvanced = document.getElementById('toggle-advanced');
    const envPill = document.getElementById('env-pill');
    const workspace = state.workspace;
    const root = workspace?.workspace?.root;
    const requestedRoot = workspace?.workspace?.requestedRoot;
    const validationError = workspace?.workspace?.validationError;
    const advancedMode = !!workspace?.workspace?.advancedMode;

    workspaceSummary.textContent = workspace?.summary || 'Attach an existing Core checkout to start editing in Monaco.';
    filePanelTitle.textContent = advancedMode ? 'Advanced Workspace Tree' : 'Focused Workspace';
    toggleAdvanced.textContent = advancedMode ? 'Advanced View On' : 'Advanced View Off';
    toggleAdvanced.disabled = !root || !!state.build?.activeJob;

    if (root) {
        workspaceRoot.textContent = root;
    } else if (requestedRoot && validationError) {
        workspaceRoot.textContent = `${requestedRoot} — ${validationError}`;
    } else {
        workspaceRoot.textContent = 'No workspace attached';
    }

    if (!root) {
        envPill.textContent = 'No environment selected';
    } else if (state.build?.selectedEnv) {
        envPill.textContent = `Env: ${state.build.selectedEnv}`;
    } else {
        envPill.textContent = 'No environment selected';
    }
}

function updateEditorStatus() {
    const chip = document.getElementById('file-status-chip');
    const editorTitle = document.getElementById('editor-title');
    const saveButton = document.getElementById('save-file');
    const activeTab = getActiveTab();
    const hasWorkspace = !!state.workspace?.workspace?.root;

    if (!hasWorkspace) {
        chip.textContent = 'No workspace attached';
        editorTitle.textContent = 'Workspace Surface';
        saveButton.disabled = true;
        showEditorEmptyState('Attach a workspace and open a file to start editing.');
        if (state.editor) state.editor.updateOptions({ readOnly: true });
        return;
    }

    if (!activeTab) {
        chip.textContent = 'No file open';
        editorTitle.textContent = 'Workspace Surface';
        saveButton.disabled = true;
        showEditorEmptyState('Choose a file from the workspace tree to open a Monaco tab.');
        if (state.editor) state.editor.updateOptions({ readOnly: true });
        return;
    }

    chip.textContent = activeTab.dirty ? `${activeTab.relativePath} · Unsaved` : activeTab.relativePath;
    editorTitle.textContent = activeTab.relativePath;
    saveButton.disabled = !activeTab.dirty;
    showEditorEmptyState('');
    if (state.editor) state.editor.updateOptions({ readOnly: false });
}

function renderBuildControls() {
    const envSelect = document.getElementById('env-select');
    const attachButton = document.getElementById('attach-workspace');
    const buildButton = document.getElementById('run-build');
    const cleanButton = document.getElementById('run-clean');
    const reindexButton = document.getElementById('run-reindex');
    const cancelButton = document.getElementById('cancel-build');
    const buildState = state.build;
    const running = !!buildState?.activeJob;
    const envs = Array.isArray(buildState?.envs) ? buildState.envs : [];
    const selectedEnv = buildState?.selectedEnv || '';

    envSelect.innerHTML = '';
    if (!envs.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No environment selected';
        envSelect.appendChild(option);
        envSelect.disabled = true;
    } else {
        envs.forEach((envName) => {
            const option = document.createElement('option');
            option.value = envName;
            option.textContent = envName;
            option.selected = envName === selectedEnv;
            envSelect.appendChild(option);
        });
        envSelect.disabled = !buildState?.supported || running;
    }

    attachButton.disabled = running;
    buildButton.disabled = !buildState?.actions?.build;
    cleanButton.disabled = !buildState?.actions?.clean;
    reindexButton.disabled = !buildState?.actions?.reindex;
    cancelButton.disabled = !buildState?.actions?.cancel;
}

function renderTabs() {
    const tabsRoot = document.getElementById('editor-tabs');
    tabsRoot.innerHTML = '';

    state.tabOrder.forEach((relativePath) => {
        const tab = getTab(relativePath);
        if (!tab) return;

        const wrapper = document.createElement('div');
        wrapper.className = `tab-item${relativePath === state.activeTabId ? ' active' : ''}${tab.dirty ? ' dirty' : ''}`;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tab-button';
        button.dataset.relativePath = relativePath;

        const name = document.createElement('span');
        name.className = 'tab-name';
        name.textContent = relativePath;
        button.appendChild(name);
        button.addEventListener('click', () => {
            activateTab(relativePath);
        });

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'tab-close';
        close.setAttribute('aria-label', `Close ${relativePath}`);
        close.textContent = '×';
        close.addEventListener('click', async (event) => {
            event.stopPropagation();
            await closeTab(relativePath);
        });

        wrapper.appendChild(button);
        wrapper.appendChild(close);
        tabsRoot.appendChild(wrapper);
    });
}

function renderFileEntries() {
    const list = document.getElementById('file-list');
    list.innerHTML = '';
    const entries = Array.isArray(state.fileEntries) ? state.fileEntries : [];

    if (!entries.length) {
        const item = document.createElement('li');
        item.innerHTML = '<span class="file-label"><span class="file-title">No files available</span><span class="file-detail">Attach a workspace to load focused files.</span></span>';
        list.appendChild(item);
        return;
    }

    entries.forEach((entry) => {
        const item = document.createElement('li');
        item.dataset.depth = String(Math.min(3, Number.isFinite(entry.depth) ? entry.depth : 0));

        const body = document.createElement(entry.type === 'file' ? 'button' : 'div');
        body.className = entry.type === 'file' ? 'file-button' : 'file-label';
        if (entry.type === 'file' && entry.relativePath === state.activeTabId) {
            body.classList.add('active');
        }

        const title = document.createElement('span');
        title.className = 'file-title';
        title.textContent = entry.displayPath || entry.relativePath;

        const detail = document.createElement('span');
        detail.className = 'file-detail';
        if (entry.type === 'directory') {
            detail.textContent = 'Directory';
        } else if (entry.missing) {
            detail.textContent = 'Missing from workspace';
        } else if (getTab(entry.relativePath)?.dirty) {
            detail.textContent = 'Open in Monaco · Unsaved changes';
        } else if (getTab(entry.relativePath)) {
            detail.textContent = 'Open in Monaco';
        } else {
            detail.textContent = 'Click to open';
        }

        body.append(title, detail);

        if (entry.type === 'file') {
            body.type = 'button';
            body.disabled = !!entry.missing;
            body.addEventListener('click', () => {
                openFile(entry.relativePath);
            });
        }

        item.appendChild(body);
        list.appendChild(item);
    });
}

function syncTabDirtyState(tab) {
    if (!tab || !tab.model) return;
    tab.dirty = tab.model.getValue() !== tab.originalContent;
    renderTabs();
    renderFileEntries();
    updateEditorStatus();
}

function clearTabs() {
    for (const tab of state.tabs.values()) {
        try {
            tab.changeDisposable?.dispose();
        } catch {}
        try {
            tab.model?.dispose();
        } catch {}
    }
    state.tabs.clear();
    state.tabOrder = [];
    state.activeTabId = null;
    renderTabs();
    renderFileEntries();
    updateEditorStatus();
}

function activateTab(relativePath) {
    const tab = getTab(relativePath);
    if (!tab || !state.editor) return;

    if (state.activeTabId === relativePath) return;

    saveCurrentViewState();
    state.activeTabId = relativePath;
    state.editor.setModel(tab.model);
    if (tab.viewState) {
        state.editor.restoreViewState(tab.viewState);
    } else {
        state.editor.setPosition({ lineNumber: 1, column: 1 });
        state.editor.revealPositionInCenter({ lineNumber: 1, column: 1 });
    }

    renderTabs();
    renderFileEntries();
    updateEditorStatus();
}

async function ensureEditor() {
    if (state.editor) return state.editor;
    const monaco = await loadMonaco();
    const container = document.getElementById('editor-surface');
    state.editor = monaco.editor.create(container, {
        value: '',
        language: 'plaintext',
        theme: 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: true },
        fontSize: 14,
        scrollBeyondLastLine: false,
        readOnly: true,
        roundedSelection: false,
        renderWhitespace: 'selection',
    });

    updateEditorStatus();
    return state.editor;
}

async function openFile(relativePath) {
    if (!relativePath) return;
    await ensureEditor();

    const existingTab = getTab(relativePath);
    if (existingTab) {
        activateTab(relativePath);
        appendConsoleLine(`[session-4] Switched to ${relativePath}.`);
        return;
    }

    const response = await window.api.firmwareWorkspace.readFile(relativePath);
    if (!response?.ok) {
        appendConsoleLine(`[session-4] Open failed: ${response?.error || 'Unknown error'}`);
        window.alert(response?.error || 'Could not open the selected file.');
        return;
    }

    if (response.state) state.workspace = response.state;
    const model = createTabModel(response.relativePath, response.content);
    const tab = {
        relativePath: response.relativePath,
        model,
        originalContent: response.content,
        dirty: false,
        viewState: null,
        changeDisposable: null,
    };

    tab.changeDisposable = model.onDidChangeContent(() => {
        syncTabDirtyState(tab);
    });

    state.tabs.set(tab.relativePath, tab);
    state.tabOrder.push(tab.relativePath);
    activateTab(tab.relativePath);
    updateWorkspaceSummary();
    appendConsoleLine(`[session-4] Opened ${tab.relativePath}.`);
}

async function closeTab(relativePath) {
    const tab = getTab(relativePath);
    if (!tab) return;
    if (tab.dirty) {
        const shouldClose = window.confirm(`Discard unsaved changes in ${relativePath}?`);
        if (!shouldClose) return;
    }

    if (relativePath === state.activeTabId) {
        saveCurrentViewState();
    }

    tab.changeDisposable?.dispose();
    tab.model?.dispose();
    state.tabs.delete(relativePath);
    state.tabOrder = state.tabOrder.filter((entry) => entry !== relativePath);

    if (state.activeTabId === relativePath) {
        const fallback = state.tabOrder[state.tabOrder.length - 1] || null;
        state.activeTabId = null;
        if (fallback) {
            activateTab(fallback);
        } else if (state.editor) {
            state.editor.setModel(null);
        }
    }

    renderTabs();
    renderFileEntries();
    updateEditorStatus();
}

async function refreshWorkspaceState() {
    const [workspaceState, toolchainState, buildState, filesResponse] = await Promise.all([
        window.api.firmwareWorkspace.getState(),
        window.api.firmwareToolchain.getStatus(),
        window.api.firmwareBuild.getState(),
        window.api.firmwareWorkspace.listFiles(),
    ]);

    state.workspace = workspaceState;
    state.toolchain = toolchainState;
    state.build = buildState;
    state.fileEntries = filesResponse?.ok ? filesResponse.files : [];

    setStatusChip('api-status', state.monacoReady ? 'Monaco ready' : 'Bridge connected');
    setStatusChip('toolchain-status', formatToolchainSummary(toolchainState));
    setStatusChip('build-status', formatBuildSummary(buildState));
    updateWorkspaceSummary();
    renderBuildControls();
    renderTabs();
    renderFileEntries();
    updateEditorStatus();
}

async function saveActiveFile() {
    const activeTab = getActiveTab();
    if (!activeTab) return;

    const response = await window.api.firmwareWorkspace.writeFile(activeTab.relativePath, activeTab.model.getValue());
    if (!response?.ok) {
        appendConsoleLine(`[session-4] Save failed: ${response?.error || 'Unknown error'}`);
        window.alert(response?.error || 'Could not save the selected file.');
        return;
    }

    activeTab.originalContent = activeTab.model.getValue();
    syncTabDirtyState(activeTab);
    if (response.state) state.workspace = response.state;
    updateWorkspaceSummary();
    appendConsoleLine(`[session-4] Saved ${activeTab.relativePath}.`);
}

async function attachWorkspace() {
    if (!confirmDiscardDirtyTabs('attaching another workspace')) return;

    const response = await window.api.firmwareWorkspace.attachExistingWorkspace();
    if (!response?.ok) {
        if (!response?.canceled) {
            appendConsoleLine(`[session-4] Attach failed: ${response?.error || 'Unknown error'}`);
            window.alert(response?.error || 'Could not attach the selected workspace.');
        }
        return;
    }

    clearTabs();
    await refreshWorkspaceState();
    appendConsoleLine(`[session-4] Attached ${response.state?.workspace?.root || 'workspace'}.`);

    const nextFile = pickInitialFileFromState();
    if (nextFile) {
        await openFile(nextFile);
    }
}

async function toggleAdvancedMode() {
    if (!state.workspace?.workspace?.root) return;
    const nextMode = !state.workspace.workspace.advancedMode;
    const response = await window.api.firmwareWorkspace.setAdvancedMode(nextMode);
    if (!response?.ok) {
        appendConsoleLine(`[session-4] Could not toggle advanced view: ${response?.error || 'Unknown error'}`);
        return;
    }
    if (response.state) state.workspace = response.state;
    await refreshWorkspaceState();
    appendConsoleLine(`[session-4] Advanced view ${nextMode ? 'enabled' : 'disabled'}.`);
}

async function selectEnvironment(envName) {
    const response = await window.api.firmwareBuild.selectEnv(envName);
    if (!response?.ok) {
        appendConsoleLine(`[session-4] Could not select env ${envName}: ${response?.error || 'Unknown error'}`);
        window.alert(response?.error || 'Could not change the PlatformIO environment.');
        renderBuildControls();
        return;
    }
    state.build = response.state || state.build;
    setStatusChip('build-status', formatBuildSummary(state.build));
    updateWorkspaceSummary();
    renderBuildControls();
    appendConsoleLine(`[session-4] Selected environment ${response.selectedEnv}.`);
}

async function runBuildAction(action) {
    if (!action) return;
    const response = await window.api.firmwareBuild[action]();
    if (!response?.ok) {
        appendConsoleLine(`[session-4] ${action} failed to start: ${response?.error || 'Unknown error'}`);
        window.alert(response?.error || `Could not start ${action}.`);
        return;
    }
    state.build = response.state || state.build;
    setStatusChip('build-status', formatBuildSummary(state.build));
    renderBuildControls();
}

async function cancelBuildAction() {
    const response = await window.api.firmwareBuild.cancel();
    if (!response?.ok && !response?.canceled) {
        appendConsoleLine(`[session-4] Cancel failed: ${response?.error || 'Unknown error'}`);
        window.alert(response?.error || 'Could not cancel the current PlatformIO job.');
        return;
    }
    state.build = response.state || state.build;
    setStatusChip('build-status', formatBuildSummary(state.build));
    renderBuildControls();
    appendConsoleLine('[session-4] Cancel requested.');
}

function installDiagnosticsRuntime() {
    window.__firmwareWorkspaceRuntime = {
        isMonacoReady: () => state.monacoReady,
        getOpenTabs: () => state.tabOrder.slice(),
        getActiveTab: () => state.activeTabId,
        getEditorValue: () => getActiveTab()?.model?.getValue() || '',
        getBuildState: () => state.build,
        setEditorValue: (value) => {
            if (!state.editor || !getActiveTab()) return false;
            state.editor.setValue(String(value));
            return true;
        },
        getDebugState: () => ({
            workspace: state.workspace,
            build: state.build,
            toolchain: state.toolchain,
            fileEntries: state.fileEntries.slice(),
            openTabs: state.tabOrder.slice(),
            activeTab: state.activeTabId,
            consoleLines: state.consoleLines.slice(),
        }),
    };
}

function bindEvents() {
    document.getElementById('attach-workspace').addEventListener('click', () => {
        attachWorkspace();
    });

    document.getElementById('toggle-advanced').addEventListener('click', () => {
        toggleAdvancedMode();
    });

    document.getElementById('save-file').addEventListener('click', () => {
        saveActiveFile();
    });

    document.getElementById('env-select').addEventListener('change', (event) => {
        const nextEnv = event.target.value;
        if (!nextEnv || nextEnv === state.build?.selectedEnv) return;
        selectEnvironment(nextEnv);
    });

    document.getElementById('run-build').addEventListener('click', () => {
        runBuildAction('build');
    });

    document.getElementById('run-clean').addEventListener('click', () => {
        runBuildAction('clean');
    });

    document.getElementById('run-reindex').addEventListener('click', () => {
        runBuildAction('reindex');
    });

    document.getElementById('cancel-build').addEventListener('click', () => {
        cancelBuildAction();
    });
}

async function bootFirmwareShell() {
    if (!window.api || !window.api.firmwareWorkspace || !window.api.firmwareToolchain || !window.api.firmwareBuild) {
        setStatusChip('api-status', 'Bridge unavailable');
        document.getElementById('workspace-summary').textContent = 'Firmware preload API is missing.';
        return;
    }

    installDiagnosticsRuntime();
    bindEvents();
    appendConsoleLine('[session-4] Firmware Workspace shell booted.');

    try {
        await ensureEditor();
        setStatusChip('api-status', 'Monaco ready');
        await refreshWorkspaceState();
        const startupFile = pickInitialFileFromState();
        if (startupFile) {
            await openFile(startupFile);
        }
    } catch (error) {
        setStatusChip('api-status', 'Bridge error');
        document.getElementById('workspace-summary').textContent = 'Could not load Monaco for the firmware workspace.';
        appendConsoleLine(`[session-4] Boot failed: ${error?.message || error}`);
    }

    window.api.firmwareWorkspace.onStateChange((nextState) => {
        state.workspace = nextState;
        updateWorkspaceSummary();
    });
    window.api.firmwareToolchain.onStatusChange((nextState) => {
        state.toolchain = nextState;
        setStatusChip('toolchain-status', formatToolchainSummary(nextState));
    });
    window.api.firmwareBuild.onOutput((payload = {}) => {
        appendConsoleLine(payload.text || '');
    });
    window.api.firmwareBuild.onStateChange((nextState) => {
        state.build = nextState;
        setStatusChip('build-status', formatBuildSummary(nextState));
        updateWorkspaceSummary();
        renderBuildControls();
    });
}

window.addEventListener('DOMContentLoaded', () => {
    bootFirmwareShell();
});
