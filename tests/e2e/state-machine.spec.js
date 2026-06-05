const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

test.setTimeout(60_000);

test('state machine widget renders with placeholder and disabled Run button', async () => {
    const { app, page } = await launchApp();
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('state_machine_dashboard.json'));

    await page.waitForSelector('.state-machine-widget', { timeout: 15_000 });

    const runBtn = page.locator('.state-machine-widget button', { hasText: 'Run' });
    await expect(runBtn).toBeVisible();
    await expect(runBtn).toBeDisabled();

    const svgText = await page.locator('.sm-pane-svg text').first().textContent();
    expect(svgText).toContain('No states');

    await app.close();
});

test('state machine widget renders states and transitions from settings', async () => {
    const { app, page } = await launchApp();
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('state_machine_dashboard.json'));

    await page.waitForSelector('.state-machine-widget', { timeout: 15_000 });

    await page.evaluate(() => {
        const widget = window.freeboard.getLiveModel().panes()[0].widgets()[0].widgetInstance;
        widget.onSettingsChanged({
            title: 'Test',
            datasource: '',
            deviceType: 'TWIST',
            initialState: 's0',
            states: [
                { id: 's0', name: 'IDLE', x: 100, y: 80, powerMode: 'IDLE', legs: [] },
                { id: 's1', name: 'RUN',  x: 250, y: 80, powerMode: 'ON',   legs: [] }
            ],
            transitions: [
                { id: 't0', from: 's0', to: 's1', variable: 'V1', mathOp: 'x', mathK: 1, mathB: 0, operator: '>', threshold: 10 }
            ]
        });
    });

    const circles = page.locator('.sm-pane-svg circle');
    await expect(circles).toHaveCount(3);

    const runBtn = page.locator('.state-machine-widget button', { hasText: 'Run' });
    await expect(runBtn).toBeEnabled();

    await app.close();
});

test('state machine model is accessible and has correct structure after load', async () => {
    const { app, page } = await launchApp();
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('state_machine_dashboard.json'));

    await page.waitForSelector('.state-machine-widget', { timeout: 15_000 });

    const widgetType = await page.evaluate(() => {
        return window.freeboard.getLiveModel().panes()[0].widgets()[0].type();
    });
    expect(widgetType).toBe('state_machine');

    const settings = await page.evaluate(() => {
        return window.freeboard.getLiveModel().panes()[0].widgets()[0].settings();
    });
    expect(Array.isArray(settings.states)).toBe(true);
    expect(Array.isArray(settings.transitions)).toBe(true);

    await app.close();
});
