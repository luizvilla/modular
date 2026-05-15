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

    function getDashboardRoot() {
        // Runtime assets moved under app/, so resolve dashboard from app/dashboard.
        if (paths && paths.appDir && paths.join) return paths.join(paths.appDir(), 'dashboard');
        if (paths && paths.cwd && paths.join) return paths.join(paths.cwd(), 'app', 'dashboard');
        if (localDir && path) return path.join(localDir, '..');
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
        const dashboardRoot = getDashboardRoot();
        const docsRoot = dashboardRoot
            ? (paths && paths.join ? paths.join(dashboardRoot, 'docs', 'examples') : path.join(dashboardRoot, 'docs', 'examples'))
            : (path && localDir ? path.join(localDir, 'docs', 'examples') : '');
        const dashboardPathRoot = dashboardRoot
            ? (paths && paths.join ? paths.join(dashboardRoot, 'dashboards') : path.join(dashboardRoot, 'dashboards'))
            : (path && localDir ? path.join(localDir, 'dashboards') : '');
        const firmwarePathRoot = dashboardRoot
            ? (paths && paths.join ? paths.join(dashboardRoot, 'binaries') : path.join(dashboardRoot, 'binaries'))
            : (path && localDir ? path.join(localDir, 'binaries') : '');
        return [{ path: docsRoot, dashboardRoot: dashboardPathRoot, firmwareRoot: firmwarePathRoot }];
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
    const tabs = new Map(); // id -> { id, type, exampleId, button }
    const examplesById = new Map();
    const widgetDocsByType = new Map();
    let activeTabId = dashboardTabId;
    let pendingOpenId = null;
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
    let dockPreviewExampleId = null;

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

    function updateUploadButton() {
        if (!uploadFirmwareBtn) return;
        uploadFirmwareBtn.disabled = false;
        uploadFirmwareBtn.textContent = isUploading ? 'Cancel upload' : 'Upload example to target';
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
        const base = String(port.name || port.value || '');
        if (!port.isOwntech) return base;
        return base.includes('(OwnTech)') ? base : `${base} (OwnTech)`;
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

        console.log('[tabs] README count:', readmes.length);
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
                title: leaf,
                subtitle,
                label,
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
        const sources = await getWidgetDocsSources();
        const thingsetEnabled = bootstrap
            ? true
            : !(api && api.flags && api.flags.thingset === false);

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
                    if (!thingsetEnabled && entry.requiresThingset) return;
                    const docPath = (paths && paths.join) ? paths.join(source.path, entry.doc) : path.join(source.path, entry.doc);
                    widgetDocsByType.set(entry.type, {
                        type: entry.type,
                        title: entry.title || entry.type,
                        category: entry.category || '',
                        docPath,
                        requiresThingset: !!entry.requiresThingset
                    });
                });
            } catch (err) {
                console.warn('[tabs] widget docs parse failed:', err?.message || err);
            }
        }
        console.log('[tabs] widget docs loaded:', widgetDocsByType.size);
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

    function populateExampleSelect() {
        // Build a tree-like dropdown using optgroups to mirror the menu structure.
        exampleSelect.innerHTML = '';
        const grouped = new Map();
        for (const ex of examplesById.values()) {
            const parts = ex.id.split('/').filter(Boolean);
            const root = parts[0] || 'Examples';
            const label = parts.slice(1).join(' / ') || ex.title || ex.id;
            if (!grouped.has(root)) grouped.set(root, []);
            grouped.get(root).push({ ...ex, menuLabel: label });
        }
        const roots = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));
        for (const root of roots) {
            const group = document.createElement('optgroup');
            group.label = root;
            const items = grouped.get(root).slice().sort((a, b) => a.menuLabel.localeCompare(b.menuLabel));
            for (const ex of items) {
                const opt = document.createElement('option');
                opt.value = ex.id;
                opt.textContent = ex.menuLabel;
                group.appendChild(opt);
            }
            exampleSelect.appendChild(group);
        }
        console.log(`[tabs] example list populated (${examplesById.size})`);
    }

    async function loadExample(exampleId) {
        const example = examplesById.get(exampleId);
        if (!example) {
            setStatus('Example not found.');
            docContent.innerHTML = '<p>Example configuration missing.</p>';
            console.warn('[tabs] loadExample: missing example', exampleId);
            return;
        }
        console.log('[tabs] loadExample:', exampleId);
        docTitle.textContent = example.title;
        docSubtitle.textContent = example.subtitle || '';
        setStatus('Loading documentation...');
        try {
            const markdown = docsApi && docsApi.readMarkdown
                ? await docsApi.readMarkdown(example.docPath)
                : await fs.promises.readFile(example.docPath, 'utf8');
            const baseDir = paths && paths.dirname ? paths.dirname(example.docPath) : path.dirname(example.docPath);
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
        const tab = tabs.get(activeTabId);
        if (!tab || !tab.exampleId) return;
        const example = examplesById.get(tab.exampleId);
        if (!example) return;
        setStatus('Loading dashboard in main window...');
        const res = dashboardApi && dashboardApi.loadDashboardFromPath
            ? await dashboardApi.loadDashboardFromPath(example.dashboardPath)
            : await ipcRenderer.invoke('load-dashboard-from-path', { dashboardPath: example.dashboardPath });
        if (res && res.ok) {
            setStatus('Dashboard loaded.');
        } else {
            setStatus(`Failed to load dashboard: ${res?.error || 'unknown error'}`);
        }
    }

    async function uploadFirmware() {
        const tab = tabs.get(activeTabId);
        if (isUploading) {
            await cancelUpload();
            return;
        }
        if (!tab || !tab.exampleId) return;
        const example = examplesById.get(tab.exampleId);
        const port = portSelect.value;
        if (!example || !port) {
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
                await flashApi.startFlash({ comPort: port, firmwarePath: example.firmwarePath });
            } else {
                await ipcRenderer.invoke('start-flash', {
                    comPort: port,
                    firmwarePath: example.firmwarePath
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
        if (tabId === dashboardTabId) {
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
                const tabsEl = document.getElementById('app-tabs');
                const tabsOffset = tabsEl ? tabsEl.offsetHeight : 0;
                const adminBar = document.getElementById('admin-bar');
                const barHeight = adminBar ? adminBar.offsetHeight : 0;
                const editing = (window.freeboard && typeof window.freeboard.isEditing === 'function')
                    ? window.freeboard.isEditing()
                    : null;
                const top = (editing === false)
                    ? tabsOffset + 20
                    : tabsOffset + barHeight + 20;
                boardContent.style.top = `${top}px`;
                boardContent.style.minHeight = `calc(100vh - ${tabsOffset}px)`;
                boardContent.style.height = 'auto';
                console.log('[tabs] board-content top reset:', { tabsOffset, barHeight, top });
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
        if (tab && tab.type === 'doc' && tab.exampleId) {
            setDocMode('example');
            exampleSelect.value = tab.exampleId;
            loadExample(tab.exampleId);
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
        if (dockPreviewExampleId) {
            const existing = tabs.get(`doc:${dockPreviewExampleId}`);
            if (existing) existing.button.classList.remove('dock-preview');
        }
        if (dockPreviewTab) {
            dockPreviewTab.remove();
            dockPreviewTab = null;
        }
        dockPreviewExampleId = null;
    }

    function showDockPreview(exampleId) {
        if (!exampleId) {
            clearDockPreview();
            return;
        }
        if (dockPreviewExampleId === exampleId) return;
        clearDockPreview();
        dockPreviewExampleId = exampleId;
        const existing = tabs.get(`doc:${exampleId}`);
        if (existing) {
            existing.button.classList.add('dock-preview');
            return;
        }
        const example = examplesById.get(exampleId);
        const label = example ? example.title : exampleId;
        const btn = document.createElement('button');
        btn.className = 'tab tab-dock-preview';
        btn.textContent = label;
        btn.disabled = true;
        btn.setAttribute('aria-disabled', 'true');
        btn.dataset.previewId = exampleId;
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

    function createDocTab(exampleId) {
        const id = `doc:${exampleId}`;
        if (tabs.has(id)) {
            setActiveTab(id);
            return;
        }
        if (dockPreviewExampleId === exampleId) {
            clearDockPreview();
        }
        const example = examplesById.get(exampleId);
        const label = example ? example.title : exampleId;
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
                if (examplesApi && examplesApi.undockDocTab) examplesApi.undockDocTab(exampleId);
                else ipcRenderer.send('undock-doc-tab', { id: exampleId });
                closeTab(id);
            }
        });

        tabs.set(id, { id, type: 'doc', exampleId, button: btn });
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

    function updateActiveTabExample(exampleId) {
        const tab = tabs.get(activeTabId);
        if (!tab || tab.type !== 'doc') return;
        tab.exampleId = exampleId;
        const example = examplesById.get(exampleId);
        if (example) {
            tab.button.childNodes[0].nodeValue = example.title;
        }
        loadExample(exampleId);
    }

    function openExampleTab(exampleId) {
        if (examplesById.has(exampleId)) {
            createDocTab(exampleId);
        } else {
            pendingOpenId = exampleId;
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
        exampleId: null,
        button: tabStrip.querySelector('[data-tab-id="dashboard"]')
    });
    const dashboardButton = tabs.get(dashboardTabId).button;
    if (dashboardButton) {
        dashboardButton.addEventListener('click', () => {
            console.log('[tabs] dashboard tab clicked');
            setActiveTab(dashboardTabId);
        });
        console.log('[tabs] dashboard tab wired');
    } else {
        console.warn('[tabs] dashboard tab button missing');
    }

    exampleSelect.addEventListener('change', () => {
        const id = exampleSelect.value;
        if (id) updateActiveTabExample(id);
    });
    loadDashboardBtn.addEventListener('click', loadDashboard);
    uploadFirmwareBtn.addEventListener('click', uploadFirmware);
    refreshPortsBtn.addEventListener('click', refreshPorts);
    updateUploadButton();

    if (examplesApi && examplesApi.onOpenExampleTab) {
        examplesApi.onOpenExampleTab(({ id } = {}) => {
            console.log('[tabs] open-example-tab IPC:', id);
            if (id) openExampleTab(id);
        });
    } else if (ipcRenderer) {
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
    if (examplesApi && examplesApi.onDockPreview) {
        examplesApi.onDockPreview(({ id, active } = {}) => {
            if (active) showDockPreview(id);
            else clearDockPreview();
        });
    } else if (ipcRenderer) {
        ipcRenderer.on('example-dock-preview', (_e, { id, active }) => {
            if (active) showDockPreview(id);
            else clearDockPreview();
        });
    }

    resetProgress();
    refreshPorts();
    loadExamplesIndex().then(() => {
        console.log('[tabs] loadExamplesIndex complete');
        populateExampleSelect();
        if (pendingOpenId && examplesById.has(pendingOpenId)) {
            console.log('[tabs] opening pending example', pendingOpenId);
            createDocTab(pendingOpenId);
            pendingOpenId = null;
        }
    }).catch((err) => {
        console.error('[tabs] loadExamplesIndex failed', err);
    }).finally(async () => {
        try {
            const pending = examplesApi && examplesApi.getPendingExampleTab
                ? await examplesApi.getPendingExampleTab()
                : await ipcRenderer.invoke('get-pending-example-tab');
            if (pending) openExampleTab(pending);
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
