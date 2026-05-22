const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, fixturePath } = require('./helpers');

function makeTempFirmwareWorkspace() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modular-firmware-e2e-'));
  const fixtureRoot = fixturePath('firmware_workspace');
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const userDataRoot = path.join(tempRoot, 'userData');
  const fakePioPath = path.join(tempRoot, 'fake-pio.sh');
  const fakeClangdPath = path.join(tempRoot, 'fake-clangd.js');
  fs.cpSync(fixtureRoot, workspaceRoot, { recursive: true });
  fs.writeFileSync(fakePioPath, `#!/usr/bin/env bash
set -eu

if [[ "\${1:-}" == "--version" ]]; then
  echo "PlatformIO Core, version 6.9.9-test"
  exit 0
fi

target="build"
env_name=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    run)
      shift
      ;;
    -e)
      env_name="$2"
      shift 2
      ;;
    -t)
      target="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

echo "fake-pio target=$target env=$env_name cwd=$PWD"

if [[ "$target" == "clean" ]]; then
  trap 'echo "fake-pio clean canceled for $env_name"; exit 130' TERM INT
  echo "waiting for cancel on $env_name"
  while true; do
    sleep 1
  done
fi

if [[ "$target" == "compiledb" ]]; then
  mkdir -p ".pio/build/$env_name"
  printf '[]\\n' > ".pio/build/$env_name/compile_commands.json"
  echo "compiledb ready for $env_name"
  exit 0
fi

if [[ "$target" == "upload" ]]; then
  echo "upload complete for $env_name"
  exit 0
fi

echo "build complete for $env_name"
`, 'utf8');
  fs.chmodSync(fakePioPath, 0o755);
  fs.writeFileSync(fakeClangdPath, `#!/usr/bin/env node
const path = require('path');

let buffer = Buffer.alloc(0);
const documents = new Map();

function send(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  process.stdout.write(\`Content-Length: \${payload.length}\\r\\n\\r\\n\`);
  process.stdout.write(payload);
}

function publishDiagnostics(uri, version, text) {
  const diagnostics = text.includes('BROKEN_SYMBOL')
    ? [{
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 12 } },
        severity: 1,
        source: 'fake-clangd',
        message: 'BROKEN_SYMBOL is not declared',
      }]
    : [{
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 8 } },
        severity: 2,
        source: 'fake-clangd',
        message: 'fixture diagnostic',
      }];
  send({
    jsonrpc: '2.0',
    method: 'textDocument/publishDiagnostics',
    params: { uri, version, diagnostics },
  });
}

function rememberDocument(textDocument) {
  if (!textDocument || !textDocument.uri) return;
  documents.set(textDocument.uri, {
    text: String(textDocument.text || ''),
    version: Number(textDocument.version || 1),
  });
  publishDiagnostics(textDocument.uri, Number(textDocument.version || 1), String(textDocument.text || ''));
}

function updateDocument(params) {
  const uri = params?.textDocument?.uri;
  if (!uri) return;
  const current = documents.get(uri) || { text: '', version: 0 };
  const nextText = String(params?.contentChanges?.[0]?.text || current.text || '');
  const nextVersion = Number(params?.textDocument?.version || current.version + 1);
  documents.set(uri, { text: nextText, version: nextVersion });
  publishDiagnostics(uri, nextVersion, nextText);
}

function handle(message) {
  switch (message.method) {
    case 'initialize':
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          capabilities: {
            textDocumentSync: 2,
            completionProvider: { triggerCharacters: ['.', ':', '>'] },
            hoverProvider: true,
            definitionProvider: true,
          },
        },
      });
      return;
    case 'initialized':
      return;
    case 'textDocument/didOpen':
      rememberDocument(message.params?.textDocument);
      return;
    case 'textDocument/didChange':
      updateDocument(message.params);
      return;
    case 'textDocument/completion':
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          isIncomplete: false,
          items: [{
            label: 'fixture_driver_value',
            kind: 3,
            detail: 'int fixture_driver_value()',
            documentation: {
              kind: 'markdown',
              value: 'Returns the fixture driver value.',
            },
          }],
        },
      });
      return;
    case 'textDocument/hover':
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          contents: [{
            kind: 'markdown',
            value: '### fixture_driver_value\\n\\nint fixture_driver_value()',
          }],
          range: {
            start: { line: 2, character: 4 },
            end: { line: 2, character: 24 },
          },
        },
      });
      return;
    case 'textDocument/definition': {
      const headerPath = path.join(process.cwd(), 'owntech', 'include', 'mock_driver.hpp');
      const headerUri = new URL('file://' + headerPath).toString();
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: [{
          uri: headerUri,
          range: {
            start: { line: 1, character: 0 },
            end: { line: 3, character: 1 },
          },
        }],
      });
      return;
    }
    case 'shutdown':
      send({ jsonrpc: '2.0', id: message.id, result: null });
      return;
    case 'exit':
      process.exit(0);
      return;
    default:
      if (Object.prototype.hasOwnProperty.call(message, 'id')) {
        send({ jsonrpc: '2.0', id: message.id, result: null });
      }
  }
}

function parseMessages() {
  while (buffer.length > 0) {
    const boundary = buffer.indexOf('\\r\\n\\r\\n');
    if (boundary === -1) return;
    const header = buffer.slice(0, boundary).toString('utf8');
    const match = header.match(/Content-Length:\\s*(\\d+)/i);
    if (!match) {
      throw new Error('Missing Content-Length header');
    }
    const length = Number.parseInt(match[1], 10);
    const start = boundary + 4;
    const end = start + length;
    if (buffer.length < end) return;
    const body = buffer.slice(start, end).toString('utf8');
    buffer = buffer.slice(end);
    if (!body.trim()) continue;
    handle(JSON.parse(body));
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  parseMessages();
});
`, 'utf8');
  fs.chmodSync(fakeClangdPath, 0o755);
  return { tempRoot, workspaceRoot, userDataRoot, fakePioPath, fakeClangdPath };
}

async function openFirmwareWindow(app) {
  const firmwareWindowPromise = app.waitForEvent('window');
  await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const fileMenu = menu && menu.items.find((item) => item.label === 'File');
    const action = fileMenu && fileMenu.submenu.items.find((item) => item.label === 'Firmware Workspace');
    if (!action) throw new Error('Firmware Workspace menu item not found');
    action.click();
  });
  const firmwarePage = await firmwareWindowPromise;
  await firmwarePage.waitForLoadState('domcontentloaded');
  await expect(firmwarePage.locator('[data-testid="firmware-shell"]')).toBeVisible();
  return firmwarePage;
}

test('firmware workspace attach/edit flow persists across relaunch', async ({}, testInfo) => {
  testInfo.setTimeout(90_000);
  const temp = makeTempFirmwareWorkspace();
  const env = {
    MODULAR_USER_DATA_DIR: temp.userDataRoot,
    MODULAR_FIRMWARE_PIO_PATH: temp.fakePioPath,
  };

  let app;
  let errors = [];

  try {
    const firstLaunch = await launchApp(env);
    app = firstLaunch.app;
    errors = firstLaunch.errors;
    const page = firstLaunch.page;
    await waitForDashboard(page);

    let firmwarePage = await openFirmwareWindow(app);
    firmwarePage.on('pageerror', (err) => errors.push(err));
    firmwarePage.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      errors.push(new Error(msg.text() || 'console.error'));
    });

    const attachResult = await firmwarePage.evaluate((workspaceRoot) => {
      return window.api.firmwareWorkspace.attachExistingWorkspace(workspaceRoot);
    }, temp.workspaceRoot);
    expect(attachResult.ok).toBe(true);

    await firmwarePage.reload();
    await firmwarePage.waitForLoadState('domcontentloaded');
    await expect(firmwarePage.locator('[data-testid="firmware-root"]')).toContainText(temp.workspaceRoot);
    await expect(firmwarePage.locator('[data-testid="firmware-action-build"]')).toBeEnabled();
    await expect(firmwarePage.locator('[data-testid="firmware-env-select"]')).toHaveValue('USB');
    await expect.poll(async () => {
      return firmwarePage.evaluate(() => window.__firmwareWorkspaceRuntime?.isMonacoReady() || false);
    }).toBe(true);

    await expect.poll(async () => {
      return firmwarePage.evaluate(() => window.__firmwareWorkspaceRuntime?.getEditorValue() || '');
    }).toContain('fixture workspace');

    await firmwarePage.locator('[data-testid="firmware-file-list"]').getByText('src/app.ini').click();

    await expect.poll(async () => {
      return firmwarePage.evaluate(() => window.__firmwareWorkspaceRuntime?.getOpenTabs() || []);
    }).toEqual(['src/main.cpp', 'src/app.ini']);

    await expect.poll(async () => {
      return firmwarePage.evaluate(() => window.__firmwareWorkspaceRuntime?.getActiveTab() || '');
    }).toBe('src/app.ini');

    await firmwarePage.locator('[data-testid="firmware-file-list"]').getByText('src/main.cpp').click();

    const updatedContent = '#include <iostream>\n\nint main() {\n    std::cout << "session 2 save" << std::endl;\n    return 0;\n}\n';
    const wrote = await firmwarePage.evaluate((content) => {
      return window.__firmwareWorkspaceRuntime?.setEditorValue(content) || false;
    }, updatedContent);
    expect(wrote).toBe(true);
    await firmwarePage.locator('[data-testid="firmware-action-save"]').click();
    await expect(firmwarePage.locator('#file-status-chip')).toContainText('src/main.cpp');

    const savedContent = fs.readFileSync(path.join(temp.workspaceRoot, 'src', 'main.cpp'), 'utf8');
    expect(savedContent).toBe(updatedContent);

    await firmwarePage.locator('[data-testid="firmware-action-advanced"]').click();
    await expect(firmwarePage.locator('[data-testid="firmware-file-list"]')).toContainText('owntech/include/mock_driver.hpp');
    await expect(firmwarePage.locator('[data-testid="firmware-file-list"]')).toContainText('zephyr/app.overlay');

    await app.close();

    const secondLaunch = await launchApp(env);
    app = secondLaunch.app;
    errors = errors.concat(secondLaunch.errors);
    const pageAfterRestart = secondLaunch.page;
    await waitForDashboard(pageAfterRestart);

    firmwarePage = await openFirmwareWindow(app);
    firmwarePage.on('pageerror', (err) => errors.push(err));
    firmwarePage.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      errors.push(new Error(msg.text() || 'console.error'));
    });

    await expect(firmwarePage.locator('[data-testid="firmware-root"]')).toContainText(temp.workspaceRoot);
    await expect.poll(async () => {
      return firmwarePage.evaluate(() => window.__firmwareWorkspaceRuntime?.isMonacoReady() || false);
    }).toBe(true);
    await expect.poll(async () => {
      return firmwarePage.evaluate(() => window.__firmwareWorkspaceRuntime?.getEditorValue() || '');
    }).toBe(updatedContent);

    const snapshot = await firmwarePage.evaluate(async () => {
      const workspace = await window.api.firmwareWorkspace.getState();
      return {
        session: workspace.session,
        mode: workspace.workspace.mode,
        root: workspace.workspace.root,
        activeFile: workspace.workspace.activeFile,
        openTabs: window.__firmwareWorkspaceRuntime?.getOpenTabs() || [],
      };
    });

    expect(snapshot.session).toBe(7);
    expect(snapshot.mode).toBe('attached');
    expect(snapshot.root).toBe(temp.workspaceRoot);
    expect(snapshot.activeFile).toBe('src/main.cpp');
    expect(snapshot.openTabs).toEqual(['src/main.cpp']);

    const filtered = errors.filter((err) => {
      const msg = String(err && err.message ? err.message : err);
      return /Uncaught|ReferenceError|TypeError|window\\.api|firmware/i.test(msg);
    });
    expect(filtered).toEqual([]);
  } finally {
    if (app) {
      await app.close().catch(() => {});
    }
    fs.rmSync(temp.tempRoot, { recursive: true, force: true });
  }
});

test('firmware workspace build flow streams PlatformIO output and supports cancel', async ({}, testInfo) => {
  testInfo.setTimeout(90_000);
  const temp = makeTempFirmwareWorkspace();
  const env = {
    MODULAR_USER_DATA_DIR: temp.userDataRoot,
    MODULAR_FIRMWARE_PIO_PATH: temp.fakePioPath,
  };

  let app;
  let errors = [];

  try {
    const launch = await launchApp(env);
    app = launch.app;
    errors = launch.errors;
    await waitForDashboard(launch.page);

    const firmwarePage = await openFirmwareWindow(app);
    firmwarePage.on('pageerror', (err) => errors.push(err));
    firmwarePage.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      errors.push(new Error(msg.text() || 'console.error'));
    });

    const attachResult = await firmwarePage.evaluate((workspaceRoot) => {
      return window.api.firmwareWorkspace.attachExistingWorkspace(workspaceRoot);
    }, temp.workspaceRoot);
    expect(attachResult.ok).toBe(true);

    await expect(firmwarePage.locator('[data-testid="firmware-action-build"]')).toBeEnabled();
    await expect(firmwarePage.locator('[data-testid="firmware-env-select"]')).toHaveValue('USB');

    await firmwarePage.locator('[data-testid="firmware-env-select"]').selectOption('SIM');
    await expect(firmwarePage.locator('#env-pill')).toContainText('SIM');

    await firmwarePage.locator('[data-testid="firmware-action-build"]').click();
    await expect(firmwarePage.locator('[data-testid="firmware-console"]')).toContainText('fake-pio target=build env=SIM');
    await expect(firmwarePage.locator('[data-testid="firmware-console"]')).toContainText('build complete for SIM');

    await firmwarePage.locator('[data-testid="firmware-action-upload"]').click();
    await expect(firmwarePage.locator('[data-testid="firmware-console"]')).toContainText('fake-pio target=upload env=SIM');
    await expect(firmwarePage.locator('[data-testid="firmware-console"]')).toContainText('upload complete for SIM');

    await firmwarePage.locator('[data-testid="firmware-action-reindex"]').click();
    await expect(firmwarePage.locator('[data-testid="firmware-console"]')).toContainText('compiledb ready for SIM');
    expect(fs.existsSync(path.join(temp.workspaceRoot, '.pio', 'build', 'SIM', 'compile_commands.json'))).toBe(true);

    await firmwarePage.locator('[data-testid="firmware-action-clean"]').click();
    await expect(firmwarePage.locator('[data-testid="firmware-console"]')).toContainText('waiting for cancel on SIM');
    await expect(firmwarePage.locator('[data-testid="firmware-action-cancel"]')).toBeEnabled();

    await firmwarePage.locator('[data-testid="firmware-action-cancel"]').click();
    await expect(firmwarePage.locator('[data-testid="firmware-console"]')).toContainText('fake-pio clean canceled for SIM');
    await expect(firmwarePage.locator('[data-testid="firmware-action-build"]')).toBeEnabled();

    const buildState = await firmwarePage.evaluate(() => window.__firmwareWorkspaceRuntime?.getBuildState() || null);
    expect(buildState.selectedEnv).toBe('SIM');
    expect(buildState.activeJob).toBe(null);
    expect(buildState.envs).toEqual(['USB', 'SIM']);

    const filtered = errors.filter((err) => {
      const msg = String(err && err.message ? err.message : err);
      return /Uncaught|ReferenceError|TypeError|window\\.api|firmware/i.test(msg);
    });
    expect(filtered).toEqual([]);
  } finally {
    if (app) {
      await app.close().catch(() => {});
    }
    fs.rmSync(temp.tempRoot, { recursive: true, force: true });
  }
});

test('firmware workspace installs and uses a managed PlatformIO runtime', async ({}, testInfo) => {
  testInfo.setTimeout(90_000);
  const temp = makeTempFirmwareWorkspace();
  const env = {
    MODULAR_USER_DATA_DIR: temp.userDataRoot,
    MODULAR_FIRMWARE_DISABLE_LOCAL_PIO: '1',
    MODULAR_FIRMWARE_MANAGED_PIO_SEED_PATH: temp.fakePioPath,
    MODULAR_FIRMWARE_DISABLE_LOCAL_CLANGD: '1',
    MODULAR_FIRMWARE_MANAGED_CLANGD_SEED_PATH: temp.fakeClangdPath,
  };

  let app;
  let errors = [];

  try {
    const launch = await launchApp(env);
    app = launch.app;
    errors = launch.errors;
    await waitForDashboard(launch.page);

    const firmwarePage = await openFirmwareWindow(app);
    firmwarePage.on('pageerror', (err) => errors.push(err));
    firmwarePage.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      errors.push(new Error(msg.text() || 'console.error'));
    });

    const attachResult = await firmwarePage.evaluate((workspaceRoot) => {
      return window.api.firmwareWorkspace.attachExistingWorkspace(workspaceRoot);
    }, temp.workspaceRoot);
    expect(attachResult.ok).toBe(true);

    await expect(firmwarePage.locator('[data-testid="firmware-action-install"]')).toBeEnabled();
    await expect(firmwarePage.locator('[data-testid="firmware-action-build"]')).toBeDisabled();
    await expect(firmwarePage.locator('#toolchain-status')).toContainText('PlatformIO missing');

    await firmwarePage.locator('[data-testid="firmware-action-install"]').click();
    await expect(firmwarePage.locator('[data-testid="firmware-console"]')).toContainText('Managed PlatformIO runtime installed');
    await expect(firmwarePage.locator('[data-testid="firmware-console"]')).toContainText('Managed clangd runtime installed');
    await expect(firmwarePage.locator('#toolchain-status')).toContainText('Toolchains ready');
    await expect(firmwarePage.locator('[data-testid="firmware-action-build"]')).toBeEnabled();
    await expect(firmwarePage.locator('[data-testid="firmware-action-install"]')).toBeDisabled();

    const managedPioPath = path.join(temp.userDataRoot, 'toolchains', 'platformio', 'penv', 'bin', 'pio');
    expect(fs.existsSync(managedPioPath)).toBe(true);

    await firmwarePage.locator('[data-testid="firmware-action-build"]').click();
    await expect(firmwarePage.locator('[data-testid="firmware-console"]')).toContainText(`Running ${managedPioPath} run -e USB`);
    await expect(firmwarePage.locator('[data-testid="firmware-console"]')).toContainText('build complete for USB');

    const debugState = await firmwarePage.evaluate(() => window.__firmwareWorkspaceRuntime?.getDebugState() || null);
    expect(debugState.toolchain.platformio.usingManagedRuntime).toBe(true);
    expect(debugState.toolchain.platformio.managedStatus).toBe('installed');
    expect(debugState.toolchain.clangd.usingManagedRuntime).toBe(true);

    const filtered = errors.filter((err) => {
      const msg = String(err && err.message ? err.message : err);
      return /Uncaught|ReferenceError|TypeError|window\\.api|firmware/i.test(msg);
    });
    expect(filtered).toEqual([]);
  } finally {
    if (app) {
      await app.close().catch(() => {});
    }
    fs.rmSync(temp.tempRoot, { recursive: true, force: true });
  }
});

test('firmware workspace enables clangd-backed completion, hover, and diagnostics after reindex', async ({}, testInfo) => {
  testInfo.setTimeout(90_000);
  const temp = makeTempFirmwareWorkspace();
  const env = {
    MODULAR_USER_DATA_DIR: temp.userDataRoot,
    MODULAR_FIRMWARE_DISABLE_LOCAL_PIO: '1',
    MODULAR_FIRMWARE_MANAGED_PIO_SEED_PATH: temp.fakePioPath,
    MODULAR_FIRMWARE_DISABLE_LOCAL_CLANGD: '1',
    MODULAR_FIRMWARE_MANAGED_CLANGD_SEED_PATH: temp.fakeClangdPath,
  };

  let app;
  let errors = [];

  try {
    const launch = await launchApp(env);
    app = launch.app;
    errors = launch.errors;
    await waitForDashboard(launch.page);

    const firmwarePage = await openFirmwareWindow(app);
    firmwarePage.on('pageerror', (err) => errors.push(err));
    firmwarePage.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      errors.push(new Error(msg.text() || 'console.error'));
    });

    const attachResult = await firmwarePage.evaluate((workspaceRoot) => {
      return window.api.firmwareWorkspace.attachExistingWorkspace(workspaceRoot);
    }, temp.workspaceRoot);
    expect(attachResult.ok).toBe(true);

    await firmwarePage.reload();
    await firmwarePage.waitForLoadState('domcontentloaded');
    await expect.poll(async () => {
      return firmwarePage.evaluate(() => window.__firmwareWorkspaceRuntime?.isMonacoReady() || false);
    }).toBe(true);
    await expect.poll(async () => {
      return firmwarePage.evaluate(() => window.__firmwareWorkspaceRuntime?.getActiveTab() || '');
    }).toBe('src/main.cpp');

    await firmwarePage.locator('[data-testid="firmware-action-install"]').click();
    await expect(firmwarePage.locator('[data-testid="firmware-console"]')).toContainText('Managed clangd runtime installed');
    await expect(firmwarePage.locator('[data-testid="firmware-clangd-status"]')).toContainText('Reindex');

    await firmwarePage.locator('[data-testid="firmware-action-reindex"]').click();
    await expect(firmwarePage.locator('[data-testid="firmware-console"]')).toContainText('compiledb ready for USB');
    await expect.poll(async () => {
      return firmwarePage.locator('[data-testid="firmware-clangd-status"]').textContent();
    }).toContain('clangd ready');

    const completion = await firmwarePage.evaluate(async () => {
      return window.__firmwareWorkspaceRuntime?.requestCompletionAt(3, 5);
    });
    expect(completion.ok).toBe(true);
    expect(completion.labels).toContain('fixture_driver_value');

    const hover = await firmwarePage.evaluate(async () => {
      return window.__firmwareWorkspaceRuntime?.requestHoverAt(3, 5);
    });
    expect(hover.ok).toBe(true);
    expect(hover.contents.join('\n')).toContain('fixture_driver_value');

    await expect.poll(async () => {
      return firmwarePage.evaluate(() => window.__firmwareWorkspaceRuntime?.getMarkers() || []);
    }).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringContaining('fixture diagnostic'),
      }),
    ]));

    const languageState = await firmwarePage.evaluate(() => window.__firmwareWorkspaceRuntime?.getLanguageState() || null);
    expect(languageState.status).toBe('ready');
    expect(languageState.compileCommandsReady).toBe(true);
    expect(languageState.clangd.usingManagedRuntime).toBe(true);

    const filtered = errors.filter((err) => {
      const msg = String(err && err.message ? err.message : err);
      return /Uncaught|ReferenceError|TypeError|window\\.api|firmware|clangd/i.test(msg);
    });
    expect(filtered).toEqual([]);
  } finally {
    if (app) {
      await app.close().catch(() => {});
    }
    fs.rmSync(temp.tempRoot, { recursive: true, force: true });
  }
});
