const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

test.setTimeout(60_000);

async function readGridPosition(locator) {
  return locator.evaluate((el) => ({
    row: Number(el.getAttribute('data-row')),
    col: Number(el.getAttribute('data-col')),
  }));
}

/**
 * Verify that dragging a pane horizontally causes an in-row swap rather than
 * pushing the displaced pane down to a new row (the "blown away" regression).
 *
 * The fixture has two single-widget panes on the same row: Pane A at col 1
 * and Pane B at col 2.  Dragging Pane A over Pane B should swap them: both
 * panes must remain on the same row, and their column assignments should be
 * exchanged.
 */
test('pane drag — horizontal swap stays on the same row', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  await loadDashboard(page, fixturePath('pane_drag_dashboard.json'));

  // Enable editing so the pane-drag-handle is shown.
  await page.evaluate(() => window.freeboard.setEditing(true));
  await page.waitForTimeout(400);

  const panes = page.locator('.gridster .gs_w');
  await expect(panes).toHaveCount(2, { timeout: 10_000 });

  const paneA = panes.nth(0);
  const paneB = panes.nth(1);

  // Record initial gridster grid positions.
  const beforeA = await readGridPosition(paneA);
  const beforeB = await readGridPosition(paneB);

  // Both panes must start on the same row.
  expect(beforeA.row).toBe(beforeB.row);
  // Pane A should be to the left of Pane B.
  expect(beforeA.col).toBeLessThan(beforeB.col);

  // Drag pane A's handle to pane B's drag handle.  The drag handle sits in
  // the 30px pane header, which is exactly one gridster faux-grid row — so
  // the drop registers in the correct grid cell for a same-row swap.
  const handleA = paneA.locator('.pane-drag-handle');
  const handleB = paneB.locator('.pane-drag-handle');
  await handleA.dragTo(handleB);

  // Allow gridster's drop animation to settle.
  await page.waitForTimeout(600);

  const afterA = await readGridPosition(paneA);
  const afterB = await readGridPosition(paneB);

  // Neither pane must have been pushed to a different row — the "blown away"
  // regression manifests as one or both panes moving to row > beforeA.row.
  expect(afterA.row).toBe(beforeA.row);
  expect(afterB.row).toBe(beforeA.row);

  // The columns must have been exchanged (swap, not push-right).
  expect(afterA.col).toBe(beforeB.col);
  expect(afterB.col).toBe(beforeA.col);

  await app.close();
});

test('pane drag undo restores the previous pane positions', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  await loadDashboard(page, fixturePath('pane_drag_dashboard.json'));

  await page.evaluate(() => window.freeboard.setEditing(true));
  await page.waitForTimeout(400);

  const panes = page.locator('.gridster .gs_w');
  await expect(panes).toHaveCount(2, { timeout: 10_000 });

  const paneA = panes.nth(0);
  const paneB = panes.nth(1);
  const handleA = paneA.locator('.pane-drag-handle');
  const handleB = paneB.locator('.pane-drag-handle');

  const beforeA = await readGridPosition(paneA);
  const beforeB = await readGridPosition(paneB);

  await handleA.dragTo(handleB);
  await page.waitForTimeout(600);

  const movedA = await readGridPosition(paneA);
  const movedB = await readGridPosition(paneB);
  expect(movedA.col).toBe(beforeB.col);
  expect(movedB.col).toBe(beforeA.col);

  await page.keyboard.press('Control+KeyZ');
  await page.waitForTimeout(600);

  const restoredA = await readGridPosition(paneA);
  const restoredB = await readGridPosition(paneB);

  expect(restoredA).toEqual(beforeA);
  expect(restoredB).toEqual(beforeB);

  await app.close();
});
