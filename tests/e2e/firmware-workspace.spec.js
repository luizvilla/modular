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
  fs.cpSync(fixtureRoot, workspaceRoot, { recursive: true });
  return { tempRoot, workspaceRoot, userDataRoot };
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
  const env = { MODULAR_USER_DATA_DIR: temp.userDataRoot };

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
    await expect(firmwarePage.locator('[data-testid="firmware-action-build"]')).toBeDisabled();
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

    expect(snapshot.session).toBe(3);
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
