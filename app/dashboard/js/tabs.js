// Tabs controller for in-app documentation and example actions.
(function () {
    const api = window.api || null;
    const paths = api && api.paths ? api.paths : null;
    const docsApi = api && api.docs ? api.docs : null;
    const filesApi = api && api.files ? api.files : null;
    const systemApi = api && api.system ? api.system : null;
    const dashboardApi = api && api.dashboard ? api.dashboard : null;
    const serialApi = api && api.serial ? api.serial : null;
    const flashApi = api && api.flash ? api.flash : null;
    const examplesApi = api && api.examples ? api.examples : null;
    const widgetsApi = api && api.widgets ? api.widgets : null;
    const extensionsApi = api && api.extensions ? api.extensions : null;

    const { ipcRenderer, shell } = !api && window.require ? window.require('electron') : { ipcRenderer: null, shell: null };
    const fs = !api && window.require ? window.require('fs') : null;
    const path = !api && window.require ? window.require('path') : null;
    const { pathToFileURL } = !api && window.require ? window.require('url') : { pathToFileURL: null };
    const localDir = (typeof __dirname !== 'undefined') ? __dirname : null;
    let extensionBootstrapPromise = null;

    function getExampleExtensionRoot() {
        if (paths && paths.appDir && paths.join) return paths.join(paths.appDir(), 'extensions', 'owntech-examples', 'dashboard');
        if (paths && paths.cwd && paths.join) return paths.join(paths.cwd(), 'app', 'extensions', 'owntech-examples', 'dashboard');
        if (localDir && path) return path.join(localDir, '..', '..', 'extensions', 'owntech-examples', 'dashboard');
        return null;
    }

    async function getExtensionBootstrap() {
        if (extensionBootstrapPromise) return extensionBootstrapPromise;
        if (!extensionsApi || typeof extensionsApi.getBootstrap !== 'function') return null;
        extensionBootstrapPromise = extensionsApi.getBootstrap().catch((err) => {
            console.warn('[tabs] extension bootstrap failed:', err?.message || err);
            return null;
        });
        return extensionBootstrapPromise;
    }

    async function getExampleSourceRoots() {
        const bootstrap = await getExtensionBootstrap();
        if (bootstrap && Array.isArray(bootstrap.exampleRoots) && bootstrap.exampleRoots.length) {
            return bootstrap.exampleRoots;
        }
        const dashboardRoot = getExampleExtensionRoot();
        const docsRoot = dashboardRoot
            ? (paths && paths.join ? paths.join(dashboardRoot, 'docs', 'examples') : path.join(dashboardRoot, 'docs', 'examples'))
            : '';
        const dashboardPathRoot = dashboardRoot
            ? (paths && paths.join ? paths.join(dashboardRoot, 'dashboards') : path.join(dashboardRoot, 'dashboards'))
            : '';
        const firmwarePathRoot = dashboardRoot
            ? (paths && paths.join ? paths.join(dashboardRoot, 'binaries') : path.join(dashboardRoot, 'binaries'))
            : '';
        return [{ path: docsRoot, dashboardRoot: dashboardPathRoot, firmwareRoot: firmwarePathRoot }];
    }

    function normalizeDocRequest(payload) {
        if (!payload || typeof payload !== 'object') return null;
        const kind = String(payload.kind || '').trim().toLowerCase();
        const id = String(payload.id || '').trim();
        if (!kind || !id) return null;
        if (!['example', 'courseware'].includes(kind)) return null;
        return { kind, id };
    }

    function tabIdForDoc(kind, id) {
        return kind === 'example' ? `doc:${id}` : `doc:${kind}:${id}`;
    }

    function humanizeSegment(segment) {
        return String(segment || '')
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\b\w/g, (match) => match.toUpperCase());
    }

    function docKindLabel(kind) {
        return kind === 'courseware' ? 'Courseware' : 'Example';
    }

    function getDocMap(kind) {
        return kind === 'courseware' ? coursewareById : examplesById;
    }

    function getDocItem(kind, id) {
        return getDocMap(kind).get(id) || null;
    }

    if (!api && (!ipcRenderer || !fs || !path)) {
        console.warn('Tabs: missing Electron/Node context; docs tabs disabled.');
        return;
    }
    console.log('[tabs] init: renderer ready');

    const tabStrip = document.getElementById('tab-strip');
    const docPanel = document.getElementById('doc-panel');
    const boardContent = document.getElementById('board-content');
    const mainHeader = document.getElementById('main-header');

    const docTitle = document.getElementById('doc-title');
    const docSubtitle = document.getElementById('doc-subtitle');
    const docContent = document.getElementById('doc-content');
    const exampleSelect = document.getElementById('doc-example-select');
    const docPickerLabel = document.querySelector('.doc-picker label');
    const loadDashboardBtn = document.getElementById('doc-load-dashboard-btn');
    const uploadFirmwareBtn = document.getElementById('doc-upload-firmware-btn');
    const refreshPortsBtn = document.getElementById('doc-refresh-ports-btn');
    const portSelect = document.getElementById('doc-port-select');
    const statusBar = document.getElementById('doc-status');
    const docPicker = document.querySelector('.doc-picker');
    const docActions = document.querySelector('.doc-actions');
    const docPortRow = document.querySelector('.doc-port-row');
    const progressPanel = document.querySelector('.progress-panel');

    const progressBar = document.getElementById('doc-upload-progress-bar');
    const progressSpinner = document.getElementById('doc-upload-spinner');
    const progressState = document.getElementById('doc-upload-state');
    const progressLabel = document.getElementById('doc-upload-label');

    const dashboardTabId = 'dashboard';
    const tabs = new Map(); // id -> { id, type, exampleId|coursewareId, button }
    const examplesById = new Map();
    const coursewareById = new Map();
    const widgetDocsByType = new Map();
    let activeTabId = dashboardTabId;
    let currentDashboardPath = null;
    let dashboardTabCounter = 0;
    let pendingOpenId = null;
    let pendingDocRequest = null;
    let pendingWidgetType = null;
    let isUploading = false;
    let uploadCanceled = false;
    let uploadFailed = false;
    let progressPeak = 0;
    let headerObserver = null;
    let lastHeaderSnapshot = null;
    let lastHeaderState = null;
    // Preserve allow_edit so the dashboard header can be restored after docs tabs.
    let lastAllowEdit = null;
    // Toggle a body class to hide dashboard UI without leaving inline styles behind.
    const docsModeClass = 'docs-mode';
    const dashboardModeClass = 'dashboard-mode';
    // Dock preview state for popping an example window back into the tab strip.
    let dockPreviewTab = null;
    let dockPreviewRequest = null;

    function setStatus(message) {
        statusBar.textContent = message || '';
    }

    function setProgress(percent, allowDecrease = false) {
        const clamped = Math.max(0, Math.min(100, percent));
        if (!allowDecrease && clamped < progressPeak) return;
        progressPeak = clamped;
        progressBar.style.width = `${clamped}%`;
        progressBar.setAttribute('aria-valuenow', String(clamped));
        progressBar.textContent = `${clamped}%`;
    }

    function extractProgressPercent(text) {
        const matches = String(text || '').match(/(\d{1,3}(?:\.\d+)?)%/g);
        if (!matches || !matches.length) return null;
        let max = null;
        for (const token of matches) {
            const n = parseFloat(String(token).replace('%', ''));
            if (!Number.isFinite(n)) continue;
            if (max === null || n > max) max = n;
        }
        return max;
    }

    function resetProgress() {
        progressBar.classList.remove('bg-success', 'bg-danger');
        progressPeak = 0;
        setProgress(0, true);
        progressState.textContent = 'idle';
        progressLabel.textContent = 'No upload running';
        if (progressSpinner) progressSpinner.classList.add('d-none');
        uploadFailed = false;
    }

    function setFailure(message) {
        uploadFailed = true;
        progressBar.classList.remove('bg-success');
        progressBar.classList.add('bg-danger');
        progressState.textContent = 'failed';
        progressLabel.textContent = message || 'Upload failed';
        if (progressSpinner) progressSpinner.classList.add('d-none');
    }

    function setSuccess() {
        progressBar.classList.remove('bg-danger');
        progressBar.classList.add('bg-success');
        progressState.textContent = 'done';
        progressLabel.textContent = 'Upload complete';
        if (progressSpinner) progressSpinner.classList.add('d-none');
        setProgress(100);
    }

    function getActiveDocTab() {
        const tab = tabs.get(activeTabId);
        return tab && tab.type === 'doc' ? tab : null;
    }

    function updateUploadButton() {
        if (!uploadFirmwareBtn) return;
        uploadFirmwareBtn.disabled = false;
        if (isUploading) {
            uploadFirmwareBtn.textContent = 'Cancel upload';
            return;
        }
        const tab = getActiveDocTab();
        const kind = tab && tab.kind ? tab.kind : 'example';
        uploadFirmwareBtn.textContent = `Upload ${docKindLabel(kind).toLowerCase()} to target`;
    }

    async function cancelUpload() {
        if (!isUploading) return;
        uploadCanceled = true;
        uploadFailed = false;
        progressState.textContent = 'canceling';
        progressLabel.textContent = 'Canceling upload...';
        if (progressSpinner) progressSpinner.classList.remove('d-none');
        setStatus('Canceling upload...');
        try {
            if (flashApi && flashApi.cancelFlash) {
                await flashApi.cancelFlash();
            } else if (ipcRenderer) {
                ipcRenderer.send('cancel-flash');
            }
        } catch (err) {
            setFailure(`Cancel failed: ${err?.message || String(err)}`);
            setStatus('Cancel failed.');
            isUploading = false;
            updateUploadButton();
        }
    }

    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatPortLabel(port) {
        if (!port) return '';
        return String(port.name || port.value || '');
    }

    function resolveAssetUrl(rawUrl, baseDir) {
        if (!rawUrl) return rawUrl;
        if (/^(https?:|data:|file:|#)/i.test(rawUrl)) return rawUrl;
        if (paths && paths.isAbsolute && paths.toFileUrl && paths.resolve) {
            if (paths.isAbsolute(rawUrl)) return paths.toFileUrl(rawUrl);
            return paths.toFileUrl(paths.resolve(baseDir, rawUrl));
        }
        if (path && pathToFileURL) {
            if (path.isAbsolute(rawUrl)) return pathToFileURL(rawUrl).toString();
            return pathToFileURL(path.resolve(baseDir, rawUrl)).toString();
        }
        return rawUrl;
    }

    function normalizeRenderedMarkdown(html, baseDir) {
        if (typeof document === 'undefined') return html;
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;

        wrapper.querySelectorAll('img[src]').forEach((img) => {
            const src = img.getAttribute('src');
            img.setAttribute('src', resolveAssetUrl(src, baseDir));
        });

        wrapper.querySelectorAll('a[href]').forEach((anchor) => {
            const href = anchor.getAttribute('href');
            anchor.setAttribute('href', resolveAssetUrl(href, baseDir));
        });

        wrapper.querySelectorAll('table').forEach((table) => {
            table.classList.add('markdown-table');
        });

        return wrapper.innerHTML;
    }

    async function typesetMath(element) {
        if (!element || !window.MathJax) return;
        try {
            if (typeof window.MathJax.typesetClear === 'function') {
                window.MathJax.typesetClear([element]);
            }
            if (typeof window.MathJax.typesetPromise === 'function') {
                await window.MathJax.typesetPromise([element]);
                return;
            }
            if (typeof window.MathJax.typeset === 'function') {
                window.MathJax.typeset([element]);
            }
        } catch (err) {
            console.warn('[tabs] math typeset failed:', err?.message || err);
        }
    }

    async function openExternalUrl(url) {
        if (!url || !/^https?:\/\//i.test(String(url))) return false;
        try {
            if (systemApi && systemApi.openExternal) {
                const result = await systemApi.openExternal(String(url));
                return result ? result.ok !== false : true;
            }
            if (shell && shell.openExternal) {
                await shell.openExternal(String(url));
                return true;
            }
        } catch (err) {
            console.warn('[tabs] openExternal failed:', err?.message || err);
        }
        return false;
    }

    function installDocLinkHandling(container) {
        if (!container || container.dataset.externalLinkHandlingInstalled === 'true') return;
        container.dataset.externalLinkHandlingInstalled = 'true';
        container.addEventListener('click', async (event) => {
            const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
            if (!anchor) return;
            const href = anchor.getAttribute('href') || '';
            if (!/^https?:\/\//i.test(href)) return;
            event.preventDefault();
            await openExternalUrl(href);
        });
    }

    function renderInlineFallback(text, baseDir) {
        const tokens = [];
        function stash(html) {
            const token = `@@MDTOKEN${tokens.length}@@`;
            tokens.push(html);
            return token;
        }

        let source = String(text || '');

        source = source.replace(/`([^`]+)`/g, (_m, code) => stash(`<code>${escapeHtml(code)}</code>`));
        source = source.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => {
            const resolved = resolveAssetUrl(url, baseDir);
            return stash(`<img alt="${escapeHtml(alt)}" src="${resolved}">`);
        });
        source = source.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => {
            const resolved = resolveAssetUrl(url, baseDir);
            return stash(`<a href="${resolved}">${escapeHtml(label)}</a>`);
        });
        source = source.replace(/\$([^$\n]+)\$/g, (_m, math) => {
            return stash(`<span class="math-inline">${escapeHtml(math)}</span>`);
        });

        let out = escapeHtml(source);
        out = out.replace(/\\([\\`*_{}\[\]()#+\-.!])/g, '$1');
        out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        out = out.replace(/@@MDTOKEN(\d+)@@/g, (_m, idx) => tokens[Number(idx)] || '');
        return out;
    }

    function renderMarkdownBlocksFallback(lines, baseDir) {
        const html = [];
        let i = 0;

        function isBlank(line) {
            return !line || !line.trim();
        }

        while (i < lines.length) {
            const line = lines[i];
            if (isBlank(line)) {
                i += 1;
                continue;
            }

            if (line.startsWith('```')) {
                const fence = line.trim();
                const language = fence.replace(/```/, '').trim();
                i += 1;
                const codeLines = [];
                while (i < lines.length && !lines[i].startsWith('```')) {
                    codeLines.push(lines[i]);
                    i += 1;
                }
                i += 1;
                const codeHtml = escapeHtml(codeLines.join('\n'));
                html.push(`<pre><code class="language-${language}">${codeHtml}</code></pre>`);
                continue;
            }

            const admonitionMatch = line.match(/^!!!\s+([a-zA-Z0-9_-]+)(?:\s+"([^"]+)")?/);
            if (admonitionMatch) {
                const type = admonitionMatch[1].toLowerCase();
                const title = admonitionMatch[2] || type;
                i += 1;
                const bodyLines = [];
                while (i < lines.length && (lines[i].startsWith('    ') || lines[i].startsWith('\t'))) {
                    bodyLines.push(lines[i].replace(/^\s{4}|\t/, ''));
                    i += 1;
                }
                const bodyHtml = renderMarkdownBlocksFallback(bodyLines, baseDir).join('');
                html.push(
                    `<div class="admonition ${type}">` +
                    `<div class="admonition-title">${escapeHtml(title)}</div>` +
                    `<div class="admonition-body">${bodyHtml}</div>` +
                    `</div>`
                );
                continue;
            }

            const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
            if (headingMatch) {
                const level = headingMatch[1].length;
                const content = renderInlineFallback(headingMatch[2], baseDir);
                html.push(`<h${level}>${content}</h${level}>`);
                i += 1;
                continue;
            }

            const ulMatch = line.match(/^\s*[-*+]\s+(.*)/);
            if (ulMatch) {
                const items = [];
                while (i < lines.length) {
                    const m = lines[i].match(/^\s*[-*+]\s+(.*)/);
                    if (!m) break;
                    items.push(`<li>${renderInlineFallback(m[1], baseDir)}</li>`);
                    i += 1;
                }
                html.push(`<ul>${items.join('')}</ul>`);
                continue;
            }

            const olMatch = line.match(/^\s*\d+\.\s+(.*)/);
            if (olMatch) {
                const items = [];
                while (i < lines.length) {
                    const m = lines[i].match(/^\s*\d+\.\s+(.*)/);
                    if (!m) break;
                    items.push(`<li>${renderInlineFallback(m[1], baseDir)}</li>`);
                    i += 1;
                }
                html.push(`<ol>${items.join('')}</ol>`);
                continue;
            }

            const paragraphLines = [];
            while (i < lines.length && !isBlank(lines[i])) {
                if (lines[i].startsWith('```') || lines[i].match(/^!!!\s+/) || lines[i].match(/^#{1,6}\s+/)) {
                    break;
                }
                paragraphLines.push(lines[i]);
                i += 1;
            }
            if (paragraphLines.length) {
                html.push(`<p>${renderInlineFallback(paragraphLines.join(' '), baseDir)}</p>`);
            }
        }

        return html;
    }

    function renderMarkdown(markdown, baseDir) {
        // Strip HTML comments so internal notes don't render in docs.
        const cleaned = markdown.replace(/<!--[\s\S]*?-->/g, '');
        if (window.marked && typeof window.marked.parse === 'function') {
            const html = window.marked.parse(cleaned, {
                gfm: true,
                breaks: false,
                mangle: false,
                headerIds: false
            });
            return normalizeRenderedMarkdown(html, baseDir);
        }
        const lines = cleaned.replace(/\r\n/g, '\n').split('\n');
        return renderMarkdownBlocksFallback(lines, baseDir).join('\n');
    }

    async function renderMarkdownInto(element, markdown, baseDir) {
        element.innerHTML = renderMarkdown(markdown, baseDir);
        installDocLinkHandling(element);
        await typesetMath(element);
    }

    async function loadExamplesIndex() {
        examplesById.clear();
        const rootEntries = await getExampleSourceRoots();
        const readmes = [];

        async function walk(dir) {
            if (!dir) return [];
            async function walkInner(currentDir) {
                let entries = [];
                try {
                    entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
                } catch (err) {
                    console.warn('[tabs] readDir failed:', currentDir, err?.message || err);
                    return [];
                }
                const results = [];
                for (const entry of entries) {
                    const full = path.join(currentDir, entry.name);
                    if (entry.isDirectory()) {
                        results.push(...await walkInner(full));
                    } else if (entry.isFile() && entry.name.toLowerCase() === 'readme.md') {
                        results.push(full);
                    }
                }
                return results;
            }
            return walkInner(dir);
        }

        for (const rootEntry of rootEntries) {
            if (!rootEntry || !rootEntry.path) continue;
            const rootReadmes = docsApi && docsApi.listReadmes
                ? await docsApi.listReadmes(rootEntry.path)
                : await walk(rootEntry.path);
            for (const docPath of rootReadmes) {
                readmes.push({ root: rootEntry, docPath });
            }
        }

        console.log('[tabs] example README count:', readmes.length);
        readmes.sort((a, b) => a.docPath.localeCompare(b.docPath));
        for (const entry of readmes) {
            const dir = paths && paths.dirname ? paths.dirname(entry.docPath) : path.dirname(entry.docPath);
            const relDir = paths && paths.relative
                ? paths.relative(entry.root.path, dir)
                : path.relative(entry.root.path, dir);
            const sep = paths && paths.sep ? paths.sep : path.sep;
            const parts = relDir.split(sep).filter(Boolean);
            if (!parts.length) continue;
            const leaf = path && path.basename ? path.basename(dir) : dir.split(sep).slice(-1)[0];
            const id = parts.join('/');
            const board = parts[0] || '';
            const category = parts.slice(1, -1).join(' / ');
            const subtitle = board ? (category ? `${board} - ${category}` : board) : '';
            const label = parts.length ? parts.join(' / ') : leaf;
            examplesById.set(id, {
                id,
                kind: 'example',
                title: leaf,
                subtitle,
                label,
                menuRoot: parts[0] || 'Examples',
                menuLabel: parts.slice(1).join(' / ') || leaf,
                docPath: entry.docPath,
                dashboardPath: (paths && paths.join
                    ? paths.join(entry.root.dashboardRoot || '', leaf, `${leaf}.json`)
                    : path.join(entry.root.dashboardRoot || '', leaf, `${leaf}.json`)),
                firmwarePath: (paths && paths.join
                    ? paths.join(entry.root.firmwareRoot || '', leaf, `${leaf}.mcuboot.bin`)
                    : path.join(entry.root.firmwareRoot || '', leaf, `${leaf}.mcuboot.bin`))
            });
        }
    }

    async function loadCoursewareIndex() {
        coursewareById.clear();
        const bootstrap = await getExtensionBootstrap();
        const entries = bootstrap && Array.isArray(bootstrap.courseware) ? bootstrap.courseware : [];
        entries.forEach((entry) => {
            if (!entry || !entry.id || !entry.markdownPath || !entry.dashboardPath || !entry.binaryPath) return;
            const segments = Array.isArray(entry.menuSegments) && entry.menuSegments.length
                ? entry.menuSegments.slice()
                : entry.id.split('/').filter(Boolean).map(humanizeSegment);
            const root = segments[0] || 'Courseware';
            const trail = segments.slice(1, -1);
            const menuLabel = trail.length ? `${trail.join(' / ')} / ${entry.title}` : entry.title;
            const subtitle = trail.length ? `${root} - ${trail.join(' / ')}` : root;
            const label = trail.length ? `${root} / ${trail.join(' / ')} / ${entry.title}` : `${root} / ${entry.title}`;
            coursewareById.set(entry.id, {
                id: entry.id,
                kind: 'courseware',
                title: entry.title,
                subtitle,
                label,
                menuRoot: root,
                menuLabel,
                docPath: entry.markdownPath,
                dashboardPath: entry.dashboardPath,
                firmwarePath: entry.binaryPath,
            });
        });
        console.log('[tabs] courseware loaded:', coursewareById.size);
    }

    function getWidgetsDocsRoot() {
        // Widget docs live under app/docs/widgets (outside the dashboard assets).
        if (paths && paths.appDir && paths.join) return paths.join(paths.appDir(), 'docs', 'widgets');
        if (paths && paths.cwd && paths.join) return paths.join(paths.cwd(), 'app', 'docs', 'widgets');
        if (localDir && path) return path.join(localDir, '..', 'docs', 'widgets');
        return null;
    }

    async function getWidgetDocsSources() {
        const bootstrap = await getExtensionBootstrap();
        if (bootstrap && Array.isArray(bootstrap.widgetDocsRoots) && bootstrap.widgetDocsRoots.length) {
            return bootstrap.widgetDocsRoots;
        }
        const baseDir = getWidgetsDocsRoot();
        if (!baseDir) return [];
        return [{
            extensionId: 'core',
            path: baseDir,
            indexPath: (paths && paths.join) ? paths.join(baseDir, 'index.json') : path.join(baseDir, 'index.json')
        }];
    }

    async function loadWidgetDocsIndex() {
        widgetDocsByType.clear();
        const bootstrap = await getExtensionBootstrap();

        if (bootstrap && Array.isArray(bootstrap.widgetDocs) && bootstrap.widgetDocs.length) {
            bootstrap.widgetDocs.forEach((entry) => {
                if (!entry || !entry.type || !entry.docPath) return;
                widgetDocsByType.set(entry.type, {
                    type: entry.type,
                    title: entry.title || entry.type,
                    category: entry.category || '',
                    docPath: entry.docPath,
                });
            });
            console.log('[tabs] widget docs loaded from bootstrap:', widgetDocsByType.size);
            return;
        }

        const sources = await getWidgetDocsSources();
        for (const source of sources) {
            if (!source || !source.path || !source.indexPath) continue;
            let raw = '';
            try {
                raw = filesApi && filesApi.readText
                    ? await filesApi.readText(source.indexPath)
                    : await fs.promises.readFile(source.indexPath, 'utf8');
            } catch (err) {
                console.warn('[tabs] widget docs index read failed:', err?.message || err);
                continue;
            }
            try {
                const parsed = JSON.parse(raw);
                const entries = Array.isArray(parsed.widgets) ? parsed.widgets : [];
                entries.forEach((entry) => {
                    if (!entry || !entry.type || !entry.doc) return;
                    const docPath = (paths && paths.join) ? paths.join(source.path, entry.doc) : path.join(source.path, entry.doc);
                    widgetDocsByType.set(entry.type, {
                        type: entry.type,
                        title: entry.title || entry.type,
                        category: entry.category || '',
                        docPath,
                    });
                });
            } catch (err) {
                console.warn('[tabs] widget docs parse failed:', err?.message || err);
            }
        }
        console.log('[tabs] widget docs loaded from files:', widgetDocsByType.size);
    }

    function setDocMode(mode) {
        if (!docPanel) return;
        docPanel.dataset.docMode = mode || 'example';
        const isWidget = mode === 'widget';
        if (docPicker) docPicker.style.display = isWidget ? 'none' : '';
        if (docActions) docActions.style.display = isWidget ? 'none' : '';
        if (docPortRow) docPortRow.style.display = isWidget ? 'none' : '';
        if (progressPanel) progressPanel.style.display = isWidget ? 'none' : '';
    }

    function setDocActionLabels(kind) {
        const label = docKindLabel(kind).toLowerCase();
        if (docPickerLabel) docPickerLabel.textContent = docKindLabel(kind);
        if (loadDashboardBtn) loadDashboardBtn.textContent = `Load ${label} dashboard`;
        if (uploadFirmwareBtn && !isUploading) uploadFirmwareBtn.textContent = `Upload ${label} to target`;
    }

    function populateDocSelect(kind) {
        exampleSelect.innerHTML = '';
        const grouped = new Map();
        for (const item of getDocMap(kind).values()) {
            const root = item.menuRoot || docKindLabel(kind);
            const label = item.menuLabel || item.title || item.id;
            if (!grouped.has(root)) grouped.set(root, []);
            grouped.get(root).push({ ...item, menuLabel: label });
        }
        const roots = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
        for (const root of roots) {
            const group = document.createElement('optgroup');
            group.label = root;
            const items = grouped.get(root).slice().sort((a, b) => a.menuLabel.localeCompare(b.menuLabel));
            for (const item of items) {
                const opt = document.createElement('option');
                opt.value = item.id;
                opt.textContent = item.menuLabel;
                group.appendChild(opt);
            }
            exampleSelect.appendChild(group);
        }
        console.log(`[tabs] ${kind} list populated (${getDocMap(kind).size})`);
    }

    async function loadDocItem(kind, itemId) {
        const item = getDocItem(kind, itemId);
        if (!item) {
            setStatus(`${docKindLabel(kind)} not found.`);
            docContent.innerHTML = '<p>Documentation configuration missing.</p>';
            console.warn('[tabs] loadDocItem: missing item', kind, itemId);
            return;
        }
        console.log('[tabs] loadDocItem:', kind, itemId);
        docTitle.textContent = item.title;
        docSubtitle.textContent = item.subtitle || '';
        setDocActionLabels(kind);
        setStatus('Loading documentation...');
        try {
            const markdown = docsApi && docsApi.readMarkdown
                ? await docsApi.readMarkdown(item.docPath)
                : await fs.promises.readFile(item.docPath, 'utf8');
            const baseDir = paths && paths.dirname ? paths.dirname(item.docPath) : path.dirname(item.docPath);
            await renderMarkdownInto(docContent, markdown, baseDir);
            setStatus('Ready.');
        } catch (err) {
            docContent.innerHTML = `<p>Failed to load documentation: ${escapeHtml(err?.message || String(err))}</p>`;
            setStatus('Failed to load documentation.');
        }
    }

    async function loadWidgetDoc(typeName) {
        const doc = widgetDocsByType.get(typeName);
        if (!doc) {
            setStatus('Widget documentation not found.');
            docTitle.textContent = 'Widget documentation';
            docSubtitle.textContent = '';
            docContent.innerHTML = '<p>Documentation for this widget is not available yet.</p>';
            console.warn('[tabs] loadWidgetDoc: missing widget', typeName);
            return;
        }
        console.log('[tabs] loadWidgetDoc:', typeName);
        docTitle.textContent = doc.title;
        docSubtitle.textContent = doc.category || '';
        setStatus('Loading documentation...');
        try {
            const markdown = docsApi && docsApi.readMarkdown
                ? await docsApi.readMarkdown(doc.docPath)
                : await fs.promises.readFile(doc.docPath, 'utf8');
            const baseDir = paths && paths.dirname ? paths.dirname(doc.docPath) : path.dirname(doc.docPath);
            await renderMarkdownInto(docContent, markdown, baseDir);
            setStatus('Ready.');
        } catch (err) {
            docContent.innerHTML = `<p>Failed to load documentation: ${escapeHtml(err?.message || String(err))}</p>`;
            setStatus('Failed to load documentation.');
        }
    }

    async function refreshPorts() {
        try {
            const ports = serialApi && serialApi.listPorts
                ? await serialApi.listPorts()
                : await ipcRenderer.invoke('get-serial-ports');
            portSelect.innerHTML = '';
            if (!ports || ports.length === 0) {
                const opt = document.createElement('option');
                opt.textContent = 'No ports found';
                opt.value = '';
                portSelect.appendChild(opt);
                return;
            }
            ports.forEach((port) => {
                const opt = document.createElement('option');
                opt.textContent = formatPortLabel(port);
                opt.value = port.value;
                portSelect.appendChild(opt);
            });
        } catch (err) {
            setStatus('Failed to load serial ports.');
        }
    }

    async function loadDashboard() {
        const tab = getActiveDocTab();
        if (!tab || !tab.docId) return;
        const item = getDocItem(tab.kind, tab.docId);
        if (!item) return;
        setStatus('Opening dashboard in new tab...');
        try {
            await openDashboardFileInNewTab(item.dashboardPath);
            setStatus('Dashboard opened.');
        } catch (e) {
            setStatus(`Failed to open dashboard: ${e?.message || 'unknown error'}`);
        }
    }

    async function uploadFirmware() {
        const tab = getActiveDocTab();
        if (isUploading) {
            await cancelUpload();
            return;
        }
        if (!tab || !tab.docId) return;
        const item = getDocItem(tab.kind, tab.docId);
        const port = portSelect.value;
        if (!item || !port) {
            setStatus('Select a target port before uploading.');
            return;
        }
        isUploading = true;
        uploadCanceled = false;
        uploadFailed = false;
        updateUploadButton();
        setStatus('Uploading firmware...');
        resetProgress();
        progressLabel.textContent = `Starting upload to ${port}`;
        progressState.textContent = 'flashing';
        if (progressSpinner) progressSpinner.classList.remove('d-none');

        try {
            if (flashApi && flashApi.startFlash) {
                await flashApi.startFlash({ comPort: port, firmwarePath: item.firmwarePath });
            } else {
                await ipcRenderer.invoke('start-flash', {
                    comPort: port,
                    firmwarePath: item.firmwarePath
                });
            }
        } catch (err) {
            setFailure(`Error: ${err?.message || String(err)}`);
            setStatus('Upload failed to start.');
            isUploading = false;
            updateUploadButton();
        }
    }

    if (flashApi && flashApi.onProgress) {
        flashApi.onProgress((message) => {
            const text = String(message || '').trim();
            const pct = extractProgressPercent(text);
            if (/error|failed/i.test(text)) {
                setFailure(text || 'Upload failed');
                return;
            }
            if (pct !== null) {
                setProgress(Math.round(pct));
            }
        });
    } else if (ipcRenderer) {
        ipcRenderer.on('flash-progress', (_event, message) => {
        const text = String(message || '').trim();
        const pct = extractProgressPercent(text);
        if (/error|failed/i.test(text)) {
            setFailure(text || 'Upload failed');
            return;
        }
        if (pct !== null) {
            setProgress(Math.round(pct));
        }
        });
    }

    if (flashApi && flashApi.onComplete) {
        flashApi.onComplete(() => {
            if (uploadCanceled) {
                progressBar.classList.remove('bg-success', 'bg-danger');
                progressState.textContent = 'canceled';
                progressLabel.textContent = 'Upload canceled.';
                if (progressSpinner) progressSpinner.classList.add('d-none');
                setStatus('Upload canceled.');
            } else if (uploadFailed) {
                setFailure('Upload failed');
                setStatus('Upload failed.');
            } else {
                setSuccess();
                setStatus('Upload complete.');
            }
            isUploading = false;
            updateUploadButton();
        });
    } else if (ipcRenderer) {
        ipcRenderer.on('flash-complete', () => {
        if (uploadCanceled) {
            progressBar.classList.remove('bg-success', 'bg-danger');
            progressState.textContent = 'canceled';
            progressLabel.textContent = 'Upload canceled.';
            if (progressSpinner) progressSpinner.classList.add('d-none');
            setStatus('Upload canceled.');
        } else if (uploadFailed) {
            setFailure('Upload failed');
            setStatus('Upload failed.');
        } else {
            setSuccess();
            setStatus('Upload complete.');
        }
        isUploading = false;
        updateUploadButton();
        });
    }

    function setActiveTab(tabId) {
        console.log('[tabs] setActiveTab:', tabId);
        activeTabId = tabId;
        for (const [id, tab] of tabs.entries()) {
            tab.button.classList.toggle('active', id === tabId);
        }
        const switchingToDashboard = tabId === dashboardTabId || tabs.get(tabId)?.type === 'dashboard';
        if (switchingToDashboard) {
            console.log('[tabs] switching to dashboard view');
            document.body.classList.remove(docsModeClass);
            document.documentElement.classList.remove(docsModeClass);
            document.body.classList.add(dashboardModeClass);
            document.documentElement.classList.add(dashboardModeClass);
            if (mainHeader) mainHeader.style.display = '';
            if (boardContent) boardContent.style.display = '';
            try {
                if (mainHeader && !headerObserver && window.MutationObserver) {
                    headerObserver = new MutationObserver((mutations) => {
                        try {
                            const style = getComputedStyle(mainHeader);
                            const snapshot = {
                                display: style.display,
                                visibility: style.visibility,
                                opacity: style.opacity,
                                top: style.top,
                                height: style.height,
                                zIndex: style.zIndex,
                                className: mainHeader.className,
                                styleAttr: mainHeader.getAttribute('style')
                            };
                            const changed = JSON.stringify(snapshot) !== JSON.stringify(lastHeaderSnapshot);
                            if (changed) {
                                console.log('[tabs] main-header mutation:', {
                                    type: mutations.map(m => m.type).join(','),
                                    snapshot
                                });
                                lastHeaderSnapshot = snapshot;
                            }
                        } catch (err) {
                            console.warn('[tabs] main-header mutation log failed:', err?.message || err);
                        }
                    });
                    headerObserver.observe(mainHeader, { attributes: true, attributeFilter: ['style', 'class'] });
                    console.log('[tabs] main-header observer attached');
                }
            } catch (err) {
                console.warn('[tabs] header observer setup failed:', err?.message || err);
            }
            try {
                const hasHeader = !!mainHeader;
                const fbEditing = (window.freeboard && typeof window.freeboard.isEditing === 'function')
                    ? window.freeboard.isEditing()
                    : null;
                console.log('[tabs] state:', {
                    hasHeader,
                    hasFreeboard: !!window.freeboard,
                    hasFreeboardModel: !!window.freeboardModel,
                    isEditing: fbEditing
                });
                if (mainHeader) {
                    const before = getComputedStyle(mainHeader);
                    console.log('[tabs] main-header before:', {
                        display: before.display,
                        visibility: before.visibility,
                        opacity: before.opacity,
                        top: before.top,
                        height: before.height,
                        zIndex: before.zIndex
                    });
                }
            } catch (err) {
                console.warn('[tabs] state snapshot failed:', err?.message || err);
            }
            docPanel.hidden = true;
            if (mainHeader) {
                try {
                    if (window.freeboardModel && typeof window.freeboardModel.allow_edit === 'function') {
                        const canEdit = !!window.freeboardModel.allow_edit();
                        console.log('[tabs] allow_edit:', canEdit);
                    }
                    if (window.freeboard && typeof window.freeboard.getLiveModel === 'function') {
                        const model = window.freeboard.getLiveModel();
                        if (model && typeof model.allow_edit === 'function') {
                            // Ensure the header can render when returning to the dashboard tab.
                            model.allow_edit(lastAllowEdit !== null ? lastAllowEdit : true);
                        }
                    }
                    // Show the header only on the dashboard tab and only when allow_edit is enabled.
                    try {
                        const model = window.freeboard && typeof window.freeboard.getLiveModel === 'function'
                            ? window.freeboard.getLiveModel()
                            : window.freeboardModel;
                        const allowEdit = model && typeof model.allow_edit === 'function'
                            ? model.allow_edit()
                            : true;
                        console.log('[tabs] allow_edit check:', {
                            hasFreeboard: !!window.freeboard,
                            hasLiveModel: !!(window.freeboard && typeof window.freeboard.getLiveModel === 'function'),
                            hasFreeboardModel: !!window.freeboardModel,
                            allowEdit,
                            lastAllowEdit
                        });
                        // If allow_edit was forced off elsewhere, re-enable it on the dashboard tab.
                        if (model && typeof model.allow_edit === 'function' && !allowEdit) {
                            model.allow_edit(true);
                            console.log('[tabs] allow_edit forced true');
                        }
                        if (model && typeof model.allow_edit === 'function' && mainHeader) {
                            const headerDisplay = getComputedStyle(mainHeader).display;
                            if (allowEdit && headerDisplay === 'none') {
                                // Force the allow_edit subscription to re-run so the header is shown.
                                model.allow_edit(false);
                                model.allow_edit(true);
                                console.log('[tabs] allow_edit toggled to refresh header display');
                            }
                        }
                        if (window.$) {
                            const beforeShown = $("#main-header").data('shown');
                            console.log('[tabs] jQuery present; main-header data.shown before:', beforeShown);
                            if (allowEdit) {
                                $("#main-header").show().data('shown', true);
                            } else {
                                $("#main-header").hide().data('shown', false);
                            }
                            console.log('[tabs] jQuery allow_edit applied; main-header data.shown after:', $("#main-header").data('shown'));
                        } else if (mainHeader) {
                            mainHeader.style.display = allowEdit ? '' : 'none';
                        }
                    } catch {}
                    const tabsEl = document.getElementById('app-tabs');
                    const tabsOffset = tabsEl ? tabsEl.offsetHeight : 0;
                    const adminBar = document.getElementById('admin-bar');
                    const barHeight = adminBar ? adminBar.offsetHeight : 0;
                    const editing = (window.freeboard && typeof window.freeboard.isEditing === 'function')
                        ? window.freeboard.isEditing()
                        : null;
                    const shown = lastHeaderState?.shown ?? true;
                    const headerTop = (editing === false)
                        ? Math.max(0, tabsOffset - barHeight)
                        : tabsOffset;
                    mainHeader.style.display = shown ? 'block' : 'none';
                    mainHeader.style.top = `${headerTop}px`;
                    mainHeader.style.visibility = 'visible';
                    mainHeader.style.opacity = '1';
                    try {
                        const after = getComputedStyle(mainHeader);
                        console.log('[tabs] main-header after:', {
                            display: after.display,
                            visibility: after.visibility,
                            opacity: after.opacity,
                            top: after.top,
                            height: after.height,
                            zIndex: after.zIndex
                        });
                    } catch {}
                    try {
                        setTimeout(() => {
                            const delayed = getComputedStyle(mainHeader);
                            console.log('[tabs] main-header after (50ms):', {
                                display: delayed.display,
                                visibility: delayed.visibility,
                                opacity: delayed.opacity,
                                top: delayed.top,
                                height: delayed.height,
                                zIndex: delayed.zIndex,
                                styleAttr: mainHeader.getAttribute('style'),
                                className: mainHeader.className
                            });
                        }, 50);
                    } catch {}
                    try {
                        setTimeout(() => {
                            const delayed = getComputedStyle(mainHeader);
                            console.log('[tabs] main-header after (250ms):', {
                                display: delayed.display,
                                visibility: delayed.visibility,
                                opacity: delayed.opacity,
                                top: delayed.top,
                                height: delayed.height,
                                zIndex: delayed.zIndex,
                                styleAttr: mainHeader.getAttribute('style'),
                                className: mainHeader.className
                            });
                        }, 250);
                    } catch {}
                } catch {
                    mainHeader.style.display = (lastHeaderState?.shown ?? true) ? 'block' : 'none';
                    mainHeader.style.visibility = 'visible';
                    mainHeader.style.opacity = '1';
                }
            }
            try {
                boardContent.style.top = '';
                boardContent.style.minHeight = '';
                boardContent.style.height = 'auto';
            } catch {}
            // Trigger a resize so gridster/layout recalculates after restoring.
            try { window.dispatchEvent(new Event('resize')); } catch {}
            try {
                if (window.freeboard && typeof window.freeboard.resize === 'function') {
                    setTimeout(() => window.freeboard.resize(), 0);
                }
                if (window.freeboard && typeof window.freeboard.isEditing === 'function' && typeof window.freeboard.setEditing === 'function') {
                    const editing = window.freeboard.isEditing();
                    // Force Freeboard to recompute header/board offsets.
                    setTimeout(() => window.freeboard.setEditing(editing, false), 0);
                }
            } catch {}
            try {
                const bc = boardContent;
                const mh = mainHeader;
                const bcStyle = bc ? getComputedStyle(bc) : null;
                const mhStyle = mh ? getComputedStyle(mh) : null;
                const grid = bc ? bc.querySelector('.gridster ul') : null;
                const gridItems = grid ? grid.querySelectorAll('li') : [];
                const paneCount = window.freeboardModel && typeof window.freeboardModel.panes === 'function'
                    ? window.freeboardModel.panes().length
                    : null;
                console.log('[tabs] board-content:', {
                    display: bcStyle?.display,
                    visibility: bcStyle?.visibility,
                    opacity: bcStyle?.opacity,
                    top: bcStyle?.top,
                    height: bcStyle?.height,
                    zIndex: bcStyle?.zIndex
                });
                console.log('[tabs] main-header:', {
                    display: mhStyle?.display,
                    visibility: mhStyle?.visibility,
                    opacity: mhStyle?.opacity,
                    top: mhStyle?.top,
                    height: mhStyle?.height,
                    zIndex: mhStyle?.zIndex
                });
                console.log('[tabs] gridster items:', gridItems.length);
                console.log('[tabs] panes count:', paneCount);
            } catch {}
            return;
        }
        // Leaving dashboard: remember the header state to avoid flicker on return.
        try {
            if (mainHeader) {
                const style = getComputedStyle(mainHeader);
                lastHeaderState = {
                    shown: style.display !== 'none',
                    top: style.top,
                    visibility: style.visibility,
                    opacity: style.opacity,
                    className: mainHeader.className,
                    styleAttr: mainHeader.getAttribute('style')
                };
            }
            if (window.freeboard && typeof window.freeboard.getLiveModel === 'function') {
                const model = window.freeboard.getLiveModel();
                if (model && typeof model.allow_edit === 'function') {
                    lastAllowEdit = model.allow_edit();
                }
            } else if (window.freeboardModel && typeof window.freeboardModel.allow_edit === 'function') {
                lastAllowEdit = window.freeboardModel.allow_edit();
            }
        } catch {}
        docPanel.hidden = false;
        document.body.classList.add(docsModeClass);
        document.documentElement.classList.add(docsModeClass);
        document.body.classList.remove(dashboardModeClass);
        document.documentElement.classList.remove(dashboardModeClass);
        const tab = tabs.get(tabId);
        if (tab && tab.type === 'doc' && tab.docId) {
            setDocMode(tab.kind || 'example');
            populateDocSelect(tab.kind || 'example');
            exampleSelect.value = tab.docId;
            loadDocItem(tab.kind || 'example', tab.docId);
        } else if (tab && tab.type === 'widget-doc' && tab.widgetType) {
            setDocMode('widget');
            loadWidgetDoc(tab.widgetType);
        }
    }

    function closeTab(tabId) {
        if (tabId === dashboardTabId) return;
        const tab = tabs.get(tabId);
        if (!tab) return;
        tab.button.remove();
        tabs.delete(tabId);
        if (activeTabId === tabId) {
            const next = Array.from(tabs.keys()).find(id => id !== dashboardTabId) || dashboardTabId;
            setActiveTab(next);
        }
    }

    function clearDockPreview() {
        if (dockPreviewRequest) {
            const existing = tabs.get(tabIdForDoc(dockPreviewRequest.kind, dockPreviewRequest.id));
            if (existing) existing.button.classList.remove('dock-preview');
        }
        if (dockPreviewTab) {
            dockPreviewTab.remove();
            dockPreviewTab = null;
        }
        dockPreviewRequest = null;
    }

    function showDockPreview(kind, itemId) {
        if (!itemId) {
            clearDockPreview();
            return;
        }
        if (dockPreviewRequest && dockPreviewRequest.kind === kind && dockPreviewRequest.id === itemId) return;
        clearDockPreview();
        dockPreviewRequest = { kind, id: itemId };
        const existing = tabs.get(tabIdForDoc(kind, itemId));
        if (existing) {
            existing.button.classList.add('dock-preview');
            return;
        }
        const item = getDocItem(kind, itemId);
        const label = item ? item.title : itemId;
        const btn = document.createElement('button');
        btn.className = 'tab tab-dock-preview';
        btn.textContent = label;
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
        btn.dataset.previewId = itemId;
        tabStrip.appendChild(btn);
        dockPreviewTab = btn;
    }

    function isPointInWindow(screenX, screenY) {
        const left = window.screenX;
        const top = window.screenY;
        const right = left + window.outerWidth;
        const bottom = top + window.outerHeight;
        return screenX >= left && screenX <= right && screenY >= top && screenY <= bottom;
    }

    // ── Dashboard tabs (multi-tab) ─────────────────────────────────────────────

    function makeDashboardLabel(filePath) {
        if (!filePath) return 'Dashboard';
        return filePath.replace(/\\/g, '/').split('/').pop().replace(/\.json$/i, '');
    }

    function startTabRename(id) {
        const tab = tabs.get(id);
        if (!tab) return;
        const btn = tab.button;
        const textNode = [...btn.childNodes].find(n => n.nodeType === Node.TEXT_NODE);
        if (!textNode) return;
        const original = textNode.nodeValue;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = original;
        input.className = 'tab-rename-input';
        function commit() {
            const label = input.value.trim() || original;
            btn.replaceChild(document.createTextNode(label), input);
        }
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            else if (e.key === 'Escape') { input.value = original; input.blur(); }
        });
        input.addEventListener('blur', commit);
        btn.replaceChild(input, textNode);
        setTimeout(() => input.select(), 0);
    }

    let draggedTabId = null;

    function addDashboardDragHandlers(btn, id) {
        btn.setAttribute('draggable', 'true');
        btn.addEventListener('dragstart', (e) => {
            draggedTabId = id;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', id);
            setTimeout(() => btn.classList.add('tab-dragging'), 0);
        });
        btn.addEventListener('dragend', () => {
            draggedTabId = null;
            btn.classList.remove('tab-dragging');
            tabStrip.querySelectorAll('.tab-drop-before,.tab-drop-after')
                .forEach(el => el.classList.remove('tab-drop-before', 'tab-drop-after'));
        });
        btn.addEventListener('dragover', (e) => {
            if (!draggedTabId || draggedTabId === id) return;
            const src = tabs.get(draggedTabId);
            const dst = tabs.get(id);
            if (!src || !dst) return;
            if ((src.type !== 'dashboard' && draggedTabId !== dashboardTabId) ||
                (dst.type !== 'dashboard' && id !== dashboardTabId)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            tabStrip.querySelectorAll('.tab-drop-before,.tab-drop-after')
                .forEach(el => el.classList.remove('tab-drop-before', 'tab-drop-after'));
            const mid = btn.getBoundingClientRect().left + btn.offsetWidth / 2;
            btn.classList.add(e.clientX < mid ? 'tab-drop-before' : 'tab-drop-after');
        });
        btn.addEventListener('dragleave', () => {
            btn.classList.remove('tab-drop-before', 'tab-drop-after');
        });
        btn.addEventListener('drop', (e) => {
            e.preventDefault();
            btn.classList.remove('tab-drop-before', 'tab-drop-after');
            if (!draggedTabId || draggedTabId === id) return;
            const src = tabs.get(draggedTabId);
            const dst = tabs.get(id);
            if (!src || !dst) return;
            if ((src.type !== 'dashboard' && draggedTabId !== dashboardTabId) ||
                (dst.type !== 'dashboard' && id !== dashboardTabId)) return;
            const srcBtn = src.button;
            const mid = btn.getBoundingClientRect().left + btn.offsetWidth / 2;
            if (e.clientX < mid) tabStrip.insertBefore(srcBtn, btn);
            else btn.nextSibling ? tabStrip.insertBefore(srcBtn, btn.nextSibling) : tabStrip.appendChild(srcBtn);
        });
    }

    async function switchToDashboardTab(id) {
        if (activeTabId === id) return;
        // Serialize current freeboard state into the departing dashboard tab.
        const prevTab = tabs.get(activeTabId);
        if (prevTab && (activeTabId === dashboardTabId || prevTab.type === 'dashboard')) {
            prevTab.savedData = window.freeboard && typeof window.freeboard.serialize === 'function'
                ? window.freeboard.serialize() : null;
        }
        // Load the arriving tab's state into freeboard.
        const nextTab = tabs.get(id);
        if (nextTab && (id === dashboardTabId || nextTab.type === 'dashboard')) {
            const loadFn = (window.freeboard && typeof window.freeboard.loadDashboard === 'function')
                ? (d) => window.freeboard.loadDashboard(d)
                : (window.freeboardModel && typeof window.freeboardModel.loadDashboard === 'function')
                    ? (d) => window.freeboardModel.loadDashboard(d)
                    : null;
            if (loadFn) loadFn(nextTab.savedData || { allow_edit: true });
            currentDashboardPath = nextTab.filePath || null;
        }
        setActiveTab(id);
    }

    function closeDashboardTab(id) {
        const allDash = [...tabs.entries()].filter(([k, t]) => k === dashboardTabId || t.type === 'dashboard');
        if (allDash.length <= 1) return;
        const tab = tabs.get(id);
        if (!tab) return;
        tab.button.remove();
        tabs.delete(id);
        if (activeTabId === id) {
            const remaining = [...tabs.entries()].filter(([k, t]) => k === dashboardTabId || t.type === 'dashboard');
            switchToDashboardTab(remaining[remaining.length - 1]?.[0] || dashboardTabId);
        }
    }

    function createDashboardTab(filePath, initialData) {
        dashboardTabCounter += 1;
        const id = `dashboard:${dashboardTabCounter}`;
        const btn = document.createElement('button');
        btn.className = 'tab';
        btn.dataset.tabId = id;
        btn.textContent = makeDashboardLabel(filePath);
        const close = document.createElement('span');
        close.className = 'tab-close';
        close.textContent = '×';
        close.title = 'Close tab';
        close.addEventListener('click', (e) => { e.stopPropagation(); closeDashboardTab(id); });
        btn.appendChild(close);
        btn.addEventListener('click', () => {
            if (activeTabId === id) startTabRename(id);
            else switchToDashboardTab(id);
        });
        addDashboardDragHandlers(btn, id);
        tabs.set(id, { id, type: 'dashboard', filePath: filePath || null, savedData: initialData || null, button: btn });
        // Insert after the last dashboard tab, before doc tabs.
        let insertAfter = addTabBtn;
        for (const [k, t] of tabs) {
            if ((k === dashboardTabId || t.type === 'dashboard') && t.button !== btn) insertAfter = t.button;
        }
        if (insertAfter && insertAfter.nextSibling) tabStrip.insertBefore(btn, insertAfter.nextSibling);
        else tabStrip.appendChild(btn);
        return id;
    }

    async function openNewDashboardTab() {
        const id = createDashboardTab(null, null);
        await switchToDashboardTab(id);
    }

    async function openDashboardFileInNewTab(filePath) {
        try {
            const text = filesApi
                ? await filesApi.readText(filePath)
                : await ipcRenderer.invoke('files-read-text', { filePath });
            const id = createDashboardTab(filePath, JSON.parse(text));
            await switchToDashboardTab(id);
        } catch (e) {
            console.error('[tabs] openDashboardFileInNewTab failed:', e?.message || e);
        }
    }

    async function openDashboardDialog() {
        try {
            const filePath = dashboardApi && dashboardApi.openDashboardDialog
                ? await dashboardApi.openDashboardDialog()
                : ipcRenderer
                    ? await ipcRenderer.invoke('show-open-dashboard')
                    : null;
            if (filePath) await openDashboardFileInNewTab(filePath);
        } catch (e) {
            console.error('[tabs] openDashboardDialog failed:', e?.message || e);
        }
    }

    function saveCurrentDashboard() {
        const model = (window.freeboard && typeof window.freeboard.getLiveModel === 'function')
            ? window.freeboard.getLiveModel()
            : window.freeboardModel;
        if (model && typeof model.saveDashboard === 'function') {
            model.saveDashboard(null, { currentTarget: { dataset: { pretty: 'true' } } });
        }
    }

    // + button: fixed at the left of the dashboard tab group.
    const addTabBtn = document.createElement('button');
    addTabBtn.className = 'tab tab-add';
    addTabBtn.title = 'New dashboard tab (Ctrl+T)';
    addTabBtn.textContent = '+';
    addTabBtn.setAttribute('draggable', 'false');
    addTabBtn.addEventListener('click', () => openNewDashboardTab());
    tabStrip.insertBefore(addTabBtn, tabStrip.firstChild);

    // Expose tab API so dashboard_control.js can delegate menu actions here.
    window.dashboardTabs = {
        openNew: openNewDashboardTab,
        openDialog: openDashboardDialog,
        openFile: openDashboardFileInNewTab,
        save: saveCurrentDashboard
    };

    // Returns dashboard tab IDs in left-to-right DOM order (respects drag reordering).
    function getDashboardTabsInOrder() {
        const ids = [];
        for (const child of tabStrip.children) {
            for (const [id, t] of tabs) {
                if (t.button === child && (id === dashboardTabId || t.type === 'dashboard')) {
                    ids.push(id);
                    break;
                }
            }
        }
        return ids;
    }

    // Keyboard shortcuts.
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        if (e.key === 'Tab') {
            e.preventDefault();
            const order = getDashboardTabsInOrder();
            if (order.length < 2) return;
            const idx = order.indexOf(activeTabId);
            const next = e.shiftKey
                ? order[(idx - 1 + order.length) % order.length]
                : order[(idx + 1) % order.length];
            switchToDashboardTab(next);
        } else if (e.key === 't') { e.preventDefault(); openNewDashboardTab(); }
        else if (e.key === 's') { e.preventDefault(); saveCurrentDashboard(); }
        else if (e.key === 'o') { e.preventDefault(); openDashboardDialog(); }
    });

    function createDocTab(kind, itemId) {
        const id = tabIdForDoc(kind, itemId);
        if (tabs.has(id)) {
            setActiveTab(id);
            return;
        }
        if (dockPreviewRequest && dockPreviewRequest.kind === kind && dockPreviewRequest.id === itemId) {
            clearDockPreview();
        }
        const item = getDocItem(kind, itemId);
        const label = item ? item.title : itemId;
        const btn = document.createElement('button');
        btn.className = 'tab';
        btn.dataset.tabId = id;
        btn.textContent = label;
        btn.setAttribute('draggable', 'true');

        const close = document.createElement('span');
        close.className = 'tab-close';
        close.textContent = '×';
        close.addEventListener('click', (e) => {
            e.stopPropagation();
            closeTab(id);
        });
        btn.appendChild(close);

        btn.addEventListener('click', () => setActiveTab(id));
        btn.addEventListener('dragend', (e) => {
            const outside = !isPointInWindow(e.screenX, e.screenY);
            if (outside) {
                if (docsApi && docsApi.undockTab) docsApi.undockTab({ kind, id: itemId });
                else ipcRenderer.send('undock-doc-tab', { kind, id: itemId });
                closeTab(id);
            }
        });

        tabs.set(id, { id, type: 'doc', kind, docId: itemId, button: btn });
        tabStrip.appendChild(btn);
        setActiveTab(id);
    }

    function createWidgetDocTab(typeName) {
        const id = `widgetdoc:${typeName}`;
        if (tabs.has(id)) {
            setActiveTab(id);
            return;
        }
        const doc = widgetDocsByType.get(typeName);
        const label = doc ? doc.title : typeName;
        const btn = document.createElement('button');
        btn.className = 'tab';
        btn.dataset.tabId = id;
        btn.textContent = label;
        btn.setAttribute('draggable', 'false');

        const close = document.createElement('span');
        close.className = 'tab-close';
        close.textContent = '×';
        close.addEventListener('click', (e) => {
            e.stopPropagation();
            closeTab(id);
        });
        btn.appendChild(close);

        btn.addEventListener('click', () => setActiveTab(id));

        tabs.set(id, { id, type: 'widget-doc', widgetType: typeName, button: btn });
        tabStrip.appendChild(btn);
        setActiveTab(id);
    }

    function updateActiveDocTab(itemId) {
        const tab = tabs.get(activeTabId);
        if (!tab || tab.type !== 'doc') return;
        tab.docId = itemId;
        const item = getDocItem(tab.kind, itemId);
        if (item) {
            tab.button.childNodes[0].nodeValue = item.title;
        }
        loadDocItem(tab.kind, itemId);
    }

    function openExampleTab(exampleId) {
        if (examplesById.has(exampleId)) {
            createDocTab('example', exampleId);
        } else {
            pendingOpenId = exampleId;
        }
    }

    function openCoursewareTab(coursewareId) {
        if (coursewareById.has(coursewareId)) {
            createDocTab('courseware', coursewareId);
        } else {
            pendingDocRequest = { kind: 'courseware', id: coursewareId };
        }
    }

    function openWidgetTab(typeName) {
        if (widgetDocsByType.has(typeName)) {
            createWidgetDocTab(typeName);
        } else {
            pendingWidgetType = typeName;
        }
    }

    tabs.set(dashboardTabId, {
        id: dashboardTabId,
        type: 'dashboard',
        filePath: null,
        savedData: null,
        button: tabStrip.querySelector('[data-tab-id="dashboard"]')
    });
    const dashboardButton = tabs.get(dashboardTabId).button;
    if (dashboardButton) {
        // Add close button to the initial Dashboard tab.
        const initClose = document.createElement('span');
        initClose.className = 'tab-close';
        initClose.textContent = '×';
        initClose.title = 'Close tab';
        initClose.addEventListener('click', (e) => { e.stopPropagation(); closeDashboardTab(dashboardTabId); });
        dashboardButton.appendChild(initClose);
        dashboardButton.addEventListener('click', () => {
            if (activeTabId === dashboardTabId) startTabRename(dashboardTabId);
            else switchToDashboardTab(dashboardTabId);
        });
        addDashboardDragHandlers(dashboardButton, dashboardTabId);
        console.log('[tabs] dashboard tab wired');
    } else {
        console.warn('[tabs] dashboard tab button missing');
    }

    exampleSelect.addEventListener('change', () => {
        const id = exampleSelect.value;
        const tab = getActiveDocTab();
        if (id && tab) updateActiveDocTab(id);
    });
    loadDashboardBtn.addEventListener('click', loadDashboard);
    uploadFirmwareBtn.addEventListener('click', uploadFirmware);
    refreshPortsBtn.addEventListener('click', refreshPorts);
    updateUploadButton();

    if (docsApi && docsApi.onOpenTab) {
        docsApi.onOpenTab((payload = {}) => {
            const request = normalizeDocRequest(payload);
            console.log('[tabs] open-doc-tab IPC:', request);
            if (!request) return;
            if (request.kind === 'courseware') openCoursewareTab(request.id);
            else openExampleTab(request.id);
        });
    }
    if (examplesApi && examplesApi.onOpenExampleTab) {
        examplesApi.onOpenExampleTab(({ id } = {}) => {
            console.log('[tabs] open-example-tab IPC:', id);
            if (id) openExampleTab(id);
        });
    }
    if (ipcRenderer) {
        ipcRenderer.on('open-example-tab', (_e, { id }) => {
            console.log('[tabs] open-example-tab IPC:', id);
            if (id) openExampleTab(id);
        });
    }
    if (widgetsApi && widgetsApi.onOpenDocTab) {
        widgetsApi.onOpenDocTab(({ type } = {}) => {
            console.log('[tabs] open-widget-doc-tab IPC:', type);
            if (type) openWidgetTab(type);
        });
    } else if (ipcRenderer) {
        ipcRenderer.on('open-widget-doc-tab', (_e, { type }) => {
            console.log('[tabs] open-widget-doc-tab IPC:', type);
            if (type) openWidgetTab(type);
        });
    }
    if (docsApi && docsApi.onDockPreview) {
        docsApi.onDockPreview(({ kind, id, active } = {}) => {
            if (active) showDockPreview(kind || 'example', id);
            else clearDockPreview();
        });
    }
    if (examplesApi && examplesApi.onDockPreview) {
        examplesApi.onDockPreview(({ id, active } = {}) => {
            if (active) showDockPreview('example', id);
            else clearDockPreview();
        });
    }
    if (ipcRenderer) {
        ipcRenderer.on('example-dock-preview', (_e, { id, active }) => {
            if (active) showDockPreview('example', id);
            else clearDockPreview();
        });
    }

    resetProgress();
    refreshPorts();
    Promise.all([loadExamplesIndex(), loadCoursewareIndex()]).then(() => {
        console.log('[tabs] doc indexes loaded');
        populateDocSelect('example');
        if (pendingOpenId && examplesById.has(pendingOpenId)) {
            console.log('[tabs] opening pending example', pendingOpenId);
            createDocTab('example', pendingOpenId);
            pendingOpenId = null;
        }
        if (pendingDocRequest && pendingDocRequest.kind === 'courseware' && coursewareById.has(pendingDocRequest.id)) {
            console.log('[tabs] opening pending courseware', pendingDocRequest.id);
            createDocTab('courseware', pendingDocRequest.id);
            pendingDocRequest = null;
        }
    }).catch((err) => {
        console.error('[tabs] doc index load failed', err);
    }).finally(async () => {
        try {
            const pending = docsApi && docsApi.getPendingTab
                ? await docsApi.getPendingTab()
                : await ipcRenderer.invoke('get-pending-doc-tab');
            const request = normalizeDocRequest(pending);
            if (!request) return;
            if (request.kind === 'courseware') openCoursewareTab(request.id);
            else openExampleTab(request.id);
        } catch {}
    });

    loadWidgetDocsIndex().then(async () => {
        if (pendingWidgetType && widgetDocsByType.has(pendingWidgetType)) {
            console.log('[tabs] opening pending widget doc', pendingWidgetType);
            createWidgetDocTab(pendingWidgetType);
            pendingWidgetType = null;
        }
        try {
            const pending = widgetsApi && widgetsApi.getPendingDoc
                ? await widgetsApi.getPendingDoc()
                : await ipcRenderer.invoke('get-pending-widget-doc');
            if (pending) openWidgetTab(pending);
        } catch {}
        if (widgetsApi && widgetsApi.notifyReady) {
            widgetsApi.notifyReady();
        }
    }).catch((err) => {
        console.error('[tabs] loadWidgetDocsIndex failed', err);
    });
})();
