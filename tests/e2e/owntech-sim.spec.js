const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

// The OwnTech extension against the simulated demo board (M12 of
// docs/GUI/02-navigation_overhaul.md) -- MOCK_HW off, so detection, the tree
// walk, sessions, writes and the scope download all run their real code
// paths over the simulated transport. MODULAR_SIM_ONLY hides any real
// hardware so the result doesn't depend on what's plugged in.

test.setTimeout(120_000);

const SIM_ENV = { MOCK_HW: '0', MODULAR_SIM_BOARD: '1', MODULAR_SIM_ONLY: '1' };
const IF02 = 'sim://owntech-demo/if02';
const varRow = (page, path) => page.locator(`.ovt tr.ovt-var[data-path="${path}"]`);
const valueOf = (page, path) => varRow(page, path).locator('td.ovt-value');

async function openDemo() {
  const { app, page } = await launchApp(SIM_ENV);
  await waitForDashboard(page);
  await loadDashboard(page, fixturePath('owntech_demo_board.json'));
  await page.waitForFunction(() => {
    const ds = window.freeboard.getLiveModel().datasources()[0];
    const d = ds && ds.latestData();
    return !!(d && d.status === 'ok' && d.tree);
  }, null, { timeout: 30_000 });
  return { app, page };
}

async function confirmWrite(page) {
  await expect(page.locator('#modal_overlay .ovt-confirm')).toBeVisible();
  await page.click('#modal_overlay #dialog-ok');
  await expect(page.locator('#modal_overlay .ovt-confirm')).toHaveCount(0);
}

test('auto-detects the demo board and shows its real Core4 tree', async () => {
  const { app, page } = await openDemo();
  try {
    const data = await page.evaluate(() => window.freeboard.getLiveModel().datasources()[0].latestData());
    expect(data.portPath).toBe(IF02);
    expect(data.node_name).toBe('Demo OwnTech');
    await expect(page.locator('.ovt-status')).toContainText('(simulated)');
    await expect(page.locator('.ovt-status')).toContainText('79 variables');
    const ports = await page.evaluate(() => window.api.serial.listPorts());
    expect(ports.map((p) => p.name)).toEqual([
      'sim://owntech-demo/if02 (Demo OwnTech, simulated) — ThingSet shell · responding',
      'sim://owntech-demo/if00 (Demo OwnTech, simulated) — scope data port',
    ]);
  } finally {
    await app.close();
  }
});

test('writes from the table drive the simulated power stage', async () => {
  const { app, page } = await openDemo();
  try {
    await page.click('.ovt .ovt-lock');
    await page.click('.ovt [title="Expand all"]');
    // Mode -> POWER_ON (confirmed), duty 0.2, leg 1 enable (confirmed).
    await valueOf(page, '/Config/Mode').click();
    await valueOf(page, '/Config/Mode').locator('input').fill('1');
    await valueOf(page, '/Config/Mode').locator('input').press('Enter');
    await confirmWrite(page);
    await valueOf(page, '/Config/Leg1/wDutyCycle').click();
    await valueOf(page, '/Config/Leg1/wDutyCycle').locator('input').fill('0.2');
    await valueOf(page, '/Config/Leg1/wDutyCycle').locator('input').press('Enter');
    await confirmWrite(page);
    await valueOf(page, '/Config/Leg1/wEnable').click();
    await confirmWrite(page);
    // 0.2 x 30 V x 0.9 on the 10 ohm load: 5.4 V, 0.54 A -- in the table and a gauge.
    await expect.poll(async () => Number((await valueOf(page, '/Measurements/rV1Low_V').innerText()).trim()), { timeout: 10_000 }).toBeGreaterThan(5.2);
    expect(Number((await valueOf(page, '/Measurements/rI1Low_A').innerText()).trim())).toBeCloseTo(0.54, 1);
    await expect.poll(async () => Number(await page.evaluate(() => document.querySelector('.gauge-family__value').textContent)), { timeout: 10_000 }).toBeGreaterThan(5.2);
    // A read-only measurement can't be written; the firmware reverts a bad duty.
    const ro = await page.evaluate(() => window.ThingSetWrite.write({ datasource: 'Demo', path: '/Measurements/rV1Low_V', value: 1 }));
    expect(ro.ok).toBe(false);
    const bad = await page.evaluate(() => window.ThingSetWrite.write({ datasource: 'Demo', path: '/Config/Leg1/wDutyCycle', value: 2 }));
    expect(bad).toEqual({ ok: true, readBack: 0.2 });
  } finally {
    await app.close();
  }
});

test('scope widget arms, triggers and downloads a simulated capture', async () => {
  const { app, page } = await openDemo();
  try {
    const scope = page.locator('.gs_w').nth(1);
    await expect(scope.getByRole('button', { name: 'wArm' })).toBeVisible({ timeout: 15_000 });
    await scope.getByRole('button', { name: 'wArm' }).click();
    await expect(scope).toContainText('ARMED', { timeout: 10_000 });
    await scope.getByRole('button', { name: 'wTrigger' }).click();
    await expect(scope).toContainText('READY', { timeout: 10_000 });
    await scope.getByRole('button', { name: 'Download' }).click();
    await expect(scope).toContainText('Downloaded 1024 samples across 8 channels', { timeout: 15_000 });
  } finally {
    await app.close();
  }
});

test('the demo board appears in an open Add Datasource form when switched on', async () => {
  const { app, page } = await launchApp({ MOCK_HW: '0', MODULAR_SIM_ONLY: '1' });
  try {
    await waitForDashboard(page);
    await page.locator('span.table-operation', { hasText: 'ADD' }).first().click();
    await page.locator('#modal_overlay').last().getByText('OwnTech (ThingSet Serial)', { exact: true }).first().click();
    const portOptions = () => page.locator('#modal_overlay').last().locator('select').evaluateAll((sels) => {
      const list = sels.map((s) => [...s.options].map((o) => o.text)).find((l) => l.some((t) => /Select a port/.test(t)));
      return list || [];
    });
    await expect.poll(portOptions).toEqual(['Select a port…']);
    await page.evaluate(() => window.api.demoBoard.set(true));
    await expect.poll(portOptions, { timeout: 5_000 }).toEqual(['Select a port…', 'sim://owntech-demo/if02 (Demo OwnTech, simulated) — ThingSet shell']);
    await page.evaluate(() => window.api.demoBoard.set(false));
  } finally {
    await app.close();
  }
});
