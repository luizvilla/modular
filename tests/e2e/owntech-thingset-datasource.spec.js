const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

test('owntech_thingset_datasource renders and reports mocked shell detection in the sidebar', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

  const dsTypes = await page.evaluate(() => {
    const model = window.freeboard?.getLiveModel?.();
    if (!model || typeof model.datasources !== 'function') return [];
    return model.datasources().map((d) => d.type());
  });
  expect(dsTypes).toEqual(expect.arrayContaining(['owntech_thingset_datasource']));

  // Open the sidebar detail pane for the OwnTech datasource and wait for its
  // first poll (triggered automatically on datasource creation) to resolve
  // against the MOCK_HW thingsetSerial.tree() mock.
  await page.evaluate(() => {
    const model = window.freeboard.getLiveModel();
    const ds = model.datasources().find((d) => d.name() === 'MockOwnTechThingSet');
    window.__testDsRow = ds;
  });
  await page.waitForFunction(() => {
    const ds = window.__testDsRow;
    return !!(ds && ds.latestData() && ds.latestData().status === 'ok');
  }, null, { timeout: 15_000 });

  // Select the datasource row in the sidebar so its detail pane (and our
  // thingsetShellStatus binding) actually renders into the DOM.
  await page.evaluate(() => {
    const model = window.freeboard.getLiveModel();
    const ds = model.datasources().find((d) => d.name() === 'MockOwnTechThingSet');
    if (model.selectedDatasource) model.selectedDatasource(ds);
  });

  const statusText = await page.evaluate(() => {
    const el = document.querySelector('.thingset-shell-status');
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
  });

  expect(statusText).toBeTruthy();
  expect(statusText).toContain('Detected');
  expect(statusText).toContain('COM_MOCK');
  // Mock tree grew a Leg1/Leg2 subtree under /Config in Milestone 4, then a
  // /Debug/Scope subtree in Milestone 5 (see app/preload.js) -- pushing the
  // summary from the original "3 leaves across 1 group" to:
  expect(statusText).toContain('22 leaves across 3 groups');

  await app.close();
});
