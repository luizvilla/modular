const { expect } = require('playwright/test');

// Shared across every radial-context-menu spec file (docs/GUI/02-navigation_overhaul.md's
// Verification Strategy calls for extracting these once a second widget/zone
// needs them, rather than copy-pasting into each new spec file).

const OUTER_R = 92;
const INNER_R = 34;
const WEDGE_GAP_DEG = 4;
const WEDGE_MID_RADIUS = (INNER_R + OUTER_R) / 2;

function radialMenu(page) {
  return page.locator('.radial-menu-overlay');
}

// The category wedge is an SVG donut segment -- for a small N its
// bounding-box center can land in the donut's empty inner hole (Playwright's
// default click target), so this computes a point that's actually painted,
// picking the wedge by its label rather than assuming position/order.
async function clickWedgeByLabel(page, label) {
  const labels = await page.locator('.radial-menu-wedge-label').allTextContents();
  const index = labels.indexOf(label);
  if (index === -1) throw new Error(`wedge label "${label}" not found among ${JSON.stringify(labels)}`);
  const n = labels.length;
  const step = 360 / n;
  const start = step * index + WEDGE_GAP_DEG / 2;
  const end = step * (index + 1) - WEDGE_GAP_DEG / 2;
  const mid = (start + end) / 2;
  const rad = (mid - 90) * Math.PI / 180;
  const dx = WEDGE_MID_RADIUS * Math.cos(rad);
  const dy = WEDGE_MID_RADIUS * Math.sin(rad);
  const anchor = await page.locator('.radial-menu').boundingBox();
  await page.mouse.click(anchor.x + dx, anchor.y + dy);
}

async function plotWidget(page, paneIndex = 0, widgetIndex = 6) {
  const el = page.locator('.gs_w').nth(paneIndex).locator('.sub-section').nth(widgetIndex);
  await expect(el).toBeVisible();
  return el;
}

module.exports = {
  radialMenu,
  clickWedgeByLabel,
  plotWidget,
};
