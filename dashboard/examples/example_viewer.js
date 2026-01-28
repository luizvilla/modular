// Standalone example viewer logic: render markdown and trigger example actions.
(function () {
    const { ipcRenderer } = require('electron');
    const fs = require('fs');
    const path = require('path');
    const { pathToFileURL } = require('url');

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

    // Examples are discovered from dashboard/docs/examples at runtime.
    const examplesById = new Map();

    let currentExample = null;
    let isUploading = false;
    let uploadFailed = false;
    let lastProgress = 0;

    // Notify the main process which example is active so it can dock correctly.
    function notifyActiveExample() {
        if (currentExample) {
            ipcRenderer.send('example-active-id', { id: currentExample.id });
        }
    }

    function setStatus(message) {
        statusBar.textContent = message;
    }

    // Progress handling mirrors the Activity Center DFU view.
    function setProgress(percent) {
        const clamped = Math.max(0, Math.min(100, percent));
        lastProgress = clamped;
        progressBar.style.width = `${clamped}%`;
        progressBar.setAttribute('aria-valuenow', String(clamped));
        progressBar.textContent = `${clamped}%`;
    }

    function resetProgress() {
        progressBar.classList.remove('bg-success', 'bg-danger');
        setProgress(0);
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

    function escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function resolveAssetUrl(rawUrl, baseDir) {
        if (!rawUrl) return rawUrl;
        if (/^(https?:|data:|file:|#)/i.test(rawUrl)) return rawUrl;
        if (path.isAbsolute(rawUrl)) return pathToFileURL(rawUrl).toString();
        return pathToFileURL(path.resolve(baseDir, rawUrl)).toString();
    }

    function renderInline(text, baseDir) {
        let out = escapeHtml(text);
        out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
        out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => {
            const resolved = resolveAssetUrl(url, baseDir);
            return `<img alt="${escapeHtml(alt)}" src="${resolved}">`;
        });
        out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => {
            const resolved = resolveAssetUrl(url, baseDir);
            return `<a href="${resolved}">${label}</a>`;
        });
        out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        return out;
    }

    function renderMarkdownBlocks(lines, baseDir) {
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
                const bodyHtml = renderMarkdownBlocks(bodyLines, baseDir).join('');
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
                const content = renderInline(headingMatch[2], baseDir);
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
                    items.push(`<li>${renderInline(m[1], baseDir)}</li>`);
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
                    items.push(`<li>${renderInline(m[1], baseDir)}</li>`);
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
                html.push(`<p>${renderInline(paragraphLines.join(' '), baseDir)}</p>`);
            }
        }

        return html;
    }

    function renderMarkdown(markdown, baseDir) {
        const lines = markdown.replace(/\r\n/g, '\n').split('\n');
        return renderMarkdownBlocks(lines, baseDir).join('\n');
    }

    // Build example list by scanning dashboard/docs/examples/**/README.md.
    async function loadExamplesIndex() {
        examplesById.clear();
        const baseDir = path.join(__dirname, '..', 'docs', 'examples');

        async function walk(dir) {
            let entries = [];
            try {
                entries = await fs.promises.readdir(dir, { withFileTypes: true });
            } catch {
                return [];
            }
            const results = [];
            for (const entry of entries) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    results.push(...await walk(full));
                } else if (entry.isFile() && entry.name.toLowerCase() === 'readme.md') {
                    results.push(full);
                }
            }
            return results;
        }

        const readmes = await walk(baseDir);
        readmes.sort((a, b) => a.localeCompare(b));
        for (const rm of readmes) {
            const dir = path.dirname(rm);
            const relDir = path.relative(baseDir, dir);
            const parts = relDir.split(path.sep).filter(Boolean);
            const leaf = path.basename(dir);
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
                docPath: rm,
                dashboardPath: path.join(__dirname, '..', 'dashboards', leaf, `${leaf}.json`),
                firmwarePath: path.join(__dirname, '..', 'binaries', leaf, `${leaf}.mcuboot.bin`)
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
            const markdown = await fs.promises.readFile(example.docPath, 'utf8');
            const baseDir = path.dirname(example.docPath);
            docContent.innerHTML = renderMarkdown(markdown, baseDir);
            setStatus('Ready.');
        } catch (err) {
            docContent.innerHTML = `<p>Failed to load documentation: ${escapeHtml(err?.message || String(err))}</p>`;
            setStatus('Failed to load documentation.');
        }
    }

    async function refreshPorts() {
        try {
            const ports = await ipcRenderer.invoke('get-serial-ports');
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
                opt.textContent = port.name || port.value;
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
        const res = await ipcRenderer.invoke('load-dashboard-from-path', {
            dashboardPath: currentExample.dashboardPath
        });
        if (res && res.ok) {
            setStatus('Dashboard loaded.');
        } else {
            setStatus(`Failed to load dashboard: ${res?.error || 'unknown error'}`);
        }
    }

    async function uploadFirmware() {
        if (!currentExample || isUploading) return;
        const port = portSelect.value;
        if (!port) {
            setStatus('Select a target port before uploading.');
            return;
        }
        isUploading = true;
        uploadFirmwareBtn.disabled = true;
        setStatus('Uploading firmware...');
        resetProgress();
        progressLabel.textContent = `Starting upload to ${port}`;
        progressState.textContent = 'flashing';
        if (progressSpinner) progressSpinner.classList.remove('d-none');

        try {
            await ipcRenderer.invoke('start-flash', {
                comPort: port,
                firmwarePath: currentExample.firmwarePath
            });
        } catch (err) {
            setFailure(`Error: ${err?.message || String(err)}`);
            setStatus('Upload failed to start.');
            isUploading = false;
            uploadFirmwareBtn.disabled = false;
        }
    }

    ipcRenderer.on('flash-progress', (_event, message) => {
        const text = String(message || '').trim();
        const match = text.match(/(\d{1,3}(?:\.\d+)?)%/);
        if (/error|failed/i.test(text)) {
            setFailure(text || 'Upload failed');
            return;
        }
        if (match) {
            setProgress(Math.round(parseFloat(match[1])));
        }
    });

    ipcRenderer.on('flash-complete', () => {
        if (uploadFailed) {
            setFailure('Upload failed');
            setStatus('Upload failed.');
        } else {
            setSuccess();
            setStatus('Upload complete.');
        }
        isUploading = false;
        uploadFirmwareBtn.disabled = false;
    });

    ipcRenderer.on('example-select', (_event, { id }) => {
        if (id && examplesById.has(id)) {
            exampleSelect.value = id;
            loadExample(id);
        }
    });

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
