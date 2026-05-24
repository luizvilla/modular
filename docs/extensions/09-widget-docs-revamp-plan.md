# Step 9 — Widget Documentation Revamp Plan

## Summary

Replace the current verbose, two-section widget docs with a screenshot-first structure
where each widget's `README.md` opens with a live screenshot, followed by a compact
parameter table.  A standalone NPM script generates all screenshots automatically by
loading the existing `drag_drop_dashboard.json` fixture and clipping each widget's pane.

## Why This Step Exists

- Current docs split every widget into "Creation" and "Usage" sections with separate images
  for each, which doubles the image count and makes the page feel long before the reader
  sees anything useful.
- The parameter descriptions are prose bullet lists with no Type or Default columns.
- Many widgets have no images at all.
- There is no automated way to regenerate screenshots when a widget's appearance changes.

## Target README Structure

Every widget's `README.md` follows this skeleton, in order:

```markdown
# Widget Name

| | |
|---|---|
| ![Widget screenshot](widget.png) | ![Edit dialog](widget-edit.png) |

Brief one-liner — what problem this widget solves.

## Parameters

| Parameter | Type       | Default | Description                        |
|-----------|------------|---------|------------------------------------|
| Title     | text       | —       | Label shown in the pane header.    |
| Source    | datasource | —       | Bound datasource to read from.     |
| Range min | number     | 0       | Lower bound of the display scale.  |

## Notes

Only present when there is a non-obvious constraint worth capturing
(e.g. "Requires the Plot Channel Manager in the same pane").
```

### Rules

- Two screenshots appear first, side by side, before any prose.  The reader sees what
  the widget looks like and how it is configured before reading a word.
- **`widget.png`** — full-window capture of the app with the widget visible in its pane.
  Shows the live, data-filled widget in context.
- **`widget-edit.png`** — full-window capture with the Edit Widget dialog open.  Shows
  all configurable settings in the dialog so the reader knows what they can change.
- Both images replace the `creation.png` + `usage.png` pair that previously existed.
- Parameter descriptions become a table with explicit **Type** and **Default** columns,
  both absent from the current format.
- The "What it does" and "Creation / Usage" section headings are removed.  The edit
  screenshot handles "Creation"; the widget screenshot handles "Usage".
- A **Notes** section is added only when there is something non-obvious to say.  Most
  widgets will not have one.

## Goals

- Make every widget doc start with a screenshot.
- Consolidate `creation.png` and `usage.png` into two purpose-built screenshots: `widget.png` and `widget-edit.png`.
- Add Type and Default columns to parameter descriptions.
- Provide an automated script that regenerates all screenshots on demand.

## Non-Goals

- Do not change widget behaviour, settings definitions, or IPC surface.
- Do not change the index files (`index.core.json`, etc.) or the tab-rendering pipeline.
- Do not add per-state screenshots (alarm, empty, error) as a structural requirement —
  these can appear as a named exception in the Notes section if needed.

## Screenshot Auto-Generation

### Approach: standalone NPM script, not a test

`scripts/capture-widget-screenshots.js` is not a Playwright test — it carries no
assertions.  It is invoked via `npm run docs:screenshots` on demand, when a widget's
visual changes, and the resulting PNGs are committed alongside the code change.

Screenshots are **not** regenerated on every CI pass.  Keeping them in the test suite
would cause CI to overwrite tracked PNGs whenever any visual detail shifts, creating noise
in every PR diff.

### Why the existing `drag_drop_dashboard.json` fixture is sufficient

The fixture already contains all 30 widget types across two panes with mock data flowing.
No per-widget fixture is needed — the script iterates the doc index, finds each widget
type's pane in the loaded dashboard, and clips it.

### Script outline

```text
scripts/capture-widget-screenshots.js
```

```javascript
// Run with: node scripts/capture-widget-screenshots.js
const { _electron: electron } = require('playwright');
const path = require('path');
const fs   = require('fs');

// Merge all extension indexes to get the full widget list.
const indexes = [
  require('./app/docs/widgets/index.core.json'),
  require('./app/docs/widgets/index.owntech.json'),
  require('./app/docs/widgets/index.thingset.json'),
];
const widgets = indexes.flatMap((idx) => idx.widgets);

async function main() {
  const app  = await electron.launch({
    args: ['.'],
    env: { ...process.env, MOCK_HW: '1' },
  });
  const page = await app.firstWindow();

  // Load the fixture that already contains every widget type.
  await page.evaluate(
    (p) => window.api.dashboard.loadDashboardFromPath(p),
    path.resolve('tests/fixtures/drag_drop_dashboard.json')
  );
  // Allow charts and gauges to settle with mock data.
  await page.waitForTimeout(2000);

  for (const entry of widgets) {
    if (!entry.doc) continue;

    // Find the first pane on screen that hosts a widget of this type.
    const paneHandle = await page.evaluateHandle((type) =>
      [...document.querySelectorAll('.gs_w')].find((pane) =>
        pane.querySelector(`[data-widget-type="${type}"]`)
      ),
      entry.type
    );

    if (!paneHandle || !(await paneHandle.evaluate((el) => !!el))) {
      console.warn(`  ✗  ${entry.type} — no pane found, skipping`);
      continue;
    }

    const box  = await paneHandle.boundingBox();
    const dest = path.join('app/docs/widgets', path.dirname(entry.doc), 'widget.png');
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    await page.screenshot({ path: dest, clip: box });
    console.log(`  ✓  ${entry.type}  →  ${dest}`);
  }

  await app.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
```

### Wire-up in `package.json`

```json
"scripts": {
  "docs:screenshots": "node scripts/capture-widget-screenshots.js"
}
```

### The one gap: data-rich charts

Plots (`time_plot_uplot`, `xy_plot_uplot`, `fast_frame_plot`) look best with a few
seconds of accumulated data.  The 2-second settle covers static widgets.  If richer
chart screenshots are needed, synthetic data can be injected before capture:

```javascript
// Example: pump 50 mock frames into the plot before screenshotting.
await page.evaluate(() => window.__mockDataPump?.inject(50));
await page.waitForTimeout(500);
```

## Trade-offs

**One screenshot vs. multiple states.**  A gauge in alarm state looks different from a
gauge in normal state.  The single-image approach loses that nuance.  If a widget has
important edge-case visuals, a second image (e.g. `widget-alarm.png`) can be added as a
named exception in its Notes section without making it mandatory for every widget.

**Manual screenshot refresh.**  Regeneration is intentionally manual (`npm run
docs:screenshots`).  The downside is that screenshots can drift from the current UI if
the developer forgets to run the script.  A CI check that compares a pixel hash could
catch drift without committing new PNGs on every run — that is left as a future
improvement.

## Migration from Current Docs

1. Run `npm run docs:screenshots` to generate `widget.png` for every widget.
2. Rewrite each `README.md` to the new skeleton (screenshot → one-liner → Parameters
   table → Notes if needed).
3. Delete the now-redundant `creation.png` and `usage.png` files.
4. Update any internal links that referenced the old image names.

## Commit Sequence

1. `docs(widgets): add step 9 widget docs revamp plan`
   - Create this markdown plan.

2. `feat(docs): add screenshot capture script`
   - Add `scripts/capture-widget-screenshots.js`.
   - Add `docs:screenshots` script to `package.json`.

3. `docs(widgets): regenerate screenshots and migrate READMEs to new format`
   - Run `npm run docs:screenshots` to produce `widget.png` for every widget.
   - Rewrite all `README.md` files to the new structure.
   - Delete `creation.png` and `usage.png` files.
