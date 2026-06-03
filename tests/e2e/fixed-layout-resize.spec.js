// Regression: pane positions must be preserved when the viewport is narrower
// than the dashboard's saved column count.  The board-content area should show
// a horizontal scrollbar instead of reflowing panes into approximate positions.

const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

// The fixture uses columns:15 with panes at cols 1, 7, and 13.
// A 15-column grid is ~4800px wide — far wider than the 800px test window.
const FIXTURE = 'fixed_layout_resize.json';

test('pane positions are preserved when viewport is narrower than the grid', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  await loadDashboard(page, fixturePath(FIXTURE));

  // Capture each pane's data-col and data-row at the saved (15-column) layout.
  const positionsBefore = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.gridster > ul > li')).map((li) => ({
      col: li.getAttribute('data-col'),
      row: li.getAttribute('data-row'),
    }))
  );

  expect(positionsBefore).toHaveLength(3);

  // Shrink the viewport to 800×600 — far narrower than the 15-column grid.
  await page.setViewportSize({ width: 800, height: 600 });

  // Wait for the debounced resize handler (500 ms) plus a reflow margin.
  await page.waitForTimeout(700);

  // Pane positions must be unchanged after the viewport shrink.
  const positionsAfter = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.gridster > ul > li')).map((li) => ({
      col: li.getAttribute('data-col'),
      row: li.getAttribute('data-row'),
    }))
  );

  expect(positionsAfter).toEqual(positionsBefore);

  // The grid container must be at least as wide as the 15-column layout.
  // 15 cols × 320px (COLUMN_WIDTH) = 4800px.
  const gridWidth = await page.evaluate(() => {
    const el = document.querySelector('.responsive-column-width');
    return el ? el.offsetWidth : 0;
  });

  expect(gridWidth).toBeGreaterThanOrEqual(4800);

  // board-content must expose a horizontal scrollbar (content wider than box).
  const scrollable = await page.evaluate(() => {
    const el = document.getElementById('board-content');
    return el ? el.scrollWidth > el.clientWidth : false;
  });

  expect(scrollable).toBe(true);

  await app.close();
});
