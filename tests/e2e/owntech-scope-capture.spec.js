const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

test('owntech_scope_capture arms/triggers via ThingSet writes and downloads an instant mocked capture', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  await loadDashboard(page, fixturePath('owntech_scope_capture.json'));

  await page.waitForFunction(() => {
    const model = window.freeboard?.getLiveModel?.();
    const ds = model?.datasources().find((d) => d.name() === 'MockOwnTechThingSet');
    return !!(ds && ds.latestData() && ds.latestData().status === 'ok');
  }, null, { timeout: 15_000 });

  // rState=3 (READY) in the mock tree by default, so status/Download should
  // reflect that once the datasource's first poll lands.
  await page.waitForFunction(() => {
    const el = document.querySelector('.d-flex.flex-column.h-100.gap-2.overflow-auto.p-2 .small.text-muted');
    return !!(el && el.textContent.includes('READY'));
  }, null, { timeout: 15_000 });

  // Discovery-driven Arm/Trigger buttons (findBooleanActionLeaves scoped to
  // /Debug/Scope) -- clicking one writes a plain ThingSet value, same
  // mechanism as the Milestone 4 Actions panel.
  const armButton = page.locator('button', { hasText: 'wArm' });
  await expect(armButton).toBeVisible();
  await armButton.click();
  await page.waitForFunction(() => {
    const calls = window.api?.thingsetSerial?.getMockSetValueCalls?.() || [];
    return calls.some((c) => c.path === '/Debug/Scope/wArm' && c.value === true);
  }, null, { timeout: 10_000 });

  // Download button should be enabled (status READY) and resolve instantly
  // against the MOCK_HW synthetic dataset (1024 samples * 8 channels).
  const downloadButton = page.locator('button', { hasText: 'Download' });
  await expect(downloadButton).toBeEnabled();
  await downloadButton.click();

  await page.waitForFunction(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('Save CSV'));
    return !!(btn && !btn.disabled);
  }, null, { timeout: 15_000 });

  const statusText = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.small.text-muted'));
    const el = els.find((e) => e.textContent.includes('Downloaded'));
    return el ? el.textContent : null;
  });
  expect(statusText).toContain('Downloaded 1024 samples across 8 channels.');

  // The rotated capture itself, independent of whether the inline uPlot
  // chart rendered -- that library loads from a CDN (external_scripts, same
  // as the pre-existing time_plot_uplot widget) and isn't asserted on
  // anywhere else in this suite either, so don't make this test depend on
  // network access.
  const capture = await page.evaluate(() => {
    const model = window.freeboard.getLiveModel();
    const widget = model.panes()[0].widgets()[0];
    const c = widget.widgetInstance._lastCapture;
    return c ? { channelCount: c.channels.length, sampleCount: c.samples.length, finalIndex: c.finalIndex } : null;
  });
  expect(capture).toEqual({ channelCount: 8, sampleCount: 1024, finalIndex: 1023 });

  await app.close();
});

test('scope port dropdown sorts the likely if00 port first and labels it', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  await loadDashboard(page, fixturePath('owntech_scope_capture.json'));

  await page.evaluate(() => window.freeboard.setEditing(true));
  await page.waitForTimeout(400);

  const pane = page.locator('.gs_w').first();
  const widget = pane.locator('.sub-section').first();
  await widget.hover();
  await widget.locator('.tool-edit').click();

  const portSelect = page.locator('#modal_overlay').last().locator('#setting-row-scopeSerialPort select');
  await expect(portSelect).toBeVisible();
  // MOCK_HW's COM_MOCK_IF00 mock port carries a pnpId ending in "-if00",
  // mirroring a real Core4 board's scope-port USB interface naming -- it
  // should sort ahead of the other (non-if00) mock ports and be labeled.
  await expect(portSelect.locator('option').first()).toHaveText('COM_MOCK_IF00 (likely if00)');

  await page.keyboard.press('Escape');
  await app.close();
});
