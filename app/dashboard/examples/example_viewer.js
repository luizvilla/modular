// Standalone example viewer logic: render markdown and trigger example actions.
(function () {
    const api = window.api || null;
    const paths = api && api.paths ? api.paths : null;
    const docsApi = api && api.docs ? api.docs : null;
    const systemApi = api && api.system ? api.system : null;
    const dashboardApi = api && api.dashboard ? api.dashboard : null;
    const serialApi = api && api.serial ? api.serial : null;
    const flashApi = api && api.flash ? api.flash : null;
    const examplesApi = api && api.examples ? api.examples : null;
    const extensionsApi = api && api.extensions ? api.extensions : null;

    const { ipcRenderer, shell } = !api && window.require ? window.require('electron') : { ipcRenderer: null, shell: null };
    const fs = !api && window.require ? window.require('fs') : null;
    const path = !api && window.require ? window.require('path') : null;
    const { pathToFileURL } = !api && window.require ? window.require('url') : { pathToFileURL: null };
    const localDir = (typeof __dirname !== 'undefined') ? __dirname : null;
    let extensionBootstrapPromise = null;

    function getDashboardRoot() {
        // Runtime assets moved under app/, so resolve dashboard from app/dashboard.
        if (paths && paths.cwd && paths.join) return paths.join(paths.cwd(), 'app', 'dashboard');
        if (localDir && path) return path.join(localDir, '..');
        return null;
    }

    async function getExtensionBootstrap() {
        if (extensionBootstrapPromise) return extensionBootstrapPromise;
        if (!extensionsApi || typeof extensionsApi.getBootstrap !== 'function') return null;
        extensionBootstrapPromise = extensionsApi.getBootstrap().catch((err) => {
            console.warn('[example_viewer] extension bootstrap failed:', err?.message || err);
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
            : (path && localDir ? path.join(localDir, '..', 'docs', 'examples') : '');
        const dashboardPathRoot = dashboardRoot
            ? (paths && paths.join ? paths.join(dashboardRoot, 'dashboards') : path.join(dashboardRoot, 'dashboards'))
            : (path && localDir ? path.join(localDir, '..', 'dashboards') : '');
        const firmwarePathRoot = dashboardRoot
            ? (paths && paths.join ? paths.join(dashboardRoot, 'binaries') : path.join(dashboardRoot, 'binaries'))
            : (path && localDir ? path.join(localDir, '..', 'binaries') : '');
        return [{ path: docsRoot, dashboardRoot: dashboardPathRoot, firmwareRoot: firmwarePathRoot }];
    }

    const statusBar = document.getElementById('status-bar');
    const titleEl = document.getElementById('example-title');
    const subtitleEl = document.getElementById('example-subtitle');
    const docContent = document.getElementById('doc-content');
    const exampleSelect = document.getElementById('example-select');
    const portSelect = document.getElementById('port-select');
    const loadDashboardBtn = document.getElementById('load-dashboard-btn');
    const uploadFirmwareBtn = document.getElementById('upload-firmware-btn');
    const refreshPortsBtn = document.getElementById('refresh-ports-btn');
    // Progress UI mirrors the Activity Center DFU progress rendering.
    const progressBar = document.getElementById('upload-progress-bar');
    const progressSpinner = document.getElementById('upload-spinner');
    const progressState = document.getElementById('upload-state');
    const progressLabel = document.getElementById('upload-label');

    // Examples are discovered from app/dashboard/docs/examples at runtime.
    const examplesById = new Map();

    let currentExample = null;
    let isUploading = false;
    let uploadCanceled = false;
    let uploadFailed = false;
    let lastProgress = 0;

    // Notify the main process which example is active so it can dock correctly.
    function notifyActiveExample() {
        if (currentExample) {
            if (examplesApi && examplesApi.setActiveExampleId) {
                examplesApi.setActiveExampleId(currentExample.id);
            } else if (ipcRenderer) {
                ipcRenderer.send('example-active-id', { id: currentExample.id });
            }
        }
    }

    function setStatus(message) {
        statusBar.textContent = message;
    }

    // Progress handling mirrors the Activity Center DFU view.
    function setProgress(percent, allowDecrease = false) {
        const clamped = Math.max(0, Math.min(100, percent));
        if (!allowDecrease && clamped < lastProgress) return;
        lastProgress = clamped;
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
        setProgress(0, true);
        progressState.textContent = 'idle';
        progressLabel.textContent = 'No upload running';
        if (progressSpinner) progressSpinner.classList.add('d-none');
        uploadFailed = false;
        lastProgress = 0;
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
        return text
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
            console.warn('[example_viewer] math typeset failed:', err?.message || err);
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
            console.warn('[example_viewer] openExternal failed:', err?.message || err);
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

    // Build example list by scanning dashboard/docs/examples/**/README.md.
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
                } catch {
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

        readmes.sort((a, b) => a.docPath.localeCompare(b.docPath));
        for (const entry of readmes) {
            const dir = paths && paths.dirname ? paths.dirname(entry.docPath) : path.dirname(entry.docPath);
            const relDir = paths && paths.relative
                ? paths.relative(entry.root.path, dir)
                : path.relative(entry.root.path, dir);
            const sep = paths && paths.sep ? paths.sep : path.sep;
            const parts = relDir.split(sep).filter(Boolean);
            const leaf = path && path.basename ? path.basename(dir) : dir.split(sep).slice(-1)[0];
            const id = parts.join('/');
            const board = parts[0] || '';
            const category = parts.slice(1, -1).join(' / ');
            const subtitle = board ? (category ? `${board} - ${category}` : board) : '';
            const label = parts.length ? parts.join(' / ') : leaf;
            const example = {
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
            };
            examplesById.set(id, example);
        }
        return examplesById;
    }

    function populateExampleSelect() {
        exampleSelect.innerHTML = '';
        for (const ex of examplesById.values()) {
            const opt = document.createElement('option');
            opt.value = ex.id;
            opt.textContent = ex.label;
            exampleSelect.appendChild(opt);
        }
    }

    async function loadExample(exampleId) {
        const example = examplesById.get(exampleId) || null;
        if (!example) {
            setStatus('Example not found.');
            docContent.innerHTML = '<p>Example configuration missing.</p>';
            return;
        }
        currentExample = example;
        titleEl.textContent = example.title;
        subtitleEl.textContent = example.subtitle || '';
        notifyActiveExample();
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
        if (!currentExample) return;
        setStatus('Loading dashboard in main window...');
        const res = dashboardApi && dashboardApi.loadDashboardFromPath
            ? await dashboardApi.loadDashboardFromPath(currentExample.dashboardPath)
            : await ipcRenderer.invoke('load-dashboard-from-path', {
                dashboardPath: currentExample.dashboardPath
            });
        if (res && res.ok) {
            setStatus('Dashboard loaded.');
        } else {
            setStatus(`Failed to load dashboard: ${res?.error || 'unknown error'}`);
        }
    }

    async function uploadFirmware() {
        if (isUploading) {
            await cancelUpload();
            return;
        }
        if (!currentExample) return;
        const port = portSelect.value;
        if (!port) {
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
                await flashApi.startFlash({ comPort: port, firmwarePath: currentExample.firmwarePath });
            } else {
                await ipcRenderer.invoke('start-flash', {
                    comPort: port,
                    firmwarePath: currentExample.firmwarePath
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

    if (examplesApi && examplesApi.onExampleSelect) {
        examplesApi.onExampleSelect(({ id } = {}) => {
            if (id && examplesById.has(id)) {
                exampleSelect.value = id;
                loadExample(id);
            }
        });
    } else if (ipcRenderer) {
        ipcRenderer.on('example-select', (_event, { id }) => {
            if (id && examplesById.has(id)) {
                exampleSelect.value = id;
                loadExample(id);
            }
        });
    }

    loadDashboardBtn.addEventListener('click', loadDashboard);
    uploadFirmwareBtn.addEventListener('click', uploadFirmware);
    refreshPortsBtn.addEventListener('click', refreshPorts);
    exampleSelect.addEventListener('change', () => {
        const id = exampleSelect.value;
        if (id) loadExample(id);
    });

    const urlParams = new URLSearchParams(window.location.search);
    const requestedId = urlParams.get('id');
    resetProgress();
    updateUploadButton();
    refreshPorts();
    loadExamplesIndex().then(() => {
        populateExampleSelect();
        const first = exampleSelect.options.length ? exampleSelect.options[0].value : null;
        const initialId = (requestedId && examplesById.has(requestedId)) ? requestedId : first;
        if (initialId) {
            exampleSelect.value = initialId;
            loadExample(initialId);
            notifyActiveExample();
        } else {
            setStatus('No examples found.');
            docContent.innerHTML = '<p>No examples found in dashboard/docs/examples.</p>';
        }
    });
})();
