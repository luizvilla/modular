const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');
const { radialMenu, clickWedgeByLabel } = require('./radial_menu_helpers');

// Milestone 11 of docs/GUI/02-navigation_overhaul.md: the OwnTech Variable
// Table against the MOCK_HW ThingSet tree (5 groups, 22 variables: Config
// with Leg1/Leg2 and rMode/wMode, Debug/Scope, and a root rStatus).

test.setTimeout(90_000);

const table = (page) => page.locator('.ovt');
const varRow = (page, path) => page.locator(`.ovt tr.ovt-var[data-path="${path}"]`);
const valueCell = (page, path) => varRow(page, path).locator('td.ovt-value');
const setValueCalls = (page) => page.evaluate(() => window.api.thingsetSerial.getMockSetValueCalls().map((c) => ({ path: c.path, value: c.value })));

async function openTable(env = {}) {
  const { app, page } = await launchApp(env);
  await waitForDashboard(page);
  await loadDashboard(page, fixturePath('owntech_variable_table.json'));
  await expect(varRow(page, '/Config/wMode')).toBeVisible({ timeout: 20_000 });
  return { app, page };
}

async function editValue(page, path, text) {
  await valueCell(page, path).click();
  const input = valueCell(page, path).locator('input.ovt-editor');
  await input.fill(text);
  await input.press('Enter');
}

test('renders the tree as groups and variables, with search and filters', async () => {
  const { app, page } = await openTable();
  try {
    await expect(table(page).locator('.ovt-status')).toContainText('22 variables');
    // Top-level groups open, deeper ones collapsed.
    await expect(page.locator('.ovt tr.ovt-group')).toHaveCount(5);
    await expect(varRow(page, '/Config/rMode')).toBeVisible();
    await expect(varRow(page, '/rStatus')).toBeVisible();
    await expect(varRow(page, '/Config/Leg1/wEnable')).toHaveCount(0);
    await expect(page.locator('.ovt tr.ovt-group[data-path="/Config/Leg1"] .ovt-summary')).toHaveText('4 variables · 4 writable');

    await page.locator('.ovt tr.ovt-group[data-path="/Config/Leg1"]').click();
    await expect(varRow(page, '/Config/Leg1/wEnable')).toBeVisible();
    await expect(varRow(page, '/Config/Leg1/wEnable').locator('.ovt-badge')).toHaveText('Writable');
    await expect(varRow(page, '/Config/Leg1/wEnable').locator('.ovt-power')).toHaveCount(1);
    await expect(varRow(page, '/Config/Leg1/wDriver').locator('.ovt-caveat')).toHaveAttribute('title', /MCU reset/);
    await expect(varRow(page, '/Debug/Scope/rSamplePeriod_us')).toHaveCount(0);

    // Search keeps each match's ancestor groups.
    await page.fill('.ovt-search', 'wEnable');
    await expect(page.locator('.ovt tr.ovt-var')).toHaveCount(2);
    await expect(page.locator('.ovt tr.ovt-group')).toHaveCount(3);

    await page.fill('.ovt-search', '');
    await page.click('.ovt [data-filter="readonly"]');
    const readOnly = await page.locator('.ovt tr.ovt-var').evaluateAll((rows) => rows.map((r) => r.dataset.path));
    expect(readOnly).toContain('/Config/rMode');
    expect(readOnly).toContain('/Debug/Scope/rSamplePeriod_us');
    expect(readOnly.every((p) => /\/r[A-Z]/.test(p))).toBe(true);
    await expect(varRow(page, '/Debug/Scope/rSamplePeriod_us').locator('.ovt-unit')).toHaveText('µs');
  } finally {
    await app.close();
  }
});

test('writes need unlocking; edits write the parsed value; power writes ask first', async () => {
  const { app, page } = await openTable();
  try {
    // Locked: clicking a writable value opens nothing.
    await valueCell(page, '/Config/wMode').click();
    await expect(page.locator('.ovt input.ovt-editor')).toHaveCount(0);

    await page.click('.ovt .ovt-lock');
    await expect(page.locator('.ovt .ovt-lock')).toContainText('Writes on');

    // Invalid input stays in the editor and sends nothing.
    await editValue(page, '/Config/wMode', 'abc');
    await expect(page.locator('.ovt input.ovt-editor.ovt-editor-error')).toHaveCount(1);
    await page.keyboard.press('Escape');
    expect(await setValueCalls(page)).toEqual([]);

    // A plain writable number: no confirmation, written as a number.
    await editValue(page, '/Config/wMode', '3');
    await expect(valueCell(page, '/Config/wMode').locator('.ovt-result-ok')).toBeVisible();
    expect(await setValueCalls(page)).toEqual([{ path: '/Config/wMode', value: 3 }]);

    // Read-only values never open an editor.
    await valueCell(page, '/Config/rMode').click();
    await expect(page.locator('.ovt input.ovt-editor')).toHaveCount(0);

    // A power-stage boolean asks first: Cancel sends nothing, Write sends the flip.
    await page.locator('.ovt tr.ovt-group[data-path="/Config/Leg1"]').click();
    await valueCell(page, '/Config/Leg1/wEnable').click();
    await expect(page.locator('#modal_overlay .ovt-confirm')).toBeVisible();
    await expect(page.locator('#modal_overlay .ovt-confirm-change')).toHaveText(/true\s+→\s+false/);
    await page.click('#modal_overlay #dialog-cancel');
    await expect(page.locator('#modal_overlay .ovt-confirm')).toHaveCount(0);
    expect((await setValueCalls(page)).length).toBe(1);

    await valueCell(page, '/Config/Leg1/wEnable').click();
    await page.click('#modal_overlay #dialog-ok');
    await expect(valueCell(page, '/Config/Leg1/wEnable').locator('.ovt-result-ok')).toBeVisible();
    expect((await setValueCalls(page))[1]).toEqual({ path: '/Config/Leg1/wEnable', value: false });
  } finally {
    await app.close();
  }
});

test('a write the board rejects is shown as rejected', async () => {
  const { app, page } = await openTable({ MOCK_THINGSET_REJECT_PATHS: '/Config/wMode' });
  try {
    await page.click('.ovt .ovt-lock');
    await editValue(page, '/Config/wMode', '5');
    await expect(valueCell(page, '/Config/wMode').locator('.ovt-result-fail')).toContainText('rejected');
    expect(await setValueCalls(page)).toEqual([{ path: '/Config/wMode', value: 5 }]);
  } finally {
    await app.close();
  }
});

test('pane right-click lists the table under OwnTech; row right-click adds a bound widget', async () => {
  const { app, page } = await openTable();
  try {
    // The empty second pane: right-click its widget area -> OwnTech category.
    const emptyPane = page.locator('.gs_w').nth(1).locator('.widget-sort-section');
    await emptyPane.click({ button: 'right', force: true });
    await expect(radialMenu(page)).toBeVisible();
    await clickWedgeByLabel(page, 'OwnTech');
    await expect(page.locator('.radial-menu-leaf', { hasText: 'OwnTech Variable Table' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(radialMenu(page)).toHaveCount(0);

    // Row radial: a writable number offers a +/- button bound to it.
    await varRow(page, '/Config/wMode').click({ button: 'right' });
    const leaves = (await page.locator('.radial-menu-leaf').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim().toLowerCase());
    expect(leaves).toEqual(['copy path', 'add +/− button', 'refresh']);
    await page.locator('.radial-menu-leaf', { hasText: /\+\/− button/i }).click();
    const added = await page.evaluate(() => window.freeboard.getLiveModel().panes()[0].widgets().map((w) => ({ type: w.type(), writePath: w.settings().writePath, source: (w.settings().sourceDef || {}).var })));
    expect(added[1]).toEqual({ type: 'plus_minus_button', writePath: '/Config/wMode', source: '/Config/wMode' });

    // A read-only number offers a gauge instead.
    await varRow(page, '/Config/rMode').click({ button: 'right' });
    await expect(page.locator('.radial-menu-leaf', { hasText: /add gauge/i })).toBeVisible();
  } finally {
    await app.close();
  }
});
