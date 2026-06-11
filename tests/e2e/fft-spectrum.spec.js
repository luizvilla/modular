const { test, expect } = require('playwright/test');
const { launchApp, waitForDashboard, loadDashboard, fixturePath } = require('./helpers');

test.setTimeout(60_000);

test('fft spectrum widget computes harmonics and THD from a csv file', async () => {
  const { app, page } = await launchApp();
  await waitForDashboard(page);

  const csvPath = fixturePath('fft_spectrum_plot.csv');
  const dashboardPath = fixturePath('fft_spectrum_dashboard.json');
  const samplePeriodUs = 97.65625;

  await page.evaluate(async ({ targetPath, tsUs }) => {
    const rows = ['Vgrid,Igrid'];
    const samples = 1024;
    const ts = tsUs / 1e6;

    for (let index = 0; index < samples; index++) {
      const t = index * ts;
      const angle50 = 2 * Math.PI * 50 * t;
      const vgrid = 100 * Math.sin(angle50)
        + 10 * Math.sin(3 * angle50)
        + 5 * Math.sin(5 * angle50);
      const igrid = 20 * Math.sin(angle50)
        + 4 * Math.sin(2 * angle50);
      rows.push(`${vgrid.toFixed(6)},${igrid.toFixed(6)}`);
    }

    await window.api.files.writeText(targetPath, rows.join('\n'));
  }, { targetPath: csvPath, tsUs: samplePeriodUs });

  await loadDashboard(page, dashboardPath);

  await page.waitForFunction(() => {
    const widget = window.freeboard.getLiveModel().panes()[0]?.widgets?.()[0]?.widgetInstance;
    return widget
      && widget.lastComputation
      && widget.plots
      && widget.plots.time
      && widget.plots.spectrum
      && widget.plots.harmonics;
  });

  const metrics = await page.evaluate(() => {
    const widget = window.freeboard.getLiveModel().panes()[0].widgets()[0].widgetInstance;
    const bySignal = Object.fromEntries(widget.lastComputation.signals.map((signal) => [signal.signal, {
      h1: signal.fundamentalAmplitude,
      thd: signal.thdPercent
    }]));

    return {
      availableColumns: widget.availableColumns,
      rowCount: widget.lastComputation.rowCount,
      signals: bySignal,
      status: widget.status.text()
    };
  });

  expect(metrics.availableColumns).toEqual(expect.arrayContaining(['Vgrid', 'Igrid']));
  expect(metrics.rowCount).toBe(1024);
  expect(metrics.status).toContain('fft_spectrum_plot.csv');

  expect(metrics.signals.Vgrid.h1).toBeCloseTo(100, 1);
  expect(metrics.signals.Igrid.h1).toBeCloseTo(20, 1);
  expect(metrics.signals.Vgrid.thd).toBeCloseTo(11.18, 1);
  expect(metrics.signals.Igrid.thd).toBeCloseTo(20, 1);

  await app.close();
});
