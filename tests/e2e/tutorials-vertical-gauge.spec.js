const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard } = require('./helpers');

test.setTimeout(120_000);

const TUTORIAL_ID = 'core/vertical-gauge-basics';

async function openGaugeTutorial(app) {
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

test('vertical-gauge-basics tutorial appears in bootstrap and welcome card', async () => {
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
      title: 'Vertical Gauge Basics',
      menuSegments: ['Core', 'Vertical Gauge Basics'],
    }),
  ]));

  const gaugeTutorial = bootstrapState.tutorials.find((t) => t.id === TUTORIAL_ID);
  expect(gaugeTutorial).toBeTruthy();
  expect(gaugeTutorial.steps.some((s) => s.completion && s.completion.kind === 'gauge_source_bound')).toBe(true);
  expect(gaugeTutorial.steps.some((s) => s.completion && s.completion.kind === 'gauge_runtime_offset_adjusted')).toBe(true);

  const startupEntry = bootstrapState.welcomeEntries.find((e) => e.id === 'tutorials-startup');
  expect(startupEntry).toBeTruthy();
  expect(startupEntry.actions).toEqual(expect.arrayContaining([
    expect.objectContaining({ tutorialId: TUTORIAL_ID, label: 'Vertical Gauge Basics' }),
  ]));

  const menuState = await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const tutorialsItem = menu && menu.items.find((item) => item.label === 'Tutorials');
    const coreGroup = tutorialsItem && tutorialsItem.submenu.items.find((item) => item.label === 'Core');
    return {
      coreLabels: coreGroup ? coreGroup.submenu.items.map((item) => item.label) : [],
    };
  });

  expect(menuState.coreLabels).toEqual(expect.arrayContaining(['Vertical Gauge Basics']));

  await app.close();
});

test('vertical-gauge-basics tutorial welcome card shows gauge action', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await expect(page.locator('#tutorial-welcome')).toBeVisible();
  await expect(
    page.locator('#tutorial-welcome .tutorial-welcome-action').filter({ hasText: 'Vertical Gauge Basics' })
  ).toBeVisible();

  await app.close();
});

test('vertical-gauge-basics tutorial opens a fresh tab with stepper', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await openGaugeTutorial(app);
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

  expect(state.label).toBe('Tutorial: Vertical Gauge Basics');
  expect(state.tutorialId).toBe(TUTORIAL_ID);
  expect(state.isEditing).toBe(true);
  expect(state.stepperVisible).toBe(true);
  expect(state.stepTitle).toBe('What is a Vertical Gauge?');

  await app.close();
});

test('vertical-gauge-basics tutorial happy path completes with gauge_runtime_offset_adjusted', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await openGaugeTutorial(app);
  await waitForTutorialTab(page);

  // Step 1: intro (manual)
  await expectSubtitle(page, 'What is a Vertical Gauge?');
  await clickTutorialNext(page);

  // Step 2: add signal generator datasource
  await expectSubtitle(page, 'Add a signal generator');
  await page.locator('#side-tab-datasources .table-operation').click();
  const sgTile = page.locator('#modal_overlay .datasource-tile[data-type="signal_generator_datasource"]');
  await expect(sgTile).toBeVisible({ timeout: 10_000 });
  await sgTile.click();
  // Name input dialog
  await page.locator('#modal_overlay .form-row input').first().fill('TestSignal');
  await page.locator('#modal_overlay #dialog-ok').click();
  await page.waitForFunction(() => {
    const model = window.freeboard.getLiveModel();
    return model.datasources().some((ds) => ds.type() === 'signal_generator_datasource');
  }, null, { timeout: 15_000 });
  await clickTutorialNext(page);

  // Step 3: create pane
  await expectSubtitle(page, 'Create a pane');
  await page.locator('#add-pane').click();
  await clickTutorialNext(page);

  // Step 4: add vertical gauge widget (auto-advances on widget_type_exists)
  await expectSubtitle(page, 'Add a Vertical Gauge widget');
  await page.locator('.gs_w .pane-tools li[title="Add widget"]').first().click();
  const gaugeTile = page.locator('#modal_overlay .widget-tile[data-type="vertical_gauge"]');
  await expect(gaugeTile).toBeVisible({ timeout: 10_000 });
  await gaugeTile.click();
  // Standard settings dialog appears with title field
  await page.locator('#modal_overlay #dialog-ok').click();
  await page.waitForFunction(() => {
    const model = window.freeboard.getLiveModel();
    return model.panes().some((p) => p.widgets().some((w) => w.type() === 'vertical_gauge'));
  }, null, { timeout: 20_000 });
  // auto-advances to configure-gauge
  await expectSubtitle(page, 'Connect the gauge to your signal');

  // Step 5: open integrated editor, bind to signal generator
  await page.evaluate(() => {
    const model = window.freeboard.getLiveModel();
    const widget = model.panes().flatMap((p) => p.widgets()).find((w) => w.type() === 'vertical_gauge');
    if (widget) window.freeboard.openIntegratedPlotEditor(widget, 'vertical_gauge');
  });

  const gaugeEditor = page.locator('#modal_overlay .integrated-plot-editor');
  await expect(gaugeEditor).toBeVisible({ timeout: 10_000 });

  // Bind to signal generator: select datasource in source section
  await page.waitForFunction(() => {
    const editor = document.querySelector('#modal_overlay .integrated-plot-editor');
    if (!editor) return false;
    return Array.from(editor.querySelectorAll('option')).some((o) => o.value === 'TestSignal');
  }, null, { timeout: 15_000 });

  await gaugeEditor.locator('select').filter({ has: page.locator('option[value="TestSignal"]') }).first().selectOption('TestSignal');
  await page.locator('#modal_overlay #dialog-ok').click();

  // Wait for gauge_source_bound: sourceDef.ds is non-empty
  await page.waitForFunction(() => {
    const model = window.freeboard.getLiveModel();
    return model.panes().some((p) => p.widgets().some((w) => {
      if (w.type() !== 'vertical_gauge') return false;
      const s = w.settings() || {};
      const sd = s.sourceDef;
      return !!(sd && typeof sd.ds === 'string' && sd.ds.trim());
    }));
  }, null, { timeout: 20_000 });

  await expect(page.locator('#tutorial-stepper [data-action="next"]')).toBeEnabled({ timeout: 15_000 });
  await clickTutorialNext(page);

  // Step 6: adjust offset
  await expectSubtitle(page, 'Explore runtime offset');

  // Click the + offset button on the gauge widget
  await page.locator('.gauge-family-host .gauge-offset-btn').last().click();

  // Wait for gauge_runtime_offset_adjusted: offset value is non-zero
  await page.waitForFunction(() => {
    const el = document.querySelector('.gauge-family-host .gauge-offset-value');
    if (!el) return false;
    const val = parseFloat(el.textContent || '0');
    return !isNaN(val) && val !== 0;
  }, null, { timeout: 10_000 });

  await expect(page.locator('#tutorial-stepper [data-action="next"]')).toBeEnabled({ timeout: 10_000 });
  await clickTutorialNext(page);

  // Step 7: complete
  await expectSubtitle(page, 'Tutorial complete');
  await expect(page.locator('#tutorial-stepper [data-action="next"]')).toHaveText('Done');

  const finalState = await page.evaluate(() => {
    const model = window.freeboard.getLiveModel();
    const widget = model.panes().flatMap((p) => p.widgets()).find((w) => w.type() === 'vertical_gauge');
    const s = widget ? widget.settings() : {};
    const offsetEl = document.querySelector('.gauge-family-host .gauge-offset-value');
    return {
      hasGaugeWidget: !!widget,
      sourceDsName: (s && s.sourceDef && s.sourceDef.ds) || '',
      offsetValue: offsetEl ? parseFloat(offsetEl.textContent || '0') : 0,
    };
  });

  expect(finalState.hasGaugeWidget).toBe(true);
  expect(finalState.sourceDsName).toBe('TestSignal');
  expect(finalState.offsetValue).not.toBe(0);

  await app.close();
});
