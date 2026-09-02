# Radial Navigation Overhaul Plan

## Context

`01-overhaul.md`'s layout work has landed — the app already has the flattened top bar (`#top-bar`, `#add-pane` calling `createPane`), the collapsible left `#side-pane` (datasources list + detail, `ADD` button calling the `pluginEditor` binding with `type:'datasource'`), and bottom-anchored tabs. This plan is the next layer on top of that shape: replacing *some* of the click-through-menus-and-dialogs interactions with **right-click radial menus** and **hover-triggered inline panels**, following the pattern already piloted and shipped on `time_plot_uplot` (the Time Plot widget).

### What already exists (the pilot)

- **`app/dashboard/js/radial_context_menu.js`** — the generic engine. A node is either a branch (`{id, label, children}`, rendered as an SVG donut-wedge arc) or a leaf group (`{id, label, items}`, rendered as a ring of circular buttons). `children`/`items` may be a plain array or a function returning one (sync or async — needed because a datasource's live tree has to be read before its category list is known). A leaf item is either an action (`{onSelect}`) or an inline-editable value (`{inlineEdit: {type, getValue, onSubmit}}`, swapping the circle for a small input) or a colored swatch (`{color}`, no text). `RadialContextMenu.show({x, y, root})` starts at the arc level; `show({x, y, items})` skips straight to the leaf ring for menus with nothing to categorize (the color carrousel).
- **`app/dashboard/plugins/uplot.widget.js`** — the reference implementation, three zones:
  - Right-click the plot area → drills **Datasource → (Measurements | Others → Config/Calibration/...) → leaf variable** for ThingSet-type datasources, or straight to a flat channel list for simple indexed ones (serial/fast-frame/signal-generator/CAN) → quick-adds the channel with the identity op and the next palette color, no dialog.
  - Hovering the Y-axis margin shows an inline panel (Y Label / Y Min / Y Max); hovering the X-axis margin shows a different one (Duration / Refresh Rate). Both stay open across edits while the cursor is on the margin or the panel itself (a short hide-delay bridges the gap between them) and commit each field on blur/Enter — no dialog, no drill-down, since these are always the same handful of fixed fields.
  - Double-click a channel's readout label, or the chart's own title, to rename it in place — a **floating input positioned over the target via `getBoundingClientRect()`, living in `document.body`**, not swapped into the target's own DOM. This is load-bearing: `_renderReadouts()` rebuilds its children wholesale on every poll tick, which was destroying an in-place input (and the keystrokes in it) mid-edit before this fix.
  - Right-click a channel's color swatch → the 10-color ColorBlind10 carrousel (`show({items})`, no arc step) → quick-sets the channel's color.
- **`tests/e2e/radial-context-menu.spec.js`** — 12 tests, including a `clickWedgeByLabel()` helper that clicks the *painted* point of a donut-wedge rather than its bounding-box center (which can land in the donut's empty inner hole for a small wedge count — Playwright's default click target).

### Other relevant existing mechanics this plan reuses, not reimplements

- **Widget catalog & categories** (`app/dashboard/js/freeboard.js:2117-2176`): `_getDefaultWidgetCategories()` returns `["OwnTech", "Fast Frame", "Serial", "ThingSet", "Plots", "Controls", "Buttons", "Other"]`; `"Gauges"` also exists as an inferred category. `_inferWidgetCategory(typeName, pluginType)` is the fallback for widgets without an explicit `category` in their `loadWidgetPlugin()` call. The existing widget-picker modal (`.widget-picker`, `.widget-picker-section`, `.widget-tile`) already groups by exactly this taxonomy — the pane-level radial (M2) reuses the *same* grouping, not a new one.
- **Widget creation** (`app/dashboard/js/freeboard.js:4484-4508`): `new WidgetModel(theFreeboardModel, widgetPlugins)`, `.settings({})`, `.type(typeName)`, default title from `widgetPlugins[typeName].display_name`, `pane.widgets.push(newViewModel)`, then for "integrated editor types" (`time_plot_uplot`, `xy_plot_uplot`, `fast_frame_plot`, `fft_spectrum_plot`, the five gauge types, `plus_minus_button`, `serial_command_buttons`) — `freeboard.openIntegratedPlotEditor(newViewModel, type)` fires immediately. This is already the "quick add with defaults, then scoped editor if it's complex" pattern this plan's radial leaves reuse directly.
- **Datasource creation**: same `pluginEditor` binding (`type:'datasource'`), backed by a flat `.datasource-tile` picker (no categories — only 5-6 types) rather than the widget picker's categorized one.
- **Pane chrome** (`app/dashboard/index.html:382-425`, the `pane-template`): `.pane-header` (title, already double-click-renameable via `paneTitleEditor` — direct prior art for M2/M6's title-rename leaves), `.pane-tools` (Add widget / Duplicate pane / Delete pane), and per-widget `.sub-section-tools` (move up/down, docs, edit/wrench → opens the full/integrated editor, delete). **None of this is being removed or replaced** — see Design Principle 1.
- **`app/extensions/core/manifest.json`** — `rendererScripts` array with an `order` field; `radial_context_menu.js` currently sits at `order: 25`, before `uplot.widget.js` (`order: 30`). New files in this plan need entries here too.

---

## Design Principles

Carried over from the pilot, or newly learned from it:

1. **Additive, never a replacement.** The generic per-widget toolbar, per-pane toolbar, and dashboard top-bar buttons stay exactly as they are. Radial menus and hover panels are a faster *parallel* path for the most common actions, not the only path — the wrench/edit icon must always still work, for every widget, including ones that get a radial adaptation.
2. **Hover vs. right-click+drill is a real design decision, not a default.** Hover-triggered inline panels are for a **small, fixed set of fields that are always the same** (axis label/min/max, duration/refresh rate, gauge min/max/units) — there's nothing to categorize, so a drill-down would just be friction. Right-click+drill is for **picking one of many** (which channel, which datasource, which widget type) — a real choice that benefits from the arc→circle narrowing. Don't reach for a radial drill where a hover panel would do, and don't reach for a hover panel where the field set genuinely varies per situation.
3. **Floating-input rule.** Anything editable that lives inside a container the widget re-renders periodically or on settings changes (`_renderReadouts()`, `_resetPlot()`, any `.html(...)` rebuild) must be a **floating input positioned via `getBoundingClientRect()` and appended to `document.body`**, never swapped into the churn-prone DOM in place. This was a real, reported bug (rename losing keystrokes) before the fix — every future rename/inline-edit target must use this pattern from the start, not rediscover the bug.
4. **Quick-add with sane defaults, not a dialog, wherever a default is genuinely sane.** A channel gets the identity op and the next palette color; a widget gets its type's default settings and, if it's a complex type, an immediately-opened scoped editor (already true today for the 11 "integrated editor types" — this plan extends that same instinct to the *trigger*, not the underlying add-then-maybe-edit flow, which stays as-is).
5. **Reuse, never reimplement.** `ModularPlotEditorShared` (`listDatasources`, `getDatasourceType`, `fetchDatasourceVariableOptions`, `getColorThemes`, `commitWidgetSettings`, `parseSeriesDefs`), `freeboard.openIntegratedPlotEditor`, the existing `WidgetModel`/`DatasourceModel` construction code, and the existing category-inference logic are the source of truth. Every milestone below names the specific existing function it calls into rather than describing new logic to write from scratch, except where a small, explicit extension point is called out.
6. **Event-layering contract.** Zones nest: widget-specific zones live inside a pane, which lives inside the dashboard. The most specific handler that fires **must call `stopPropagation()`** so broader handlers don't also fire redundantly or show the wrong menu. `uplot.widget.js`'s chartHost handler already does this against its own container-level fallback; M1-M2 must do the same at the pane/dashboard boundary, and every future per-widget radial must do the same against its enclosing pane.
7. **A hint is plain text, not an icon standing in for the cursor.** The hover-hint label is literal text ("Add Channel", "Change Axis") — no emoji, no icon; the OS pointer itself (via `cursor: pointer`) is the "this is clickable" signal, and the hint just names the action.

---

## Milestone 0 — Extract shared infrastructure before fanning out

**Goal:** pull the ~150 lines of interaction-binding boilerplate currently living entirely inside `uplot.widget.js` (hover-hint styling/binding, the floating-input pattern, the Datasource→category→leaf channel-menu builder, `_findWidgetModel()`) into a small reusable module, **before** M3 onward need to duplicate it into five more widget files. Skipping this milestone would mean six-plus near-identical copies of the same event-binding code drifting independently.

**New file:** `app/dashboard/js/radial_widget_kit.js`, hosted in `app/extensions/core/manifest.json` at `order: 26` (just after `radial_context_menu.js`, before any widget plugin that will use it). Proposed surface (`window.RadialWidgetKit`):

- `ensureStyles()` — the shared hover-hint / floating-input / axis-panel CSS injection, called once app-wide via the same `freeboard.addStyle` idempotent pattern already used, but from one place instead of duplicated per widget file.
- `findWidgetModel(widgetInstance)` — generalizes `uplot.widget.js`'s `_findWidgetModel()` (currently: walk `freeboard.getLiveModel().panes()` → `widgets()` → match `w.widgetInstance === this`). Every widget instance calling this needs no change to the underlying logic, just to stop duplicating it.
- `bindHoverHint(el, zoneToLabelFn)` — generic version of `_bindChartHover()`'s hint half.
- `floatingInput({anchorEl, value, type, placeholder, onCommit, onCancel})` — generalizes `_startRenameChannel`/`_startRenameTitle`'s shared body (position over `anchorEl.getBoundingClientRect()`, append to `document.body`, Enter commits, Escape cancels, blur commits, `stopPropagation` on the input itself).
- `buildChannelMenuRoot(shared, { includeTypes, excludeTypes })` — generalizes `_buildChannelMenuRoot()`/`_buildThingSetCategoryNodes()`/`_buildSimpleLeafItems()`, parameterized so a caller can restrict to only the datasource types relevant to it (e.g. a gauge might reasonably allow any type; a CAN-only widget would restrict differently) instead of hardcoding the branch as `uplot.widget.js` currently does.
- `colorCarrousel(sourceOrPatch, x, y, onSelect)` — thin wrapper around `RadialContextMenu.show({items: paletteColors...})`, since every future widget's "right-click swatch" zone is identical apart from what `onSelect` commits.

**`uplot.widget.js` itself gets refactored** to call into `RadialWidgetKit` instead of its own private copies, as the *first* consumer and the correctness check — if this refactor doesn't leave `tests/e2e/radial-context-menu.spec.js`'s 12 tests green with zero behavior change, the extraction is wrong and must not proceed to M3.

**Risk:** this is a refactor of already-shipped, tested code — do it as its own commit/PR, verified purely by the existing test suite (no new tests expected, since behavior shouldn't change), before starting any new widget's radial work.

---

## Milestone 1 — Dashboard-level radial: Add Pane / Add Datasource

**Goal:** right-click empty space in `#board-content` (not bubbled from a pane — panes' own handlers, added in M2, must `stopPropagation()`) opens a two-category radial: **Pane** and **Datasource**.

**New file:** `app/dashboard/js/board_context_menu.js` (hosts both this milestone and M2 — they're both "chrome-level," not tied to any specific widget plugin, so one file is more cohesive than splitting by dashboard-vs-pane). Manifest entry at `order: 27`.

- **Pane category**: a single leaf, `+ Add Pane`, `onSelect: () => theFreeboardModel.createPane()` — this is already a zero-argument, zero-dialog call (`freeboard.js:1007-1011`), so the radial leaf is a direct passthrough, no new logic.
- **Datasource category**: one leaf per datasource type (5-6 today: `serialport_datasource`, `fast_frame_datasource`, `signal_generator_datasource`, `can_datasource`, `thingset_serial_datasource`, `owntech_thingset_datasource`), reading `datasourcePlugins` the same way the existing `.datasource-tile` picker does. Clicking a leaf should open the *settings step directly*, skipping the type-picker grid the modal shows today (the radial arc already **was** the type picker). This needs one small, explicit extension point: `createPluginEditor(title, pluginTypes, currentTypeName, currentSettingsValues, settingsSavedCallback, isWidgetType, skipSettingsTypes)` (`freeboard.js:2598`) already accepts a `currentTypeName` — confirm during implementation whether passing a real type name for an `operation:'add'` call already skips the picker step (`inPickerStep`/`selectedType` initialization needs checking); if not, a small guard change is needed so a pre-selected type advances straight to `advanceToSettings()`. This is the only new logic this milestone needs; everything else is wiring.

**Files touched:** `app/dashboard/js/board_context_menu.js` (new), `app/dashboard/js/freeboard.js` (small extension to `createPluginEditor` if the pre-select doesn't already work), `app/extensions/core/manifest.json`.

**Dependency:** none on M0 (doesn't touch any widget instance) — can land in parallel with M0, but must land before M2 since they share the new file.

---

## Milestone 2 — Pane-level radial: category → widget type, quick-add

**Goal:** right-click empty space inside a pane's `<section data-bind="foreach: widgets">` (not the header — that already has its own double-click rename and `.pane-tools` icons; not on an existing `.sub-section` — a widget's own zones, once it has any, take priority and must `stopPropagation()`) opens the widget category arcs (the same 8-9 categories the existing picker groups by) → each category's leaves are that category's widget types → clicking one quick-adds it to *this* pane using the exact code path at `freeboard.js:4494-4508` (new `WidgetModel`, default title, `pane.widgets.push`, auto-open the scoped editor for the 11 integrated-editor types) — called directly, not through the modal.

**Needed refactor:** the category→type grouping logic currently lives only inside the widget-picker modal's build code (`freeboard.js:~3356-3407`). Extract it into a small reusable `getCategorizedWidgetPlugins()` (or similar) in `freeboard.js`'s public surface, so the existing modal and the new radial both call the same function instead of the radial re-deriving the grouping a second time.

**Files touched:** `app/dashboard/js/board_context_menu.js` (pane-level handler, alongside M1's dashboard-level one), `app/dashboard/js/freeboard.js` (extract `getCategorizedWidgetPlugins()`), `app/extensions/core/manifest.json` (no new entry — same file as M1).

**Dependency:** M1 (shares the file); independent of M0.

---

## Milestone 3 — XY Plot (`xy_plot_uplot`)

**Goal:** apply the pilot's pattern to `app/dashboard/plugins/xy_plot.widget.js`, adapted for its actual shape — **exactly two** fixed sources (`xSourceDef`, `ySourceDef`), not an open-ended channel list, and a real two-axis (not time-axis) plot.

- Right-click the graph (`this.chartHost`) → two arcs, **"X Source"** and **"Y Source"** — each drills the *same* `RadialWidgetKit.buildChannelMenuRoot()` used by M0's extraction, but the leaf `onSelect` quick-**sets** `xSourceDef`/`ySourceDef` directly (`commitWidgetSettings`) rather than appending to a list.
- Hover the Y-axis margin → panel with **Y Label / Y Min / Y Max**; hover the X-axis margin → panel with **X Label / X Min / X Max** (this widget's X axis is a real data axis, unlike the time plot's duration/refresh-rate — confirm exact setting names against `openXYPlotEditor`'s commit block in `integrated_plot_editor.js` during implementation).
- Double-click the X/Y readout labels (`.uplot-readout-label`, already shared CSS with the time plot) to rename — **open question**: `xy_plot.widget.js`'s readout already shows `xLabel`/`yLabel`; confirm during implementation whether renaming the readout label should write the *same* `xLabel`/`yLabel` setting the axis panel edits (avoiding two mechanisms for one field) or a separate display-only label, before building this.
- Right-click the readout swatches → color carrousel for `trailColor`/`latestColor`.

**Files touched:** `app/dashboard/plugins/xy_plot.widget.js`, `tests/e2e/radial-context-menu.spec.js` (new tests, or a new `radial-context-menu-xy-plot.spec.js` if the existing file gets too large — judgement call at implementation time).

**Dependency:** M0 (needs `RadialWidgetKit`).

---

## Milestone 4 — Fast Frame Plot (`fast_frame_plot`)

**Goal:** apply the pattern to `app/dashboard/plugins/fast_frame_plot.widget.js`, adapted for its CSV-file (not live-datasource) data model.

- Right-click the graph → **no Datasource arc at all** (there's no live datasource to pick between) — straight to a flat list of the loaded CSV's column headers (`this.availableColumns`) as leaves, clicking one quick-adds it as a plotted channel. This reuses the *leaf-building* half of `RadialWidgetKit.buildChannelMenuRoot()`'s pattern but with a CSV-column source instead of a ThingSet/simple-datasource one — likely needs its own small `buildCsvColumnItems()` helper rather than forcing it through the datasource-shaped builder.
- Axis hover panels: this widget's settings don't obviously include `yMin`/`yMax` (confirm during implementation — may turn out there's nothing to put in a Y-axis panel, in which case skip it rather than inventing fields); the X-axis margin is the time/index column picker.
- Rename (double-click label) and recolor (right-click swatch) reuse the exact same delegated-binding pattern as the time plot, since `fast_frame_plot.widget.js` already uses identical `.uplot-readout-*` CSS classes.

**Files touched:** `app/dashboard/plugins/fast_frame_plot.widget.js`, test additions.

**Dependency:** M0.

---

## Milestone 5 — FFT Spectrum Plot (`fft_spectrum_plot`)

**Goal:** apply the pattern to `app/dashboard/plugins/fft_spectrum.widget.js` — the lightest of the plot milestones, since it's a single-signal selection (not a channel list) over a CSV source, much like M4's data model but simpler.

- Right-click the plot → flat list of CSV columns (reuse M4's `buildCsvColumnItems()`) — but clicking one **sets** the analyzed signal rather than adding to a list.
- Axis hover panels are likely unnecessary (FFT plots are typically auto-scaled) — confirm during implementation rather than building panels nobody needs.

**Files touched:** `app/dashboard/plugins/fft_spectrum.widget.js`, test additions.

**Dependency:** M4 (reuses its CSV-column leaf builder directly).

---

## Milestone 6 — Gauge Family (5 types, one implementation)

**Goal:** `vertical_gauge`, `horizontal_gauge`, `radial_arc_gauge`, `radial_needle_gauge`, and `donut_gauge` all share `app/dashboard/plugins/gauge_family.shared.js` — a single implementation here covers all five, the best leverage-to-effort ratio in this plan.

- Right-click the gauge body → Datasource drill (`RadialWidgetKit.buildChannelMenuRoot()`) → quick-sets the single `sourceDef` (gauges have exactly one, unlike the time plot's list) — no dialog.
- Hover the gauge → inline panel with **Min / Max / Units** (`merged.min`/`merged.max`/`merged.units`, confirmed fields per `gauge_family.shared.js`'s `normalizeSettings()`).
- Double-click the gauge's title to rename it (reuse `RadialWidgetKit.floatingInput()` directly against the title element).
- Right-click the gauge's color area (bar/arc/needle, depending on family member) → the *exact same* 10-color carrousel component already built — quick-sets `barColor`. No new carrousel code needed, just wiring.
- **Open question, not blocking:** whether `warningThreshold`/`criticalThreshold` belong in the hover panel too, or are complex enough to stay dialog-only — lean toward dialog-only initially (they interact with `alarmDirection`/`alarmEnabled`, more than a flat field list), revisit if it turns out to be a common enough edit to be worth it.

**Files touched:** `app/dashboard/plugins/gauge_family.shared.js`, test additions (one spec file, parameterized across the 5 `type_name`s the way `integrated-plot-editor.spec.js` already parameterizes its own gauge-family tests).

**Dependency:** M0.

---

## Milestone 7 — Buttons Family (`toggle_button`, `plus_minus_button`, `serial_command_buttons`)

**Goal:** these are action-first widgets, not display-first ones — the radial's role here is **configuring the write target**, not live-editing a displayed value, which is a different emphasis than M3-M6.

- **`toggle_button`**: right-click → Datasource drill, but the leaf `onSelect` quick-sets `writePath` (not a `sourceDef` — this widget writes, it doesn't read a channel) rather than adding anything. Whether the on/off value text (`onValue`/`offValue`) should be double-click renameable on the button label itself is a genuine product judgement call — flag as **open question**, don't prescribe a mechanism until it's clear what "the button's label" even means for this widget's rendered DOM.
- **`plus_minus_button`**: already has a read-side `sourceDef` from the OwnTech migration's M2 (`_readInstantValue()`); right-click → Datasource drill sets *both* the read source and a separate write path, since these can legitimately differ; hover → a small panel for **Step** size, the one "always the same fixed field" this widget has.
- **`serial_command_buttons`** (Push Buttons): the most complex of the three — an array of `buttons`/`buttonTargets`, already with its own dedicated editor (`openPushButtonsEditor`, from the OwnTech migration's M3). The radial's role is narrower here: right-click empty space in the button list → `+ Add Button` quick-add with a blank target (matching the quick-add ethos even though the *button itself* still needs manual configuration after); double-click an existing button's label to rename it in place. **Do not** attempt to radial-ify the button-target configuration itself (path + value) — that's exactly the kind of "genuinely varies per situation" case Design Principle 2 says stays in the full editor.

**Files touched:** `app/dashboard/plugins/toggle_button.widget.js`, `app/dashboard/plugins/plusminus_button.widget.js`, `app/dashboard/plugins/serialcommand.widget.js`, test additions.

**Dependency:** M0.

---

## Milestone 8 — OwnTech Family (`owntech_actions_panel`, `owntech_scope_capture`) — lower priority

**Goal:** survey-level pass on the two active OwnTech widgets; **explicitly lower priority** than M3-M7, since the value-add here looks thinner (these are already fairly direct-manipulation widgets — toggles and buttons you click once — with less "which one of many" friction to remove than a multi-channel plot has).

- `owntech_actions_panel`: right-click the datasource summary line → reassign the linked `datasource` setting (flat leaf list, same pattern as M1). Per-leg toggle grid and power buttons are already one click each — no obvious radial value-add there; don't force one in. A leg badge could be double-click-renameable (cosmetic label only) if it turns out anyone wants to relabel "Leg1"/"Leg2" — treat as optional, not core to this milestone.
- `owntech_scope_capture`: decimation/pre-trigger are already direct `<select>`/`<input>` controls with no dialog in between — nothing to speed up there. If the inline uPlot chart ever gains distinct per-channel colors, the same carrousel wiring would apply, but that's speculative against the current single-chart rendering, not a concrete need today.

**Explicitly out of scope within this milestone:** `owntech-legacy` (`twist_actions_panel`, `twist_setpoints_panel`, `twist_calibration_panel`, `state_machine`) — frozen, disabled-by-default, per the OwnTech extension migration's own M0 decision (`dev/docs/extensions/owntech_extension_overhaul_migration.md`). No radial work planned for it.

**Files touched:** `app/dashboard/plugins/owntech_actions_panel.widget.js` (datasource-reassign leaf only), test additions.

**Dependency:** M0.

---

## Milestone 9 — ThingSet/Serial Family — deferred, revisit after M1-M8

**Goal:** `thingset_serial_device_ui`, `serial_terminal`, `serial_csv_recorder`, `serial_flasher` are largely **operational/monitoring** widgets (live value tables, a scrolling log, record start/stop, a file-then-flash flow) rather than plot/config-heavy ones. The only broadly-applicable zone that suggests itself is "right-click → reassign linked datasource/port," reusing M1's flat-leaf pattern — nothing here obviously benefits from a hover panel or a multi-level drill-down the way the plot family does.

**Recommendation: do not commit to specific interactions now.** Revisit once M1-M8 have shipped and the pattern's real value (and the team's appetite for radial menus generally) is better understood from actual usage, rather than speculatively building thin value-add here. If revisited, the datasource-reassign leaf is the only piece worth doing unconditionally.

**Explicitly out of scope:** CAN-based ThingSet widgets (`thingset_control_panel`, `thingset_device_ui`, `thingset_measurements`, `thingset_mode_button`) and `can_datasource` — consistent with the "CAN stays untouched" principle already established for the OwnTech extension (`dev/docs/extensions/owntech_extension_overhaul_migration.md`'s Architecture Principles).

---

## Milestone 10 — Polish from live user testing (M0-M8 follow-ups)

**Goal:** three fixes reported after using the M0-M8 implementation live, none of them new surface area — all three are corrections to the pilot's own generic infrastructure (`radial_context_menu.js` / `radial_widget_kit.js`), so every widget built on it picks up the fix automatically.

- **Icon + name widget-type and datasource-type leaves.** The pane-level radial's widget-type leaf ring (M2) and the dashboard-level radial's datasource-type leaf ring (M1) were both showing only the full display name as text inside a 64px circle. `RadialContextMenu`'s leaf renderer gained an `item.icon` field (Font Awesome, rendered via `<i class="fa-solid fa-…">` stacked above an `item.label` text span, alongside the existing `item.color` swatch and plain-text-only cases) — icon-only was tried first and read as too sparse; icon-above-name (matching the widget-picker and datasource-picker modals' own tile layout) is the shipped version. `board_context_menu.js` passes each widget plugin's own `icon`, falling back to `freeboard.getWidgetCategoryDefaultIcons()` and then `puzzle-piece`; datasource leaves fall back to the new `freeboard.getDatasourceIconMap()` and then `database` -- both are the same per-type/category default-icon maps the respective modals already used internally, now exposed for reuse instead of a second copy drifting in the radial.
- **Leaf tooltips didn't match the Add-button modals'.** Both modals show a plugin's own `description` (when it has one) as its tile's hover tooltip; the radial's leaf ring only ever showed the plain name (`item.label`) as `btn.title`, regardless of whether a richer description existed. `RadialContextMenu`'s leaf renderer now prefers `item.description`, falling back to `item.label`; `board_context_menu.js` passes each widget/datasource plugin's own `description` through for both leaf rings.
- **"Pane" was a category of exactly one, forcing a pointless extra click.** `RadialContextMenu` gained a third wedge shape alongside branch (`children`) and leaf-group (`items`): a direct-action wedge (`{ id, label, onSelect }`, mirroring the leaf item's own `onSelect` shape) that fires immediately on click instead of drilling to a leaf ring with a single circle in it. The dashboard-level radial's "Pane" wedge (M1) now uses this -- right-click empty board space -> click "Pane" -> a pane exists, no "+ Add Pane" leaf-ring step in between. General engine capability, reusable anywhere else a category collapses to one option.
- **"Gauges" category was silently missing.** `_getDefaultWidgetCategories()` never included `"Gauges"` even though every gauge widget declares `category:'Gauges'` and `_inferWidgetCategory()` already knows about it — the old widget-picker modal never showed the gap since it renders from its own separate, complete `widgetCategoryOrder` list. All 5 gauge types were silently falling into "Other" in the pane-level radial. Fixed by adding `"Gauges"` to `_getDefaultWidgetCategories()`.
- **Duplicate leaf circles for same-named leaves under different groups.** `buildThingSetCategoryNodes()` bucketed only one level deep (top segment → flat leaf ring keyed by the *last* path segment), so a multi-leg board's `/Config/Leg1/wEnable` and `/Config/Leg2/wEnable` both collapsed to a bare "wEnable" leaf — two visually identical circles for genuinely different paths. Replaced with a recursive `levelFor()` that only drills one more level when it would actually resolve a same-label collision (or when entries are more than one segment deeper), and groups a level's non-nested scalars (e.g. `/Config/rMode`, `/Config/wMode`) under one shared "General" wedge rather than each getting its own single-item wedge. A flat single-level group (e.g. `Measurements`) still renders straight to leaves with no extra hop — this only adds structure where duplication would otherwise occur.
- **Axis/gauge hover panel lingered too long after the mouse left.** `RadialWidgetKit.makeHoverBridge()`'s hide-debounce (bridges the physical gap between a trigger zone and its floating panel, e.g. time plot's Y-axis margin → its Y Label/Min/Max panel) was 200ms, long enough to read as a lag rather than a deliberate grace period. Reduced to 80ms — still enough to move the cursor from the margin into the panel without it flickering shut, but the panel now disappears promptly once the mouse has genuinely left both.

**Files touched:** `app/dashboard/js/radial_context_menu.js` (icon leaf rendering), `app/dashboard/js/board_context_menu.js` (pass `icon` per widget-type leaf), `app/dashboard/js/freeboard.js` (`getWidgetCategoryDefaultIcons()`), `app/dashboard/js/radial_widget_kit.js` (`buildThingSetCategoryNodes()` rewrite, `makeHoverBridge()` default), `app/dashboard/plugins/{uplot,xy_plot,fast_frame_plot,plusminus_button}.widget.js` + `gauge_family.shared.js` (adopt the new hover-bridge default), test additions across `radial-context-menu*.spec.js` and `board-context-menu.spec.js`.

**Dependency:** M0-M8 (fixes to their shared infrastructure, not new milestones of its own).

---

## Non-Goals / Explicitly Out of Scope (whole plan)

- **Legacy freeboard built-in widgets** (`text_widget`, `gauge` [the old freeboard one, distinct from the new gauge family], `sparkline`, `pointer`, `picture`, `indicator`, `google_map`) and their demo datasources (`JSON`, `openweathermap`) — these predate this app's own widget conventions and aren't part of the OwnTech-relevant surface. No radial adaptation planned, ever, unless explicitly requested later.
- **`owntech-legacy`** widget family — frozen (see M8).
- **CAN-based ThingSet widgets/datasource** — out of scope (see M9).
- **Any change to the existing generic per-widget toolbar, per-pane toolbar, or dashboard top-bar** — these are the reliable fallback for every action a radial menu ever covers; removing or hiding them is never in scope (Design Principle 1).

---

## Sequencing / Dependency Graph

```
M0 (shared RadialWidgetKit, extracted from the pilot)
  │
  ├──► M1 (dashboard radial: Pane/Datasource) ──► M2 (pane radial: categories → widget types)
  │        [M1/M2 don't strictly need M0 -- they're chrome-level, not per-widget --
  │         but share one new file, so M2 depends on M1 landing first]
  │
  ├──► M3 (XY Plot)
  ├──► M4 (Fast Frame Plot) ──► M5 (FFT Spectrum, reuses M4's CSV-column leaf builder)
  ├──► M6 (Gauge family -- covers all 5 gauge types at once)
  ├──► M7 (Buttons family)
  └──► M8 (OwnTech family -- lower priority)

M9 (ThingSet/Serial family) -- deferred, not scheduled; revisit after M1-M8
```

M3, M4, M6, M7, M8 are independent of each other once M0 lands and can be parallelized or reordered freely by priority; M5 is the one milestone with a real intra-plan dependency (on M4).

---

## Verification Strategy

Every milestone needs e2e coverage in the same style as the existing `tests/e2e/radial-context-menu.spec.js` — real right-clicks, real wedge/leaf clicks (via `clickWedgeByLabel`, not a raw locator `.click()`, for the reason documented in that file), and assertions against committed settings, not just DOM appearance. Two structural notes:

- **Extract `clickWedgeByLabel()` (and the other small helpers in that file) into a shared `tests/e2e/radial_menu_helpers.js`** once M3 starts — copy-pasting it into a second spec file the moment a second widget needs it is the wrong call; do the extraction as part of M3's own PR, not retroactively later.
- **Decide per-milestone whether to extend `radial-context-menu.spec.js` or start a new spec file** based on size — the existing file is already ~470 lines across 12 tests for one widget; six more widgets' worth of tests in one file would be unwieldy. Recommend one spec file per widget (`radial-context-menu-xy-plot.spec.js`, etc.) from M3 onward, keeping `radial-context-menu.spec.js` scoped to the time plot and to M1/M2's dashboard/pane-level tests (which don't belong to any single widget file).

| Milestone | Unit tests | E2E |
|---|---|---|
| M0 | n/a (pure refactor) | Existing 12 `radial-context-menu.spec.js` tests must stay green, unmodified |
| M1 | n/a | New: right-click empty board → Pane/Datasource arcs, Add Pane creates a pane, Add Datasource leaf reaches settings |
| M2 | n/a | New: right-click empty pane → category arcs match the picker's own grouping, quick-add creates the widget, integrated-editor types auto-open scoped |
| M3-M8 | n/a (all UI wiring, no pure-function logic worth unit testing) | New spec file per widget, mirroring M3-M8's own zones |
| M9 | — | Deferred |

---

## Implementation Order

| Step | Scope | Effort |
|---|---|---|
| M0. Extract `RadialWidgetKit`, refactor `uplot.widget.js` onto it | JS refactor, no new UI | Medium |
| M1. Dashboard radial (Pane/Datasource) | New file + small `freeboard.js` extension | Small |
| M2. Pane radial (categories → widget types) | Same file + `freeboard.js` category-grouping extraction | Medium |
| M3. XY Plot radial | Widget file + tests | Medium |
| M4. Fast Frame Plot radial | Widget file + tests | Medium |
| M5. FFT Spectrum radial | Widget file + tests | Small |
| M6. Gauge family radial (5 types at once) | Shared widget file + tests | Medium |
| M7. Buttons family radial | 3 widget files + tests | Medium |
| M8. OwnTech family radial (lower priority) | 1 widget file + tests | Small |
| M9. ThingSet/Serial family | Deferred — not scheduled | — |

Start with M0 — every later milestone's effort estimate above assumes the shared kit exists; skipping it would make M3-M8 each larger and duplicate-prone instead.

---

## Commit Pattern

One commit per milestone (or a small number of commits per milestone, matching how `radial-context-menu.spec.js`'s own history split "pilot," "extend pilot," and "fix bugs found while trying it" into separate commits — same discipline here: a milestone's *core* wiring, its *tests*, and any *bug fix discovered while testing it* are separate commits, not squashed together).

| Milestone | Commit message |
|---|---|
| M0 | `refactor(dashboard): extract RadialWidgetKit from the time-plot radial menu pilot` |
| M1 | `feat(dashboard): right-click the board for Add Pane / Add Datasource` |
| M2 | `feat(dashboard): right-click a pane for category-grouped quick-add widgets` |
| M3 | `feat(xy-plot): adapt the radial menu pattern -- X/Y source drill, axis panels, rename, color` |
| M4 | `feat(fast-frame-plot): adapt the radial menu pattern -- CSV column quick-add, rename, color` |
| M5 | `feat(fft-spectrum): adapt the radial menu pattern -- CSV column quick-select` |
| M6 | `feat(gauges): adapt the radial menu pattern across all 5 gauge types` |
| M7 | `feat(buttons): adapt the radial menu pattern -- write-target drill, quick-add buttons` |
| M8 | `feat(owntech): adapt the radial menu pattern -- datasource reassignment` |

Each milestone should leave the app in a working, visually consistent state, matching every prior migration in this codebase's own convention: never commit a half-wired zone, and if a milestone's diff grows past what one commit should carry, split and number it `(1/2)`/`(2/2)` rather than force it into one.

---

## Files Modified Summary

| File | Changes |
|---|---|
| `app/dashboard/js/radial_widget_kit.js` | **New** (M0) — shared hover-hint, floating-input, and channel-menu-builder helpers |
| `app/dashboard/js/board_context_menu.js` | **New** (M1/M2) — dashboard-level and pane-level right-click zones |
| `app/dashboard/js/freeboard.js` | M1: small `createPluginEditor` extension for a pre-selected type; M2: extract `getCategorizedWidgetPlugins()` |
| `app/dashboard/plugins/uplot.widget.js` | M0: refactored onto `RadialWidgetKit`, no behavior change |
| `app/dashboard/plugins/xy_plot.widget.js` | M3: X/Y source drill, axis panels, rename, color carrousel |
| `app/dashboard/plugins/fast_frame_plot.widget.js` | M4: CSV-column quick-add, rename, color carrousel |
| `app/dashboard/plugins/fft_spectrum.widget.js` | M5: CSV-column quick-select |
| `app/dashboard/plugins/gauge_family.shared.js` | M6: Datasource drill, Min/Max/Units panel, title rename, color carrousel (all 5 gauge types) |
| `app/dashboard/plugins/toggle_button.widget.js` | M7: write-path drill |
| `app/dashboard/plugins/plusminus_button.widget.js` | M7: read/write drill, Step panel |
| `app/dashboard/plugins/serialcommand.widget.js` | M7: quick-add button, label rename |
| `app/dashboard/plugins/owntech_actions_panel.widget.js` | M8: datasource-reassign leaf |
| `app/extensions/core/manifest.json` | New `rendererScripts` entries for `radial_widget_kit.js` and `board_context_menu.js` |
| `tests/e2e/radial_menu_helpers.js` | **New** (M3) — `clickWedgeByLabel()` and friends, extracted from `radial-context-menu.spec.js` |
| `tests/e2e/radial-context-menu-*.spec.js` | New spec files, one per widget from M3 onward |
