const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard } = require('./helpers');

test.setTimeout(120_000);

const TUTORIAL_ID = 'core/fft-spectrum-from-csv';

async function openFftTutorial(app) {
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

test('fft-spectrum-from-csv tutorial appears in bootstrap and welcome card', async () => {
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
      title: 'FFT Spectrum From CSV',
      menuSegments: ['Core', 'Fft Spectrum From Csv'],
    }),
  ]));

  const fftTutorial = bootstrapState.tutorials.find((t) => t.id === TUTORIAL_ID);
  expect(fftTutorial).toBeTruthy();
  expect(fftTutorial.resources).toEqual(expect.objectContaining({ csv: expect.stringContaining('sample_data.csv') }));
  expect(fftTutorial.steps.some((s) => s.actions && s.actions.some((a) => a.kind === 'apply_tutorial_csv'))).toBe(true);
  expect(fftTutorial.steps.some((s) => s.completion && s.completion.kind === 'fft_spectrum_configured')).toBe(true);

  const startupEntry = bootstrapState.welcomeEntries.find((e) => e.id === 'tutorials-startup');
  expect(startupEntry).toBeTruthy();
  expect(startupEntry.actions).toEqual(expect.arrayContaining([
    expect.objectContaining({ tutorialId: TUTORIAL_ID, label: 'FFT Spectrum From CSV' }),
  ]));

  const menuState = await app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    const tutorialsItem = menu && menu.items.find((item) => item.label === 'Tutorials');
    const coreGroup = tutorialsItem && tutorialsItem.submenu.items.find((item) => item.label === 'Core');
    return {
      coreLabels: coreGroup ? coreGroup.submenu.items.map((item) => item.label) : [],
    };
  });

  expect(menuState.coreLabels).toEqual(expect.arrayContaining(['FFT Spectrum From CSV']));

  await app.close();
});

test('fft-spectrum-from-csv tutorial welcome card shows FFT action', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await expect(page.locator('#tutorial-welcome')).toBeVisible();
  await expect(
    page.locator('#tutorial-welcome .tutorial-welcome-action').filter({ hasText: 'FFT Spectrum From CSV' })
  ).toBeVisible();

  await app.close();
});

test('fft-spectrum-from-csv tutorial opens a fresh tab with stepper', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await openFftTutorial(app);
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

  expect(state.label).toBe('Tutorial: FFT Spectrum From CSV');
  expect(state.tutorialId).toBe(TUTORIAL_ID);
  expect(state.isEditing).toBe(true);
  expect(state.stepperVisible).toBe(true);
  expect(state.stepTitle).toBe('What is an FFT Spectrum plot?');

  await app.close();
});

test('fft-spectrum-from-csv tutorial happy path completes with fft_spectrum_configured', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  await openFftTutorial(app);
  await waitForTutorialTab(page);

  // Step 1: intro (manual)
  await expectSubtitle(page, 'What is an FFT Spectrum plot?');
  await clickTutorialNext(page);

  // Step 2: create pane
  await expectSubtitle(page, 'Create a pane');
  await page.locator('#add-pane').click();
  await clickTutorialNext(page);

  // Step 3: add FFT widget — apply_tutorial_csv action fires on step entry, then
  // clicking the tile auto-opens the editor with the CSV already pre-loaded.
  await expectSubtitle(page, 'Add an FFT Spectrum widget');
  await page.locator('.gs_w .pane-tools li[title="Add widget"]').first().click();
  const fftTile = page.locator('#modal_overlay .widget-tile[data-type="fft_spectrum_plot"]');
  await expect(fftTile).toBeVisible({ timeout: 10_000 });
  await fftTile.click();
  // The integrated editor opens automatically with the CSV pre-loaded.
  const fftEditor = await activeModal(page);
  await expect(fftEditor.locator('.integrated-plot-editor')).toBeVisible({ timeout: 10_000 });

  // Wait for columns to load from the pre-loaded CSV.
  await page.waitForFunction(() => {
    const editor = document.querySelector('#modal_overlay .integrated-plot-editor');
    if (!editor) return false;
    return Array.from(editor.querySelectorAll('option')).some((o) => o.value === 'Vgrid');
  }, null, { timeout: 15_000 });

  // Add a regular channel: Y Variable = Vgrid
  await fftEditor.locator('select').filter({ has: page.locator('option[value="Vgrid"]') }).first().selectOption('Vgrid');

  // Click Add channel
  await fftEditor.getByRole('button', { name: 'Add channel' }).click();
  await fftEditor.locator('#dialog-ok').click();

  // Wait for fft_spectrum_configured to fire (csvPath set + at least one channelDef)
  await page.waitForFunction(() => {
    const model = window.freeboard.getLiveModel();
    return model.panes().some((p) => p.widgets().some((w) => {
      if (w.type() !== 'fft_spectrum_plot') return false;
      const s = w.settings() || {};
      const csvPath = typeof s.csvPath === 'string' ? s.csvPath.trim() : '';
      const defs = Array.isArray(s.channelDefs) ? s.channelDefs : [];
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
    const widget = model.panes().flatMap((p) => p.widgets()).find((w) => w.type() === 'fft_spectrum_plot');
    const s = widget ? widget.settings() : {};
    return {
      hasFftWidget: !!widget,
      csvPath: (s && s.csvPath) || '',
      channelCount: s && Array.isArray(s.channelDefs) ? s.channelDefs.length : 0,
    };
  });

  expect(finalState.hasFftWidget).toBe(true);
  expect(finalState.csvPath).toContain('sample_data.csv');
  expect(finalState.channelCount).toBeGreaterThan(0);

  await app.close();
});
