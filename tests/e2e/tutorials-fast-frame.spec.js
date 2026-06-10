const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard } = require('./helpers');

test.setTimeout(120_000);

const TUTORIAL_ID = 'core/fast-frame-from-csv';

async function openFastFrameTutorial(app) {
  await app.evaluate(({ BrowserWindow }, id) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.webContents.send('open-tutorial', { id });
  }, TUTORIAL_ID);
}

async function waitForTutorialTab(page) {
  await page.waitForFunction((id) => {
    const active = window.dashboardTabs && typeof window.dashboardTabs.getActive === 'function'
      ? window.dashboardTabs.getActive()
      : null;
    return active && active.meta && active.meta.tutorialId === id;
  }, TUTORIAL_ID, { timeout: 30_000 });
}

async function clickTutorialNext(page) {
  const nextButton = page.locator('#tutorial-stepper [data-action="next"]');
  await expect(nextButton).toBeEnabled({ timeout: 10_000 });
  await nextButton.click();
}

async function expectSubtitle(page, title) {
  await expect(page.locator('#tutorial-stepper .tutorial-subtitle')).toHaveText(title, { timeout: 15_000 });
}

async function activeModal(page) {
  return page.locator('#modal_overlay').last();
}

test('fast-frame-from-csv tutorial appears in bootstrap and welcome card', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  const bootstrapState = await page.evaluate(async () => {
    const bootstrap = await window.api.extensions.getBootstrap();
    return {
      tutorials: Array.isArray(bootstrap.tutorials) ? bootstrap.tutorials : [],
      welcomeEntries: Array.isArray(bootstrap.dashboardWelcomeEntries) ? bootstrap.dashboardWelcomeEntries : [],
    };
  });

  expect(bootstrapState.tutorials).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: TUTORIAL_ID,
      title: 'Fast Frame From CSV',
      menuSegments: ['Core', 'Fast Frame From Csv'],
    }),
  ]));

  const ffTutorial = bootstrapState.tutorials.find((t) => t.id === TUTORIAL_ID);
  expect(ffTutorial).toBeTruthy();
  expect(ffTutorial.resources).toEqual(expect.objectContaining({ csv: expect.stringContaining('sample_data.csv') }));
  expect(ffTutorial.steps.some((s) => s.actions && s.actions.some((a) => a.kind === 'apply_tutorial_csv'))).toBe(true);

  const startupEntry = bootstrapState.welcomeEntries.find((e) => e.id === 'tutorials-startup');
  expect(startupEntry).toBeTruthy();
  expect(startupEntry.actions).toEqual(expect.arrayContaining([
    expect.objectContaining({ tutorialId: TUTORIAL_ID, label: 'Fast Frame From CSV' }),
  ]));

  const menuState = await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const tutorialsItem = menu && menu.items.find((item) => item.label === 'Tutorials');
    const coreGroup = tutorialsItem && tutorialsItem.submenu.items.find((item) => item.label === 'Core');
    return {
      coreLabels: coreGroup ? coreGroup.submenu.items.map((item) => item.label) : [],
    };
  });

  expect(menuState.coreLabels).toEqual(expect.arrayContaining(['Fast Frame From CSV']));

  await app.close();
});

test('fast-frame-from-csv tutorial welcome card shows Fast Frame action', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await expect(page.locator('#tutorial-welcome')).toBeVisible();
  await expect(
    page.locator('#tutorial-welcome .tutorial-welcome-action').filter({ hasText: 'Fast Frame From CSV' })
  ).toBeVisible();

  await app.close();
});

test('fast-frame-from-csv tutorial opens a fresh tab with stepper', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await openFastFrameTutorial(app);
  await waitForTutorialTab(page);

  const state = await page.evaluate((id) => {
    const active = window.dashboardTabs.getActive();
    return {
      label: active.label,
      tutorialId: active.meta && active.meta.tutorialId,
      isEditing: window.freeboard.isEditing(),
      stepTitle: document.querySelector('#tutorial-stepper .tutorial-subtitle')?.textContent || '',
      stepperVisible: !document.getElementById('tutorial-stepper').hidden,
    };
  }, TUTORIAL_ID);

  expect(state.label).toBe('Tutorial: Fast Frame From CSV');
  expect(state.tutorialId).toBe(TUTORIAL_ID);
  expect(state.isEditing).toBe(true);
  expect(state.stepperVisible).toBe(true);
  expect(state.stepTitle).toBe('What is a Fast Frame plot?');

  await app.close();
});

test('fast-frame-from-csv tutorial happy path completes with fast_frame_plot_configured', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await openFastFrameTutorial(app);
  await waitForTutorialTab(page);

  // Step 1: intro (manual)
  await expectSubtitle(page, 'What is a Fast Frame plot?');
  await clickTutorialNext(page);

  // Step 2: create pane
  await expectSubtitle(page, 'Create a pane');
  await page.locator('#add-pane').click();
  await clickTutorialNext(page);

  // Step 3: add fast frame widget — auto-opens integrated editor
  await expectSubtitle(page, 'Add a Fast Frame Plot widget');
  await page.locator('.gs_w .pane-tools li[title="Add widget"]').first().click();
  const ffTile = page.locator('#modal_overlay .widget-tile[data-type="fast_frame_plot"]');
  await expect(ffTile).toBeVisible({ timeout: 10_000 });
  await ffTile.click();
  // Skip immediate ok — clicking the tile auto-fires dialog-ok; the integrated editor opens.
  // Close it with Save (empty settings) to trigger widget_type_exists and auto-advance to step 4.
  await (await activeModal(page)).locator('#dialog-ok').click();
  await page.waitForFunction(() => {
    const model = window.freeboard.getLiveModel();
    return model.panes().some((p) => p.widgets().some((w) => w.type() === 'fast_frame_plot'));
  }, null, { timeout: 20_000 });
  // auto-advances on widget_type_exists: fast_frame_plot; step 4 entered, action fires
  await expectSubtitle(page, 'Configure the plot');

  // Step 4: configure-channels.
  // The action (apply_tutorial_csv) set window._tutorialPendingCsv when step 4 was entered.
  // Re-open the editor to pick up the pre-loaded CSV.
  const pendingCsv = await page.evaluate(() => window._tutorialPendingCsv || null);
  // If _tutorialPendingCsv was already consumed by a residual editor open, check via widget
  // programmatically open the Fast Frame editor so the tutorial CSV gets pre-loaded.
  await page.evaluate(() => {
    const model = window.freeboard.getLiveModel();
    const widget = model.panes().flatMap((p) => p.widgets()).find((w) => w.type() === 'fast_frame_plot');
    if (widget) window.freeboard.openIntegratedPlotEditor(widget, 'fast_frame_plot');
  });

  const ffEditor = await activeModal(page);
  await expect(ffEditor.locator('.integrated-plot-editor')).toBeVisible({ timeout: 10_000 });

  // Verify the CSV was pre-loaded by checking that columns are available in the X Variable select.
  // The sample_data.csv has a time_ms-like first unnamed column; at minimum check select has options.
  await page.waitForFunction(async () => {
    const editor = document.querySelector('#modal_overlay .integrated-plot-editor');
    if (!editor) return false;
    // Look for the X Variable select — it should have options loaded from the CSV.
    const selects = editor.querySelectorAll('select');
    // At least one select should have more than 1 option (the columns).
    return Array.from(selects).some((s) => s.options.length > 1);
  }, null, { timeout: 15_000 });

  // Add a math channel: A=I1_low_value, Op=+, B=I2_low_value
  await ffEditor.locator('select').filter({ has: page.locator('option[value="math"]') }).selectOption('math');

  // Wait for math controls to appear
  await page.waitForFunction(() => {
    const editor = document.querySelector('#modal_overlay .integrated-plot-editor');
    return editor && Array.from(editor.querySelectorAll('option')).some((o) => o.value === 'I1_low_value');
  }, null, { timeout: 10_000 });

  await ffEditor.locator('select').filter({ has: page.locator('option[value="I1_low_value"]') }).first().selectOption('I1_low_value');

  // Click Add channel
  await ffEditor.getByRole('button', { name: 'Add channel' }).click();
  await ffEditor.locator('#dialog-ok').click();

  // Wait for fast_frame_plot_configured to fire (csvPath set + at least one seriesDef)
  await page.waitForFunction(() => {
    const model = window.freeboard.getLiveModel();
    return model.panes().some((p) => p.widgets().some((w) => {
      if (w.type() !== 'fast_frame_plot') return false;
      const s = w.settings() || {};
      const csvPath = typeof s.csvPath === 'string' ? s.csvPath.trim() : '';
      const defs = Array.isArray(s.seriesDefs) ? s.seriesDefs : [];
      return !!(csvPath && defs.length > 0);
    }));
  }, null, { timeout: 20_000 });

  // Next button should now be enabled
  await expect(page.locator('#tutorial-stepper [data-action="next"]')).toBeEnabled({ timeout: 15_000 });
  await clickTutorialNext(page);

  // Step 5: complete
  await expectSubtitle(page, 'Tutorial complete');
  await expect(page.locator('#tutorial-stepper [data-action="next"]')).toHaveText('Done');

  const finalState = await page.evaluate(() => {
    const model = window.freeboard.getLiveModel();
    const widget = model.panes().flatMap((p) => p.widgets()).find((w) => w.type() === 'fast_frame_plot');
    const s = widget ? widget.settings() : {};
    return {
      hasFastFrameWidget: !!widget,
      csvPath: (s && s.csvPath) || '',
      seriesCount: s && Array.isArray(s.seriesDefs) ? s.seriesDefs.length : 0,
    };
  });

  expect(finalState.hasFastFrameWidget).toBe(true);
  expect(finalState.csvPath).toContain('sample_data.csv');
  expect(finalState.seriesCount).toBeGreaterThan(0);

  await app.close();
});
