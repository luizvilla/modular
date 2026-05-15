const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, fixturePath } = require('./helpers');

// Three app launches (cleanup+install, verify+uninstall, verify-gone) each with
// full Electron startup time.
test.setTimeout(180_000);

const BUNDLE_ID   = 'test-bundle';
const BUNDLE_PATH = fixturePath('test-bundle');

test('extension manager — install then uninstall round trip', async () => {
  // ── Launch 1: clean up any leftover from a prior run, then install ──────
  {
    const { app, page } = await launchApp({ MOCK_HW: '0' });
    await waitForDashboard(page);

    // Idempotent cleanup: no-op if the extension isn't present.
    await page.evaluate((id) => window.api.extensions.manager.uninstall(id), BUNDLE_ID);

    const installResult = await page.evaluate(
      (bundlePath) => window.api.extensions.manager.install(bundlePath),
      BUNDLE_PATH
    );
    expect(installResult).toMatchObject({ ok: true, id: BUNDLE_ID, version: '1.0.0', requiresRestart: true });

    await app.close();
  }

  // ── Launch 2: verify extension loaded, then uninstall ───────────────────
  {
    const { app, page } = await launchApp({ MOCK_HW: '0' });
    await waitForDashboard(page);

    const installed = await page.evaluate(async (id) => {
      const managerList = await window.api.extensions.manager.list();
      const inventory   = await window.api.extensions.list();
      const bootstrap   = await window.api.extensions.getBootstrap();
      return {
        // manager list reflects on-disk state; source 'installed' distinguishes
        // from built-in extensions.
        inManagerList:     managerList.some((e) => e.id === id && e.source === 'installed'),
        enabledInInventory: inventory.some((e) => e.id === id && e.enabled === true),
        // Installed scripts use absolute file:// URLs; match on the filename.
        hasScript:         bootstrap.rendererScripts.some((s) => s.path.includes('test_widget.js')),
      };
    }, BUNDLE_ID);

    expect(installed.inManagerList).toBe(true);
    expect(installed.enabledInInventory).toBe(true);
    expect(installed.hasScript).toBe(true);

    const uninstallResult = await page.evaluate(
      (id) => window.api.extensions.manager.uninstall(id),
      BUNDLE_ID
    );
    expect(uninstallResult).toMatchObject({ ok: true, requiresRestart: true });

    await app.close();
  }

  // ── Launch 3: verify extension is fully gone after restart ───────────────
  {
    const { app, page } = await launchApp({ MOCK_HW: '0' });
    await waitForDashboard(page);

    const uninstalled = await page.evaluate(async (id) => {
      const managerList = await window.api.extensions.manager.list();
      const inventory   = await window.api.extensions.list();
      const bootstrap   = await window.api.extensions.getBootstrap();
      return {
        inManagerList: managerList.some((e) => e.id === id),
        inInventory:   inventory.some((e) => e.id === id),
        hasScript:     bootstrap.rendererScripts.some((s) => s.path.includes('test_widget.js')),
      };
    }, BUNDLE_ID);

    expect(uninstalled.inManagerList).toBe(false);
    expect(uninstalled.inInventory).toBe(false);
    expect(uninstalled.hasScript).toBe(false);

    await app.close();
  }
});
