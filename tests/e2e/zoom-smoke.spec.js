const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard } = require('./helpers');

test.setTimeout(60_000);

test('zoom buttons appear, update the label, and reset on dblclick', async () => {
    const { app, page } = await launchApp();
    await waitForDashboard(page);

    // Reset to known state regardless of persisted localStorage value.
    await page.evaluate(() => { if (window.dashboardZoom) window.dashboardZoom.reset(); });
    await expect(page.locator('#zoom-level-label')).toHaveText('100%', { timeout: 3_000 });

    await expect(page.locator('#zoom-out-btn')).toBeVisible();
    await expect(page.locator('#zoom-in-btn')).toBeVisible();

    // Zoom out once → 90%
    await page.locator('#zoom-out-btn').click();
    await expect(page.locator('#zoom-level-label')).toHaveText('90%', { timeout: 3_000 });

    // Zoom in twice → 110%
    await page.locator('#zoom-in-btn').click();
    await page.locator('#zoom-in-btn').click();
    await expect(page.locator('#zoom-level-label')).toHaveText('110%', { timeout: 3_000 });

    // Double-click label → reset to 100%
    await page.locator('#zoom-level-label').dblclick();
    await expect(page.locator('#zoom-level-label')).toHaveText('100%', { timeout: 3_000 });

    await app.close();
});

test('Ctrl+scroll wheel zooms in and out', async () => {
    const { app, page } = await launchApp();
    await waitForDashboard(page);

    await page.evaluate(() => { if (window.dashboardZoom) window.dashboardZoom.reset(); });
    await expect(page.locator('#zoom-level-label')).toHaveText('100%', { timeout: 3_000 });

    // Ctrl+scroll up → zoom in
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    await expect(page.locator('#zoom-level-label')).toHaveText('110%', { timeout: 3_000 });

    // Ctrl+scroll down × 2 → zoom out to 90%
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 120);
    await page.mouse.wheel(0, 120);
    await page.keyboard.up('Control');
    await expect(page.locator('#zoom-level-label')).toHaveText('90%', { timeout: 3_000 });

    // Scroll without Ctrl → no zoom change
    await page.mouse.wheel(0, -120);
    await expect(page.locator('#zoom-level-label')).toHaveText('90%', { timeout: 2_000 });

    await app.close();
});

test('right-click drag pans #board-content', async () => {
    const { app, page } = await launchApp();
    await waitForDashboard(page);

    // Inject a tall spacer so #board-content is scrollable without needing real panes.
    await page.evaluate(() => {
        const el = document.getElementById('board-content');
        const spacer = document.createElement('div');
        spacer.id = 'pan-test-spacer';
        spacer.style.height = '3000px';
        el.appendChild(spacer);
    });

    await page.waitForFunction(() => {
        const el = document.getElementById('board-content');
        return el && el.scrollHeight > el.clientHeight;
    }, null, { timeout: 5_000 });

    const boardBox = await page.locator('#board-content').boundingBox();
    const cx = boardBox.x + boardBox.width / 2;
    const cy = boardBox.y + boardBox.height / 2;

    // is-panning class appears on right-mousedown and disappears on right-mouseup.
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'right' });
    await expect(page.locator('body')).toHaveClass(/is-panning/, { timeout: 2_000 });
    await page.mouse.up({ button: 'right' });
    await expect(page.locator('body')).not.toHaveClass(/is-panning/, { timeout: 2_000 });

    // Start at scrollTop = 0, drag upward → scrollTop should increase.
    await page.evaluate(() => { document.getElementById('board-content').scrollTop = 0; });
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(cx, cy - 150, { steps: 10 });
    await page.mouse.up({ button: 'right' });

    const scrollTop = await page.evaluate(() => document.getElementById('board-content').scrollTop);
    expect(scrollTop).toBeGreaterThan(0);

    await app.close();
});
