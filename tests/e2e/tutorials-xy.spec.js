const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard } = require('./helpers');

test.setTimeout(120_000);

const TUTORIAL_ID = 'core/xy-signal-generator';
const DS_X = 'Signal X';
const DS_Y = 'Signal Y';

async function openXyTutorial(app) {
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

async function addSignalGenerator(page, name, phase) {
  await page.locator('#side-tab-datasources .table-operation').click();
  const modal = await activeModal(page);
  await modal.locator('.datasource-tile[data-type="signal_generator_datasource"]').click();
  const nameInput = (await activeModal(page))
    .locator('.form-row')
    .filter({ has: page.locator('.form-label', { hasText: 'Name' }) })
    .locator('input');
  await nameInput.fill(name);
  if (phase != null) {
    const phaseInput = (await activeModal(page))
      .locator('.form-row')
      .filter({ has: page.locator('.form-label', { hasText: 'Phase' }) })
      .locator('input');
    if (await phaseInput.count()) {
      await phaseInput.fill(String(phase));
    }
  }
  await (await activeModal(page)).locator('#dialog-ok').click();
}

test('xy-signal-generator tutorial appears in bootstrap and welcome card', async () => {
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
      title: 'XY Signal Generator',
      menuSegments: ['Core', 'Xy Signal Generator'],
    }),
  ]));

  const startupEntry = bootstrapState.welcomeEntries.find((e) => e.id === 'tutorials-startup');
  expect(startupEntry).toBeTruthy();
  expect(startupEntry.actions).toEqual(expect.arrayContaining([
    expect.objectContaining({ tutorialId: TUTORIAL_ID, label: 'XY Signal Generator' }),
  ]));

  const menuState = await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const tutorialsItem = menu && menu.items.find((item) => item.label === 'Tutorials');
    const coreGroup = tutorialsItem && tutorialsItem.submenu.items.find((item) => item.label === 'Core');
    return {
      coreLabels: coreGroup ? coreGroup.submenu.items.map((item) => item.label) : [],
    };
  });

  expect(menuState.coreLabels).toEqual(expect.arrayContaining(['XY Signal Generator']));

  await app.close();
});

test('xy-signal-generator tutorial welcome card shows XY action', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await expect(page.locator('#tutorial-welcome')).toBeVisible();
  await expect(
    page.locator('#tutorial-welcome .tutorial-welcome-action').filter({ hasText: 'XY Signal Generator' })
  ).toBeVisible();

  await app.close();
});

test('xy-signal-generator tutorial opens a fresh tab with stepper', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await openXyTutorial(app);
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

  expect(state.label).toBe('Tutorial: XY Signal Generator');
  expect(state.tutorialId).toBe(TUTORIAL_ID);
  expect(state.isEditing).toBe(true);
  expect(state.stepperVisible).toBe(true);
  expect(state.stepTitle).toBe('What is an XY plot?');

  await app.close();
});

test('xy-signal-generator tutorial happy path completes with xy_plot_sources_bound', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await openXyTutorial(app);
  await waitForTutorialTab(page);

  // Step 1: intro (manual)
  await expectSubtitle(page, 'What is an XY plot?');
  await clickTutorialNext(page);

  // Step 2: create pane
  await expectSubtitle(page, 'Create a pane');
  await page.locator('#add-pane').click();
  await clickTutorialNext(page);
  await expectSubtitle(page, 'Create the X-axis datasource');

  // Step 3: first signal generator (Signal X)
  await addSignalGenerator(page, DS_X, null);
  await page.waitForFunction((name) => {
    const model = window.freeboard.getLiveModel();
    return model.datasources().some((ds) => ds.name() === name && ds.type() === 'signal_generator_datasource');
  }, DS_X, { timeout: 20_000 });
  // auto-advances on datasource_type_exists count:1
  await expectSubtitle(page, 'Create the Y-axis datasource');

  // Step 4: second signal generator (Signal Y)
  await addSignalGenerator(page, DS_Y, 90);
  await page.waitForFunction((name) => {
    const model = window.freeboard.getLiveModel();
    return model.datasources().some((ds) => ds.name() === name && ds.type() === 'signal_generator_datasource');
  }, DS_Y, { timeout: 20_000 });
  // auto-advances on datasource_type_exists count:2
  await expectSubtitle(page, 'Add the XY Plot widget');

  // Step 5: add XY plot widget — opens integrated editor after adding
  await page.locator('.gs_w .pane-tools li[title="Add widget"]').first().click();
  const xyTile = page.locator('#modal_overlay .widget-tile[data-type="xy_plot_uplot"]');
  await expect(xyTile).toBeVisible({ timeout: 10_000 });
  await xyTile.click();
  await (await activeModal(page)).locator('#dialog-ok').click();
  await page.waitForFunction(() => {
    const model = window.freeboard.getLiveModel();
    return model.panes().some((p) => p.widgets().some((w) => w.type() === 'xy_plot_uplot'));
  }, null, { timeout: 20_000 });
  // auto-advances on widget_type_exists: xy_plot_uplot; integrated editor opens
  await expectSubtitle(page, 'Bind X and Y sources');
  await expect(page.locator('#modal_overlay .integrated-plot-editor')).toBeVisible({ timeout: 10_000 });

  // Step 6: configure sources in the integrated XY editor.
  // Each axis card is a <div class="border rounded"> (createSection uses <section>, so div targets
  // only the axis cards and not the parent "Sources" section).
  const xyEditor = await activeModal(page);
  // X Source datasource select
  await xyEditor
    .locator('div.border.rounded')
    .filter({ has: page.locator('h4', { hasText: 'X Source' }) })
    .locator('.input-group')
    .filter({ has: page.locator('.input-group-text', { hasText: 'Datasource' }) })
    .locator('select')
    .selectOption(DS_X);
  // Y Source datasource select
  await xyEditor
    .locator('div.border.rounded')
    .filter({ has: page.locator('h4', { hasText: 'Y Source' }) })
    .locator('.input-group')
    .filter({ has: page.locator('.input-group-text', { hasText: 'Datasource' }) })
    .locator('select')
    .selectOption(DS_Y);
  await xyEditor.locator('#dialog-ok').click();

  await page.waitForFunction((names) => {
    const model = window.freeboard.getLiveModel();
    return model.panes().some((p) => p.widgets().some((w) => {
      if (w.type() !== 'xy_plot_uplot') return false;
      const s = w.settings() || {};
      const x = s.xSourceDef;
      const y = s.ySourceDef;
      if (!x || !y) return false;
      const xDs = typeof x === 'string' ? JSON.parse(x).ds : x.ds;
      const yDs = typeof y === 'string' ? JSON.parse(y).ds : y.ds;
      return names.includes(xDs) && names.includes(yDs);
    }));
  }, [DS_X, DS_Y], { timeout: 20_000 });

  // xy_plot_sources_bound fires → Next enabled
  await expect(page.locator('#tutorial-stepper [data-action="next"]')).toBeEnabled({ timeout: 15_000 });
  await clickTutorialNext(page);

  // Step 7: complete
  await expectSubtitle(page, 'Tutorial complete');
  await expect(page.locator('#tutorial-stepper [data-action="next"]')).toHaveText('Done');

  const finalState = await page.evaluate((names) => {
    const model = window.freeboard.getLiveModel();
    const xyWidget = model.panes().flatMap((p) => p.widgets()).find((w) => w.type() === 'xy_plot_uplot');
    const settings = xyWidget ? xyWidget.settings() : {};
    const xDef = settings.xSourceDef;
    const yDef = settings.ySourceDef;
    const xDs = xDef ? (typeof xDef === 'string' ? JSON.parse(xDef).ds : xDef.ds) : null;
    const yDs = yDef ? (typeof yDef === 'string' ? JSON.parse(yDef).ds : yDef.ds) : null;
    return {
      datasourceCount: model.datasources().length,
      hasXyWidget: !!xyWidget,
      xDs,
      yDs,
    };
  }, [DS_X, DS_Y]);

  expect(finalState.datasourceCount).toBe(2);
  expect(finalState.hasXyWidget).toBe(true);
  expect([DS_X, DS_Y]).toContain(finalState.xDs);
  expect([DS_X, DS_Y]).toContain(finalState.yDs);
  expect(finalState.xDs).not.toBe(finalState.yDs);

  await app.close();
});
