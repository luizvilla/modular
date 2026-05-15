const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

// All 30 registered widget types in the fixture — give each drag pair
// enough time, plus headroom for slow Electron/Chromium startup.
test.setTimeout(180_000);

/**
 * Drag the first widget in `fromSection` to `toSection`.
 *
 * freeboard.js hides .sub-section-tools via jQuery fadeOut(250) on mouseleave,
 * writing an inline display:none that overrides the CSS display:flex.  After
 * a prior drag's mouseout event the tools are invisible.  We trigger the
 * jQuery mouseenter handler by hovering the parent .sub-section first, then
 * wait for the tools to become visible before dragging.
 */
async function dragFirstWidget(page, fromSection, toSection) {
  const subSection = fromSection.locator('.sub-section').first();
  await subSection.scrollIntoViewIfNeeded();
  await subSection.hover();
  const tools = fromSection.locator('.sub-section-tools').first();
  await expect(tools).toBeVisible({ timeout: 2000 });
  await tools.dragTo(toSection);
}

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
      await dragFirstWidget(page, section0, section1);
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
      await dragFirstWidget(page, section1, section0);
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

  // Drag widget at index 1 (lower on the page, safely below the fixed
  // #main-header) upward onto widget 0.  Hovering widget 0 causes
  // Playwright's internal scroll to pull its tools inside the fixed header
  // area (z-index:50, ~234px tall in edit mode), where #admin-menu intercepts
  // pointer events.  Widget 1 starts ~240px lower so its tools remain
  // accessible even after Playwright adjusts scroll on hover.
  const subSection1 = section0.locator('.sub-section').nth(1);
  await subSection1.scrollIntoViewIfNeeded();
  await subSection1.hover();
  const handle1 = section0.locator('.sub-section-tools').nth(1);
  await expect(handle1).toBeVisible({ timeout: 2000 });
  // Wait for jQuery fadeIn(250) to complete before dragging.
  await page.waitForTimeout(350);

  // Drop at 15 % down widget 0 (top quarter → sort before it).
  const target0 = section0.locator('.sub-section').nth(0);
  const t0Box   = await target0.boundingBox();
  await handle1.dragTo(target0, {
    targetPosition: { x: Math.floor(t0Box.width * 0.5), y: Math.floor(t0Box.height * 0.15) },
  });
  // Allow jQuery UI sortable's update callback and Knockout model to settle.
  await page.waitForTimeout(300);

  const after = await page.evaluate(() =>
    window.freeboard.getLiveModel().panes()[0].widgets().map(w => w.type())
  );

  // Widget count must be preserved and the order must have changed.
  expect(after.length).toBe(before.length);
  expect(after).not.toEqual(before);

  await app.close();
});
