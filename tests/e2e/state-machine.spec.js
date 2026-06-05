const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

test.setTimeout(90_000);

// ── helpers ──────────────────────────────────────────────────────────────────

async function enableEditing(page) {
    await page.evaluate(() => window.freeboard.setEditing(true));
    await page.waitForTimeout(400);
}

async function openEditorViaWrench(page, paneIndex = 0, widgetIndex = 0) {
    const subSection = page.locator('.gs_w').nth(paneIndex).locator('.sub-section').nth(widgetIndex);
    await subSection.hover();
    await subSection.locator('.tool-edit').click();
}

function activeModal(page) {
    return page.locator('#modal_overlay').last();
}

async function openEditorDirectly(page) {
    await page.evaluate(() => {
        const widgetModel = window.freeboard.getLiveModel().panes()[0].widgets()[0];
        window.ModularStateMachineEditor.open(widgetModel);
    });
    await page.waitForSelector('.sm-editor-modal', { timeout: 10_000 });
}

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

// ── Session 2: editor modal ───────────────────────────────────────────────────

test('state machine editor opens via ModularStateMachineEditor.open', async () => {
    const { app, page } = await launchApp();
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('state_machine_dashboard.json'));
    await page.waitForSelector('.state-machine-widget', { timeout: 15_000 });

    await openEditorDirectly(page);

    await expect(activeModal(page).locator('header .title')).toHaveText('State Machine Editor');
    await expect(page.locator('.sm-editor-modal')).toBeVisible();

    await activeModal(page).locator('#dialog-cancel').click();
    await app.close();
});

test('editor: wrench icon opens the state machine editor', async () => {
    const { app, page } = await launchApp();
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('state_machine_dashboard.json'));
    await page.waitForSelector('.state-machine-widget', { timeout: 15_000 });
    await enableEditing(page);

    await openEditorViaWrench(page);
    await page.waitForSelector('.sm-editor-modal', { timeout: 10_000 });

    await expect(activeModal(page).locator('header .title')).toHaveText('State Machine Editor');

    await activeModal(page).locator('#dialog-cancel').click();
    await app.close();
});

test('editor: Add State creates a circle in the SVG canvas', async () => {
    const { app, page } = await launchApp();
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('state_machine_dashboard.json'));
    await page.waitForSelector('.state-machine-widget', { timeout: 15_000 });

    await openEditorDirectly(page);

    await page.locator('.sm-editor-modal button', { hasText: '+ Add State' }).click();
    await page.waitForTimeout(200);

    // SVG canvas should have at least one state circle (each state has one <g data-id>)
    const stateGroups = page.locator('.sm-canvas g[data-id]');
    await expect(stateGroups).toHaveCount(1);

    // Sidebar list should show the state
    await expect(page.locator('.sm-editor-modal .sm-sidebar .small', { hasText: 'State 1' })).toBeVisible();

    await activeModal(page).locator('#dialog-cancel').click();
    await app.close();
});

test('editor: clicking a state shows its params in the bottom panel', async () => {
    const { app, page } = await launchApp();
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('state_machine_dashboard.json'));
    await page.waitForSelector('.state-machine-widget', { timeout: 15_000 });

    await openEditorDirectly(page);

    // Add two states
    await page.locator('.sm-editor-modal button', { hasText: '+ Add State' }).click();
    await page.waitForTimeout(100);
    await page.locator('.sm-editor-modal button', { hasText: '+ Add State' }).click();
    await page.waitForTimeout(100);

    // Click first state in the sidebar list (the auto-selected state is the last added)
    await page.locator('.sm-editor-modal .sm-sidebar .small', { hasText: 'State 1' }).click();
    await page.waitForTimeout(200);

    // Bottom panel should show a Name input and a Power dropdown
    const nameInput = page.locator('.sm-params-panel input[type="text"]').first();
    await expect(nameInput).toBeVisible();
    await expect(page.locator('.sm-params-panel select')).toBeVisible();

    await activeModal(page).locator('#dialog-cancel').click();
    await app.close();
});

test('editor: save persists states and transitions to widget settings', async () => {
    const { app, page } = await launchApp();
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('state_machine_dashboard.json'));
    await page.waitForSelector('.state-machine-widget', { timeout: 15_000 });

    await openEditorDirectly(page);

    // Add two states
    await page.locator('.sm-editor-modal button', { hasText: '+ Add State' }).click();
    await page.waitForTimeout(100);
    await page.locator('.sm-editor-modal button', { hasText: '+ Add State' }).click();
    await page.waitForTimeout(100);

    // Save
    await activeModal(page).locator('#dialog-ok').click();
    await page.waitForFunction(() => document.querySelectorAll('#modal_overlay').length === 0);

    const settings = await page.evaluate(() => {
        return window.freeboard.getLiveModel().panes()[0].widgets()[0].settings();
    });
    expect(settings.states.length).toBe(2);
    expect(settings.states[0].id).toBeTruthy();

    await app.close();
});

test('editor: deleting a state removes it from SVG and sidebar', async () => {
    const { app, page } = await launchApp();
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('state_machine_dashboard.json'));
    await page.waitForSelector('.state-machine-widget', { timeout: 15_000 });

    await openEditorDirectly(page);

    await page.locator('.sm-editor-modal button', { hasText: '+ Add State' }).click();
    await page.waitForTimeout(100);
    await page.locator('.sm-editor-modal button', { hasText: '+ Add State' }).click();
    await page.waitForTimeout(100);

    await expect(page.locator('.sm-canvas g[data-id]')).toHaveCount(2);

    // Delete first state via sidebar ✕ button
    await page.locator('.sm-editor-modal .sm-sidebar .btn-outline-danger').first().click();
    await page.waitForTimeout(200);

    await expect(page.locator('.sm-canvas g[data-id]')).toHaveCount(1);

    await activeModal(page).locator('#dialog-cancel').click();
    await app.close();
});

test('editor: transition form opens via Add Transition button', async () => {
    const { app, page } = await launchApp();
    await waitForDashboard(page);
    await loadDashboard(page, fixturePath('state_machine_dashboard.json'));
    await page.waitForSelector('.state-machine-widget', { timeout: 15_000 });

    await openEditorDirectly(page);

    // Add two states first
    await page.locator('.sm-editor-modal button', { hasText: '+ Add State' }).click();
    await page.waitForTimeout(100);
    await page.locator('.sm-editor-modal button', { hasText: '+ Add State' }).click();
    await page.waitForTimeout(100);

    // Switch to Transitions tab and click Add
    await page.locator('.sm-editor-modal button', { hasText: 'Transitions' }).click();
    await page.waitForTimeout(100);
    await page.locator('.sm-editor-modal button', { hasText: '+ Add Transition' }).click();
    await page.waitForTimeout(200);

    // Transition form should appear in params panel
    await expect(page.locator('.sm-params-panel .fw-semibold', { hasText: 'Add Transition' })).toBeVisible();
    await expect(page.locator('.sm-params-panel select').first()).toBeVisible();

    await activeModal(page).locator('#dialog-cancel').click();
    await app.close();
});
