// Run with: npm run docs:screenshots
// Launches the app, loads the all-widgets fixture, and clips one screenshot per
// widget type into its doc folder as widget.png.
'use strict';

const { _electron: electron } = require('playwright');
const path = require('path');
const fs   = require('fs');

const indexes = [
    require('../app/docs/widgets/index.core.json'),
    require('../app/docs/widgets/index.owntech.json'),
    require('../app/docs/widgets/index.thingset.json'),
];
const widgets = indexes.flatMap((idx) => idx.widgets);

async function main() {
    const app  = await electron.launch({ args: ['.'], env: { ...process.env, MOCK_HW: '1' } });
    const page = await app.firstWindow();

    await page.evaluate(
        (p) => window.api.dashboard.loadDashboardFromPath(p),
        path.resolve('tests/fixtures/drag_drop_dashboard.json')
    );
    // Allow charts and gauges to settle with data.
    await page.waitForTimeout(3000);

    for (const entry of widgets) {
        if (!entry.doc) continue;

        // Freeboard stores the widget type on the sub-section's jQuery data under
        // 'ko-widget'. There is no data-widget-type attribute in the DOM.
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
            console.warn(`  ✗  ${entry.type} — no pane found, skipping`);
            continue;
        }

        const box  = await el.boundingBox();
        if (!box || box.width < 2 || box.height < 2) {
            console.warn(`  ✗  ${entry.type} — zero bounding box, skipping`);
            continue;
        }

        const dest = path.join('app/docs/widgets', path.dirname(entry.doc), 'widget.png');
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        await page.screenshot({ path: dest, clip: box });
        console.log(`  ✓  ${entry.type}  →  ${dest}`);
    }

    await app.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
