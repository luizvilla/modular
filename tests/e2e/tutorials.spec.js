const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard } = require('./helpers');

test.setTimeout(90_000);

const TUTORIAL_ID = 'core/dashboard-basics';
const DATASOURCE_NAME = 'Tutorial Signal';

async function activeModal(page) {
  return page.locator('#modal_overlay').last();
}

async function openTutorial(app) {
  await app.evaluate(({ BrowserWindow }, id) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.webContents.send('open-tutorial', { id });
    }
  }, TUTORIAL_ID);
}

async function waitForTutorialTab(page) {
  await page.waitForFunction(() => {
    const active = window.dashboardTabs && typeof window.dashboardTabs.getActive === 'function'
      ? window.dashboardTabs.getActive()
      : null;
    return active && active.meta && active.meta.tutorialId === 'core/dashboard-basics';
  }, null, { timeout: 30_000 });
}

async function clickTutorialNext(page) {
  const nextButton = page.locator('#tutorial-stepper [data-action="next"]');
  await expect(nextButton).toBeEnabled();
  await nextButton.click();
}

async function expectTutorialSubtitle(page, title) {
  await expect(page.locator('#tutorial-stepper .tutorial-subtitle')).toHaveText(title);
}

async function expectWelcomeVisible(page) {
  await expect(page.locator('#tutorial-welcome')).toBeVisible();
}

test('tutorials menu and tutorial bootstrap are exposed when enabled', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  const bootstrapState = await page.evaluate(async () => {
    const bootstrap = await window.api.extensions.getBootstrap();
    return {
      tutorials: Array.isArray(bootstrap.tutorials) ? bootstrap.tutorials : [],
      tutorialRoots: Array.isArray(bootstrap.tutorialRoots) ? bootstrap.tutorialRoots : [],
      dashboardWelcomeEntries: Array.isArray(bootstrap.dashboardWelcomeEntries) ? bootstrap.dashboardWelcomeEntries : [],
    };
  });

  expect(bootstrapState.tutorialRoots.length).toBeGreaterThan(0);
  expect(bootstrapState.tutorials).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: TUTORIAL_ID,
      title: 'Dashboard Basics',
      menuSegments: ['Core', 'Dashboard Basics'],
    }),
  ]));
  expect(bootstrapState.dashboardWelcomeEntries).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: 'tutorials-startup',
      trigger: 'startup',
      showWhen: 'empty_default_dashboard',
      actions: expect.arrayContaining([
        expect.objectContaining({ tutorialId: TUTORIAL_ID, label: 'Dashboard Basics' }),
      ]),
    }),
  ]));

  const menuState = await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const tutorials = menu && menu.items.find((item) => item.label === 'Tutorials');
    const coreGroup = tutorials && tutorials.submenu.items.find((item) => item.label === 'Core');
    return {
      hasTutorials: !!tutorials,
      rootLabels: tutorials ? tutorials.submenu.items.map((item) => item.label) : [],
      coreLabels: coreGroup ? coreGroup.submenu.items.map((item) => item.label) : [],
    };
  });

  expect(menuState.hasTutorials).toBe(true);
  expect(menuState.rootLabels).toEqual(expect.arrayContaining(['Core']));
  expect(menuState.coreLabels).toEqual(expect.arrayContaining(['Dashboard Basics']));

  await app.close();
});

test('empty default dashboard shows the tutorial welcome card at startup', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await expectWelcomeVisible(page);
  await expect(page.locator('#tutorial-welcome .tutorial-welcome-title')).toHaveText('Welcome to Modular');
  await expect(page.locator('#tutorial-welcome .tutorial-welcome-action')).toContainText('Dashboard Basics');

  await app.close();
});

test('dashboard basics opens a fresh editable tutorial tab with a visible stepper', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await openTutorial(app);
  await waitForTutorialTab(page);

  const tutorialState = await page.evaluate(() => {
    const active = window.dashboardTabs.getActive();
    const model = window.freeboard.getLiveModel();
    return {
      active,
      isEditing: window.freeboard.isEditing(),
      paneCount: model.panes().length,
      datasourceCount: model.datasources().length,
      visibleStepper: !document.getElementById('tutorial-stepper').hidden,
      stepTitle: document.querySelector('#tutorial-stepper .tutorial-subtitle')?.textContent || '',
    };
  });

  expect(tutorialState.active).toEqual(expect.objectContaining({
    label: 'Tutorial: Dashboard Basics',
    meta: expect.objectContaining({ tutorialId: TUTORIAL_ID }),
  }));
  expect(tutorialState.isEditing).toBe(true);
  expect(tutorialState.paneCount).toBe(0);
  expect(tutorialState.datasourceCount).toBe(0);
  expect(tutorialState.visibleStepper).toBe(true);
  expect(tutorialState.stepTitle).toBe('Panes and widgets');

  await app.close();
});

test('dashboard basics happy path completes with signal generator bound to a time plot', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await openTutorial(app);
  await waitForTutorialTab(page);

  await clickTutorialNext(page);
  await expectTutorialSubtitle(page, 'From datasource to widget');
  await clickTutorialNext(page);
  await expectTutorialSubtitle(page, 'Create a pane');

  await page.locator('#add-pane').click();
  await clickTutorialNext(page);
  await expectTutorialSubtitle(page, 'Create a Signal Generator datasource');

  await page.locator('#side-tab-datasources .table-operation').click();
  await expect(page.locator('#modal_overlay .datasource-tile[data-type="signal_generator_datasource"]')).toBeVisible();
  await page.locator('#modal_overlay .datasource-tile[data-type="signal_generator_datasource"]').click();
  const datasourceModal = await activeModal(page);
  await datasourceModal
    .locator('.form-row')
    .filter({ has: page.locator('.form-label', { hasText: 'Name' }) })
    .locator('input')
    .fill(DATASOURCE_NAME);
  await datasourceModal.locator('#dialog-ok').click();
  await page.waitForFunction((name) => {
    const model = window.freeboard.getLiveModel();
    return model.datasources().some((datasource) => datasource.name() === name && datasource.type() === 'signal_generator_datasource');
  }, DATASOURCE_NAME, { timeout: 20_000 });
  // auto-advances to step 5
  await expectTutorialSubtitle(page, 'Add a time plot widget');

  await page.locator('.gs_w .pane-tools li[title="Add widget"]').first().click();
  const widgetTile = page.locator('#modal_overlay .widget-tile[data-type="time_plot_uplot"]');
  await expect(widgetTile).toBeVisible();
  await widgetTile.click();
  await (await activeModal(page)).locator('#dialog-ok').click();
  await page.waitForFunction(() => {
    const model = window.freeboard.getLiveModel();
    return model.panes().some((pane) => pane.widgets().some((widget) => widget.type() === 'time_plot_uplot'));
  }, null, { timeout: 20_000 });
  await expect(page.locator('#modal_overlay .integrated-plot-editor')).toBeVisible();
  // auto-advances to step 6
  await expectTutorialSubtitle(page, 'Bind one signal to the plot');

  const plotModal = await activeModal(page);
  await plotModal
    .locator('.input-group')
    .filter({ has: page.locator('.input-group-text', { hasText: 'Source' }) })
    .locator('select')
    .first()
    .selectOption(DATASOURCE_NAME);
  await plotModal.getByRole('button', { name: 'Add channel' }).click();
  await plotModal.locator('#dialog-ok').click();

  await page.waitForFunction((name) => {
    const model = window.freeboard.getLiveModel();
    return model.panes().some((pane) => pane.widgets().some((widget) => {
      if (widget.type() !== 'time_plot_uplot') return false;
      const settings = widget.settings() || {};
      const defs = Array.isArray(settings.seriesDefs) ? settings.seriesDefs : [];
      return defs.some((def) => def && def.a && def.a.ds === name);
    }));
  }, DATASOURCE_NAME, { timeout: 20_000 });

  await clickTutorialNext(page);
  await expectTutorialSubtitle(page, 'Tutorial complete');

  const completionState = await page.evaluate((name) => {
    const model = window.freeboard.getLiveModel();
    const widget = model.panes().flatMap((pane) => pane.widgets()).find((entry) => entry.type() === 'time_plot_uplot');
    const defs = widget ? widget.settings().seriesDefs || [] : [];
    return {
      datasourceCount: model.datasources().length,
      paneCount: model.panes().length,
      widgetTypes: model.panes().flatMap((pane) => pane.widgets()).map((entry) => entry.type()),
      boundSeries: defs.filter((def) => def && def.a && def.a.ds === name).length,
    };
  }, DATASOURCE_NAME);

  expect(completionState.datasourceCount).toBe(1);
  expect(completionState.paneCount).toBe(1);
  expect(completionState.widgetTypes).toEqual(expect.arrayContaining(['time_plot_uplot']));
  expect(completionState.boundSeries).toBeGreaterThan(0);

  await app.close();
});

test('tutorial stepper hides when leaving the tutorial tab and resumes on return', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await openTutorial(app);
  await waitForTutorialTab(page);
  await clickTutorialNext(page);
  await clickTutorialNext(page);
  await expectTutorialSubtitle(page, 'Create a pane');

  await page.locator('[data-tab-id="dashboard"]').click();
  await expect(page.locator('#tutorial-stepper')).toBeHidden();

  await page.locator('[data-tab-id^="dashboard:"]').filter({ hasText: 'Tutorial: Dashboard Basics' }).click();
  await expect(page.locator('#tutorial-stepper')).toBeVisible();
  await expectTutorialSubtitle(page, 'Create a pane');

  await app.close();
});

test('welcome action becomes completed after finishing the tutorial and remains clickable', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);
  await expectWelcomeVisible(page);

  await page.locator('#tutorial-welcome .tutorial-welcome-action').first().click();
  await waitForTutorialTab(page);

  await clickTutorialNext(page);
  await clickTutorialNext(page);
  await page.locator('#add-pane').click();
  await clickTutorialNext(page);

  await page.locator('#side-tab-datasources .table-operation').click();
  await page.locator('#modal_overlay .datasource-tile[data-type="signal_generator_datasource"]').click();
  const datasourceModal = await activeModal(page);
  await datasourceModal
    .locator('.form-row')
    .filter({ has: page.locator('.form-label', { hasText: 'Name' }) })
    .locator('input')
    .fill(DATASOURCE_NAME);
  await datasourceModal.locator('#dialog-ok').click();
  await expectTutorialSubtitle(page, 'Add a time plot widget');

  await page.locator('.gs_w .pane-tools li[title="Add widget"]').first().click();
  await page.locator('#modal_overlay .widget-tile[data-type="time_plot_uplot"]').click();
  await (await activeModal(page)).locator('#dialog-ok').click();
  await expectTutorialSubtitle(page, 'Bind one signal to the plot');

  const plotModal = await activeModal(page);
  await plotModal
    .locator('.input-group')
    .filter({ has: page.locator('.input-group-text', { hasText: 'Source' }) })
    .locator('select')
    .first()
    .selectOption(DATASOURCE_NAME);
  await plotModal.getByRole('button', { name: 'Add channel' }).click();
  await plotModal.locator('#dialog-ok').click();
  await clickTutorialNext(page);
  await expectTutorialSubtitle(page, 'Tutorial complete');

  await page.locator('[data-tab-id="dashboard"]').click();
  await expectWelcomeVisible(page);
  const welcomeAction = page.locator('#tutorial-welcome .tutorial-welcome-action').first();
  await expect(welcomeAction).toHaveClass(/is-complete/);
  await expect(welcomeAction).toContainText('Completed');

  await welcomeAction.click();
  await page.waitForFunction(() => {
    const tutorialTabs = Array.from(document.querySelectorAll('[data-tab-id^="dashboard:"]'));
    return tutorialTabs.filter((node) => /Tutorial: Dashboard Basics/.test(node.textContent || '')).length >= 2;
  }, null, { timeout: 20_000 });

  await app.close();
});
