const state = {
    workspace: null,
    build: null,
    toolchain: null,
    language: null,
    fileEntries: [],
    tabs: new Map(),
    tabOrder: [],
    activeTabId: null,
    editor: null,
    monaco: null,
    monacoReady: false,
    monacoLoadingPromise: null,
    consoleLines: [],
    languageProviderDisposables: [],
    languageSyncTimers: new Map(),
};

const DIAGNOSTICS_OWNER = 'firmware-clangd';

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
    const consoleOutput = document.getElementById('console-output');
    consoleOutput.textContent = state.consoleLines.join('\n');
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

function setStatusChip(id, message) {
    const element = document.getElementById(id);
    if (element) element.textContent = message;
}

function formatToolchainSummary(toolchainState) {
    if (!toolchainState || typeof toolchainState !== 'object') {
        return 'Toolchain status unavailable';
    }
    const platformio = toolchainState.platformio || {};
    const clangd = toolchainState.clangd || {};
    const clangdReady = clangd.usingManagedRuntime || clangd.status === 'installed' || clangd.status === 'available';
    if (platformio.status === 'installing') {
        return 'Installing managed toolchains…';
    }
    if ((platformio.usingManagedRuntime || platformio.status === 'installed') && clangdReady) {
        return `Toolchains ready · ${platformio.version || 'PlatformIO'} + ${clangd.version || 'clangd'}`;
    }
    if (platformio.status === 'available') {
        return `Using local PlatformIO · ${platformio.version || 'PlatformIO available'}`;
    }
    if (platformio.managedStatus === 'error') {
        return `Managed PlatformIO error · ${platformio.error || 'Retry the managed toolchain install.'}`;
    }
    return `PlatformIO missing · ${platformio.error || 'Install the managed toolchain or configure a local CLI.'}`;
}

function formatInstallButtonLabel(toolchainState) {
    const platformio = toolchainState?.platformio || {};
    const clangd = toolchainState?.clangd || {};
    if (platformio.status === 'installing') {
        return 'Installing Toolchains…';
    }
    if ((platformio.usingManagedRuntime || platformio.status === 'installed')
        && (clangd.usingManagedRuntime || clangd.status === 'installed')) {
        return 'Managed Toolchains Ready';
    }
    if (platformio.status === 'available') {
        return 'Install Missing Toolchains';
    }
    if (platformio.managedStatus === 'error') {
        return 'Retry Install Toolchain';
    }
    return 'Install Toolchain';
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

function formatClangdSummary(languageState) {
    if (!languageState || typeof languageState !== 'object') {
        return 'clangd status unavailable';
    }
    if (languageState.status === 'ready') {
        return `clangd ready · ${languageState.activeEnv || 'no env'}`;
    }
    if (languageState.status === 'installing') {
        return 'Installing managed clangd…';
    }
    if (languageState.status === 'missing-compiledb') {
        return languageState.message || 'Reindex to generate compile_commands.json';
    }
    if (languageState.status === 'missing-clangd') {
        return `clangd missing · ${languageState.clangd?.error || 'Install the managed toolchain.'}`;
    }
    return languageState.message || 'clangd pending';
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
    const installButton = document.getElementById('install-toolchain');
    const buildButton = document.getElementById('run-build');
    const uploadButton = document.getElementById('run-upload');
    const cleanButton = document.getElementById('run-clean');
    const reindexButton = document.getElementById('run-reindex');
    const cancelButton = document.getElementById('cancel-build');
    const buildState = state.build;
    const toolchainState = state.toolchain;
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
    installButton.textContent = formatInstallButtonLabel(toolchainState);
    installButton.disabled = !buildState?.actions?.installToolchain;
    buildButton.disabled = !buildState?.actions?.build;
    uploadButton.disabled = !buildState?.actions?.upload;
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

function findTabByModel(model) {
    for (const tab of state.tabs.values()) {
        if (tab.model === model) return tab;
    }
    return null;
}

function clearTabLanguageSync(relativePath) {
    const timer = state.languageSyncTimers.get(relativePath);
    if (!timer) return;
    window.clearTimeout(timer);
    state.languageSyncTimers.delete(relativePath);
}

function clearAllLanguageSyncTimers() {
    for (const relativePath of state.languageSyncTimers.keys()) {
        clearTabLanguageSync(relativePath);
    }
}

function clearModelDiagnostics(model) {
    if (!state.monaco || !model) return;
    state.monaco.editor.setModelMarkers(model, DIAGNOSTICS_OWNER, []);
}

function clearAllDiagnostics() {
    if (!state.monaco) return;
    for (const tab of state.tabs.values()) {
        clearModelDiagnostics(tab.model);
    }
}

function toMonacoRange(range) {
    if (!range?.start || !range?.end || !state.monaco) return null;
    return new state.monaco.Range(
        Number(range.start.line || 0) + 1,
        Number(range.start.character || 0) + 1,
        Number(range.end.line || 0) + 1,
        Number(range.end.character || 0) + 1,
    );
}

function toMonacoPosition(position) {
    return {
        line: Math.max(0, Number(position?.lineNumber || 1) - 1),
        character: Math.max(0, Number(position?.column || 1) - 1),
    };
}

function normalizeMarkupContent(content) {
    if (!content) return [];
    const values = Array.isArray(content) ? content : [content];
    return values
        .map((entry) => {
            if (!entry) return null;
            if (typeof entry === 'string') {
                return { value: entry };
            }
            if (typeof entry === 'object' && typeof entry.value === 'string') {
                return { value: entry.value };
            }
            if (typeof entry === 'object' && typeof entry.language === 'string' && typeof entry.value === 'string') {
                return { value: `\`\`\`${entry.language}\n${entry.value}\n\`\`\`` };
            }
            return null;
        })
        .filter(Boolean);
}

function lspSeverityToMarkerSeverity(severity) {
    if (!state.monaco) return 1;
    const markerSeverity = state.monaco.MarkerSeverity;
    if (severity === 1) return markerSeverity.Error;
    if (severity === 2) return markerSeverity.Warning;
    if (severity === 3) return markerSeverity.Info;
    return markerSeverity.Hint;
}

function lspCompletionKindToMonaco(kind) {
    const completionKinds = state.monaco?.languages?.CompletionItemKind;
    if (!completionKinds) return 18;
    const fallback = completionKinds.Text;
    const mapping = {
        1: completionKinds.Text,
        2: completionKinds.Method,
        3: completionKinds.Function,
        4: completionKinds.Constructor,
        5: completionKinds.Field,
        6: completionKinds.Variable,
        7: completionKinds.Class,
        8: completionKinds.Interface,
        9: completionKinds.Module,
        10: completionKinds.Property,
        11: completionKinds.Unit,
        12: completionKinds.Value,
        13: completionKinds.Enum,
        14: completionKinds.Keyword,
        15: completionKinds.Snippet,
        16: completionKinds.Color,
        17: completionKinds.File,
        18: completionKinds.Reference,
        19: completionKinds.Folder,
        20: completionKinds.EnumMember,
        21: completionKinds.Constant,
        22: completionKinds.Struct,
        23: completionKinds.Event,
        24: completionKinds.Operator,
        25: completionKinds.TypeParameter,
    };
    return mapping[kind] || fallback;
}

function toMonacoCompletionItem(item, defaultRange) {
    if (!item || !state.monaco) return null;
    const label = typeof item.label === 'string' ? item.label : (item.label?.label || '');
    if (!label) return null;
    const completionItem = {
        label,
        kind: lspCompletionKindToMonaco(item.kind),
        detail: item.detail || '',
        documentation: normalizeMarkupContent(item.documentation)[0] || undefined,
        sortText: item.sortText || label,
        filterText: item.filterText || label,
        insertText: item.insertText || label,
        range: defaultRange,
    };
    if (item.textEdit?.newText) {
        completionItem.insertText = item.textEdit.newText;
        completionItem.range = toMonacoRange(item.textEdit.range) || defaultRange;
    }
    return completionItem;
}

function applyLanguageDiagnostics(payload = {}) {
    if (!state.monaco) return;
    if (!payload.relativePath) {
        clearAllDiagnostics();
        return;
    }
    const tab = getTab(payload.relativePath);
    if (!tab?.model) return;
    const diagnostics = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
    state.monaco.editor.setModelMarkers(tab.model, DIAGNOSTICS_OWNER, diagnostics.map((entry) => ({
        severity: lspSeverityToMarkerSeverity(entry.severity),
        message: entry.message || 'clangd diagnostic',
        startLineNumber: Number(entry.range?.start?.line || 0) + 1,
        startColumn: Number(entry.range?.start?.character || 0) + 1,
        endLineNumber: Number(entry.range?.end?.line || 0) + 1,
        endColumn: Number(entry.range?.end?.character || 0) + 1,
        source: entry.source || 'clangd',
        code: typeof entry.code === 'string' || typeof entry.code === 'number' ? String(entry.code) : undefined,
    })));
}

async function requestLanguageCompletion(model, position) {
    const tab = findTabByModel(model);
    if (!tab || !window.api?.firmwareLanguage) return { suggestions: [] };
    const word = model.getWordUntilPosition(position);
    const defaultRange = new state.monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
    const response = await window.api.firmwareLanguage.provideCompletion({
        relativePath: tab.relativePath,
        content: model.getValue(),
        position: toMonacoPosition(position),
    });
    if (response?.state) {
        state.language = response.state;
        setStatusChip('clangd-status', formatClangdSummary(state.language));
    }
    if (!response?.ok) return { suggestions: [] };
    const items = Array.isArray(response.items) ? response.items : [];
    return {
        suggestions: items
            .map((item) => toMonacoCompletionItem(item, defaultRange))
            .filter(Boolean),
        incomplete: !!response.incomplete,
    };
}

async function requestLanguageHover(model, position) {
    const tab = findTabByModel(model);
    if (!tab || !window.api?.firmwareLanguage) return null;
    const response = await window.api.firmwareLanguage.provideHover({
        relativePath: tab.relativePath,
        content: model.getValue(),
        position: toMonacoPosition(position),
    });
    if (response?.state) {
        state.language = response.state;
        setStatusChip('clangd-status', formatClangdSummary(state.language));
    }
    if (!response?.ok || !response.hover) return null;
    const contents = normalizeMarkupContent(response.hover.contents);
    if (!contents.length) return null;
    return {
        range: toMonacoRange(response.hover.range) || undefined,
        contents,
    };
}

async function requestLanguageDefinition(model, position) {
    const tab = findTabByModel(model);
    if (!tab || !window.api?.firmwareLanguage) return null;
    const response = await window.api.firmwareLanguage.provideDefinition({
        relativePath: tab.relativePath,
        content: model.getValue(),
        position: toMonacoPosition(position),
    });
    if (response?.state) {
        state.language = response.state;
        setStatusChip('clangd-status', formatClangdSummary(state.language));
    }
    if (!response?.ok || !response.definition) return null;
    const definitions = Array.isArray(response.definition) ? response.definition : [response.definition];
    return definitions
        .map((location) => {
            if (!location?.uri || !location?.range) return null;
            return {
                uri: state.monaco.Uri.parse(location.uri),
                range: toMonacoRange(location.range),
            };
        })
        .filter(Boolean);
}

function registerLanguageProviders(monaco) {
    if (state.languageProviderDisposables.length) return;
    state.languageProviderDisposables.push(
        monaco.languages.registerCompletionItemProvider('cpp', {
            triggerCharacters: ['.', ':', '>'],
            provideCompletionItems: async (model, position) => requestLanguageCompletion(model, position),
        }),
        monaco.languages.registerHoverProvider('cpp', {
            provideHover: async (model, position) => requestLanguageHover(model, position),
        }),
        monaco.languages.registerDefinitionProvider('cpp', {
            provideDefinition: async (model, position) => requestLanguageDefinition(model, position),
        }),
    );
}

function scheduleLanguageSync(tab, delayMs = 140) {
    if (!tab?.model || !window.api?.firmwareLanguage) return;
    if (languageForPath(tab.relativePath) !== 'cpp') {
        clearModelDiagnostics(tab.model);
        return;
    }
    clearTabLanguageSync(tab.relativePath);
    const timer = window.setTimeout(async () => {
        state.languageSyncTimers.delete(tab.relativePath);
        const response = await window.api.firmwareLanguage.syncDocument(tab.relativePath, tab.model.getValue());
        if (response?.state) {
            state.language = response.state;
            setStatusChip('clangd-status', formatClangdSummary(state.language));
        }
    }, delayMs);
    state.languageSyncTimers.set(tab.relativePath, timer);
}

function syncTabDirtyState(tab) {
    if (!tab || !tab.model) return;
    tab.dirty = tab.model.getValue() !== tab.originalContent;
    renderTabs();
    renderFileEntries();
    updateEditorStatus();
}

function clearTabs() {
    clearAllLanguageSyncTimers();
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
    registerLanguageProviders(monaco);
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
        appendConsoleLine(`[session-7] Switched to ${relativePath}.`);
        return;
    }

    const response = await window.api.firmwareWorkspace.readFile(relativePath);
    if (!response?.ok) {
        appendConsoleLine(`[session-7] Open failed: ${response?.error || 'Unknown error'}`);
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
        scheduleLanguageSync(tab);
    });

    state.tabs.set(tab.relativePath, tab);
    state.tabOrder.push(tab.relativePath);
    activateTab(tab.relativePath);
    updateWorkspaceSummary();
    scheduleLanguageSync(tab, 0);
    appendConsoleLine(`[session-7] Opened ${tab.relativePath}.`);
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

    clearTabLanguageSync(relativePath);
    clearModelDiagnostics(tab.model);
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
    const [workspaceState, toolchainState, buildState, languageState, filesResponse] = await Promise.all([
        window.api.firmwareWorkspace.getState(),
        window.api.firmwareToolchain.getStatus(),
        window.api.firmwareBuild.getState(),
        window.api.firmwareLanguage.getState(),
        window.api.firmwareWorkspace.listFiles(),
    ]);

    state.workspace = workspaceState;
    state.toolchain = toolchainState;
    state.build = buildState;
    state.language = languageState;
    state.fileEntries = filesResponse?.ok ? filesResponse.files : [];

    setStatusChip('api-status', state.monacoReady ? 'Monaco ready' : 'Bridge connected');
    setStatusChip('toolchain-status', formatToolchainSummary(toolchainState));
    setStatusChip('build-status', formatBuildSummary(buildState));
    setStatusChip('clangd-status', formatClangdSummary(languageState));
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
        appendConsoleLine(`[session-7] Save failed: ${response?.error || 'Unknown error'}`);
        window.alert(response?.error || 'Could not save the selected file.');
        return;
    }

    activeTab.originalContent = activeTab.model.getValue();
    syncTabDirtyState(activeTab);
    scheduleLanguageSync(activeTab, 0);
    if (response.state) state.workspace = response.state;
    updateWorkspaceSummary();
    appendConsoleLine(`[session-7] Saved ${activeTab.relativePath}.`);
}

async function attachWorkspace() {
    if (!confirmDiscardDirtyTabs('attaching another workspace')) return;

    const response = await window.api.firmwareWorkspace.attachExistingWorkspace();
    if (!response?.ok) {
        if (!response?.canceled) {
            appendConsoleLine(`[session-7] Attach failed: ${response?.error || 'Unknown error'}`);
            window.alert(response?.error || 'Could not attach the selected workspace.');
        }
        return;
    }

    clearTabs();
    clearAllDiagnostics();
    await refreshWorkspaceState();
    appendConsoleLine(`[session-7] Attached ${response.state?.workspace?.root || 'workspace'}.`);

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
        appendConsoleLine(`[session-7] Could not toggle advanced view: ${response?.error || 'Unknown error'}`);
        return;
    }
    if (response.state) state.workspace = response.state;
    await refreshWorkspaceState();
    appendConsoleLine(`[session-7] Advanced view ${nextMode ? 'enabled' : 'disabled'}.`);
}

async function selectEnvironment(envName) {
    const response = await window.api.firmwareBuild.selectEnv(envName);
    if (!response?.ok) {
        appendConsoleLine(`[session-7] Could not select env ${envName}: ${response?.error || 'Unknown error'}`);
        window.alert(response?.error || 'Could not change the PlatformIO environment.');
        renderBuildControls();
        return;
    }
    state.build = response.state || state.build;
    setStatusChip('build-status', formatBuildSummary(state.build));
    updateWorkspaceSummary();
    renderBuildControls();
    appendConsoleLine(`[session-7] Selected environment ${response.selectedEnv}.`);
}

async function runBuildAction(action) {
    if (!action) return;
    const response = await window.api.firmwareBuild[action]();
    if (!response?.ok) {
        appendConsoleLine(`[session-7] ${action} failed to start: ${response?.error || 'Unknown error'}`);
        window.alert(response?.error || `Could not start ${action}.`);
        return;
    }
    state.build = response.state || state.build;
    setStatusChip('build-status', formatBuildSummary(state.build));
    renderBuildControls();
}

async function installToolchain() {
    const response = await window.api.firmwareToolchain.install();
    if (response?.state) {
        state.toolchain = response.state;
        setStatusChip('toolchain-status', formatToolchainSummary(state.toolchain));
    }
    await refreshWorkspaceState();
    if (!response?.ok) {
        appendConsoleLine(`[session-7] Install toolchain failed: ${response?.error || 'Unknown error'}`);
        window.alert(response?.error || 'Could not install the managed firmware toolchains.');
        return;
    }
    appendConsoleLine('[session-7] Managed toolchain install flow completed.');
}

async function cancelBuildAction() {
    const response = await window.api.firmwareBuild.cancel();
    if (!response?.ok && !response?.canceled) {
        appendConsoleLine(`[session-7] Cancel failed: ${response?.error || 'Unknown error'}`);
        window.alert(response?.error || 'Could not cancel the current PlatformIO job.');
        return;
    }
    state.build = response.state || state.build;
    setStatusChip('build-status', formatBuildSummary(state.build));
    renderBuildControls();
    appendConsoleLine('[session-7] Cancel requested.');
}

function installDiagnosticsRuntime() {
    window.__firmwareWorkspaceRuntime = {
        isMonacoReady: () => state.monacoReady,
        getOpenTabs: () => state.tabOrder.slice(),
        getActiveTab: () => state.activeTabId,
        getEditorValue: () => getActiveTab()?.model?.getValue() || '',
        getBuildState: () => state.build,
        getLanguageState: () => state.language,
        getMarkers: () => {
            const activeTab = getActiveTab();
            if (!state.monaco || !activeTab?.model) return [];
            return state.monaco.editor.getModelMarkers({ owner: DIAGNOSTICS_OWNER, resource: activeTab.model.uri }).map((entry) => ({
                message: entry.message,
                startLineNumber: entry.startLineNumber,
                startColumn: entry.startColumn,
                endLineNumber: entry.endLineNumber,
                endColumn: entry.endColumn,
                severity: entry.severity,
                source: entry.source,
            }));
        },
        requestCompletionAt: async (lineNumber, column) => {
            const activeTab = getActiveTab();
            if (!activeTab?.model) return { ok: false, labels: [] };
            const response = await requestLanguageCompletion(activeTab.model, { lineNumber, column });
            return {
                ok: true,
                labels: (response.suggestions || []).map((entry) => String(entry.label || '')),
            };
        },
        requestHoverAt: async (lineNumber, column) => {
            const activeTab = getActiveTab();
            if (!activeTab?.model) return { ok: false, contents: [] };
            const response = await requestLanguageHover(activeTab.model, { lineNumber, column });
            return {
                ok: !!response,
                contents: Array.isArray(response?.contents) ? response.contents.map((entry) => entry.value || '') : [],
            };
        },
        setEditorValue: (value) => {
            if (!state.editor || !getActiveTab()) return false;
            state.editor.setValue(String(value));
            return true;
        },
        getDebugState: () => ({
            workspace: state.workspace,
            build: state.build,
            toolchain: state.toolchain,
            language: state.language,
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

    document.getElementById('install-toolchain').addEventListener('click', () => {
        installToolchain();
    });

    document.getElementById('env-select').addEventListener('change', (event) => {
        const nextEnv = event.target.value;
        if (!nextEnv || nextEnv === state.build?.selectedEnv) return;
        selectEnvironment(nextEnv);
    });

    document.getElementById('run-build').addEventListener('click', () => {
        runBuildAction('build');
    });

    document.getElementById('run-upload').addEventListener('click', () => {
        runBuildAction('upload');
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
    if (!window.api || !window.api.firmwareWorkspace || !window.api.firmwareToolchain || !window.api.firmwareBuild || !window.api.firmwareLanguage) {
        setStatusChip('api-status', 'Bridge unavailable');
        document.getElementById('workspace-summary').textContent = 'Firmware preload API is missing.';
        return;
    }

    installDiagnosticsRuntime();
    bindEvents();
    appendConsoleLine('[session-7] Firmware Workspace shell booted.');

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
        appendConsoleLine(`[session-7] Boot failed: ${error?.message || error}`);
    }

    window.api.firmwareWorkspace.onStateChange((nextState) => {
        state.workspace = nextState;
        updateWorkspaceSummary();
    });
    window.api.firmwareToolchain.onStatusChange((nextState) => {
        state.toolchain = nextState;
        setStatusChip('toolchain-status', formatToolchainSummary(nextState));
        renderBuildControls();
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
    window.api.firmwareLanguage.onStateChange((nextState) => {
        state.language = nextState;
        setStatusChip('clangd-status', formatClangdSummary(nextState));
        if (nextState?.status !== 'ready') {
            clearAllDiagnostics();
        }
    });
    window.api.firmwareLanguage.onDiagnostics((payload = {}) => {
        applyLanguageDiagnostics(payload);
    });
}

window.addEventListener('DOMContentLoaded', () => {
    bootFirmwareShell();
});
