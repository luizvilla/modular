(function () {
    const api = window.api || null;
    const pathApi = api?.paths || null;
    const fileApi = api?.files || null;

    function defaultCsvDirectory() {
        return pathApi?.cwd ? pathApi.cwd() : '';
    }

    function normalizePath(value) {
        return String(value || '').trim();
    }

    function parseAxisBound(value) {
        if (value === null || value === undefined || value === '') return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function hashText(text) {
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16);
    }

    function detectDelimiter(text) {
        const sample = String(text || '').split(/\r?\n/, 1)[0] || '';
        const delimiters = [':', ',', ';', '\t'];
        let best = ',';
        let bestCount = -1;
        delimiters.forEach((delimiter) => {
            const count = sample.split(delimiter).length - 1;
            if (count > bestCount) {
                best = delimiter;
                bestCount = count;
            }
        });
        return best;
    }

    function parseCsvText(text, delimiter = ',') {
        const rows = [];
        let current = [];
        let field = '';
        let inQuotes = false;

        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (text[i + 1] === '"') {
                        field += '"';
                        i++;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    field += ch;
                }
                continue;
            }
            if (ch === '"') {
                inQuotes = true;
                continue;
            }
            if (ch === delimiter) {
                current.push(field);
                field = '';
                continue;
            }
            if (ch === '\n') {
                current.push(field);
                rows.push(current);
                current = [];
                field = '';
                continue;
            }
            if (ch !== '\r') field += ch;
        }

        if (field.length || current.length) {
            current.push(field);
            rows.push(current);
        }
        return rows;
    }

    function buildCsvDataset(text) {
        const source = String(text || '');
        const rows = parseCsvText(source, detectDelimiter(source));
        if (!rows.length) return { headers: [], rows: [], columns: {} };

        const headers = rows[0].map((value, index) => normalizePath(value) || `column_${index + 1}`);
        const body = rows.slice(1).filter(row => row.some(cell => normalizePath(cell) !== ''));
        const columns = Object.fromEntries(headers.map(header => [header, []]));

        body.forEach((row) => {
            headers.forEach((header, colIndex) => {
                const raw = normalizePath(row[colIndex]);
                const numeric = raw === '' ? null : Number(raw);
                columns[header].push(Number.isFinite(numeric) ? numeric : null);
            });
        });

        if (columns.duty_cycle && columns.V_high && !columns.V_Low_estim) {
            columns.V_Low_estim = columns.duty_cycle.map((value, idx) => {
                const duty = Number(value);
                const high = Number(columns.V_high[idx]);
                return Number.isFinite(duty) && Number.isFinite(high) ? duty * high : null;
            });
            headers.push('V_Low_estim');
        }

        return { headers, rows: body, columns };
    }

    async function listCsvFiles(directory) {
        const dir = normalizePath(directory) || defaultCsvDirectory();
        if (!dir || !fileApi?.listDir) return [];
        try {
            const names = await fileApi.listDir(dir);
            return (Array.isArray(names) ? names : [])
                .filter(name => /\.csv$/i.test(name))
                .sort((a, b) => a.localeCompare(b))
                .map(name => pathApi?.join ? pathApi.join(dir, name) : `${dir}/${name}`);
        } catch {
            return [];
        }
    }

    async function loadCsvDataset(filePath, lastSignature) {
        const path = normalizePath(filePath);
        if (!path || !fileApi?.readText) {
            return { dataset: null, signature: '', changed: false };
        }
        try {
            const text = await fileApi.readText(path);
            const signature = `${text.length}:${hashText(text)}`;
            if (signature === lastSignature) {
                return { dataset: null, signature, changed: false };
            }
            return {
                dataset: buildCsvDataset(text),
                signature,
                changed: true
            };
        } catch {
            return { dataset: null, signature: '', changed: true };
        }
    }

    function displayPath(filePath) {
        const cwd = defaultCsvDirectory();
        if (cwd && pathApi?.relative) {
            const rel = pathApi.relative(cwd, filePath);
            if (rel && !rel.startsWith('..')) return rel;
        }
        return filePath;
    }

    function getCsvSourceMode(settings) {
        const mode = String(settings?.csvSourceMode || 'fixed').trim().toLowerCase();
        return mode === 'latest' ? 'latest' : 'fixed';
    }

    function selectLatestCsvPath(files) {
        const list = Array.isArray(files) ? files.filter(Boolean) : [];
        if (!list.length) return '';
        const timestamped = list.filter((filePath) => {
            const name = String(filePath).split(/[\\/]/).pop() || '';
            return /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-.+\.csv$/i.test(name);
        });
        const preferred = timestamped.length ? timestamped : list;
        return preferred
            .slice()
            .sort((a, b) => String(a).localeCompare(String(b)))
            .pop() || '';
    }

    function resolveCsvSource(settings, files) {
        const mode = getCsvSourceMode(settings);
        const explicitPath = normalizePath(settings?.csvPath);
        if (mode === 'latest') {
            const latestPath = selectLatestCsvPath(files);
            return {
                mode,
                filePath: latestPath || explicitPath,
                fallbackPath: explicitPath
            };
        }
        return {
            mode,
            filePath: explicitPath,
            fallbackPath: explicitPath
        };
    }

    function widgetTitle(widget) {
        let title = widget?.settings?.().title;
        if (typeof title === 'function') title = title();
        return title || '';
    }

    function listWidgetsByType(types) {
        const model = freeboard.getLiveModel?.();
        if (!model || typeof model.panes !== 'function') return [];
        const wanted = new Set(Array.isArray(types) ? types : [types]);
        const out = [];
        model.panes().forEach(pane => pane.widgets().forEach(widget => {
            if (wanted.has(widget.type())) {
                const title = widgetTitle(widget);
                if (title) out.push({ title, type: widget.type(), widget });
            }
        }));
        return out;
    }

    function findWidgetByTitle(title, types) {
        return listWidgetsByType(types).find(entry => entry.title === title)?.widget || null;
    }

    function updateWidgetSettings(widget, partial) {
        if (!widget) return;
        const updated = { ...widget.settings(), ...partial };
        widget.settings(updated);
        widget.widgetInstance?.onSettingsChanged(updated);
    }

    function normalizeSeriesDefs(settings, columns) {
        const available = Array.isArray(columns) ? columns : [];
        const defs = Array.isArray(settings?.seriesDefs) ? settings.seriesDefs.slice() : [];
        if (!defs.length && settings?.yVariable && available.includes(settings.yVariable)) {
            defs.push({
                variable: settings.yVariable,
                label: settings.yVariable,
                color: '#4e79a7',
                visible: true
            });
        }
        return defs
            .filter(def => def && def.variable && available.includes(def.variable))
            .map((def, index) => ({
                variable: def.variable,
                label: def.label || def.variable,
                color: def.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length],
                visible: def.visible !== false
            }));
    }

    const DEFAULT_COLORS = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc949'];

    window.FastFrameShared = {
        api,
        pathApi,
        fileApi,
        DEFAULT_COLORS,
        defaultCsvDirectory,
        normalizePath,
        parseAxisBound,
        detectDelimiter,
        buildCsvDataset,
        listCsvFiles,
        loadCsvDataset,
        displayPath,
        getCsvSourceMode,
        selectLatestCsvPath,
        resolveCsvSource,
        listWidgetsByType,
        findWidgetByTitle,
        updateWidgetSettings,
        normalizeSeriesDefs
    };
}());
