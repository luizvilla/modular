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

/**
 * Regression: a narrow (1-column) bystander pane must not ping-pong sideways
 * as a wider pane drags across it.
 *
 * The bug: try_swap_widget_sideways recomputed its preferred swap direction
 * from scratch on every collision tick (`player_col >= widget_grid_data.col`),
 * so a 1-column pane sitting between two open columns could get swapped back
 * and forth — e.g. col 5 -> 6 -> 5 -> 6 — as the drag continued, even though
 * the drag itself was moving steadily in one direction. This was most visible
 * with a thin/tall pane (e.g. a 1-column command panel) next to a much wider
 * one (e.g. a plot), since the thin pane always has somewhere else to go.
 *
 * The fix: try_swap_widget_sideways first checks whether the bystander's
 * *current* column already clears the player's real, pixel-accurate
 * footprint; if so it leaves the bystander alone instead of re-picking a
 * side. The fixture here has "Cmd" (1 column wide, 18 rows tall) at col 5
 * and "Plot" (2 columns wide, 2 rows tall) at col 1 on a 10-column grid, with
 * open columns on both sides of Cmd so the buggy code had a real choice to
 * flip-flop between.
 */
test('pane drag — narrow bystander does not oscillate sideways next to a wide pane', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  await loadDashboard(page, fixturePath('pane_drag_thin_vs_square.json'));

  await page.evaluate(() => window.freeboard.setEditing(true));
  await page.waitForTimeout(400);

  const paneDragLines = [];
  page.on('console', (msg) => {
    if (msg.text().includes('[pane-drag]')) paneDragLines.push(msg.text());
  });

  const panes = page.locator('.gridster .gs_w');
  await expect(panes).toHaveCount(2, { timeout: 10_000 });

  // Cmd is pane 0 (col 5), Plot is pane 1 (col 1). Drag Plot slowly to the
  // right, through and past Cmd's column, so on_drag fires many times while
  // grazing it -- the exact condition that used to cause oscillation.
  const handlePlot = panes.nth(1).locator('.pane-drag-handle');
  const box = await handlePlot.boundingBox();

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Real human drags aren't perfectly linear -- small back-and-forth jitter
  // while crossing Cmd's column is what actually triggered the flip-flop in
  // try_swap_widget_sideways (prefer_left_first depends on the player's
  // *current* column relative to the bystander, so a tiny reversal in
  // pointer motion used to be enough to flip the preferred swap side).
  const steps = 80;
  const totalDx = 1300; // PANE_WIDTH is 300px/col -- cross from col 1 through col 5 and beyond
  const jitter = 40;
  for (let s = 1; s <= steps; s++) {
    const base = box.x + box.width / 2 + (totalDx * s) / steps;
    const wiggle = s % 4 === 0 ? -jitter : 0;
    await page.mouse.move(base + wiggle, box.y + box.height / 2);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(700);

  // Extract every column Cmd was swapped to, in order, from the diagnostic
  // log (see freeboard.thirdparty.js's paneDragLog). Oscillation shows up as
  // a non-monotonic sequence, e.g. [6, 7, 6] instead of [6, 7, 8].
  const cmdCols = paneDragLines
    .map((l) => l.match(/Cmd col=(\d+)->(\d+)/))
    .filter(Boolean)
    .map((m) => Number(m[2]));

  for (let i = 1; i < cmdCols.length; i++) {
    expect(cmdCols[i], `Cmd swap sequence ${JSON.stringify(cmdCols)} is not monotonic`).toBeGreaterThanOrEqual(cmdCols[i - 1]);
  }

  await app.close();
});
