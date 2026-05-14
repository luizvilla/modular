# Task: Replace Widget Dropdown with Icon Grid Picker

## Context

This is an Electron + Knockout.js dashboard app. When the user clicks the `+` button on a pane header, a dialog opens and asks them to pick a widget type. Currently that picker is a categorized `<select>` dropdown. The task is to replace it with a CSS grid of icon tiles, organized by category, with a special highlighted section for OwnTech widgets.

Font Awesome 6 is already loaded in the app (`css/all.min.css`).

---

## Commit 1 — Add OwnTech as a first-class category

**File:** `app/dashboard/js/freeboard.js`

Find the default categories array (around line 1828):
```js
["Fast Frame", "Serial", "ThingSet", "Plots", "Controls", "Other"]
```
Add `"OwnTech"` as the **first** entry:
```js
["OwnTech", "Fast Frame", "Serial", "ThingSet", "Plots", "Controls", "Other"]
```

Find the category inference block (around line 1850–1877) that maps `type_name` patterns to categories. Add a rule **before** the `"Other"` fallback:
```js
if (/^owntech_|^twist_/.test(typeName)) return "OwnTech";
```

No UI change in this commit.

---

## Commit 2 — Add icon field to all widget plugin definitions

Each plugin file calls `freeboard.loadWidgetPlugin({ type_name: ..., display_name: ..., ... })`. Add an `icon` field (Font Awesome 6 class name, without the `fa-` prefix — just the name string) to each one. `loadWidgetPlugin` already passes the object through unchanged, so no registry code needs to change.

Plugin files are in `app/dashboard/plugins/`. Here is the full mapping:

| File | type_name | icon |
|------|-----------|------|
| `twist_calibration.widget.js` | `twist_calibration_panel` | `ruler-combined` |
| `twist_control.widget.js` | `twist_actions_panel` | `bolt` |
| `twist_setpoints.widget.js` | `twist_setpoints_panel` | `sliders` |
| `fast_frame_channel_manager.widget.js` | `fast_frame_channel_manager` | `layer-group` |
| `fast_frame_control.widget.js` | `fast_frame_control` | `circle-play` |
| `fast_frame_plot_ui.widget.js` | `fast_frame_plot_ui` | `chart-line` |
| `fast_frame_plot.widget.js` | `fast_frame_plot` | `chart-area` |
| `serialcommand.widget.js` | `serial_command_buttons` | `terminal` |
| `serialflash.widget.js` | `serial_flasher` | `microchip` |
| `serialrecord.widget.js` | `serial_csv_recorder` | `file-csv` |
| `serialterminal.widget.js` | `serial_terminal` | `rectangle-terminal` |
| `ts_control.widget.js` | `thingset_control_panel` | `gamepad` |
| `ts_device_ui.widget.js` | `thingset_device_ui` | `display` |
| `ts_measurements.widget.js` | `thingset_measurements` | `gauge` |
| `ts_mode.widget.js` | `thingset_mode_button` | `power-off` |
| `ts_serial_device_ui.widget.js` | `thingset_serial_device_ui` | `plug` |
| `uplot.widget.js` | `owntech_plot_uplot` | `chart-line` |
| `xy_plot.widget.js` | `xy_plot_uplot` | `chart-scatter` |
| `vertical_gauge.widget.js` | `vertical_gauge` | `gauge-high` |

No UI change in this commit.

---

## Commit 3 — Add grid picker CSS

**Files to edit:**
- `app/dashboard/lib/css/freeboard/styles.css` — source of truth
- `app/dashboard/css/freeboard.css` — keep in sync
- `app/dashboard/css/freeboard.min.css` — keep in sync (minify the new rules and append/replace)

Add these rules:

```css
.widget-picker {
    padding: 8px 4px;
}

.widget-picker-section {
    margin-bottom: 14px;
}

.widget-picker-section-title {
    font-size: 10px;
    text-transform: uppercase;
    color: #888;
    letter-spacing: 1px;
    margin-bottom: 6px;
    padding-left: 2px;
}

.widget-picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));
    gap: 6px;
}

.widget-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 8px 4px 6px;
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    background: rgba(75,75,75,0.0);
    color: #d3d4d4;
    font-size: 10px;
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    line-height: 1.3;
    transition: background 200ms linear, border-color 200ms linear;
    word-break: break-word;
}

.widget-tile i {
    font-size: 20px;
    margin-bottom: 5px;
    color: #B88F51;
}

.widget-tile:hover {
    background: rgba(75,75,75,1.0);
    border-color: #555;
}

.widget-tile.selected {
    background: rgba(75,75,75,1.0);
    border-color: #B88F51;
}

.widget-picker-section.owntech .widget-picker-section-title {
    color: #B88F51;
}

.widget-picker-section.owntech .widget-picker-grid {
    background: rgba(184,143,81,0.08);
    border: 1px solid rgba(184,143,81,0.35);
    border-radius: 5px;
    padding: 6px;
}
```

No behavior change in this commit.

---

## Commit 4 — Replace dropdown with grid in PluginEditor

**File:** `app/dashboard/lib/js/freeboard/PluginEditor.js`

Find the block around **line 712–754** that builds the widget type `<select>` element. It looks roughly like:

```js
// (inside createPluginEditor, for type === 'widget')
var typeSelect = $('<select>...</select>');
// groups by category, appends <optgroup> and <option> elements
// ...
typeSelect.change(function() { ... selectedType = ... });
```

Replace that entire block with a function that:

1. Creates `<div class="widget-picker">` as the container.
2. Iterates over categories in order: `["OwnTech", "Fast Frame", "Serial", "ThingSet", "Plots", "Controls", "Other"]`.
3. For each category, collects all plugins from `types` (the `widgetPlugins` object passed in) whose resolved category matches. Resolves category the same way the rest of the codebase does: check `plugin.category` first, then fall back to the `getWidgetCategoryForType(plugin.type_name)` function already available in scope.
4. Skips a category section if it has zero plugins.
5. For each section, emits:
   ```html
   <div class="widget-picker-section [owntech if category==='OwnTech']">
     <div class="widget-picker-section-title">Category Name</div>
     <div class="widget-picker-grid">
       <!-- one .widget-tile per plugin -->
     </div>
   </div>
   ```
6. Each tile:
   ```html
   <div class="widget-tile" data-type="plugin.type_name" title="plugin.description">
     <i class="fa-solid fa-[plugin.icon or category-default]"></i>
     display_name
   </div>
   ```
   Category-default icons (when `plugin.icon` is absent): OwnTech → `bolt`, Fast Frame → `chart-area`, Serial → `terminal`, ThingSet → `network-wired`, Plots → `chart-line`, Controls → `sliders`, Other → `puzzle-piece`.

7. Clicking a tile:
   - Removes `.selected` from all tiles, adds it to the clicked tile.
   - Sets `selectedType` to `plugin.type_name` (use whatever variable/mechanism the old `typeSelect.change` handler used — keep it identical).
   - Triggers whatever the old change handler triggered (settings form reveal, etc.).

8. Pre-select the first tile in the first non-empty section on render (mirrors the old `<select>` defaulting to the first option).

The `<select>` element and all its `<optgroup>`/`<option>` building code is fully deleted. Everything outside this block — the `DialogBox` wrapper, the settings form rendered after selection, the docs button — stays untouched.

---

## File map summary

```
app/dashboard/js/freeboard.js                       — commits 1
app/dashboard/plugins/*.widget.js  (19 files)       — commit 2
app/dashboard/lib/css/freeboard/styles.css          — commit 3
app/dashboard/css/freeboard.css                     — commit 3
app/dashboard/css/freeboard.min.css                 — commit 3
app/dashboard/lib/js/freeboard/PluginEditor.js      — commit 4
```

Do not touch minified JS files (`freeboard.min.js`, `freeboard_plugins.min.js`) — the app loads `js/freeboard.js` directly.
