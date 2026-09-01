const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');
const { radialMenu } = require('./radial_menu_helpers');

// Milestone 5 of docs/GUI/02-navigation_overhaul.md: fft_spectrum_plot's
// three plots (time domain, spectrum, harmonics) all render the same set of
// channelDefs, so right-clicking any one of them quick-adds a channel from
// the loaded CSV's own columns -- no axis panels, since every axis here is
// auto-scaled from analysis parameters, not cosmetic settings.

function activeModal(page) {
  return page.locator('#modal_overlay').last();
}

async function addFftSpectrumWidget(page, paneIndex, csvPath) {
  await page.evaluate((index) => {
    document.querySelectorAll('.gs_w')[index]?.querySelector('.pane-tools li[title="Add widget"]')?.click();
  }, paneIndex);
  await expect(page.locator('#modal_overlay .widget-picker')).toBeVisible();
  const tile = page.locator('#modal_overlay .widget-tile[data-type="fft_spectrum_plot"]');
  await tile.click();
  await activeModal(page).locator('header .title').waitFor();

  await activeModal(page).getByRole('button', { name: 'Choose CSV File' }).click();
  await activeModal(page).locator('#dialog-ok').click();
  await page.waitForFunction(() => document.querySelectorAll('#modal_overlay').length === 0);

  await page.waitForFunction((idx) => {
    const w = window.freeboard.getLiveModel().panes()[idx].widgets()[0];
    return w && w.widgetInstance && Array.isArray(w.widgetInstance.availableColumns) && w.widgetInstance.availableColumns.length > 0;
  }, paneIndex);
}

test('right-click any of the three plots shows a flat list of CSV columns; quick-add appends a channel', async () => {
  const csvPath = path.join(os.tmpdir(), `modular-fft-radial-${Date.now()}.csv`);
  const { app, page } = await launchApp({ MOCK_CSV_PATH: csvPath });
  try {
    await page.evaluate(async (targetPath) => {
      await window.api.files.writeText(targetPath, [
        'Vgrid,Igrid,Extra',
        '0,0,1',
        '1,1,2',
        '0,0,1',
        '-1,-1,2',
      ].join('\n'));
    }, csvPath);
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('drag_drop_dashboard.json'));

    await addFftSpectrumWidget(page, 1, csvPath);

    const widget = page.locator('.gs_w').nth(1).locator('.sub-section').nth(0);
    const timeHost = widget.locator('.fft-spectrum-chart-host').first();
    await timeHost.scrollIntoViewIfNeeded();
    const box = await timeHost.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });

    await expect(radialMenu(page)).toBeVisible();
    await expect(page.locator('.radial-menu-wedge')).toHaveCount(0);
    const leaves = await page.locator('.radial-menu-leaf').allTextContents();
    expect(leaves.sort()).toEqual(['Extra', 'Igrid', 'Vgrid']);

    await page.locator('.radial-menu-leaf', { hasText: 'Extra' }).click();
    await expect(radialMenu(page)).toHaveCount(0);

    const channelDefs = await page.evaluate(() => window.freeboard.getLiveModel().panes()[1].widgets()[0].settings().channelDefs);
    expect(channelDefs).toContainEqual({ variable: 'Extra' });

    await app.close();
  } catch (e) {
    await app.close();
    throw e;
  } finally {
    try { fs.unlinkSync(csvPath); } catch {}
  }
});
