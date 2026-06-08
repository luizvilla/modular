const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard } = require('./helpers');

test.setTimeout(120_000);

const TUTORIAL_ID = 'hardware/opposition-testing';
const COURSEWARE_ID = 'Hackathons/Opposition_Testing';

async function openOppositionTutorial(app) {
  await app.evaluate(({ BrowserWindow }, id) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.webContents.send('open-tutorial', { id });
  }, TUTORIAL_ID);
}

async function openCoursewareTab(app, id) {
  await app.evaluate(({ BrowserWindow }, payload) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.webContents.send('open-doc-tab', payload);
  }, { kind: 'courseware', id });
}

async function clickTutorialNext(page) {
  const nextButton = page.locator('#tutorial-stepper [data-action="next"]');
  await expect(nextButton).toBeEnabled({ timeout: 10_000 });
  await nextButton.click();
}

async function expectTutorialSubtitle(page, title) {
  await expect(page.locator('#tutorial-stepper .tutorial-subtitle')).toHaveText(title, { timeout: 10_000 });
}

test('opposition testing tutorial appears in bootstrap and menu', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  const bootstrapState = await page.evaluate(async () => {
    const bootstrap = await window.api.extensions.getBootstrap();
    return {
      tutorials: Array.isArray(bootstrap.tutorials) ? bootstrap.tutorials : [],
    };
  });

  expect(bootstrapState.tutorials).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: TUTORIAL_ID,
      title: 'Opposition Testing',
      overlayMode: true,
      menuSegments: ['Hardware', 'Opposition Testing'],
    }),
  ]));

  const menuState = await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const tutorialsItem = menu && menu.items.find((item) => item.label === 'Tutorials');
    const hardwareGroup = tutorialsItem && tutorialsItem.submenu.items.find((item) => item.label === 'Hardware');
    return {
      hasTutorials: !!tutorialsItem,
      rootLabels: tutorialsItem ? tutorialsItem.submenu.items.map((item) => item.label) : [],
      hardwareLabels: hardwareGroup ? hardwareGroup.submenu.items.map((item) => item.label) : [],
    };
  });

  expect(menuState.hasTutorials).toBe(true);
  expect(menuState.rootLabels).toEqual(expect.arrayContaining(['Hardware']));
  expect(menuState.hardwareLabels).toEqual(expect.arrayContaining(['Opposition Testing']));

  await app.close();
});

test('opposition testing tutorial opens overlay stepper visible across tabs', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await openOppositionTutorial(app);

  // Stepper visible on its tab
  await expect(page.locator('#tutorial-stepper')).toBeVisible({ timeout: 20_000 });
  await expectTutorialSubtitle(page, 'Opposition Testing');

  // Open the courseware doc tab — stepper should remain visible (overlay mode)
  await openCoursewareTab(app, COURSEWARE_ID);
  await page.waitForFunction(() => {
    const panel = document.getElementById('doc-panel');
    return panel && !panel.hidden;
  }, null, { timeout: 15_000 });

  await expect(page.locator('#tutorial-stepper')).toBeVisible();
  await expectTutorialSubtitle(page, 'Opposition Testing');

  await app.close();
});

test('opposition testing tutorial happy path advances through all manual steps', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await openOppositionTutorial(app);
  await expect(page.locator('#tutorial-stepper')).toBeVisible({ timeout: 20_000 });
  await expectTutorialSubtitle(page, 'Opposition Testing');

  // Step 1 → 2: advance to "Upload the firmware"
  await clickTutorialNext(page);
  await expectTutorialSubtitle(page, 'Upload the firmware');

  // Open courseware tab — stepper stays visible
  await openCoursewareTab(app, COURSEWARE_ID);
  await page.waitForFunction(() => {
    const panel = document.getElementById('doc-panel');
    return panel && !panel.hidden;
  }, null, { timeout: 15_000 });
  await expect(page.locator('#tutorial-stepper')).toBeVisible();

  // Focus resolver should highlight the upload button
  await expect(page.locator('#doc-upload-firmware-btn')).toBeVisible();

  // Step 2 → 3: advance to "Load the dashboard"
  await clickTutorialNext(page);
  await expectTutorialSubtitle(page, 'Load the dashboard');

  // Focus resolver should highlight the load dashboard button
  await expect(page.locator('#doc-load-dashboard-btn')).toBeVisible();

  // Load the opposition testing dashboard
  await page.locator('#doc-load-dashboard-btn').click();
  await page.waitForFunction(() => {
    const model = window.freeboard && window.freeboard.getLiveModel();
    return model && typeof model.panes === 'function' && model.panes().length > 0;
  }, null, { timeout: 15_000 });

  // Step 3 → 4: advance to "Power on"
  await clickTutorialNext(page);
  await expectTutorialSubtitle(page, 'Power on');

  // POWER ON button should be in the DOM
  await expect(page.locator('.btn-outline-success').filter({ hasText: 'POWER ON' })).toBeVisible({ timeout: 10_000 });

  // Step 4 → 5: advance to "Enable LEG1"
  await clickTutorialNext(page);
  await expectTutorialSubtitle(page, 'Enable LEG1');

  // LEG1 toggle section should be in the DOM
  await expect(page.locator('.badge.bg-light').filter({ hasText: 'LEG1' }).first()).toBeVisible({ timeout: 10_000 });

  // Step 5 → 6: advance to "Enable DRIVER1"
  await clickTutorialNext(page);
  await expectTutorialSubtitle(page, 'Enable DRIVER1');

  // Step 6 → 7: advance to "Set duty cycle to 0.5"
  await clickTutorialNext(page);
  await expectTutorialSubtitle(page, 'Set duty cycle to 0.5');

  // Duty row should be in the DOM
  await expect(page.locator('.twist-setpoints').filter({ has: page.locator('.input-group-text', { hasText: 'Duty' }) }).first()).toBeVisible({ timeout: 10_000 });

  // Step 7 → 8: advance to "Tutorial complete"
  await clickTutorialNext(page);
  await expectTutorialSubtitle(page, 'Tutorial complete');

  // Done button should be visible
  await expect(page.locator('#tutorial-stepper [data-action="next"]')).toHaveText('Done');

  await app.close();
});
