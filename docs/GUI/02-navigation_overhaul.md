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
- **Category wedges had no tooltip, and the two top-level ones read as nouns instead of actions.** Wedge nodes gained the same `description`-as-native-tooltip support leaf items already had (an SVG `<title>` child, falling back to the visible `label` when absent) -- every category wedge throughout the app (the pane-level radial's widget categories included, via `Add a ${category} widget`) now shows one on hover. Separately, the dashboard-level radial's two top-level wedges (M1) now show "Add Pane" / "Add Datasource" as their *visible* label too, not just "Pane" / "Datasource" -- there are exactly two choices at that first click, each already fully describing what it does.
- **"Gauges" category was silently missing.** `_getDefaultWidgetCategories()` never included `"Gauges"` even though every gauge widget declares `category:'Gauges'` and `_inferWidgetCategory()` already knows about it — the old widget-picker modal never showed the gap since it renders from its own separate, complete `widgetCategoryOrder` list. All 5 gauge types were silently falling into "Other" in the pane-level radial. Fixed by adding `"Gauges"` to `_getDefaultWidgetCategories()`.
- **Duplicate leaf circles for same-named leaves under different groups.** `buildThingSetCategoryNodes()` bucketed only one level deep (top segment → flat leaf ring keyed by the *last* path segment), so a multi-leg board's `/Config/Leg1/wEnable` and `/Config/Leg2/wEnable` both collapsed to a bare "wEnable" leaf — two visually identical circles for genuinely different paths. Replaced with a recursive `levelFor()` that only drills one more level when it would actually resolve a same-label collision (or when entries are more than one segment deeper), and groups a level's non-nested scalars (e.g. `/Config/rMode`, `/Config/wMode`) under one shared "General" wedge rather than each getting its own single-item wedge. A flat single-level group (e.g. `Measurements`) still renders straight to leaves with no extra hop — this only adds structure where duplication would otherwise occur.
- **Axis/gauge hover panel lingered too long after the mouse left.** `RadialWidgetKit.makeHoverBridge()`'s hide-debounce (bridges the physical gap between a trigger zone and its floating panel, e.g. time plot's Y-axis margin → its Y Label/Min/Max panel) was 200ms, long enough to read as a lag rather than a deliberate grace period. Reduced to 80ms — still enough to move the cursor from the margin into the panel without it flickering shut, but the panel now disappears promptly once the mouse has genuinely left both.

**Files touched:** `app/dashboard/js/radial_context_menu.js` (icon leaf rendering), `app/dashboard/js/board_context_menu.js` (pass `icon` per widget-type leaf), `app/dashboard/js/freeboard.js` (`getWidgetCategoryDefaultIcons()`), `app/dashboard/js/radial_widget_kit.js` (`buildThingSetCategoryNodes()` rewrite, `makeHoverBridge()` default), `app/dashboard/plugins/{uplot,xy_plot,fast_frame_plot,plusminus_button}.widget.js` + `gauge_family.shared.js` (adopt the new hover-bridge default), test additions across `radial-context-menu*.spec.js` and `board-context-menu.spec.js`.

**Dependency:** M0-M8 (fixes to their shared infrastructure, not new milestones of its own).

---

## Milestone 11 — OwnTech Variable Table widget (`owntech_variable_table`)

**Goal:** a table showing **every variable the board exposes**, laid out as its ThingSet hierarchy. Read-only variables are shown live; writable ones can be edited in place, and each edit sends one write to the board. Today the only overview of a walked tree is the generic `thingset_serial_device_ui` widget: a list of nested `<details>` blocks that fetches its own copy of the tree, with no columns, filtering, units or write safety. This milestone gives the OwnTech extension a proper "manual mode" view of the target.

### What it shows

- **A tree-table**, one row per node, built from the linked `owntech_thingset_datasource`'s tree. It adds no serial traffic of its own: it re-renders on every datasource update (values-only refreshes, ~150 ms on a Core4 board since `49f7d57`).
  - **Group rows** (`Config`, `Leg1`, `Measurements`…) have an expand/collapse chevron, indentation by depth, bold names and a summary, e.g. `Leg1 · 11 variables · 9 writable`. Top-level groups start expanded; deeper ones start collapsed.
  - **Variable rows**, in columns:
    - **Name**: indented, with the ThingSet prefix de-emphasized so `wDutyCycle` reads as "DutyCycle".
    - **Value**, formatted by type: boolean as a pill (true/false), number to sensible precision, string as text, array or record as a compact chip.
    - **Unit**, parsed from the name suffix: `_V`, `_A`, `_s`, `_ms`, `_us`, `_ns`, `_Hz`, `_degC`, `_W`.
    - **Access** badge (see below).
    - **Full path**, shown on hover, with copy on click.
  - Values that changed since the previous update flash briefly, so it's obvious what's live.
- **Access badges**, from the ThingSet naming prefix, since the serial shell exposes no access metadata:
  - `r` → **Read-only**
  - `w` → **Writable**
  - `s` → **Stored setting** (writable, persisted)
  - `p` → node identity (read-only)
  - `m` → subset/record (read-only here)
  - `_` → internal, hidden unless "Show internal" is on
  - **No prefix** (e.g. `Config/Mode`, `Config/Frequency_Hz`) → **Unknown**: editable, and the board decides. A rejected write is shown inline (`ade9015`).
- **Toolbar:**
  - search box (matches name and path) and filter chips: *All · Writable · Read-only · Changed*
  - Expand all / Collapse all
  - **Refresh** (values) and **Rescan** (full walk, `rescan()`)
  - last-update time and the datasource's port/node
  - the **write lock** (below)

### Editing

- **The write lock is on by default.** The table opens read-only, and an explicit "Unlock writes" toggle in the toolbar enables editing. The toggle is per widget instance and not saved, so a reload always comes back locked.
- **Typed inline editors**, opened by clicking a writable value:
  - boolean → switch
  - number → numeric input (Enter writes, Esc cancels, the arrow keys step)
  - string → text input
  - Records and arrays are not editable in this milestone.
- **Each write** goes through `ThingSetWrite.write()`. The cell shows a spinner, then:
  - ✓ with the board's **readback**;
  - or ✗ with the error, on hover.

  If the readback differs from what was written, the cell says so. For example: "board holds 0.1".
- **Writes that affect power ask for confirmation**, showing the current and new value: `Config/Mode`, `*/wEnable`, `*/wDriver`, `*/wCapa`, `*/wDutyCycle`, `*/wReferenceValue`, `*/wBuck`, `*/wBoost`, `Config/Frequency_Hz`.
- **Known-firmware caveats shown inline** next to the affected variables (from the 2026-10-13 hardware runs and Core4's own test log):
  - `wDriver`: once true, only an MCU reset clears it.
  - `wDutyCycle`: values below 0.1 are clamped to 0.1 by the power library, and `rDutyN` echoes the requested value.
  - `Debug/Scope/wArm` / `wTrigger`: one-shot, they read back `false` after success.
  - `Frequency_Hz`: writes are a known firmware issue; Core4's own tests never write it.

### Navigation (radial menus, same patterns as M1–M8)

- **Pane right-click → OwnTech category** lists the widget automatically (category `OwnTech`, its own icon and description), like the other OwnTech widgets.
- **Right-click a variable row** → a small radial:
  - **Copy path**
  - **Add widget bound to it**: a gauge for a number, a toggle for a boolean, via the existing quick-add path
  - **Refresh**
- **Right-click the header/status line** → reassign the linked datasource (M8's flat-leaf pattern).

### Out of scope

- Editing records/arrays, creating or deleting nodes (`ts-serial-create`/`-delete`), executing functions (`e…`).
- CAN ThingSet (same rule as M9).
- Retiring `thingset_serial_device_ui`: decide after M11 has been used.

### Files

- `app/dashboard/js/owntech_variable_table_model.js` (**new**, pure and unit-testable, loadable from Node like `thingset_value_parse.js`):
  - tree → flat row list (depth, parent, group summaries);
  - access inference from the prefix;
  - unit parsing from the suffix;
  - value formatting and editor-value parsing;
  - the power-path list and caveats.
- `app/dashboard/plugins/owntech_variable_table.widget.js` (**new**): rendering, filter/search, expand state, live updates, editing, radial wiring.
- `app/extensions/owntech/manifest.json`: two new `rendererScripts` entries.
- `app/preload.js` (MOCK_HW only): an opt-in way to make mocked writes fail, so the rejected-write path is testable.
- `docs/widgets/…` + `index.owntech.json`: widget doc.
- `tests/unit/owntech_variable_table_model.test.js`, `tests/e2e/owntech-variable-table.spec.js`.

### Verification

| Level | What |
|---|---|
| Unit | Flattening keeps the hierarchy and order; group summaries count correctly; every prefix maps to the right access; units parse; formatting/parsing round-trips; power paths are matched by pattern (`/Config/Leg2/wEnable`, a 3rd leg too) |
| E2E (MOCK_HW) | Renders groups + variables from the mocked tree; expand/collapse; search and filter chips; write lock blocks editing; editing a number calls `setValue` with the parsed value and shows the readback; a rejected write shows ✗; a power path asks for confirmation and Cancel sends nothing; the widget is listed under the pane radial's OwnTech category; row right-click → Copy path / Add widget |
| Real hardware (Core4 board) | **Read-only:** all values and groups shown and updating live. **Inert writes:** `Config/wBlinkPeriod_s` 1 → 0.5 → 1 (the LED visibly changes), `Debug/Scope/wDecimation`. **Writes that switch power, only with the user at the bench** under the Phase 3 interlock rules: Mode, leg 1 `wEnable` at duty 0.1, confirming the confirmation dialog appears and the readback is shown |

### Commit sequence

| # | Commit |
|---|---|
| 1 | `docs(gui): plan the OwnTech variable table widget (M11)` |
| 2 | `feat(owntech): add the variable table model (tree rows, access, units, formatting)` + unit tests |
| 3 | `feat(owntech): add the owntech_variable_table widget: hierarchical read-only view with search and filters` |
| 4 | `feat(owntech): edit writable variables in the variable table, with write lock, confirmation and readback` |
| 5 | `feat(owntech): variable table radial menu: copy path, add a bound widget, reassign datasource` |
| 6 | `test(owntech): e2e coverage for the variable table` (+ the MOCK_HW rejected-write hook) |
| 7 | `docs(owntech): document the variable table widget` |
| 8 | `docs(gui): log M11 real-hardware verification` |

Each commit leaves the app working: 3 ships a useful read-only table even before 4 adds editing.

**Dependency:** the 2026-10-13 fixes (`49f7d57` values refresh, `ade9015` `ThingSetWrite`, `9d1f671` group reads); M1/M2 (pane radial) and M8 (datasource reassign) for navigation.

### M11 delivered (2026-10-14)

| # | Commit | What |
|---|---|---|
| 1 | `167669f` | docs(gui): plan the OwnTech variable table widget (M11) |
| 2 | `b990e45` | feat(owntech): add the variable table model (tree rows, access, units, formatting) |
| 3 | `3948615` | feat(owntech): add the owntech_variable_table widget: hierarchical read-only view with search and filters |
| 3a | `6337c57` | fix(thingset): refresh variables the walk returned with empty children (found by step 4, see below) |
| 4 | `131e252` | feat(owntech): edit writable variables in the variable table, with write lock, confirmation and readback |
| 5 | `e254194` | feat(owntech): variable table radial menu: copy path, add a bound widget, reassign datasource |
| 6 | `d7793b9` | test(owntech): e2e coverage for the variable table |
| 7 | `82e484e` | docs(owntech): document the variable table widget |
| 8 | this commit | docs(gui): log M11 real-hardware verification |

**Deviations from the plan, found on the board:**
- **Access prefixes:** the real tree also uses `c` (constants, `THINGSET_ANY_R`) and `z` (the OwnTech CAN control channel, `THINGSET_ANY_RW`). Both are now mapped. `p` turned out not always read-only (`pCANNodeAddr`), so it's "Persistent" and the board decides. `Control/z*` writes ask for confirmation: on firmware that wires them to the power stage, `zStartStop` starts a converter.
- **Leaf detection:** the walk returns some variables (`Config/Mode`, `Frequency_Hz`, `pNodeID`, `Device/c*`, `Control/z*`) as nodes with empty `children` plus their own `value`. The model treats them as variables. The same shape also broke `refreshValues()` (`49f7d57`): those variables were never refreshed after the first walk, so a confirmed `Mode = 1` read back 1 and then the next refresh restored the stale 0. Fixed in `6337c57`, with a unit test.
- **No integer guard in the editor:** a float holding 1.0 arrives as `1` (`Config/wBlinkPeriod_s`), so the type can't be inferred from the value. The board accepts or rejects, and the readback shows what it stored.
- **Step size** (+/− button, arrow keys) comes from the unit: a value with a unit steps by its magnitude (1 s → 0.1), a unitless whole number by 1.
- **`freeboard.addWidgetToPane()`** was added (step 5): freeboard had no way to add a widget with preset settings without opening the editor.

### M11 real-hardware verification (2026-10-14)

**Bench:** a Spin board running Core4 firmware, with no power stage attached (serial `423250070031003C`; if02 → `/dev/ttyACM1`, node UID `0941809145890E85`). Measurements are meaningless without the power stage (e.g. V1Low −92.2 V, I −10 A), but the tree, access and writes are the real firmware's. Driven in the live app over CDP, with every written value restored afterwards.

| Check | Result |
|---|---|
| Tree | 17 groups, 79 variables (54 writable): Calibration I1/I2/IH/V1/V2/VH, Config with Leg1/Leg2 plus Mode/Frequency_Hz/wBlinkPeriod_s, Control, Converter, Debug/Scope, Device, Measurements, Networking, root records and identity |
| Access | 47 Writable, 19 Read-only, 4 Constant, 3 Persistent, 2 Control, 2 Record, 2 Unknown (`Config/Mode`, `Config/Frequency_Hz`) |
| Power markers | Mode, Frequency_Hz, every leg Enable/Driver/Capa/DutyCycle/ReferenceValue/Buck/Boost, Control/z* |
| Search "duty" | Leg1/Leg2 `DutyCycle` and Measurements `Duty1`/`Duty2`, with their groups |
| Read-only filter | 25 variables |
| Locked | clicking a value opens nothing |
| `Config/wBlinkPeriod_s` 1 → 0.5 → 1 | written without confirmation, ✓, board holds 0.5 then 1 (the LED blink rate follows) |
| `Config/Mode` 0 → 1 → 0 | confirmation shows `0 → 1` and "changes what the power stage does"; Cancel leaves the board at 0; Write sets 1 and the cell stays 1 after the refresh; restored to 0 |
| `Config/Leg1/wEnable` | confirmation `false → true`; Escape cancels and the board stays false |
| `Debug/Scope/wArm` | ✓ *board holds false* (one-shot), rState → 1 (ARMED) |
| `abc` into `wDecimation` | stays in the editor with "expected a number"; nothing sent |
| Read-only `rVHigh_V` | not editable |
| Row right-click | Copy path / Add +/− button / Refresh (writable number); Add gauge (read-only number); Add toggle (writable boolean) |
| Add +/− button for `wBlinkPeriod_s` | bound to `/Config/wBlinkPeriod_s`, step 0.1 |
| Add gauge for `rVHigh_V` | bound, reads 0.12–0.18 V live |
| Copy path | `/Config/Leg1/wEnable` on the clipboard |
| Status-line right-click | lists the ThingSet datasources |
| Page errors | none |
| Final board state | Mode 0, blink 1 s, Leg1 `wEnable`/`wDriver` false, decimation 1 (scope left ARMED by the `wArm` check) |

**Tests:** unit `owntech_variable_table_model`, `thingset_serial_shell` (+ `refreshValues`), and the other ThingSet/scope unit tests pass. E2E `owntech-variable-table.spec.js` (4) plus the other OwnTech, OwnTech radial and button radial specs (16 in that run) pass.

**Not run here:** writes that switch power on a board with a power stage. The confirmation dialog and readback were exercised on the Spin; a Twist bench run under the Phase 3 interlock rules is still worth doing before relying on the table for power-stage writes.

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
| M11. OwnTech Variable Table widget | 1 model file + 1 widget file + tests + docs | Medium–Large |

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

---

## Real-hardware responsiveness testing (OwnTech extension)

**Why here:** live use of the dashboard on a real board (2026-10-12/13) reported that the hardware *does* respond but the app feels slow: voltage changes show up late, and writes take a while to land. The radial menus only pay off if the widgets underneath them respond quickly, so the extension's responsiveness is tracked alongside this plan.

**Setup:** Core4 Twist v1.4.2 board (`if00` → `/dev/ttyACM0` scope port, `if02` → `/dev/ttyACM1` ThingSet shell, node `0x01`), Core4 firmware `a5b6414`, powered bench. Tests 1–3 drive the real `ts-serial-*` IPC handlers (`app/extensions/thingset/main.js`) from Node, with per-step timing wrapped around `ThingSetSerialShell` methods. Tests 4–5 run inside the live app (started with `--remote-debugging-port=9222`, driven over CDP by Playwright) with `dashboard_test` (one `owntech_thingset_datasource`) loaded.

### Test plan

| Phase | Test | Writes? | Gate |
|---|---|---|---|
| 1 | T1: detect + 5 consecutive tree fetches | No | none |
| 1 | T2: 20× `get-value` on `Measurements/rV1Low_V` and `Config/Leg1/wEnable`, split into open / handshake / command / close | No | none |
| 1 | T3: one read issued while a tree fetch is in flight | No | none |
| 1 | T4: in-app: dashboard load → first tree; Auto Refresh's real update rate; reads while Auto Refresh runs | No | none |
| 1 | T5: in-app `window.api.thingsetSerial.getValue` vs. the Node baseline (IPC/renderer overhead) | No | none |
| 2 | Scope arm/trigger/download at low decimation, if00 + if02 concurrently | `/Debug/Scope/*` only (inert) | user OK per write |
| 3 | `Config/Mode` IDLE→POWER_ON→POWER_OFF→IDLE; leg `wEnable`; duty/reference stepping from the lowest setpoint, timing write-accepted → readback → measured voltage change | Actuating | user's explicit go, present at a current-limited bench, value announced before every write, stop on first surprise (same rules as the OwnTech migration's M9) |

### Phase 1 results (2026-10-13)

| Measurement | Result |
|---|---|
| T1 detect (auto, lands on `/dev/ttyACM1`) | 1.07 s |
| T1 tree fetch (81 leaves), ×5 | 2.71–3.20 s, median 2.77 s. Of that: open 1 ms, handshake 75 ms, **walk 2.55 s**, node meta 53 ms, close 35 ms |
| T2 single read, **before** fix | median **551 ms** (only ~123 ms of it serial work) |
| T2 single read, **after** fix | median **121 ms**: handshake 75 ms + close 37 ms + **the actual command 10 ms** + open ~1 ms |
| T3 read issued 200 ms into a tree fetch | completes after **3.0 s**: it waits for the whole walk (per-port queue) |
| T4 dashboard load → first tree in the app | 4.1 s (detect + walk) |
| T4 Auto Refresh at the default 2000 ms | data actually updates every **3.5–4.0 s**, and the port is busy walking almost continuously |
| T4 reads while Auto Refresh runs | 122 ms when the port is free, **2.7–3.5 s** when it lands behind a walk |
| T5 in-app read (IPC + renderer) | median 125 ms vs. 121 ms from Node: IPC overhead is negligible |
| Page errors during the run | none |

**Regression found and fixed during the run:** the if00 guard added in `ca22323` called `SerialPort.list()` before every `ts-serial-*` operation, and a list costs ~450 ms on Linux (udev scan). That was ~80% of every read. It now uses a 5 s cache, and detect still lists fresh. The guard still refuses `/dev/ttyACM0` in 1 ms.

### What makes it feel slow

1. **Widgets only see values from full tree walks.** Gauges, buttons and the Actions panel read `latestData().values`, which only changes when the datasource re-walks all 81 leaves (~2.7–3.2 s). With Auto Refresh off (the default) values never update on their own. With it on, they update every 3.5–4 s at best, whatever the configured period.
2. **Every operation reopens the port and redoes the handshake.** That's 112 ms of fixed cost around a 10 ms command.
3. **Writes queue behind walks, then trigger another walk.** A write issued during a refresh waits up to ~3.5 s, and the post-write "rescan" (`a087961`) adds another ~3 s before the widget shows the result.

### Candidate fixes, in order of payoff

1. **Refresh only what widgets display.** One `?Measurements` fetch returns every measurement in a single command (~10–20 ms) instead of a 2.5 s walk. Keep the full walk for discovery (first connect, the Rescan button).
2. **After a write, read back only the written leaf**, not the whole tree.
3. **Keep one shell session open per port** and reuse it, so the 112 ms handshake + close is paid once per connection instead of per operation. That brings reads close to the ~10 ms command time.

### Phase 2 results (2026-10-13): scope capture, writes to `/Debug/Scope/*` only

Run in the live app over CDP, with the board powered (VHigh ≈ 30 V). Safety baseline before every round and at the end: `Config/Leg1/wEnable` and `Config/Leg2/wEnable` both `false`. No write ever touched `Config/Mode`, `wEnable` or duty/reference.

| Measurement | Result |
|---|---|
| `wDecimation=1`, `wPretriggerRatio=0.2` (current values, so no-op writes), write + readback | 142–154 ms each |
| `wArm` / `wTrigger` write + readback | 133–207 ms each |
| Arm → trigger → `rState` READY at decimation 1 | 389–465 ms (the capture itself is 102.4 ms) |
| Download over if00 (1024 samples × 8 channels) | 1.16 s, identical across 3 rounds |
| Fresh capture each round? | Yes: `rState` 1 after arm, 3 after trigger, `rLastError` 0, final index 126 vs. 433 with different sample data, downloaded final index matches `rFinalIndex` |
| if00 probe | 6–7 ms, **but the first probe after the app started timed out** (1.5 s), then passed on the very next attempt |

**Findings:**

1. **if02 reads fail while if00 is downloading.** In all 3 rounds, both reads issued during the 1.16 s download came back `{ok:false}` (the first after ~950 ms, the next after ~220 ms). Zero succeeded. The firmware streams 8192 `printk` lines during a download, and the ThingSet shell doesn't answer the per-operation handshake in time. The M8 run (2026-08-31) saw no cross-talk, but it used one long-lived shell instance with no per-operation handshake. In the app today, any widget or Auto Refresh read that lands inside a download fails. Candidate fix: hold `ts-serial-*` operations for a board while a scope download is in flight on its if00, or retry once after it finishes. A persistent shell session (Phase 1 fix 3) may also help.
2. **The first if00 probe after app start can time out.** Standalone opens with 0/100/500 ms delay before `?` all answered in 10–12 ms (3/3 each), so it isn't simply DTR settling. It matches the "first probe legitimately timed out" note from M8. Candidate fix: resend `?` once on the same open link before giving up. Don't close and reopen immediately: M8 saw a ~1 min lock storm after an immediate reopen.
3. **`wArm` / `wTrigger` are one-shot.** The firmware clears them after acting (`scope_capture.cpp`), so a readback of `false` after writing `true` means success, not failure. Anything that checks write success by readback (the Actions panel's write feedback, the radial write-target drill) must not treat these as failed writes.
4. **The scope widget only names 4 of the firmware's 6 states.** `SCOPE_STATE_NAMES` in `owntech_scope.widget.js` is IDLE/ARMED/TRIGGERED/READY. The firmware also has STREAMING (4) and ERROR (5), which the widget shows as "Unknown".

### Phase 3 results (2026-10-13): switching power, through the app's own IPC

**Bench:** VHigh ≈ 30.2 V. **Leg 1 → 10 Ω resistor; leg 2 → open.** Open-loop duty (`wBuck`/`wBoost` false), with leg 1's duty capped at 0.15 (≈ 2 W in the resistor) since the resistor's rating was unknown. `wDriver`, `wCapa`, frequency and dead times were never written: once `wDriver` is set true, only an MCU reset clears it (known firmware bug, Core4 `automated_test.md`). The interlock tripped immediately on V1/V2 > 8 V, I1 more than 1 A above its idle reading, VHigh > 33 V, or any write/read error. It never tripped. The board ended at Mode IDLE, both `wEnable`/`wDriver` false, duties restored to 0.1.

Each step: the write (with readback), then the measurements polled (V1, I1, V2, VHigh, rDuty1, rDuty2: 6 reads, ≈ 0.7 s per poll) until V was within max(0.6 V, 15%) of duty × VHigh, or 4 s passed.

| Step | Write + readback | Measured after | Expected V | Time to settle |
|---|---|---|---|---|
| Mode POWER_ON, legs disabled | 127 ms | V1 0.70, V2 0.01: no movement ✓ | n/a | n/a |
| Leg 1 enable @ 0.05 | 137 ms | V1 2.60 V, I1 0.27 A | 1.51 | not settled in 4 s; **first change only after ~3.4 s** |
| Leg 1 duty 0.10 | 149 ms | V1 2.74 V, I1 0.33 A | 3.02 | 1.5 s |
| Leg 1 duty 0.15 | 138 ms | V1 4.06 V, I1 0.51 A | 4.53 | 2.0 s |
| Leg 1 duty 0.05 | 139 ms | V1 2.91 V, I1 0.31 A | 1.51 | not settled in 4 s |
| Leg 1 disable | 135 ms | V1 0.48 V | idle | 1.5 s |
| Leg 2 enable @ 0.05 (open) | 137 ms | V2 3.08 V | 1.51 | not settled; first change after ~2.8 s |
| Leg 2 duty 0.10 | 140 ms | V2 2.81 V | 3.02 | 1.5 s |
| Leg 2 disable | 140 ms | V2 2.18 V, still falling | idle | not settled (no load, so the capacitor discharges slowly) |
| Mode POWER_OFF → IDLE | 129 ms each | n/a | n/a | n/a |

**Findings:**

1. **The command path is fast and reliable:** 14 actuating writes, all accepted and read back in 127–149 ms through the app's own IPC (the same calls widgets make). The legs switch without `wDriver`. V1/I1 at duty 0.10–0.15 is consistent with the 10 Ω load (V/I ≈ 8–8.3 Ω, about 0.9 × duty × VHigh).
2. **Watching the result is the slow part, and it's measurable.** Polling 6 values costs ≈ 0.7 s per poll, so nothing can see a change in under ~0.7 s, and the 1.5–2.0 s settle times above are 2–3 polls. A widget that relies on the datasource's full tree walk (Phase 1) sees it after 3–4 s. This is the "voltage changes, but slowly" the user saw. It is a readback problem in the app, not slow switching.
3. ~~**Enabling a leg showed no output change for ~2.8–3.4 s.**~~ **Disproved by the scope captures below:** the output responds within one 10 ms sample. The "delay" was a flaw in this test's method: it took its "before" reading ~0.7 s *after* the enable write, by which time the output had already risen, so it only registered later noise as the "first move".
4. **Duty 0.05 produces ~2.6–2.9 V instead of ~1.5 V**, about what 0.10 gives, on both legs, while `rDuty` reports 0.05. **Confirmed below:** the power library clamps duty to a minimum of 0.1.
5. **A group read (`getValue('Measurements')`) returns a single scalar**, not the group's object, through the app's `ts-serial-get-value`. (Fixed: `9d1f671`.)
6. **The first operation after the 5 s port-list cache expires pays the ~450 ms list cost again** (a 568 ms read observed). (Fixed: `72fbb68`.)

### Scope-verified follow-up on findings 3 and 4 (2026-10-13)

Power on, same bench. Scope at decimation 100 (10 ms per sample, 10.24 s window, 2 s pre-trigger). Sequence: leg 1 duty set, Mode POWER_ON, scope armed, 2.5 s wait, `Leg1.wEnable=true`, then `wTrigger` right after. The interlock kept polling until the capture was READY, then: leg off, POWER_OFF, IDLE, duty and decimation restored.

| Run | V1 before | V1 after enable | Response time | V1 / VHigh |
|---|---|---|---|---|
| duty 0.10 | 0.70 V | 3.62 V | **within one 10 ms sample** of the enable write | 0.121 |
| duty 0.05 | 0.79 V | 3.63 V | within one 10 ms sample | **0.121, identical to 0.10** |

- **Finding 3 is resolved:** there is no start-up delay in the power stage. The app's own first poll, 1.26 s after the enable, already read 3.49 V.
- **Finding 4 is confirmed and located:** the OwnTech HRTIM driver sets a default minimum duty of 0.1 (`Core4/zephyr/modules/owntech_hrtim_driver/zephyr/src/hrtim.c:338-340`, `duty_min_user_float = 0.1`), and `Power.cpp:260` clamps to it. Core4's `rDuty1`/`rDuty2` echo the *requested* duty, so they read 0.05 while 0.1 is applied. This is firmware/library behaviour, outside this repo. Options for Core4: report the applied (clamped) duty in `rDutyN`, or lower the minimum with the power API's `setDutyCycleMin` if the hardware allows it.
- **I1 read ~0 A in both runs** (mean −0.05 A) while V1 sat at ~3.6 V, the *unloaded* value. In Phase 3, the same duty 0.10 drew 0.33 A at 2.74 V. Either the 10 Ω resistor was disconnected between the runs, or the I1 measurement changed. Not yet checked on the bench.
- The enable write took 593–657 ms in these runs instead of ~135 ms: the 5 s port-list cache had expired during the wait (fixed in `72fbb68`).

---

## Fixes from the real-hardware findings (2026-10-13)

### Commit sequence

| # | Commit | Fixes |
|---|---|---|
| 1 | `9d1f671` fix(thingset): return the whole object from a group read | Phase 3 finding 5 |
| 2 | `49f7d57` perf(thingset): refresh values with one fetch per group instead of re-walking the tree | Phase 1 "what makes it slow" #1, candidate fix 1 |
| 3 | `08c0ef4` perf(thingset): keep one handshaken shell session open per port | Phase 1 #2, candidate fix 3 |
| 4 | `72fbb68` fix(owntech): queue ThingSet and scope operations per board, not per port | Phase 2 finding 1; Phase 3 finding 6 and the 593 ms enable write |
| 5 | `a1ada7a` fix(owntech): resend the scope probe once before giving up | Phase 2 finding 2 |
| 6 | `ade9015` fix(owntech): report rejected ThingSet writes and show the readback at once | Phase 1 #3 / candidate fix 2; Phase 2 finding 3 |
| 7 | `7878234` fix(owntech): name the scope's STREAMING and ERROR states | Phase 2 finding 4 |
| 8 | this commit: docs(gui): log the fixes and the scope-verified findings | n/a |

Earlier in the same session: `ca22323`, `5539a69` (if00 auto-detect and fail-fast fixes) and `e032400` (port-list cache), plus the doc commits `1bdf482`, `6508b8e`, `13b67a7`.

### What changed

- **`app/js/thingset_serial_shell.js`**: `getValue()` only unwraps a `{leaf: value}` echo, so group reads return the whole object. New `refreshValues(root)` re-reads every value of an already-walked tree with one `?<group>` fetch per group, in place.
- **`app/extensions/thingset/main.js`**:
  - `ts-serial-tree` takes `mode: 'values'`. The main process keeps the last full walk per port and refreshes it, falling back to a full walk if any group read fails.
  - `withShell()` keeps one handshaken session per port, dropped on an I/O error or a port close and closed after 10 s idle. Detect, walks, refreshes and every value operation use it.
  - Operations queue per board through `serial_board_lock.js`. The scope-port list comes from its cache.
- **`app/js/serial_board_lock.js`** (new):
  - A per-board queue keyed by USB serial number, shared by the ThingSet and OwnTech extensions.
  - A port list served from cache and refreshed in the background once older than 5 s; `fresh: true` for detect.
- **`app/extensions/owntech/main.js`**: scope probe and download go through the board queue.
- **`app/extensions/owntech/scope_serial.js`**: `probe()` resends `?` once on the same open link before failing.
- **`app/dashboard/js/thingset_serial_datasource_core.js`**:
  - Walks once per port, then refreshes values.
  - `rescan()` forces a full walk.
  - `applyWrite(path, value)` shows a just-written value immediately.
- **`app/dashboard/js/thingset_write.js`** (new, loaded by the ThingSet extension manifest): `ThingSetWrite.write()` checks `ok`, applies the device's readback to the datasource and can follow with a values refresh.
- **Widgets:**
  - The Actions panel, scope widget, Toggle, +/- and Push buttons use `ThingSetWrite`.
  - The Actions panel and scope widget show "Write failed: …".
  - The +/- button shows the accepted readback.
  - The Actions panel's Rescan Tree button does a full walk.
  - The scope widget names STREAMING and ERROR.
- **Tests:** a `getValue` group/leaf unit test, and a scope probe resend unit test with a fake port.

### Before / after (same board, measured in the live app unless noted)

| Measurement | Before | After |
|---|---|---|
| Datasource refresh (what widgets display) | 2.7–3.3 s (full walk) | **147–259 ms**, median 152 ms |
| Single read | 551 ms → 121 ms (after `e032400`) | **10 ms** |
| Group read `Measurements` (12 values) | wrong: one scalar | **16 ms**, whole object (Node harness) |
| Write → value visible in the datasource | write + readback + ~3 s rescan | **41 ms** |
| Auto Refresh at 2000 ms / 500 ms | real interval 3.5–4.0 s at 2000 ms | **487–518 ms at 500 ms** |
| Read while Auto Refresh runs | up to 3.5 s | **max 156 ms** |
| if02 read during an if00 scope download | **failed** (0/6 succeeded) | succeeds after waiting ≤ 1.18 s (0 failures in 3 rounds, Node harness) |
| Read after the port-list cache went stale | +450 ms | 15 ms (Node harness) |

### Verification

- Unit: `thingset_serial_shell`, `thingset_tree_walk`, `thingset_value_parse` and `scope_serial` all pass.
- E2E: the OwnTech specs plus `radial-context-menu-owntech` and `radial-context-menu-buttons` (12) pass.
- In a broader run (`serial`, `widget-picker`, `integrated-plot-editor`, `pane-drag`, `board-context-menu`, `radial-context-menu`, `can-thingset`, OwnTech), 9 plot-editor/axis-hover tests failed with 4 parallel workers. With 1 worker, 24/25 passed. The one remaining (vertical gauge) passes 3/3 when run alone on both this code and `a9ec993` (before this session). These are load-dependent and flaky, not regressions.

### Still open

- **Minimum duty 0.1** (finding 4): fix in Core4 firmware, not here.
- **Leg 1 current reading ~0 A** in the scope runs: check the 10 Ω resistor connection, or the I1 sensor.
- **Pane drag stalls** (`Cannot read properties of undefined (reading 'size_x')` from gridster). Reported on 2026-10-12 and not reproduced on a fresh board; needs the user's saved dashboard.
- **The app holds if00 open after a scope download** until an explicit `owntech-scope-close` (the M7 no-idle-eviction decision). It blocked an external tool from opening the port during testing. Consider an idle timeout like `withShell`'s.
- **Detect scans all `/dev/ttyS*` ports** after the OwnTech candidates. They're ordered last, so this only costs time when if02 fails.
- **E2E flakiness under parallel load** in `integrated-plot-editor.spec.js` and the axis-hover test.
