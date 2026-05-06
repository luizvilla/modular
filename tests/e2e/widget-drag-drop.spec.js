const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

// All 30 registered widget types in the fixture — give each drag pair
// enough time, plus headroom for slow Electron/Chromium startup.
test.setTimeout(180_000);

test('widget drag-and-drop — all types move from pane 0 to pane 1 and back', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

  // Enable editing so the sortable handles are active.
  await page.evaluate(() => window.freeboard.setEditing(true));
  // Short pause lets Knockout apply bindings after setEditing.
  await page.waitForTimeout(400);

  const widgetCount = await page.evaluate(() =>
    window.freeboard.getLiveModel().panes()[0].widgets().length
  );
  expect(widgetCount).toBeGreaterThan(0);

  const section0 = page.locator('.gs_w').nth(0).locator('section.widget-sort-section');
  const section1 = page.locator('.gs_w').nth(1).locator('section.widget-sort-section');

  // ── Sweep 1: move every widget from pane 0 → pane 1 ──────────────────
  // Always drag the first remaining widget.  The type is captured before
  // the drag so a failure message names the offending widget.
  for (let i = 0; i < widgetCount; i++) {
    const type = await page.evaluate(() =>
      window.freeboard.getLiveModel().panes()[0].widgets()[0]?.type() ?? '(unknown)'
    );
    await test.step(`→ pane 1: ${type}`, async () => {
      await section0.locator('.sub-section-tools').first().dragTo(section1);
      await expect(section0.locator('.sub-section')).toHaveCount(widgetCount - i - 1, { timeout: 8000 });
      await expect(section1.locator('.sub-section')).toHaveCount(i + 1,              { timeout: 8000 });
    });
  }

  // ── Sweep 2: move every widget back from pane 1 → pane 0 ─────────────
  for (let i = 0; i < widgetCount; i++) {
    const type = await page.evaluate(() =>
      window.freeboard.getLiveModel().panes()[1].widgets()[0]?.type() ?? '(unknown)'
    );
    await test.step(`← pane 0: ${type}`, async () => {
      await section1.locator('.sub-section-tools').first().dragTo(section0);
      await expect(section1.locator('.sub-section')).toHaveCount(widgetCount - i - 1, { timeout: 8000 });
      await expect(section0.locator('.sub-section')).toHaveCount(i + 1,              { timeout: 8000 });
    });
  }

  // Final state: all widgets back in pane 0, pane 1 empty.
  await expect(section0.locator('.sub-section')).toHaveCount(widgetCount);
  await expect(section1.locator('.sub-section')).toHaveCount(0);

  await app.close();
});

test('widget drag-and-drop — within-pane reorder changes widget order', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

  await page.evaluate(() => window.freeboard.setEditing(true));
  await page.waitForTimeout(400);

  const section0 = page.locator('.gs_w').nth(0).locator('section.widget-sort-section');

  const before = await page.evaluate(() =>
    window.freeboard.getLiveModel().panes()[0].widgets().map(w => w.type())
  );
  expect(before.length).toBeGreaterThanOrEqual(2);

  // Drag the first widget's handle on top of the second widget to swap them.
  const handle0 = section0.locator('.sub-section-tools').nth(0);
  const target1  = section0.locator('.sub-section').nth(1);
  await handle0.dragTo(target1);

  const after = await page.evaluate(() =>
    window.freeboard.getLiveModel().panes()[0].widgets().map(w => w.type())
  );

  // Widget count must be preserved and at least the first position must differ.
  expect(after.length).toBe(before.length);
  expect(after[0]).not.toBe(before[0]);

  await app.close();
});
