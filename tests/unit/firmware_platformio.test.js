const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    DEFAULT_PLATFORMIO_HOME,
    DEFAULT_PLATFORMIO_VENV_PATH,
    parseConfigPathList,
    parseEnvList,
    parsePlatformioIni,
    readPlatformioProjectConfig,
    resolvePlatformioActionArgs,
    selectPlatformioEnv,
    stripIniComment,
} = require('../../app/firmware/platformio');

function runParserTests() {
    assert.deepStrictEqual(parseEnvList('USB, SIM debug'), ['USB', 'SIM', 'debug']);
    assert.deepStrictEqual(parseConfigPathList('owntech/pio_extra.ini\nsrc/app.ini'), ['owntech/pio_extra.ini', 'src/app.ini']);
    assert.strictEqual(stripIniComment('default_envs = USB ; comment'), 'default_envs = USB');
    assert.strictEqual(stripIniComment('# comment only'), '');

    const parsed = parsePlatformioIni(`
[platformio]
default_envs = USB, SIM
extra_configs =
  owntech/pio_extra.ini
  src/app.ini

[env:USB]
platform = native

[env:SIM]
platform = native ; inline comment
`);

    assert.deepStrictEqual(parsed.envs, ['USB', 'SIM']);
    assert.deepStrictEqual(parsed.defaultEnvs, ['USB', 'SIM']);
    assert.deepStrictEqual(parsed.extraConfigs, ['owntech/pio_extra.ini', 'src/app.ini']);
    assert.strictEqual(parsed.selectedEnv, 'USB');
    assert.strictEqual(selectPlatformioEnv(parsed, 'SIM'), 'SIM');
    assert.strictEqual(selectPlatformioEnv(parsed, 'MISSING'), 'USB');
    assert.strictEqual(DEFAULT_PLATFORMIO_HOME.endsWith('.platformio'), true);
    assert.strictEqual(typeof DEFAULT_PLATFORMIO_VENV_PATH, 'string');
    assert.deepStrictEqual(resolvePlatformioActionArgs('build', 'USB'), ['run', '-e', 'USB']);
    assert.deepStrictEqual(resolvePlatformioActionArgs('upload', 'USB'), ['run', '-e', 'USB', '-t', 'upload']);
    assert.deepStrictEqual(resolvePlatformioActionArgs('clean', 'USB'), ['run', '-e', 'USB', '-t', 'clean']);
    assert.deepStrictEqual(resolvePlatformioActionArgs('reindex', 'USB'), ['run', '-e', 'USB', '-t', 'compiledb']);
    assert.throws(() => resolvePlatformioActionArgs('upload', ''), /environment is selected/i);
    assert.throws(() => resolvePlatformioActionArgs('flash', 'USB'), /Unsupported firmware build action/i);
}

function runConfigReadTest() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modular-firmware-platformio-'));
    try {
        fs.mkdirSync(path.join(tempRoot, 'src'), { recursive: true });
        fs.mkdirSync(path.join(tempRoot, 'owntech'), { recursive: true });
        fs.writeFileSync(path.join(tempRoot, 'src', 'main.cpp'), 'int main() { return 0; }\n', 'utf8');
        fs.writeFileSync(path.join(tempRoot, 'platformio.ini'), `
[platformio]
default_envs = USB
extra_configs =
  owntech/pio_extra.ini
  src/app.ini

`, 'utf8');
        fs.writeFileSync(path.join(tempRoot, 'owntech', 'pio_extra.ini'), `
[env:USB]
platform = native

[env:LAB]
platform = native
`, 'utf8');
        fs.writeFileSync(path.join(tempRoot, 'src', 'app.ini'), `
[custom]
mode = test
`, 'utf8');

        const project = readPlatformioProjectConfig(tempRoot);
        assert.deepStrictEqual(project.envs, ['USB', 'LAB']);
        assert.deepStrictEqual(project.defaultEnvs, ['USB']);
        assert.strictEqual(project.selectedEnv, 'USB');
        assert.strictEqual(project.configPath, path.join(tempRoot, 'platformio.ini'));
        assert.deepStrictEqual(
            project.configPaths.map((entry) => path.relative(tempRoot, entry)).sort(),
            ['owntech/pio_extra.ini', 'platformio.ini', 'src/app.ini']
        );
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

runParserTests();
runConfigReadTest();
console.log('All firmware PlatformIO helper tests passed.');
