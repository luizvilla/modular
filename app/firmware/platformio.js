const fs = require('fs');
const os = require('os');
const path = require('path');

const { validateFirmwareWorkspaceRoot } = require('./workspace');

const DEFAULT_PLATFORMIO_HOME = path.join(os.homedir(), '.platformio');
const DEFAULT_PLATFORMIO_VENV_PATH = process.platform === 'win32'
    ? path.join(DEFAULT_PLATFORMIO_HOME, 'penv', 'Scripts', 'pio.exe')
    : path.join(DEFAULT_PLATFORMIO_HOME, 'penv', 'bin', 'pio');

function stripIniComment(line) {
    let result = '';
    let quote = null;
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (quote) {
            if (char === quote) quote = null;
            result += char;
            continue;
        }
        if (char === '"' || char === '\'') {
            quote = char;
            result += char;
            continue;
        }
        if (char === ';' || char === '#') {
            const previous = index === 0 ? '' : line[index - 1];
            if (index === 0 || /\s/.test(previous)) break;
        }
        result += char;
    }
    return result.trim();
}

function parseEnvList(value) {
    if (typeof value !== 'string' || !value.trim()) return [];
    const seen = new Set();
    return value
        .split(/[\s,]+/)
        .map((token) => token.trim())
        .filter(Boolean)
        .filter((token) => {
            if (seen.has(token)) return false;
            seen.add(token);
            return true;
        });
}

function parseConfigPathList(value) {
    if (typeof value !== 'string' || !value.trim()) return [];
    const seen = new Set();
    return value
        .split(/\r?\n|,/)
        .map((token) => token.trim())
        .filter(Boolean)
        .filter((token) => {
            if (seen.has(token)) return false;
            seen.add(token);
            return true;
        });
}

function parsePlatformioIni(content) {
    const sections = new Map();
    let currentSection = null;
    let currentKey = null;

    String(content || '')
        .split(/\r?\n/)
        .forEach((rawLine) => {
            const lineWithCommentsRemoved = stripIniComment(rawLine);
            const trimmedLine = lineWithCommentsRemoved.trim();
            if (!trimmedLine) {
                currentKey = null;
                return;
            }

            const sectionMatch = trimmedLine.match(/^\[(.+)]$/);
            if (sectionMatch) {
                currentSection = sectionMatch[1].trim();
                if (!sections.has(currentSection)) sections.set(currentSection, new Map());
                currentKey = null;
                return;
            }

            const kvMatch = trimmedLine.match(/^([^=:#]+?)\s*(=|:)\s*(.*)$/);
            if (kvMatch && currentSection) {
                const key = kvMatch[1].trim().toLowerCase();
                const value = kvMatch[3].trim();
                if (!key) return;
                sections.get(currentSection).set(key, value);
                currentKey = key;
                return;
            }

            if (currentSection && currentKey && /^\s+/.test(rawLine)) {
                const previousValue = sections.get(currentSection).get(currentKey) || '';
                const continuationValue = trimmedLine;
                sections.get(currentSection).set(
                    currentKey,
                    previousValue ? `${previousValue}\n${continuationValue}` : continuationValue
                );
                return;
            }

            currentKey = null;
        });

    const envs = Array.from(sections.keys())
        .filter((sectionName) => sectionName.toLowerCase().startsWith('env:'))
        .map((sectionName) => sectionName.slice(4))
        .filter(Boolean);

    const platformioSection = sections.get('platformio') || new Map();
    const defaultEnvs = parseEnvList(platformioSection.get('default_envs') || '');
    const extraConfigs = parseConfigPathList(platformioSection.get('extra_configs') || '');
    const selectedEnv = selectPlatformioEnv({ envs, defaultEnvs }, null);

    return {
        envs,
        defaultEnvs,
        extraConfigs,
        selectedEnv,
        sections,
    };
}

function selectPlatformioEnv(config, selectedEnv) {
    const envs = Array.isArray(config?.envs) ? config.envs : [];
    if (!envs.length) return null;
    if (selectedEnv && envs.includes(selectedEnv)) return selectedEnv;

    const defaultEnvs = Array.isArray(config?.defaultEnvs) ? config.defaultEnvs : [];
    const preferred = defaultEnvs.find((envName) => envs.includes(envName));
    return preferred || envs[0];
}

function readPlatformioProjectConfig(workspaceRoot) {
    const normalizedRoot = validateFirmwareWorkspaceRoot(workspaceRoot);
    const configPath = path.join(normalizedRoot, 'platformio.ini');
    const mergedSections = new Map();
    const configPaths = [];
    const visitedPaths = new Set();

    function mergeSections(nextSections) {
        nextSections.forEach((entries, sectionName) => {
            if (!mergedSections.has(sectionName)) {
                mergedSections.set(sectionName, new Map());
            }
            const targetSection = mergedSections.get(sectionName);
            entries.forEach((value, key) => {
                targetSection.set(key, value);
            });
        });
    }

    function visitConfig(nextConfigPath) {
        const absoluteConfigPath = path.resolve(nextConfigPath);
        if (visitedPaths.has(absoluteConfigPath)) return;
        visitedPaths.add(absoluteConfigPath);

        const content = fs.readFileSync(absoluteConfigPath, 'utf8');
        const parsed = parsePlatformioIni(content);
        configPaths.push(absoluteConfigPath);
        mergeSections(parsed.sections);

        parsed.extraConfigs.forEach((extraConfigPath) => {
            const resolvedExtraConfigPath = path.resolve(path.dirname(absoluteConfigPath), extraConfigPath);
            if (!fs.existsSync(resolvedExtraConfigPath)) return;
            if (!fs.statSync(resolvedExtraConfigPath).isFile()) return;
            visitConfig(resolvedExtraConfigPath);
        });
    }

    visitConfig(configPath);
    const platformioSection = mergedSections.get('platformio') || new Map();
    const envs = Array.from(mergedSections.keys())
        .filter((sectionName) => sectionName.toLowerCase().startsWith('env:'))
        .map((sectionName) => sectionName.slice(4))
        .filter(Boolean);
    const defaultEnvs = parseEnvList(platformioSection.get('default_envs') || '');

    return {
        workspaceRoot: normalizedRoot,
        configPath,
        configPaths,
        defaultEnvs,
        envs,
        sections: mergedSections,
        selectedEnv: selectPlatformioEnv({ envs, defaultEnvs }, null),
    };
}

module.exports = {
    DEFAULT_PLATFORMIO_HOME,
    DEFAULT_PLATFORMIO_VENV_PATH,
    parseConfigPathList,
    parseEnvList,
    parsePlatformioIni,
    readPlatformioProjectConfig,
    selectPlatformioEnv,
    stripIniComment,
};
