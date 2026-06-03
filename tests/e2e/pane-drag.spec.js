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

/**
 * Regression: bystander panes (those not being dragged) must have their
 * paneModel.row/col kept in sync with the DOM after every drag.
 *
 * The bug: when a bystander pane is moved aside during drag and returns to
 * its original row at drag-end, MutationObserver does not fire (same-value
 * write), so the model retains a stale intermediate row value.  The next
 * processResize(true) call (e.g. window resize) then repositions those panes
 * to the stale model value — panes "fly away".
 *
 * The fix: draggable.stop calls syncAllPanePositionsFromDOM() which writes
 * every pane's final DOM position back to the model unconditionally.
 */
test('pane drag — bystander pane models stay in sync with DOM after drag', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  await loadDashboard(page, fixturePath('pane_drag_3pane.json'));

  await page.evaluate(() => window.freeboard.setEditing(true));
  await page.waitForTimeout(400);

  const panes = page.locator('.gridster .gs_w');
  await expect(panes).toHaveCount(3, { timeout: 10_000 });

  // Drag pane A (col 1) onto pane B (col 2); pane C must react to make room.
  const handleA = panes.nth(0).locator('.pane-drag-handle');
  const handleB = panes.nth(1).locator('.pane-drag-handle');
  await handleA.dragTo(handleB);

  // Allow Gridster's drop animation and syncAllPanePositionsFromDOM to settle.
  await page.waitForTimeout(600);

  // For each DOM pane element, compare its data-row/data-col attributes with
  // the paneModel's stored row/col at the current column key.
  // window.freeboard.serialize().columns gives the key used by
  // updatePositionForScreenSize (== freeboardUI.getUserColumns() == grid.cols).
  const mismatches = await page.evaluate(() => {
    const colKey = String(window.freeboard.serialize().columns);
    const liElements = Array.from(document.querySelectorAll('.gridster > ul > li'));
    const results = [];

    liElements.forEach(function(li) {
      const model = window.ko.dataFor(li);   // Knockout model bound to this element
      if (!model) return;
      const domRow = Number(li.getAttribute('data-row'));
      const domCol = Number(li.getAttribute('data-col'));
      const modelRow = model.row[colKey];
      const modelCol = model.col[colKey];
      if (modelRow !== domRow || modelCol !== domCol) {
        results.push({
          title: model.title ? model.title() : '?',
          domRow, domCol, modelRow, modelCol,
        });
      }
    });

    return results;
  });

  expect(mismatches).toHaveLength(0);

  await app.close();
});
