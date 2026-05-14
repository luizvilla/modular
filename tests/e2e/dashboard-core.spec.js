const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

test.setTimeout(60_000);

test('dashboard loads and editing toggles', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  await loadDashboard(page, fixturePath('test_dashboard.json'));

  const editState = await page.evaluate(() => {
    const fb = window.freeboard;
    if (!fb || typeof fb.isEditing !== 'function' || typeof fb.setEditing !== 'function') return null;
    const before = fb.isEditing();
    fb.setEditing(!before, false);
    const after = fb.isEditing();
    return { before, after };
  });
  expect(editState).not.toBeNull();
  expect(editState.before).not.toEqual(editState.after);

  const widgetTypes = await page.evaluate(() => {
    const model = window.freeboard?.getLiveModel?.();
    if (!model || typeof model.panes !== 'function') return [];
    const types = [];
    model.panes().forEach((p) => {
      p.widgets().forEach((w) => {
        if (typeof w.type === 'function') types.push(w.type());
      });
    });
    return types;
  });
  // Power bars widget removed; keep expected list aligned with shipped widgets.
  expect(widgetTypes).toEqual(expect.arrayContaining([
    'serial_terminal',
    'serial_flasher',
    'thingset_device_ui',
    'owntech_plot_uplot',
    'text_widget',
    'gauge',
    'sparkline',
    'pointer',
    'picture',
    'indicator',
    'google_map',
    'uplot_config_panel',
    'thingset_serial_device_ui',
  ]));

  await app.close();
});
