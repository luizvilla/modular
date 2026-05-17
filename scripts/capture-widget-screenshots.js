// Run with: npm run docs:screenshots
// Launches the app, loads a single-widget dashboard for each widget type, and captures
// two full-window screenshots into its doc folder:
//   widget.png      — full window with the widget alone in its pane
//   widget-edit.png — full window with the Edit Widget dialog open
'use strict';

const { _electron: electron } = require('playwright/test');
const path = require('path');
const fs   = require('fs');

// Read the fixture once to get per-widget settings and the shared datasources.
const fixture = require('../tests/fixtures/drag_drop_dashboard.json');
const fixtureWidgets = {};
fixture.panes.forEach(pane => {
    pane.widgets.forEach(w => { fixtureWidgets[w.type] = w; });
});

const indexes = [
    require('../app/docs/widgets/index.core.json'),
    require('../app/docs/widgets/index.owntech.json'),
    require('../app/docs/widgets/index.thingset.json'),
];
const widgets = indexes.flatMap((idx) => idx.widgets);

// Widget types whose edit button does not open a standard settings dialog.
// For these, clicking the edit icon opens an intermediate plugin-picker state that
// conflicts with the next freeboard.loadDashboard call — skip it entirely.
const NO_EDIT_DIALOG = new Set([
    'uplot_config_panel', 'uplot_series_manager', 'xy_plot_source_manager',
    'vertical_gauge_manager', 'vertical_gauge_config_panel',
    'fast_frame_control', 'fast_frame_plot_ui', 'fast_frame_channel_manager',
]);

// Helper/companion widgets that require a host widget in the same pane to render
// without crashing.  Map: helper type → required companion type.
const COMPANION_TYPES = {
    'uplot_config_panel':          'time_plot_uplot',
    'uplot_series_manager':        'time_plot_uplot',
    'xy_plot_source_manager':      'xy_plot_uplot',
    'vertical_gauge_manager':      'vertical_gauge',
    'vertical_gauge_config_panel': 'vertical_gauge',
    'fast_frame_plot_ui':          'fast_frame_plot',
    'fast_frame_channel_manager':  'fast_frame_plot',
};

async function main() {
    const env = { ...process.env, MOCK_HW: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' };
    delete env.ELECTRON_RUN_AS_NODE;
    const app  = await electron.launch({ args: ['.'], env });

    // firstWindow() may return the DevTools window; find the actual app window instead.
    function pickAppPage(a) {
        const found = a.windows().find((p) => !p.url().startsWith('devtools://'));
        if (found) return Promise.resolve(found);
        return new Promise((resolve) => {
            a.on('window', (win) => { if (!win.url().startsWith('devtools://')) resolve(win); });
        });
    }
    const page = await pickAppPage(app);

    // Wait for the app shell to be ready before touching window.api.
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('#app-tabs',     { state: 'attached', timeout: 60_000 });
    await page.waitForSelector('#board-content', { state: 'attached', timeout: 60_000 });

    // Prime the grid: load the full fixture via IPC so the gridster KO binding
    // runs and the `grid` object is initialised before any freeboard.loadDashboard call.
    await page.evaluate(
        (p) => window.api.dashboard.loadDashboardFromPath(p),
        path.resolve('tests/fixtures/drag_drop_dashboard.json')
    );
    await page.waitForFunction(() => {
        const fb = window.freeboard || null;
        if (!fb || typeof fb.getLiveModel !== 'function') return false;
        const model = fb.getLiveModel();
        return model && typeof model.panes === 'function' && model.panes().length > 0;
    }, null, { timeout: 60_000 });
    await page.waitForTimeout(1500);

    for (const entry of widgets) {
        if (!entry.doc) continue;

        const widgetConfig = fixtureWidgets[entry.type];
        if (!widgetConfig) {
            console.warn(`  ✗  ${entry.type} — not in fixture, skipping`);
            continue;
        }

        // Build a minimal single-widget dashboard.
        // freeboard uses a fixed PANE_WIDTH=300px grid.  Setting columns=4 and col_width=4
        // makes the single pane span 4×300 + margins ≈ 1260px — the full window width.
        // Helper widgets that require a companion (e.g. uplot_series_manager needs
        // time_plot_uplot) get that companion prepended so they don't crash on render.
        const companionType = COMPANION_TYPES[entry.type];
        const companionConfig = companionType ? fixtureWidgets[companionType] : null;
        const paneWidgets = companionConfig ? [companionConfig, widgetConfig] : [widgetConfig];

        const minimalConfig = {
            version:    1,
            allow_edit: true,
            plugins:    [],
            columns:    4,
            panes: [{
                title:     '',
                width:     1,
                row:       { '4': 1 },
                col:       { '4': 1 },
                col_width: 4,
                widgets:   paneWidgets,
            }],
            datasources: fixture.datasources,
        };

        // freeboard.loadDashboard accepts a config object and fires the callback when done.
        await page.evaluate((config) => {
            return new Promise((resolve) => { window.freeboard.loadDashboard(config, resolve); });
        }, minimalConfig);

        // Allow charts and gauges to initialise and render.
        await page.waitForTimeout(1500);

        const destDir = path.join('app/docs/widgets', path.dirname(entry.doc));
        fs.mkdirSync(destDir, { recursive: true });

        // Find the widget's sub-section element (freeboard stores the type in jQuery data).
        const paneHandle = await page.evaluateHandle((type) => {
            const sections = [...document.querySelectorAll('.sub-section')];
            return sections.find((el) => {
                try {
                    const vm = window.jQuery
                        ? window.jQuery(el).data('ko-widget')
                        : el._koWidget;
                    return vm && typeof vm.type === 'function' && vm.type() === type;
                } catch { return false; }
            }) || null;
        }, entry.type);

        const el = paneHandle ? await paneHandle.asElement() : null;
        if (!el) {
            console.warn(`  ✗  ${entry.type} — no sub-section found after load, skipping`);
            continue;
        }

        // widget.png — full window with the widget visible in its pane.
        await page.screenshot({ path: path.join(destDir, 'widget.png') });
        console.log(`  ✓  ${entry.type}  →  widget.png`);

        // Skip the edit button for widgets that don't produce a standard dialog.
        if (NO_EDIT_DIALOG.has(entry.type)) {
            console.log(`  ℹ  ${entry.type} — no edit dialog`);
            continue;
        }

        // Hover to reveal the sub-section toolbar, then click the edit (wrench) icon.
        await el.hover();
        await page.waitForTimeout(150);
        const editBtn = await el.$('.tool-edit');
        if (!editBtn) {
            console.warn(`  ✗  ${entry.type} — no edit button, skipping widget-edit.png`);
            continue;
        }
        await editBtn.click();

        // Wait for the freeboard modal overlay (#modal_overlay) to appear.
        const appeared = await page
            .waitForSelector('#modal_overlay', { state: 'visible', timeout: 5000 })
            .then(() => true)
            .catch(() => false);

        if (appeared) {
            await page.waitForTimeout(400);
            await page.screenshot({ path: path.join(destDir, 'widget-edit.png') });
            console.log(`  ✓  ${entry.type}  →  widget-edit.png`);

            // Dismiss the dialog — prefer the explicit Cancel button to avoid
            // triggering any app-level keyboard shortcut bound to Escape.
            const cancelBtn = await page.$('#dialog-cancel');
            if (cancelBtn) {
                await cancelBtn.click();
            } else {
                await page.keyboard.press('Escape');
            }
            await page
                .waitForSelector('#modal_overlay', { state: 'hidden', timeout: 5000 })
                .catch(() => {});
            await page.waitForTimeout(200);
        } else {
            console.warn(`  ✗  ${entry.type} — edit dialog did not appear, skipping widget-edit.png`);
        }
    }

    await app.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
