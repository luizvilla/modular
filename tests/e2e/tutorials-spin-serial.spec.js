const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard } = require('./helpers');

test.setTimeout(180_000);

const TUTORIAL_ID = 'hardware/spin-serial-basics';

async function openSpinTutorial(app) {
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

test('spin-serial-basics tutorial appears in bootstrap and menu', async () => {
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
      title: 'SPIN Serial Basics',
      menuSegments: ['Hardware', 'Spin Serial Basics'],
    }),
  ]));

  const spinTutorial = bootstrapState.tutorials.find((t) => t.id === TUTORIAL_ID);
  expect(spinTutorial).toBeTruthy();
  expect(spinTutorial.resources).toEqual(expect.objectContaining({ firmware: expect.stringContaining('duty_cycle_setting.mcuboot.bin') }));
  expect(spinTutorial.steps.some((s) => s.completion && s.completion.kind === 'serialport_datasource_connected')).toBe(true);
  expect(spinTutorial.steps.some((s) => s.completion && s.completion.kind === 'flash_completed')).toBe(true);
  expect(spinTutorial.steps.some((s) => s.completion && s.completion.kind === 'serial_command_buttons_configured')).toBe(true);
  expect(spinTutorial.steps.some((s) => s.completion && s.completion.kind === 'serial_csv_recorder_started')).toBe(true);
  expect(spinTutorial.steps.some((s) => s.actions && s.actions.some((a) => a.kind === 'apply_tutorial_firmware'))).toBe(true);

  const menuState = await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const tutorialsItem = menu && menu.items.find((item) => item.label === 'Tutorials');
    const hwGroup = tutorialsItem && tutorialsItem.submenu.items.find((item) => item.label === 'Hardware');
    return {
      hwLabels: hwGroup ? hwGroup.submenu.items.map((item) => item.label) : [],
    };
  });

  expect(menuState.hwLabels).toEqual(expect.arrayContaining(['SPIN Serial Basics']));

  await app.close();
});

test('spin-serial-basics tutorial opens a fresh tab with stepper', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await openSpinTutorial(app);
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

  expect(state.label).toBe('Tutorial: SPIN Serial Basics');
  expect(state.tutorialId).toBe(TUTORIAL_ID);
  expect(state.isEditing).toBe(true);
  expect(state.stepperVisible).toBe(true);
  expect(state.stepTitle).toBe('What is SPIN Serial Basics?');

  await app.close();
});

test('spin-serial-basics tutorial happy path completes with serial_csv_recorder_started', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await openSpinTutorial(app);
  await waitForTutorialTab(page);

  // Step 1: intro (manual)
  await expectSubtitle(page, 'What is SPIN Serial Basics?');
  await clickTutorialNext(page);

  // Step 2: connect-board — add a serialport_datasource with COM_MOCK port
  await expectSubtitle(page, 'Connect the SPIN board');
  await page.locator('#side-tab-datasources .table-operation').click();
  const serialTile = page.locator('#modal_overlay .datasource-tile[data-type="serialport_datasource"]');
  await expect(serialTile).toBeVisible({ timeout: 10_000 });
  await serialTile.click();
  // Settings dialog: fill name and select COM_MOCK port
  await page.locator('#modal_overlay .form-row input').first().fill('SPIN');
  // Select COM_MOCK from the portPath dropdown
  await page.locator('#modal_overlay select').filter({ has: page.locator('option[value="COM_MOCK"]') }).first().selectOption('COM_MOCK');
  await page.locator('#modal_overlay #dialog-ok').click();
  // Wait for serialport_datasource with portPath to appear in the model
  await page.waitForFunction(() => {
    const model = window.freeboard.getLiveModel();
    return model.datasources().some((ds) => {
      if (ds.type() !== 'serialport_datasource') return false;
      const s = ds.settings ? (typeof ds.settings === 'function' ? ds.settings() : ds.settings) : {};
      return !!(s && typeof s.portPath === 'string' && s.portPath.trim());
    });
  }, null, { timeout: 20_000 });
  await clickTutorialNext(page);

  // Step 3: create pane
  await expectSubtitle(page, 'Create a pane');
  await page.locator('#add-pane').click();
  await clickTutorialNext(page);

  // Step 4: add-flasher — apply_tutorial_firmware fires on step entry, auto-advances on widget_type_exists
  await expectSubtitle(page, 'Add the firmware flasher');
  await page.locator('.gs_w .pane-tools li[title="Add widget"]').first().click();
  const flasherTile = page.locator('#modal_overlay .widget-tile[data-type="serial_flasher"]');
  await expect(flasherTile).toBeVisible({ timeout: 10_000 });
  await flasherTile.click();
  await page.locator('#modal_overlay #dialog-ok').click();
  await page.waitForFunction(() => {
    const model = window.freeboard.getLiveModel();
    return model.panes().some((p) => p.widgets().some((w) => w.type() === 'serial_flasher'));
  }, null, { timeout: 20_000 });
  // auto-advances to flash-firmware step
  await expectSubtitle(page, 'Flash the firmware');

  // Step 5: flash-firmware — firmware is pre-loaded in the widget; select port and click Start Flash
  // In mock mode startFlash simulates progress and emits flash-complete after ~1 second
  await page.waitForFunction(() => {
    // Ensure the flasher widget has rendered with the pre-loaded firmware label
    const labels = Array.from(document.querySelectorAll('input'));
    return labels.some((el) => el.value && el.value.includes('duty_cycle_setting'));
  }, null, { timeout: 10_000 });

  // Select COM_MOCK in the flasher port dropdown
  await page.locator('.gs_w select').filter({ has: page.locator('option[value="COM_MOCK"]') }).first().selectOption('COM_MOCK');

  // Click Start Flash
  const startFlashBtn = page.locator('button').filter({ hasText: 'Start Flash' });
  await expect(startFlashBtn).toBeVisible({ timeout: 5_000 });
  await startFlashBtn.click();

  // Wait for flash-complete (mock fires after ~1s)
  await page.waitForFunction(() => !!window._tutorialFlashCompleted, null, { timeout: 15_000 });
  await expect(page.locator('#tutorial-stepper [data-action="next"]')).toBeEnabled({ timeout: 10_000 });
  await clickTutorialNext(page);

  // Step 6: add-command-sender — programmatically add a configured widget to satisfy serial_command_buttons_configured
  await expectSubtitle(page, 'Set up command buttons');
  await page.evaluate(() => {
    // Programmatically commit a serial_command_buttons widget with datasource and two buttons
    const model = window.freeboard.getLiveModel();
    const pane = model.panes()[0];
    if (!pane) return;
    const widget = window.freeboard.createWidget('serial_command_buttons');
    if (!widget) return;
    const buttons = JSON.stringify([
      { label: 'Duty UP', command: 'u' },
      { label: 'Duty DOWN', command: 'd' }
    ]);
    widget.settings({ title: 'Controls', datasource: 'SPIN', buttons });
    pane.widgets.push(widget);
    window.freeboard.emit('config_updated');
  });

  await page.waitForFunction(() => {
    const model = window.freeboard.getLiveModel();
    return model.panes().some((p) => p.widgets().some((w) => {
      if (w.type() !== 'serial_command_buttons') return false;
      const s = w.settings ? (typeof w.settings === 'function' ? w.settings() : w.settings) : {};
      const ds = typeof s.datasource === 'string' ? s.datasource.trim() : '';
      if (!ds) return false;
      let arr;
      try { arr = JSON.parse(s.buttons || '[]'); } catch { arr = []; }
      return arr.some((btn) => btn && btn.label && btn.command);
    }));
  }, null, { timeout: 10_000 });

  await expect(page.locator('#tutorial-stepper [data-action="next"]')).toBeEnabled({ timeout: 10_000 });
  await clickTutorialNext(page);

  // Step 7: add-csv-recorder — auto-advances on widget_type_exists: serial_csv_recorder
  await expectSubtitle(page, 'Add the CSV recorder');
  await page.locator('.gs_w .pane-tools li[title="Add widget"]').first().click();
  const recorderTile = page.locator('#modal_overlay .widget-tile[data-type="serial_csv_recorder"]');
  await expect(recorderTile).toBeVisible({ timeout: 10_000 });
  await recorderTile.click();
  await page.locator('#modal_overlay #dialog-ok').click();
  await page.waitForFunction(() => {
    const model = window.freeboard.getLiveModel();
    return model.panes().some((p) => p.widgets().some((w) => w.type() === 'serial_csv_recorder'));
  }, null, { timeout: 20_000 });
  // auto-advances to start-recording
  await expectSubtitle(page, 'Start recording');

  // Step 8: start-recording — click Start Record button
  const startRecordBtn = page.locator('button').filter({ hasText: 'Start Record' });
  await expect(startRecordBtn).toBeVisible({ timeout: 10_000 });
  await startRecordBtn.click();

  // Wait for serial_csv_recorder_started: button text changes to Stop Record
  await page.waitForFunction(() => {
    return Array.from(document.querySelectorAll('button')).some((b) => b.textContent.trim() === 'Stop Record');
  }, null, { timeout: 10_000 });

  await expect(page.locator('#tutorial-stepper [data-action="next"]')).toBeEnabled({ timeout: 10_000 });
  await clickTutorialNext(page);

  // Step 9: complete
  await expectSubtitle(page, 'Tutorial complete');
  await expect(page.locator('#tutorial-stepper [data-action="next"]')).toHaveText('Done');

  const finalState = await page.evaluate(() => {
    const model = window.freeboard.getLiveModel();
    const widgets = model.panes().flatMap((p) => p.widgets());
    return {
      hasFlasher: widgets.some((w) => w.type() === 'serial_flasher'),
      hasCmdSender: widgets.some((w) => w.type() === 'serial_command_buttons'),
      hasCsvRecorder: widgets.some((w) => w.type() === 'serial_csv_recorder'),
      isRecording: Array.from(document.querySelectorAll('button')).some((b) => b.textContent.trim() === 'Stop Record'),
    };
  });

  expect(finalState.hasFlasher).toBe(true);
  expect(finalState.hasCmdSender).toBe(true);
  expect(finalState.hasCsvRecorder).toBe(true);
  expect(finalState.isRecording).toBe(true);

  await app.close();
});
