# OwnTech Extension Overhaul — ThingSet-Based Merge of OwnTech + ThingSet Serial

## Context

Today's "OwnTech" extension talks to Twist/OwnVerter boards over a bespoke, hand-rolled ASCII protocol (`twist_protocol.js`): underscore-delimited command strings sent as raw serial writes, and a plain colon-separated positional-float parser on the way in (`parseLine()` in `app/main.js`). Every widget (`twist_control`/Actions, `twist_setpoints`, `twist_calibration`, `state_machine`) hardcodes a `deviceType` → `{legs, variables}` profile (`TWIST`: 2 legs, `OWNVERTER`: 3 legs) and renders one form row per known field — 10 to 18+ manually-wired rows per widget, with no schema or wizard. This is the "too complex" problem: nothing is discovered, everything is hand-built per device shape, and OwnVerter support has never actually been implemented (the profile exists in the formatter but nothing downstream honors it correctly).

Separately, a new firmware example is being built in a **different repo**, `/home/luiz-villa/code/Core4/`, that replaces this entire wire protocol with **ThingSet Text Mode** over a dedicated serial shell (`if02`): a real, discoverable object tree (`/Measurements`, `/Config/Leg1`, `/Config/Leg2`, `/Calibration/*`, `/Debug/Scope`) reachable via `select thingset` + `?path` / `?path null` / `=path json` requests, with named leaves (not positional indices) and a live tree-walk discovery mechanism — no client-side hardcoded ID map needed. Crucially, this codebase **already has a working, independent implementation of this exact same protocol** (`app/js/thingset_serial_shell.js`, built for CAN/ThingSet hardware support), including the same `select thingset` handshake and the same quote-escaping workaround for the Zephyr shell's tokenizer (`escapeJsonForShell()` — confirmed to already exist, byte-for-byte matching a quirk Core4's own Python tooling also has to work around). This is a strong, verified signal that the existing ThingSet transport can be reused almost as-is rather than rebuilt.

The intended outcome: a new "OwnTech" extension where users build **simple, custom dashboards** — buttons that write a ThingSet value, gauges/measurements that read one — wired to whatever data objects the board actually exposes, discovered live, instead of maintained-by-hand per-leg forms. The Actions-style control panel remains available, but sends ThingSet writes instead of custom command strings. OwnVerter "support" is reframed as a direct consequence of never hardcoding leg/channel counts: the moment Core4 firmware adds a third leg, every widget in this plan picks it up with zero dashboard code changes, because everything walks the live discovered tree instead of consulting a profile table.

## Locked-in scope decisions (confirmed with user)

1. **Serial-only merge.** The new extension covers only the Serial ThingSet shell transport (what Core4 actually speaks). The existing `thingset` extension's CAN-based widgets/datasource (`can_datasource`, `thingset_device_ui`, `thingset_mode_button`, `thingset_control_panel`, `thingset_measurements`) are untouched and stay in `thingset`, unrelated to this effort.
2. **New id, old kept side-by-side.** The current `owntech` extension is renamed to `owntech-legacy` (disabled by default, still installed, so existing saved dashboards using `twist_actions_panel`/`twist_setpoints_panel`/`twist_calibration_panel`/`state_machine` keep loading if a user re-enables it). A brand-new extension claims the `owntech` id going forward.
3. **Every milestone spec'd in comparable detail** — no "detail M1, sketch the rest."
4. **OwnVerter is discovery-driven, never hardcoded.** No code in the new extension may contain anything analogous to `twist_protocol.js`'s `DEVICE_PROFILES` (`TWIST: {legs:2}` / `OWNVERTER: {legs:3}`). Leg/action/channel enumeration is always derived by walking the live discovered ThingSet tree.

## Architecture principles (apply to every milestone)

- **Reuse the existing ThingSet transport, don't rewrite it.** `app/js/thingset_serial_shell.js` (`ThingSetSerialShell`) and the `ts-serial-detect` / `ts-serial-tree` / `ts-serial-get-value` / `ts-serial-set-value` IPC channels in `app/extensions/thingset/main.js` already implement the Core4 handshake and quote-escaping. No changes planned to this class — only live-hardware verification.
- **Discovery over hardcoding, everywhere**, not just for "legs": boolean-action detection, writable-leaf detection, and group enumeration are all pattern/type-matched against the live tree, never a name allow-list tied to a specific firmware revision.
- **CAN stays untouched.** No milestone below touches `can_datasource` or any `ts_*` CAN widget.
- **Old dashboards keep working.** Renaming `owntech` → `owntech-legacy` changes only the owning manifest id — no widget files move, no `type_name`s change.
- **Renderer script load order is global, not per-extension** (verified in `app/extensions/runtime.js:496-501` — `buildBootstrap()` sorts the combined script list purely by numeric `order`, then path, regardless of which extension declared it). This resolves what would otherwise be an ordering ambiguity for the shared datasource-core file introduced in Milestone 1: it just needs a low `order` number: which extension's manifest hosts it doesn't affect load order at all.

## Documentation & progress tracking

**This file is the living record of the migration, not a one-shot planning artifact.** As work on each milestone lands, append an entry to the `## Progress Log` section at the bottom of this document — one entry per milestone (or per significant commit, if a milestone spans several days/sessions). Each entry should capture:
- Which commit(s) from the `## Commit Sequence` section it corresponds to.
- What actually shipped, and any deviation from what this plan describes (design changes discovered mid-implementation, scope trims, etc.).
- Verification results: which unit/e2e tests were added and passed, and — where applicable — real-hardware verification outcomes for the items each milestone's "Risks" section flags as hardware-only (e.g. the M1 handshake, M4's chunked-write removal, M5's byte format/rotation correctness).
- Any new open questions or follow-ups discovered along the way.

Do not rewrite or delete earlier milestone sections above to reflect "what actually happened" — this document's Milestone 0–6 sections stay as the original design intent; the Progress Log is where reality is recorded, so both the plan and its execution history stay legible side by side.

---

## Milestone 0 — Extension scaffolding & rename

**Goal:** split today's single `owntech` extension into a frozen `owntech-legacy` (disabled by default) and an empty new `owntech` extension ready to receive M1–M5.

**Files:**
- Rename directory `app/extensions/owntech/` → `app/extensions/owntech-legacy/` (carries `main.js` and all existing widget files as-is, unchanged content).
  - `manifest.json` edits: `"id": "owntech"` → `"owntech-legacy"`; `"displayName"` → `"OwnTech Extension (Legacy — Console Protocol)"`; `"enabledByDefault": true` → `false` (this is the actual disable mechanism — `resolveEnabled()` in `runtime.js:137-152` reads this boolean directly, falling back to it only after checking env-var override and persisted state); `"preloadFlags": {"owntech": true}` → `{"owntechLegacy": true}` (verify no renderer code reads `window.api.flags.owntech` before renaming the key — grep first); `"widgetDocsIndex"` → `"docs/widgets/index.owntech-legacy.json"` (rename the file alongside it, content unchanged — `state_machine` remains undocumented, that's pre-existing debt, not addressed here).
- **New** `app/extensions/owntech/manifest.json`:
  ```json
  {
    "id": "owntech",
    "apiVersion": 1,
    "version": "0.1.0",
    "displayName": "OwnTech Extension",
    "enabledByDefault": true,
    "mainEntry": "main.js",
    "rendererScripts": [],
    "preloadFlags": { "owntech": true },
    "capabilities": ["owntech", "thingset-serial"],
    "requiresExtensions": ["thingset"],
    "datasources": []
  }
  ```
  `requiresExtensions: ["thingset"]` is deliberate: the new datasource/widgets call `window.api.thingsetSerial.*`, whose main-process handlers live in `app/extensions/thingset/main.js`. This is the same pattern `owntech-workspace`/`owntech-examples` already use for their `requiresExtensions: ["owntech"]` dependency, enforced generically by `applyRequiredExtensionConstraints()` (`runtime.js:352-371`, verified — force-disables a dependent extension if its dependency isn't enabled). **Trade-off, confirmed intentional**: disabling `thingset` also disables the new `owntech` extension. Acceptable since serial ThingSet IPC genuinely lives there today.
- **New** `app/extensions/owntech/main.js` — minimal scaffold (`registerOwnTechExtension(context) { context.registerManifestContribution(); }`); Milestone 5 adds IPC handlers here.
- **No changes needed** to `app/extensions/owntech-workspace/manifest.json` or `app/extensions/owntech-examples/manifest.json` — both declare `"requiresExtensions": ["owntech"]` and the new extension keeps that id. **Verified**: grepped `app/extensions/owntech-examples/dashboard/dashboards/` for `twist_control|twist_actions_panel|twist_setpoints_panel|twist_calibration_panel|state_machine` — zero matches, so no bundled example dashboard breaks from the rename.
- `app/extensions/runtime.js`, `sortExtensions()` rank map (line 335-343) — optional cosmetic addition of `['owntech-legacy', 3.5]` so it lists near the new `owntech` in any extensions-manager UI; this only affects inventory/listing order, not script load order (confirmed above), so it's not required for correctness.

**Tests to update** (`tests/unit/extensions_runtime.test.js` runs against the real `app/extensions` tree, not fixtures):
- Every assertion currently naming `'owntech'` and expecting the Twist widgets (`js/twist_protocol.js`, `twist_actions_panel`, etc.) needs to retarget to `'owntech-legacy'`, and gains a companion assertion that `'owntech-legacy'` is disabled by default while `'owntech'` (the new, now-empty-until-M1 extension) is enabled by default.
- Add an env-override round-trip test: `MODULAR_EXTENSION_OWNTECH_LEGACY=1` re-enables it (uses the existing generic `envKeyForExtension()` — no runtime.js code changes needed, it already derives the env var name from `manifest.id` generically, confirmed at `runtime.js:130-135`).
- The persisted-state override block (`state.json` fixtures) needs an `owntech-legacy` entry alongside/instead of `owntech`'s.

**Risks:**
- Grep the whole renderer for `flags.owntech` / `preloadFlags.owntech` usage before finalizing the renamed key, to avoid a silent behavior change for any code gating on the old flag name.
- Grep for any `capabilities.includes('twist')`/`'ownverter'` check elsewhere in the app before cutting the manifests over, since those capability strings move to `owntech-legacy` only.

---

## Milestone 1 — OwnTech ThingSet datasource + detection surfaced in the sidebar

**Goal:** a new OwnTech-branded datasource that auto-detects the Core4 `if02` shell (reusing `ts-serial-detect`/`ts-serial-tree` IPC as-is), plus a "shell detected" status view in the left DATASOURCES sidebar — a real gap today, where detection status only ever shows inside the separate `ts_serial_device_ui` widget, never in the datasource's own sidebar detail pane.

### Datasource: distinct type_name, shared extracted core

**Decision: `type_name: "owntech_thingset_datasource"`**, distinct from `thingset_serial_datasource`, sharing an extracted implementation:
- `thingset_serial_datasource` (owned by the generic `thingset` extension) must stay device-agnostic — it can't gain OwnTech-specific branding/defaults without creating an implicit dependency in the wrong direction.
- A distinct type_name lets the Add-Datasource picker show a dedicated "OwnTech" tile with its own icon (manifest `datasources: [{"type": "owntech_thingset_datasource", "icon": "microchip"}]`, same `{type, icon}` shape already validated generically), while both types can be treated uniformly wherever appropriate (M2's picker, M3's send-target dropdown).
- The ~300 lines of actual logic in `app/dashboard/plugins/thingset_serial.datasource.js` (port detection, `flattenTree()` — confirmed to already produce both a named `values` path→value map and a positional `y[]/labels[]` shape, lines 60-95 — polling/timer logic, pause handling) must not be duplicated.

**Concrete refactor:**
1. **New file** `app/dashboard/js/thingset_serial_datasource_core.js` — lift the existing `ThingSetSerialDatasource` class body out of the IIFE in `thingset_serial.datasource.js` into this file, exporting `window.ThingSetSerialDatasourceCore`. Pure code motion, zero behavior change.
2. `app/dashboard/plugins/thingset_serial.datasource.js` shrinks to just its `freeboard.loadDatasourcePlugin({...})` registration call, using `new ThingSetSerialDatasourceCore(settings, updateCallback)`. Settings schema, defaults, `type_name` unchanged — zero risk to existing saved dashboards.
3. **New file** `app/dashboard/plugins/owntech_thingset.datasource.js` registers `type_name: "owntech_thingset_datasource", display_name: "OwnTech (ThingSet Serial)"`, same settings schema (`autoDetect`, `portPath`, `baudRate`, `usePrefix`, `autoRefresh` default `false`, `refresh`, `debug`), same constructor call.
4. Host the shared core file in **`app/extensions/thingset/manifest.json`**'s `rendererScripts` (it's a generalization of code that extension already owns) with a low `order` (e.g. `6`, before `thingset_serial.datasource.js`'s existing entry). Confirmed this placement is safe regardless of which extension is enabled first, because **script load order is global by `order` field** (`runtime.js:496-501`), not extension-rank-dependent — the earlier concern about a "reverse dependency" between `owntech` and `thingset` scripts does not apply.
5. `app/extensions/owntech/manifest.json` gains `{"path": "plugins/owntech_thingset.datasource.js", "order": 200}` and the `datasources` array entry.

### Sidebar "shell detected" status UI

**Extension point:** `app/dashboard/js/freeboard.js`'s `DatasourceModel` (existing computed pattern: `isPortBased` line ~90, `supportsResetCommand` line ~97) and the custom-binding-handler precedent (`channelMapEditor`, line ~4625) — this codebase already has exactly the right extension points for this.

- New computed on `DatasourceModel`:
  ```js
  this.isThingSetShell = ko.computed(function() {
      var t = self.type();
      return t === 'thingset_serial_datasource' || t === 'owntech_thingset_datasource';
  });
  ```
- New `ko.bindingHandlers.thingsetShellStatus` in `freeboard.js`, modeled on `channelMapEditor`: renders a small status card — badge ("Detected" / "Not detected" / "Detecting…"), port path, `node_uid`, `node_name`, `address_hex`, a one-line summary ("42 leaves across 8 groups" — computed by walking the last-known tree), and a "Rescan Tree" button calling the datasource's existing `updateNow()`. Data source: read the *live datasource instance's* `latestData()` Knockout observable (`freeboard.getLiveModel().datasources().find(d => d.name() === dsName).latestData()`), which already carries `{status, portPath, node_uid, node_name, address_hex, values, ...}` from `poll()` — no new IPC call needed, this is purely a new consumer of data the datasource already produces every poll.
- `app/dashboard/index.html` — inside the datasource detail pane (~line 262-334), add, right after the existing `<!-- ko if: isPortBased -->` block (~line 308):
  ```html
  <!-- ko if: isThingSetShell -->
  <div data-bind="thingsetShellStatus: { dsName: name(), dsType: type(), lastUpdated: last_updated }"></div>
  <!-- /ko -->
  ```
- **`app/dashboard/index-dev.html` does NOT need a mirrored edit** — verified this file has no datasource detail sidebar at all (no `side-pane-detail`, `isPortBased`, or `selectedDatasource` bindings present); it's a minimal/unused legacy dev harness (already established earlier in this project), not a second copy of the real UI.

**Files touched:** `app/dashboard/js/thingset_serial_datasource_core.js` (new), `app/dashboard/plugins/thingset_serial.datasource.js` (shrink), `app/dashboard/plugins/owntech_thingset.datasource.js` (new), `app/extensions/thingset/manifest.json`, `app/extensions/owntech/manifest.json`, `app/dashboard/js/freeboard.js`, `app/dashboard/index.html`.

**Risks:** none requiring hardware for the code structure itself. The one thing needing a real board is confirming the full handshake against Core4's actual if02 shell — but this is de-risked significantly by the verified fact that `ThingSetSerialShell` already implements the identical `select thingset` handshake and the identical quote-escaping quirk (`escapeJsonForShell`, `thingset_serial_shell.js:70-79`) that Core4's own Python tooling independently needed — strong evidence this class is already compatible, not just plausibly so.

---

## Milestone 2 — Generalize the shared variable picker for named ThingSet paths

**Goal:** make the two ThingSet serial datasource types first-class in the shared "Datasource / Device / Variable" picker (`plotEditorShared` + `buildSourceControls`) used by Gauges and the Buttons-category widgets (Push Buttons, +/- Button, Toggle Button), which today only recognizes `serialport_datasource`/`fast_frame_datasource`/`can_datasource`/`signal_generator_datasource` and force-coerces every non-CAN "Variable" to an integer.

**Exact changes:**

1. `app/dashboard/js/freeboard.js`, `plotEditorShared.listDatasources()` (~line 4903-4923): broaden the hardcoded allow-list to add `"thingset_serial_datasource"` and `"owntech_thingset_datasource"`.
2. `plotEditorShared.fetchDatasourceVariableOptions(dsName, deviceVal)` (~line 5072-5115): new branch alongside the existing `can_datasource` branch (which already proves named-path enumeration works — it reads a CAN snapshot's `flat` path→value map). New branch reads the ThingSet datasource's live `latestData().values` map (confirmed to already exist via `flattenTree()`) and emits `{value: path, label: "<leaf> - <path>"}` per key, sorted.
3. `app/dashboard/plugins/integrated_plot_editor.js`, `buildSourceControls()` `buildValue()` (~line 180): the coercion bug —
   ```js
   var: dsType === 'can_datasource' ? rawVar : parseInt(rawVar, 10)
   ```
   becomes
   ```js
   var: (dsType === 'can_datasource' || dsType === 'thingset_serial_datasource' || dsType === 'owntech_thingset_datasource') ? rawVar : parseInt(rawVar, 10)
   ```
   (broaden the "keep as string" list rather than inverting the condition, so `serialport_datasource`/`fast_frame_datasource`/`signal_generator_datasource` keep their correct integer-index behavior).
4. `showDevice = dsType === 'can_datasource'` (device-row visibility) stays unchanged — ThingSet serial has no "device" concept, one port is one node.

**New `sourceDef`-reading branch** (value display/polling) — needed in two near-duplicate call sites, each already has an identical 4-branch if-chain (serialport/fast_frame/can/signal_generator), so add a 5th branch identically in both rather than a larger refactor now:
- `app/dashboard/plugins/gauge_family.shared.js`, `_readInstantValue()` (used by all 5 gauge widgets).
- `app/dashboard/plugins/plusminus_button.widget.js`, `_readInstantValue()` (lines ~157-192). Note `_subscribeToSerialDatasource()`/`_restartSource()` need **no change** — ThingSet types naturally fall into the existing polling fallback path already used for anything that isn't `serialport_datasource`.

New branch (both files):
```js
if (sourceDef.type === 'thingset_serial_datasource' || sourceDef.type === 'owntech_thingset_datasource') {
    const live = window.freeboard && freeboard.getLiveModel ? freeboard.getLiveModel() : null;
    const dsModel = live && live.datasources().find(d => { try { return d.name() === sourceDef.ds; } catch { return false; } });
    const data = dsModel && dsModel.latestData ? dsModel.latestData() : null;
    const values = (data && data.values) ? data.values : {};
    const raw = values[sourceDef.var];
    return (typeof raw === 'number' && Number.isFinite(raw)) ? raw : Number(raw);
}
```
Deliberately reads the datasource's already-cached `latestData()` rather than issuing a new IPC poll per widget — the datasource has already fetched and flattened the tree on its own cycle; a per-widget timer re-invoking `ts-serial-tree` would multiply serial round-trips, exactly what `autoRefresh: false`-by-default was designed to avoid.

**Files touched:** `app/dashboard/js/freeboard.js`, `app/dashboard/plugins/integrated_plot_editor.js`, `app/dashboard/plugins/gauge_family.shared.js`, `app/dashboard/plugins/plusminus_button.widget.js`.

**Dependency:** hard dependency on M1 for the `owntech_thingset_datasource` type_name; the `thingset_serial_datasource` half of every change can technically land in parallel since that type and its `values` map already exist unchanged today.

**Risk:** `latestData()` may be `undefined`/empty before a datasource's first poll (autoRefresh is off by default) — every new consumer must treat that as a normal "not yet detected" state, matching existing `no-port`/`unavailable` status handling in `poll()`, not an error.

---

## Milestone 3 — Simple "buttons/measurements" widgets attached to ThingSet objects

**Goal:** give Push Buttons (`serial_command_buttons`), +/- Button (`plus_minus_button`), and Toggle Button (`toggle_button`) a ThingSet-write mode — write `=<path> <value>` via `window.api.thingsetSerial.setValue` instead of a raw serial command — without new widget type_names, so all three stay generically useful for plain serial devices too.

**Design: datasource-type-driven mode, no manual toggle.** Matches the idiom `buildSourceControls`/`buildValue()` already establishes: behavior switches automatically based on the type of the selected datasource, with no separate mode checkbox. When "Send Commands To" resolves to a ThingSet type, command-entry UI and `_send`/`_sendCommand` runtime switch to path+value editing and `thingsetSerial.setValue`; for serial/fast-frame datasources, everything is byte-for-byte unchanged (critical: these widgets are in general use beyond OwnTech).

**Shared helper first:** lift `parseInputValue()` (already implemented in `ts_serial_device_ui.widget.js` — parses booleans/numbers/JSON/quoted strings for a write payload) into a new `app/dashboard/js/thingset_value_parse.js`, exporting `window.ThingSetValueParse.parseInputValue`. Both the existing widget and the three button widgets below require it — avoids a fourth copy-paste of the same parser.

**1. Toggle Button** (`app/dashboard/plugins/toggle_button.widget.js`) — smallest change:
- Broaden `getSerialDatasourceOptions()`'s type filter to include the two ThingSet types.
- New settings: `writePath` (text), `onValue`/`offValue` (text, default `"true"`/`"false"`, parsed via the shared helper at send time). Free-text `writePath` in this first cut (a live dropdown of discovered writable leaves is a fast-follow once M4's tree-walk helper exists — not blocking).
- `_sendCommand(command)` becomes a `_send(kind)` dispatcher: if the resolved datasource type is ThingSet, resolve `dsSettings.portPath` + `this.settings.writePath` + parsed `onValue`/`offValue`, call `window.api.thingsetSerial.setValue({port, path, value})`; otherwise, unchanged legacy path using `onCommand`/`offCommand`.

**2. +/- Button** (`app/dashboard/plugins/plusminus_button.widget.js` + its editor `openPlusMinusButtonEditor` in `integrated_plot_editor.js`) — already gets ThingSet **read** support for free from M2 (its Value Source picker already supports named paths). Needs a **write** side:
- `openPlusMinusButtonEditor`: broaden the "Send Commands To" filter to the two ThingSet types. When resolved to ThingSet, replace the free-text `+ Command`/`- Command` fields with a `writePath` field (pre-filled from the Value Source's `sourceDef.var`, since +/- conceptually reads-and-increments the same object, overridable) and a numeric `Step` field. Keep `plusLegend`/`minusLegend` as pure display text, unchanged — `step` is a new, separate functional field.
- `_sendCommand` becomes an async `_send(direction)`: read current value via the existing (M2-extended) `_readInstantValue()`, compute `next = current + direction * step`, write via `thingsetSerial.setValue({port, path: writePath, value: next})`. Non-ThingSet datasources keep the existing `minusCommand`/`plusCommand` string-send path untouched.

**3. Push Buttons** (`app/dashboard/plugins/serialcommand.widget.js`) — widest change, because its `buttons: [{label, command}]` array uses the **generic declarative array editor**, which can't conditionally reshape rows per datasource type. Recommendation: give Push Buttons a dedicated custom editor (`openPushButtonsEditor(widgetModel, shared)` in `integrated_plot_editor.js`, registered in `ModularIntegratedPlotEditor.open()`'s dispatch table — same pattern already used for `plus_minus_button`), replacing the generic array editor for this widget type. Settings gain an additive `buttonTargets: [{label, path, value}]` array (used only in ThingSet mode) alongside the existing `buttons: [{label, command}]` (used in serial mode) — no breaking migration for existing saved `buttons` arrays. `_renderButtons()`/`_sendCommand()` pick whichever array is populated and dispatch accordingly.

**Files touched:** `toggle_button.widget.js`, `plusminus_button.widget.js`, `integrated_plot_editor.js`, `serialcommand.widget.js`, new `thingset_value_parse.js` (hosted in `thingset` extension's manifest, alongside `ts_serial_device_ui.widget.js`, its original owner).

**Dependency:** hard dependency on M2 (broadened picker + `_readInstantValue` branch) and M1 (datasource type existing).

**Risk (real-hardware verification, not blocking implementation):** `wDriver=false` is a documented Core4 firmware bug (write doesn't reliably disconnect). Any Toggle-Button-driven write to a `wDriver`-shaped path should surface a UI caveat ("not guaranteed to take effect — verify with a read"), since a successful ThingSet status code only confirms the shell accepted the write syntactically, not that firmware state actually changed.

---

## Milestone 4 — Actions panel successor (discovery-driven, not hardcoded)

**Goal:** replace `twist_control.widget.js` (`twist_actions_panel`) with a widget that renders per-leg action toggles by walking the discovered tree — the concrete mechanism making OwnVerter support automatic.

**Mapping:** Core4's `/Config/LegN` groups (`wEnable`, `wCapa`, `wDriver`, `wBuck`, `wBoost`, ...) map almost one-to-one onto the old widget's `LEG`/`CAPA`/`DRIVER`/`BUCK`/`BOOST` action taxonomy. Instead of hardcoding that mapping: walk `/Config`'s children, find every group whose name matches `/^Leg\d+$/i` (sorted numerically, not lexicographically, so `Leg10` doesn't sort before `Leg2`), and within each, render a toggle for every **writable, boolean-valued** leaf. Today this discovers exactly `Leg1`/`Leg2`; the moment firmware adds `Leg3` (OwnVerter), the same code discovers a third group with zero changes.

**New shared helper** (not duplicated logic): `app/dashboard/js/thingset_tree_walk.js`, `window.ThingSetTreeWalk`:
- `findLegGroups(tree)` — the group-matching/sorting logic above.
- `findBooleanActionLeaves(legNode)` — leaves whose key starts with `w`/`s` **and** whose current value is `typeof === 'boolean'` — discovery-driven, not a name allow-list, so a firmware-added boolean toggle appears automatically too.
- `findWritableNonBooleanLeaves(legNode)` — same walk for non-boolean writable leaves, implemented now so a future Setpoints-panel successor can reuse the same single tree-walk pass rather than re-implementing it. **Scoping note to confirm with user**: this plan's locked milestone list names only the Actions-panel successor, not Setpoints/Calibration successors — those would follow the identical pattern as a fast-follow (or may be entirely subsumed by pointing M3's button/gauge widgets at individual paths instead of a dedicated panel).

**New widget** `app/dashboard/plugins/owntech_actions_panel.widget.js`:
- `type_name: 'owntech_actions_panel'`, category `OwnTech`, icon `bolt`. Settings: `title`, `datasource` (filtered to the two ThingSet types, mirroring `ts_serial_device_ui.widget.js`'s existing filter pattern), `usePrefix`, `debug`.
- Renders each discovered leg group as a labeled badge + a flex-wrap grid of on/off switches, reusing the existing `onoffswitch`/`twist-toggle-*` CSS classes from `twist_control.widget.js` for visual continuity, driven by the discovered leaf list instead of a fixed array.
- Sending a toggle: `window.api.thingsetSerial.setValue({port, path: <legPath>/<leafName>, value: <bool>})` directly — no protocol-string-formatting layer at all, since ThingSet's write already *is* the wire format. This eliminates a whole code layer that existed only because the old console protocol needed hand-built command strings.
- **Explicitly drop** the old widget's chunked-write workaround (10-byte chunks, 100ms delays — a workaround for a ~16-byte Zephyr *console* ring-buffer bug specific to the old raw command channel). `ThingSetSerialShell.sendCommand()` already writes the whole command in one call with its own buffering. Flag as a real-hardware verification item, not something to defensively re-add (re-adding it would make every toggle noticeably laggier for no proven benefit).
- Power controls (`/Config/Mode` = 0 IDLE / 1 POWER_ON / 2 POWER_OFF): three buttons writing the enum integer directly. This *is* legitimately hardcoded protocol knowledge (the enum's meaning doesn't vary with leg count) — acceptable, unlike leg/action enumeration.
- **Explicitly drop**: the old widget's scope/ripple controls section (it used the unrelated fast-frame capture mechanism, not Core4's actual if00 scope protocol — gets a real implementation in M5) and its `sm:state-entered` state-machine event listener (no state-machine authoring tool is in scope for this plan; `state_machine.widget.js` stays in `owntech-legacy`, unported). **Confirm this scope reduction is acceptable** — the old Actions panel had modest state-machine awareness that the new one won't have.

**Manifest:** `app/extensions/owntech/manifest.json` gains the tree-walk helper (`order: 10`) and the new widget script (`order: 210`).

**Dependency:** M1 only (self-contained datasource dropdown + live tree, following `ts_serial_device_ui.widget.js`'s proven pattern — doesn't touch the M2/M3 shared-picker machinery at all).

**Risks (real-hardware only):** whether the chunked-write workaround is truly unneeded over if02; whether `/Config/Mode` writes reliably read back immediately (firmware notes flag `Frequency_Hz` as buggy but say nothing conclusive about `Mode` — treat writes as optimistic-but-reread-to-confirm, not assumed-successful).

---

## Milestone 5 — Scope/duty-cycle capture UI

**Goal:** a widget for the if00 bulk-transfer side-channel — arm/trigger via ordinary ThingSet writes to `/Debug/Scope` (over if02, reusing M1's datasource), status polling, then an explicit "Download" action speaking a **different, non-ThingSet, hand-rolled protocol** over the *other* port (if00): `?` → expect `SCOPE-DATA/1 OK`; `D` while state is `READY` → a large hex-encoded block that must be rotated into chronological order. This is the one milestone requiring genuinely new main-process code — nothing in this codebase implements this if00 protocol today.

**New main-process module** `app/extensions/owntech/scope_serial.js`, class `ScopeSerialLink`:
- `constructor({path, baudRate=115200})` — opens its own independent `SerialPort` for the if00 path (a different OS device path than if02's, e.g. `/dev/ttyACM0` vs `/dev/ttyACM1` — no shared-port contention with the core `openPorts` map or the ThingSet datasource's port). Manages its own small `Map<path, ScopeSerialLink>` pool, mirroring how `thingset/main.js` manages its own bus/client maps independently of core state.
- `async probe(timeoutMs=1500)` — sends `?`, waits for a line containing `SCOPE-DATA/1 OK`. This is the actual handshake for this side-channel, distinct from (and not to be confused with) `ThingSetSerialShell.enterThingSet()`.
- `async download({onProgress, timeoutMs=25000})` — sends `D`, reads until the `end record` marker, accumulating the `begin record`/`#<channel names>`/`# <final index>`/hex-lines block. Parses each 8-digit hex line as a 32-bit IEEE-754 float (**byte width and endianness must be verified against real hardware/firmware source before implementation** — "8-digit hex" implies 32-bit, but which end is which byte is unconfirmed). Rotates the array so the sample right after the `# <final index>` marker becomes index 0 (standard ring-buffer-to-linear rotation — reimplement the documented *behavior*, this is a from-scratch JS implementation, not a port of any Python source). `onProgress` fires periodically for a UI progress bar (research indicates 1.3s–20s transfer time depending on decimation).
- Arm/trigger/status are explicitly **not** this module's job — those are plain ThingSet writes/reads through the existing M1 datasource plumbing, not part of the if00 protocol.

**New IPC** (registered in `app/extensions/owntech/main.js`, extending the M0 scaffold): `owntech-scope-probe`, `owntech-scope-download` (streams `owntech-scope-progress` events, resolves `{ok, channels, samples}` rotated/chronological), `owntech-scope-close`.

**`app/preload.js`**: new `api.owntechScope = {probe, download, close, onProgress}`, gated behind a new `api.flags.owntech`-style check, with a `MOCK_HW=1` mock block (mirroring the existing `api.thingsetSerial` mocks) resolving a small synthetic dataset instantly — needed so e2e tests can exercise the full download UI flow without hardware or a multi-second wait.

**New widget** `app/dashboard/plugins/owntech_scope.widget.js`, `type_name: 'owntech_scope_capture'`, category `OwnTech`, icon `wave-square`. Settings: `datasource` (for arm/trigger/status via existing setValue/getValue) and a separate manual `scopeSerialPort` field (if00 is not ThingSet-discoverable at all, so needs its own port picker — reuse the existing `get-serial-ports` channel already exposed as `window.api.serial.listPorts`). UI: status reflecting `/Debug/Scope`'s discovered fields (Arm/Trigger buttons reusing M4's `findBooleanActionLeaves` helper scoped to the `/Debug/Scope` group instead of `/Config/LegN` — another instance of "discover, don't hardcode," extended past legs), a decimation dropdown (`1`/`10`/`100` — a fixed 3-value protocol enum, legitimately hardcoded, same category as the Mode enum in M4), pre-trigger-ratio input, and a "Download" button (disabled until status is `READY`). On success: a lightweight inline plot (reuse `uplot.widget.js` primitives or a minimal canvas sparkline) and a "Save CSV" button (reuse existing CSV-export plumbing). Presented as an explicit, user-initiated, long-running action — **no auto-refresh timer**, matching the guidance that transfers take 1.3–20s and shouldn't be treated as casual polling.

**Files touched:** new `scope_serial.js`, `owntech/main.js` (new handlers), `preload.js`, new `owntech_scope.widget.js`, `owntech/manifest.json`.

**Dependency:** M1 (datasource for arm/trigger/status) and M4 (reuses its tree-walk helper). Independent of M2/M3.

**Risks (real-hardware only, the largest unknowns in this plan):** exact byte width/endianness of the hex samples; whether if00 and if02 can genuinely be driven concurrently without cross-talk in practice (should be fine since they're physically separate ports, but Node's `serialport` library + OS-level USB composite device behavior should be smoke-tested, not assumed); real transfer duration for timeout/progress-UI calibration; rotation correctness, validated against a real capture with a known waveform (e.g. a fixed duty-cycle square wave).

---

## Milestone 6 — Docs & test coverage

**Docs:**
- New `app/docs/widgets/index.owntech.json` (distinct from `owntech-legacy`'s renamed index) with entries for `owntech_actions_panel` and `owntech_scope_capture` (category `OwnTech`). M2/M3's changes to the existing Buttons/Gauge widgets don't need new doc entries — those keep their existing type_names and whatever doc entries they already have.
- New READMEs under `app/docs/widgets/owntech/actions/` and `.../scope/`, using `app/docs/widgets/thingset/serial-device-ui/README.md` as the structural template (a generic, discovery-driven widget doc) rather than the old per-leg-hardcoded Twist docs.
- Add `"widgetDocsIndex": "docs/widgets/index.owntech.json"` to `app/extensions/owntech/manifest.json` only once this content exists (`normalizeWidgetDocsRoots()` throws if the path doesn't resolve) — sequenced after the file is created, not added in M0.

**Tests:**
- `tests/unit/extensions_runtime.test.js` — beyond M0's rename fixes: assert `owntech_thingset_datasource`/`owntech_actions_panel`/`owntech_scope_capture` appear in the bootstrap when `owntech` is enabled and are absent when disabled (mirrors existing `thingset_serial_datasource` assertions).
- **New `tests/unit/thingset_tree_walk.test.js`** — pure-function tests for `findLegGroups`/`findBooleanActionLeaves` against synthetic tree fixtures, **critically including a 3-leg (`Leg1`,`Leg2`,`Leg3`) fixture**. This is the single most important regression test in the whole plan: it proves the OwnVerter-readiness claim today, via a hand-built fixture, without needing real 3-leg firmware to exist yet.
- New `tests/unit/thingset_value_parse.test.js` for the lifted parser (booleans, numbers, JSON, quoted strings, hex).
- New `tests/e2e/owntech-thingset.spec.js` (MOCK_HW=1, mirroring `tests/e2e/can-thingset.spec.js`'s style): a dashboard fixture with `owntech_thingset_datasource` + `owntech_actions_panel` rendering without error under a mocked tree response (extend the existing mock tree fixture in `preload.js` to include a fabricated `Leg3` subtree, exercising the 3-leg discovery path through real widget rendering, not just the unit test); a ThingSet-mode Toggle Button / +/- Button test asserting the mocked `thingsetSerial.setValue` was invoked with the expected `{path, value}` (requires making the mock recordable — check for an existing call-tracking pattern in the mock file before inventing one); a sidebar status-card test; a scope-widget test using the mock's instant synthetic download (no timing/rotation correctness assertion possible under mock — that's real-hardware-only).
- The existing `tests/e2e/can-thingset.spec.js` and its fixture dashboard are **not touched** — new OwnTech widgets get their own fixture, keeping the CAN-focused suite untangled from this effort.

**Real-hardware-only verification** (cannot be automated in CI, listed once here for the whole plan): full handshake end-to-end against a real if02 port; chunked-write removal; scope download byte format/concurrency/timing/rotation correctness; `wDriver=false` and any other known-buggy write paths.

---

## Sequencing / dependency graph

```
M0 (rename + scaffold)
  │
  ├──► M1 (datasource + sidebar status)
  │       │
  │       ├──► M2 (shared picker generalization) ──► M3 (button widgets ThingSet-write mode)
  │       │
  │       └──► M4 (Actions panel, introduces thingset_tree_walk.js) ──► M5 (scope capture, reuses it)
  │
  └──► M6 (docs + tests) — land incrementally alongside each milestone, not deferred to the end;
          listed last only because the prompt's structure groups doc/test work as its own section.
```
- M0 blocks everything (the extension id must exist before any manifest can add scripts to it).
- M1 blocks M2, M3, M4, M5 (all need the new datasource type_name).
- M2 blocks M3.
- M4 and M5 share `thingset_tree_walk.js` (introduced in M4) but don't otherwise block each other; M3 and M4 are independent widget surfaces and can be parallelized once M1+M2 land.

## Verification strategy

| Milestone | Unit tests | E2E (MOCK_HW=1) | Real-hardware-only |
|---|---|---|---|
| M0 | Rename/enable/disable assertions in `extensions_runtime.test.js` | none new | Extensions-manager UI toggle sanity (manual) |
| M1 | none new | New datasource renders; sidebar status card shows mocked detection | Real handshake/quote-escaping against if02 |
| M2 | none new (pure wiring) | Gauge/button pointed at a ThingSet path reads mocked value correctly | Polling cadence feel against real hardware |
| M3 | `thingset_value_parse.test.js` | Toggle/+/-/Push-button ThingSet write asserted via recorded mock calls | `wDriver=false` behavior; real write latency |
| M4 | `thingset_tree_walk.test.js` with a synthetic **3-leg** fixture — the core OwnVerter-readiness proof | Actions panel renders a 2-leg mock tree; re-run against a 3-leg mock fixture with zero code changes | Chunked-write removal; Mode enum write/readback |
| M5 | Rotation-logic pure-function tests against a synthetic ring-buffer-ordered array | Full click-through against an instant synthetic mock download | Byte format/endianness, concurrency, real timing, rotation correctness vs. a real waveform |
| M6 | n/a | n/a | n/a |

## Commit sequence

One commit sequence per milestone, in landing order. Each milestone ends with a `docs(owntech)` commit that appends its entry to this file's `## Progress Log` — that commit is what operationalizes the "document advances in this file" rule above; it should never be skipped or folded into a code commit, so the doc update is always separately reviewable. Multiple commits per milestone are expected; the groupings below are a starting point, not a hard requirement — splitting a step further (e.g. if a refactor turns out riskier than expected) is fine, but stay within milestone boundaries (don't mix M1 and M2 changes in one commit).

**M0 — Extension scaffolding & rename**
1. `chore(owntech): rename owntech extension to owntech-legacy, disable by default` — directory rename, manifest id/displayName/enabledByDefault/preloadFlags/widgetDocsIndex edits, doc-index rename.
2. `feat(owntech): scaffold new empty owntech extension` — new `app/extensions/owntech/manifest.json` + `main.js`.
3. `test(owntech): update extensions_runtime tests for the owntech-legacy rename` — `tests/unit/extensions_runtime.test.js`.
4. `docs(owntech): log Milestone 0 completion` — Progress Log entry.

**M1 — Datasource + sidebar detection UI**
1. `refactor(thingset): extract ThingSetSerialDatasourceCore from thingset_serial.datasource.js` — pure code motion, zero behavior change.
2. `feat(owntech): add owntech_thingset_datasource plugin` — new datasource file + manifest wiring.
3. `feat(dashboard): add ThingSet shell status card to the datasource sidebar` — `freeboard.js` (`isThingSetShell`, `thingsetShellStatus`), `index.html`.
4. `docs(owntech): log Milestone 1 completion` — Progress Log entry, including real-hardware handshake verification outcome.

**M2 — Generalize the shared variable picker**
1. `feat(picker): recognize ThingSet serial datasources in the shared variable picker` — `listDatasources`, `fetchDatasourceVariableOptions`.
2. `fix(picker): stop coercing ThingSet variable paths to integers in buildSourceControls`.
3. `feat(widgets): add ThingSet sourceDef read branch to gauges and the +/- button` — `gauge_family.shared.js`, `plusminus_button.widget.js`.
4. `docs(owntech): log Milestone 2 completion` — Progress Log entry.

**M3 — ThingSet-write mode for button widgets**
1. `feat(shared): add thingset_value_parse helper` — lifted from `ts_serial_device_ui.widget.js`.
2. `feat(toggle-button): add ThingSet write mode`.
3. `feat(plusminus-button): add ThingSet write mode` — editor + `_send(direction)`.
4. `feat(push-buttons): add dedicated ThingSet-aware editor and write mode` — `openPushButtonsEditor`, `buttonTargets`.
5. `docs(owntech): log Milestone 3 completion` — Progress Log entry, including `wDriver=false` real-write verification outcome.

**M4 — Discovery-driven Actions panel**
1. `feat(shared): add thingset_tree_walk discovery helper`.
2. `test(owntech): add thingset_tree_walk unit tests, including a synthetic 3-leg fixture` — the OwnVerter-readiness proof.
3. `feat(owntech): add discovery-driven owntech_actions_panel widget`.
4. `docs(owntech): log Milestone 4 completion` — Progress Log entry, including chunked-write-removal and `/Config/Mode` readback verification outcomes.

**M5 — Scope/duty-cycle capture**
1. `feat(owntech): add scope_serial.js if00 protocol module`.
2. `feat(owntech): register scope IPC handlers, preload surface, and MOCK_HW fixtures`.
3. `feat(owntech): add owntech_scope_capture widget`.
4. `docs(owntech): log Milestone 5 completion` — Progress Log entry, including byte-format/endianness, concurrency, timing, and rotation-correctness verification outcomes (the largest set of hardware unknowns in this plan).

**M6 — Docs & test coverage**
1. `docs(owntech): add widget docs and index.owntech.json for the new widgets`.
2. `test(owntech): add owntech-thingset.spec.js e2e coverage and remaining unit tests`.
3. `docs(owntech): final migration-doc pass — mark plan complete` — Progress Log entry closing out the migration, summarizing what shipped vs. the original plan across all milestones.

## Critical files for implementation

- `app/js/thingset_serial_shell.js` — the ThingSet Text-Mode transport (`ThingSetSerialShell`), reused as-is throughout; its handshake/write/discovery behavior is the foundation for every milestone.
- `app/extensions/thingset/main.js` — owns the `ts-serial-*` IPC registrations the new extension depends on via `requiresExtensions`; gains the shared datasource-core renderer script in M1.
- `app/dashboard/plugins/thingset_serial.datasource.js` — source of the `flattenTree()`/polling logic extracted into a shared core module in M1; already produces the named-path data shape M2 needs.
- `app/dashboard/js/freeboard.js` — hosts `plotEditorShared`, `DatasourceModel`, and the `channelMapEditor` binding-handler precedent used for the new sidebar status card; touched in M1 and M2.
- `app/extensions/runtime.js` — `sortExtensions()`, `resolveEnabled()`, `applyRequiredExtensionConstraints()`, and `buildBootstrap()`'s global script-ordering govern every manifest change from M0 onward.

## Progress Log

_No milestones have landed yet. Append one entry per milestone (or per significant commit) as work proceeds, using this template:_

```
### YYYY-MM-DD — M<n> <short milestone name>
- Commits: <hash(es) or message(s) from the Commit Sequence above>
- What shipped: <summary, and any deviation from the milestone's design as written above>
- Verification: <unit/e2e results; real-hardware results for anything that milestone's Risks section flagged as hardware-only>
- Follow-ups: <anything newly discovered that isn't yet reflected in a later milestone's plan>
```

### 2026-07-31 — M0 Extension scaffolding & rename

- Commits: `5af7c2e` chore(owntech): rename owntech extension to owntech-legacy, disable by default; `44497ac` feat(owntech): scaffold new empty owntech extension; `9048e28` test(owntech): update extensions_runtime and e2e coverage for the owntech-legacy rename.
- What shipped: `app/extensions/owntech/` renamed to `owntech-legacy` (id, displayName, `enabledByDefault: false`, `preloadFlags.owntechLegacy`, `widgetDocsIndex` all updated; `app/docs/widgets/index.owntech.json` renamed alongside it). A new, empty `app/extensions/owntech/manifest.json` + `main.js` claims the `owntech` id, `enabledByDefault: true`, `requiresExtensions: ["thingset"]`, exactly as spec'd. `sortExtensions()`'s rank map in `runtime.js` gained `['owntech-legacy', 3.5]` (cosmetic, inventory ordering only). One deviation from the written plan: also updated `app/main.js`'s `buildWidgetExtensionsMenuItems()` to add a dedicated `{ extensionId: 'owntech-legacy', label: 'OwnTech Widgets (Legacy)' }` Help-menu section — not called out in the M0 spec, but without it the Twist widget docs would have become unreachable from the in-app Widgets menu the moment a user re-enables `owntech-legacy` (the menu was previously keyed only on the `owntech` id, which now points at the empty extension). No widget files moved and no `type_name`s changed, per the "old dashboards keep working" principle.
- Verification: all 6 unit test files pass (`node tests/unit/*.test.js`), including the retargeted/expanded `extensions_runtime.test.js` (default-disabled state, env-var round-trip via `MODULAR_EXTENSION_OWNTECH_LEGACY`, persisted-state override). Ran the two affected Playwright e2e specs directly (`electron-smoke.spec.js`, `tabs-docs.spec.js`) — 11 tests total, all passing, including new coverage for the env-var re-enable path and the legacy Help-menu entry. Real-hardware/manual verification (extensions-manager UI toggle sanity) not performed — flagged as manual-only in the plan's Verification strategy table, no hardware or UI-click session available in this pass.
- Follow-ups: none new. M1 (OwnTech ThingSet datasource + sidebar detection) is next and unblocked.

### 2026-07-31 — M1 OwnTech ThingSet datasource + sidebar detection UI

- Commits: `e95579c` refactor(thingset): extract ThingSetSerialDatasourceCore from thingset_serial.datasource.js; `dc8a6cf` feat(owntech): add owntech_thingset_datasource plugin; `69bab72` feat(dashboard): add ThingSet shell status card to the datasource sidebar; `b88ef1f` test(owntech): add e2e coverage for owntech_thingset_datasource and fix a widget-picker M0 regression.
- What shipped: exactly as spec'd — `ThingSetSerialDatasource` lifted out of `thingset_serial.datasource.js` into `app/dashboard/js/thingset_serial_datasource_core.js` (`window.ThingSetSerialDatasourceCore`, pure code motion), hosted in `thingset`'s manifest at `order: 6` (loads before both consuming plugin scripts, per the confirmed global-order-not-per-extension rule). `formatPortLabel`/`fetchSerialPortOptions` were also moved into the core module (attached as static properties on the constructor) since both the old and new datasource plugins need identical port-listing logic — a small addition beyond the plan's literal wording ("class body"), done to avoid a second copy-paste. New `owntech_thingset_datasource` type registered in `app/dashboard/plugins/owntech_thingset.datasource.js`, wired into `app/extensions/owntech/manifest.json` (`order: 200`, `datasources: [{type, icon: "microchip"}]`). Sidebar status card: `DatasourceModel.isThingSetShell` computed + `ko.bindingHandlers.thingsetShellStatus` in `freeboard.js`, wired into `index.html` right after the `isPortBased` block, with new `.thingset-shell-*` CSS (dark default + `html.theme-light` overrides) in `bootstrap-overrides.css`. One implementation choice not spelled out in the milestone text: the status card reads `bindingContext.$data` directly for `latestData()`/`updateNow()` (it renders inside the per-datasource-row template, so `$data` **is** the `DatasourceModel`) rather than re-finding the datasource by name via `freeboard.getLiveModel().datasources().find(...)` as the plan's illustrative snippet showed — simpler and avoids a redundant lookup. The leaf/group summary count uses a small dedicated `summarizeThingSetTree()` walk in `freeboard.js`, deliberately kept separate from Milestone 4's future `thingset_tree_walk.js` (that one pattern-matches leg group names; this one is a raw count for a status line — different jobs).
- Verification: all 6 unit test files still pass. New `tests/e2e/owntech-thingset-datasource.spec.js` (MOCK_HW=1) confirms the datasource type renders, auto-polls on creation, and the sidebar card shows "Detected", the mocked port (`COM_MOCK`), and the correct summary ("3 leaves across 1 group") against the existing mock tree fixture in `preload.js`. Ran the broader e2e surface touched by this milestone (`electron-smoke`, `tabs-docs`, `widget-picker`, `widget-drag-drop`, plus the new spec — 17 tests) and all pass. Also discovered and fixed a **missed M0 regression**: `widget-picker.spec.js`'s "picker shows OwnTech and ThingSet sections" test wasn't run during the M0 pass and had started failing (the OwnTech picker section disappeared once `owntech-legacy` defaulted off) — fixed by passing `MODULAR_EXTENSION_OWNTECH_LEGACY=1` in that test. Confirmed via `git stash` isolation that 4 pre-existing `integrated-plot-editor.spec.js` failures are unrelated to this migration (they fail identically on the M0 HEAD, before any M1 changes) — not fixed here, flagged for the user separately. Real-hardware verification (full handshake/quote-escaping against a real if02 shell) not performed — no hardware available in this pass, per the plan's Verification strategy table.
- Follow-ups: the pre-existing `integrated-plot-editor.spec.js` failures (4 tests: time/xy/fast-frame plot summary-text assertions and the "non-plot widgets use generic editor" test) are unrelated to OwnTech/ThingSet and should be triaged separately. M2 (generalize the shared variable picker for named ThingSet paths) is next and unblocked.

### 2026-07-31 — M2 Generalize the shared variable picker for named ThingSet paths

- Commits: `1c36c52` feat(picker): recognize ThingSet serial datasources in the shared variable picker; `55847ce` fix(picker): stop coercing ThingSet variable paths to integers in buildSourceControls; `05c753c` feat(widgets): add ThingSet sourceDef read branch to gauges and the +/- button; `47d7c9a` test(owntech): add e2e coverage for reading a ThingSet path through the shared picker.
- What shipped: exactly as spec'd, in `app/dashboard/js/freeboard.js` — `plotEditorShared.listDatasources()`'s allow-list gained `thingset_serial_datasource`/`owntech_thingset_datasource`, and a new branch in `fetchDatasourceVariableOptions()` enumerates named leaf paths from the datasource's cached `latestData().values` map (mirroring the existing `can_datasource` named-path branch). `integrated_plot_editor.js`'s `buildSourceControls().buildValue()` coercion bug fixed by broadening the "keep as string" list rather than inverting the condition, so `serialport_datasource`/`fast_frame_datasource`/`signal_generator_datasource` keep their integer-index behavior unchanged; `showDevice` stays `dsType === 'can_datasource'` as planned (ThingSet serial has no device concept). The identical 5th `sourceDef.type` branch was added to both `gauge_family.shared.js` and `plusminus_button.widget.js`'s `_readInstantValue()`, reading the target datasource's cached `latestData().values[sourceDef.var]` rather than issuing a new IPC poll per widget. No deviations from the written plan.
- Verification: all 6 unit test files pass. New fixture `tests/fixtures/owntech_thingset_value_read.json` (one `owntech_thingset_datasource` + a +/- Button whose `sourceDef.var` is `/Config/rMode`) and `tests/e2e/owntech-thingset-value-read.spec.js` confirm the widget displays `1` — the MOCK_HW-mocked value — end to end through the picker → `sourceDef` → `_readInstantValue()` path. Re-ran the full previously-touched e2e surface (24 tests across `owntech-thingset-datasource`, `owntech-thingset-value-read`, `integrated-plot-editor`, `widget-picker`, `tabs-docs`) — the same 4 pre-existing `integrated-plot-editor.spec.js` failures logged in the M1 entry reproduced identically (still unrelated, still unfixed here); everything else passed, 20/24. Only `plusminus_button.widget.js` was exercised end-to-end for the read path; `gauge_family.shared.js`'s identical branch was verified by code review and unit-level syntax check (`node --check`) only — no e2e assertion reads a gauge's rendered value in this pass, since vertical/radial gauges render their value into an SVG/canvas fill rather than plain text, which would need a heavier DOM-inspection helper than was justified for this milestone.
- Follow-ups: consider adding a gauge-specific e2e read assertion in a later pass (e.g. Milestone 6's broader `owntech-thingset.spec.js`) once a reusable way to read a rendered gauge's current numeric value exists — not blocking, since the read logic is identical to the already-covered +/- Button branch. M3 (ThingSet-write mode for Toggle Button, +/- Button, Push Buttons) is next and unblocked.

### 2026-07-31 — M3 ThingSet-write mode for Toggle Button, +/- Button, Push Buttons

- Commits: `a9e91c8` feat(shared): add thingset_value_parse helper; `b94224e` feat(toggle-button): add ThingSet write mode; `a1fbca6` feat(buttons): add ThingSet write mode to the +/- Button and Push Buttons widgets; `0405c68` test(owntech): add e2e coverage for Toggle/+/-/Push button ThingSet writes.
- What shipped: `parseInputValue()` lifted into `app/dashboard/js/thingset_value_parse.js` (`window.ThingSetValueParse`), hosted in `thingset`'s manifest at `order: 4`; `ts_serial_device_ui.widget.js` now references it instead of its own copy. All three button widgets got the planned datasource-type-driven mode switch with no manual toggle: Toggle Button gained `writePath`/`onValue`/`offValue` settings and a `_send(kind)` dispatcher; +/- Button's editor swaps the +/- Command fields for `writePath`+`Step` when the target datasource resolves to a ThingSet type, and `_send(direction)` reads the current value via the existing `_readInstantValue()` and writes `current + direction*step`; Push Buttons got the planned dedicated `openPushButtonsEditor` (registered in `ModularIntegratedPlotEditor.open()` and in `freeboard.js`'s three integrated-editor routing lists, mirroring the +/- Button precedent), with an additive `buttonTargets:[{label,path,value}]` array alongside the existing `buttons:[{label,command}]`. Two deviations from the written plan, both noted at commit time: (1) the +/- Button and Push Buttons commits were combined into one (`a1fbca6`) rather than kept separate, since both touch the same `freeboard.js` routing lists and the same dispatch table; (2) discovered mid-implementation that `getDatasourceSettings(dsName).portPath` only reflects an auto-detected port because the datasource instance's `currentSettings` object is the *same object reference* as the `DatasourceModel.settings()` observable's value (mutating one mutates the other without needing an explicit KO notify) — this wasn't previously documented anywhere but is load-bearing for every write path added in this milestone, so it's worth flagging here for anyone touching `onSettingsChanged`/`self.settings(...)` reassignment logic later: breaking that reference-sharing invariant (e.g. by deep-cloning settings somewhere) would silently break every ThingSet write in this milestone.
- Verification: all 6 unit test files pass. New fixture `tests/fixtures/owntech_thingset_write.json` (Toggle Button + +/- Button + Push Buttons, all pointed at one `owntech_thingset_datasource`) and `tests/e2e/owntech-thingset-write.spec.js` click each widget and assert the mocked `thingsetSerial.setValue` was invoked with the expected `{port, path, value}` — exactly the M6-planned assertion, done here instead since it's this milestone's core new behavior. This required making the previously non-recordable `MOCK_HW` `setValue` mock recordable; a naive plain-array `__mockCalls` property didn't work because Electron's `contextBridge` structured-clones plain data once at access time (only function calls round-trip live state back from the isolated preload context) — fixed by exposing a `getMockSetValueCalls()` function instead, discovered via a throwaway debug script before it was clear why the array always read back empty despite the write path executing successfully. Re-ran the full previously-touched e2e surface (30 tests) — the same 4 pre-existing `integrated-plot-editor.spec.js` failures reproduced identically (unrelated, unfixed, already logged in M1/M2); everything else passed, 26/30. Real-hardware verification (whether `wDriver=false`-shaped writes are reliably accepted, per this milestone's flagged risk) not performed — no hardware available in this pass.
- Follow-ups: the `wDriver=false` UI caveat this milestone's plan suggested ("not guaranteed to take effect — verify with a read") was not added to any widget in this pass — it's real-hardware-contingent UX polish, not blocking, and better added once real hardware confirms the actual failure mode to describe accurately. M4 (discovery-driven Actions panel successor) is next and unblocked.

### 2026-08-01 — M4 Discovery-driven Actions panel successor

- Commits: `69a4b3a` feat(shared): add thingset_tree_walk discovery helper; `e26a37d` test(owntech): add thingset_tree_walk unit tests, including a synthetic 3-leg fixture; `48a4257` feat(owntech): add discovery-driven owntech_actions_panel widget; `486da8a` test(owntech): add e2e coverage for the discovery-driven Actions panel.
- What shipped: `window.ThingSetTreeWalk` (UMD, testable from Node like `twist_protocol.js`) with `findLegGroups()`/`findBooleanActionLeaves()`/`findWritableNonBooleanLeaves()`, exactly as spec'd. One necessary extension beyond the plan's literal description: both tree-walk functions handle *two* node shapes, not one — leaves embedded directly in a `values` map (the shape `flattenTree()`/the MOCK_HW mock use) and leaves as full child nodes with their own `.value` (the shape `ThingSetSerialShell.buildTree()` actually produces against real hardware). The plan didn't call this out explicitly; discovered it by reading `buildTree()`/`createLeaf()`/`createGroup()` in `app/js/thingset_serial_shell.js` before writing the helper, since getting this wrong would have made the widget appear to work against the mock while silently discovering zero leaves against a real board. New `owntech_actions_panel.widget.js` shipped exactly as spec'd: per-leg badge + toggle grid, direct `thingsetSerial.setValue` writes (no protocol-string layer), `/Config/Mode` enum power buttons, chunked-write workaround/scope-controls/`sm:state-entered` listener all dropped. One implementation choice not spelled out in the milestone text: it reads the discovered tree from the linked datasource's cached `latestData()` (with a Rescan Tree button calling `updateNow()`) rather than doing its own independent `ts-serial-tree` IPC fetch the way `ts_serial_device_ui.widget.js` does — chosen for consistency with the efficiency principle M1-M3 already established, even though the milestone text pointed at `ts_serial_device_ui.widget.js` as the model to mirror (that reference was read as "mirror its datasource-filter pattern," not "mirror its independent-fetch architecture").
- Verification: all 7 unit test files pass, including the new `thingset_tree_walk.test.js` — its synthetic 3-leg (`Leg1`/`Leg2`/`Leg3`) fixture is the OwnVerter-readiness proof the plan called "the single most important regression test in the whole plan," and it also covers numeric-vs-lexicographic leg sorting and both tree-node shapes. New `tests/e2e/owntech-actions-panel.spec.js` proves the same claim through real widget rendering: the default MOCK_HW tree (extended with a fabricated `Leg1`/`Leg2` subtree under `/Config`) renders 2 legs / 8 toggles and both a toggle click and a power button send the expected `thingsetSerial.setValue` calls; re-running the identical fixture with a new `MOCK_THINGSET_LEG3=1` env var (zero widget/discovery code changes) renders 3 legs / 12 toggles. Growing the shared mock tree shifted the Milestone 1 sidebar card's leaf/group summary from "3 leaves across 1 group" to "11 leaves across 2 groups" — updated that assertion rather than leaving it silently wrong. Re-ran the full previously-touched e2e surface (32 tests, both parallel and serial) — the same 4 pre-existing `integrated-plot-editor.spec.js` failures reproduced identically in serial mode (confirmed via `--workers=1`; a parallel run showed one of the four with a *different* symptom, traced to cross-test flakiness from four concurrent Electron instances competing for resources, not a real regression); everything else passed. Real-hardware verification (whether the chunked-write removal is safe over if02, and whether `/Config/Mode` writes read back immediately) not performed — no hardware available in this pass.
- Follow-ups: none new for this milestone's own scope. The two-tree-shape handling in `thingset_tree_walk.js` should be kept in mind by anyone later touching `flattenTree()` or `ThingSetSerialShell.buildTree()` — the two helpers currently agree on what "a leaf" looks like, but nothing enforces that they stay in sync if either shape changes. M5 (Scope/duty-cycle capture UI) is next and unblocked.

### 2026-08-01 — M5 Scope/duty-cycle capture UI

- Commits: `73be9a7` feat(owntech): add scope_serial.js if00 protocol module; `8816cb3` feat(owntech): register scope IPC handlers, preload surface, and MOCK_HW fixtures; `9aa9c7b` feat(owntech): add owntech_scope_capture widget; `7f280b3` test(owntech): add scope_serial unit tests and e2e coverage for the scope widget.
- What shipped, and a significant deviation from the plan's premise: the plan flagged this milestone's if00 wire format (byte width/endianness, exact framing) as **unconfirmed, real-hardware-only** — but `/home/luiz-villa/code/Core4/` (the sibling firmware repo the overall plan is based on) turned out to be readable in this environment, and it contains a verified Python reference client (`src/tools/scope_serial.py`, `class ScopeSerial`) plus the firmware-side implementation (`src/scope_data_port.cpp`) and the exact `/Debug/Scope` ThingSet leaf schema (`src/user_data_objects.cpp`: `wArm`, `wTrigger`, `wPretriggerRatio`, `wDecimation`, `rState` 0-3=IDLE/ARMED/TRIGGERED/READY, `rSampleCount`, `rChannelCount`, `rSamplePeriod_us`, `rCaptureDuration_ms`, `rFinalIndex`, `rLastError`). `scope_serial.js`'s `ScopeSerialLink` is a line-for-line port of the verified Python client rather than a from-scratch reimplementation of a partially-specified protocol — this resolves the plan's single biggest flagged unknown (confirmed big-endian 32-bit float, `SCOPE_CHANNEL_NAMES` is a fixed 8-name list, `SCOPE_SAMPLE_COUNT` is 1024) months before real hardware would otherwise have been needed to find out. `owntech_scope_capture` widget shipped exactly as spec'd: discovery-driven Arm/Trigger buttons via M4's `findBooleanActionLeaves` scoped to `/Debug/Scope`, hardcoded decimation/pre-trigger controls (same category as M4's Mode enum), `rState`-gated Download button, inline uPlot chart, Save CSV via `files.saveExportCsv` (added `owntech_scope_csv` to `app/main.js`'s category allow-list — a small necessary addition the plan's file list didn't mention). New `api.flags.owntech`/`ENABLE_OWNTECH` preload gate mirrors `api.flags.thingset`, ANDed with it since the extension itself requires ThingSet.
- Verification: all 8 unit test files pass, including new `scope_serial.test.js` — its `parseHexFloat` test vectors (`3F800000`→1, `C0000000`→-2, etc.) are a **direct, hardware-independent confirmation** of the byte-format risk the plan flagged, and `rotateToChronological` is tested against both small hand-worked arrays and a full 1024×8 synthetic ring buffer matching the real protocol's shape. New `tests/e2e/owntech-scope-capture.spec.js` (MOCK_HW's `owntechScope` mock resolves an instant synthetic capture) confirms an Arm click sends the expected ThingSet write, Download reflects the mocked `READY` status, and the resolved capture has the correct channel/sample counts and `finalIndex`. **A real bug caught and fixed during this pass**: `_download()`'s `finally` block originally called the widget's full `_updateFromTree()`, which immediately overwrote the "Downloaded N samples…" success message with "Status: READY" before a user could ever see it — found via the e2e test failing on a null status-text lookup, fixed by narrowing the `finally` block to only refresh the Download button's enabled state, not the status line. The inline uPlot chart's actual rendering is *not* asserted anywhere (neither here nor in the pre-existing `time_plot_uplot` e2e coverage) since uPlot loads from a CDN via `external_scripts` and asserting on it would make tests depend on network access; verified the underlying capture data (`_lastCapture`) directly instead. Re-ran the full previously-touched e2e surface (33 tests) — the same 4 pre-existing `integrated-plot-editor.spec.js` failures reproduced identically; everything else passed, 29/33. Real-hardware verification **not performed** for what remains genuinely hardware-only even with the reference implementation in hand: whether if00 and if02 can truly be driven concurrently without cross-talk on real USB composite-device hardware, real transfer timing across decimations (for calibrating the 25s default timeout), and end-to-end rotation correctness against a real capture with a known waveform (the rotation *math* is now verified against the reference implementation and synthetic data, but not against real ring-buffer content from a live board).
- Follow-ups: the `getOrOpenLink` pool in `owntech/main.js` never expires idle links — if a user leaves a scope widget configured for a long time without explicitly closing it (or the widget's `onDispose` doesn't fire, e.g. on unclean app shutdown), the if00 port stays open indefinitely. Not fixed here since it mirrors an existing, accepted pattern (`thingset/main.js`'s `canBuses`/`tsClients` maps have the same property), but worth a shared look later if it becomes a real port-exhaustion problem. M6 (Docs & test coverage) is next — the only remaining milestone, and per its own text, largely already satisfied incrementally by M0-M5's per-milestone test commits; what's left is primarily the widget-docs index/READMEs and a final consolidated `owntech-thingset.spec.js` if one is still judged necessary on top of the five dedicated specs already written.

### 2026-08-01 — Real-hardware verification pass (M1, M3, M4, M5)

- Commit: `1593d83` fix(owntech): normalize discovered ThingSet leaf paths to always have a leading slash.
- Setup: a real Twist board running Core4 firmware was connected (`if00` → `/dev/ttyACM0`, `if02` → `/dev/ttyACM1`, confirmed via `/dev/serial/by-id`). All checks below ran with `Config/Mode = 0` (IDLE) and both legs' `wEnable = false` confirmed *before* touching anything, and were scoped to what's electrically inert: detection, tree discovery, ThingSet reads/writes to non-actuating leaves (`/Debug/Scope/*`, a no-op `/Config/Mode` 0→0 write), and scope captures with the converter idle. No leg was ever enabled, no duty cycle written, no `POWER_ON`/`POWER_OFF` transition attempted — those remain deliberately untested pending an explicit, operator-supervised session.
- **M1 handshake**: `ThingSetSerialShell.open()` → `enterThingSet()` → `buildTree()` against the real `if02` port succeeded on the first attempt, no quote-escaping or prompt-detection issues. Confirmed real top-level tree children: `_Reporting, Calibration, Config, Control, Converter, Debug, Device, mCAN, Measurements, mLive, Networking, pNodeID, pNodeName`.
- **A real, previously-latent bug found and fixed**: the real tree's `node.path` values have **no leading slash** (e.g. `"Debug/Scope/wArm"`, `"Config/Leg1"`) — every mock and synthetic fixture in this repo's tests used a leading slash instead, so nothing caught this until real hardware. It never broke a read or write (`ThingSetSerialShell.setValue()`/`getValue()`/`update()` all call `normalizePath()` internally regardless of the caller's input), verified by writing to the *same* leaf both with and without a leading slash and getting identical, correct results — but `thingset_tree_walk.js`'s discovered `leaf.path` would have been silently incomparable to a `flattenTree()`-produced values-map key. Fixed in `1593d83`, with a regression test using the real (no-slash) path shape.
- **M4 discovery, against real data**: `Config.children` = `{Frequency_Hz, Leg1, Leg2, Mode, wBlinkPeriod_s}` — `findLegGroups` correctly picks out just `Leg1`/`Leg2` (numeric `LegN` pattern) and ignores the rest. `Leg1.children` = 11 leaves (`wBoost, wBuck, wCapa, wDeadTimeFalling_ns, wDeadTimeRising_ns, wDriver, wDutyCycle, wEnable, wPhaseShift, wReferenceValue, wTrackingVar`) — `findBooleanActionLeaves` correctly discovers exactly the 5 booleans (`wBoost/wBuck/wCapa/wDriver/wEnable`), `findWritableNonBooleanLeaves` correctly discovers the other 6. Every real leaf uses the children-with-`.value` shape (`values: {}` on every group node), confirming the M4 progress log's earlier decision to support *both* tree shapes was load-bearing, not speculative — a values-map-only implementation would have discovered zero leaves against this board.
- **M4 `/Config/Mode` write/readback**: a no-op `Config/Mode` write (0 → 0, the exact command `owntech_actions_panel`'s IDLE button sends) read back correctly 15ms later. `POWER_ON`/`POWER_OFF` transitions themselves remain untested (deliberately, per the safety scoping above).
- **M5 scope protocol, end to end on real if00**: armed (`Debug/Scope/wArm = true` → `rState` 0→1), triggered (`Debug/Scope/wTrigger = true` → `rState` 1→3/READY within the poll window), then downloaded a full capture over `if00` while `if02` stayed open and in active use throughout. Download completed in ~1.1s for `decimation=1` (consistent with Core4's documented 0.08–0.25s arm-to-READY window plus transfer), returned all 1024 samples × 8 channels (`V1Low_V, V2Low_V, VHigh_V, I1Low_A, I2Low_A, IHigh_A, Duty1, Duty2`), `finalIndex` in the valid `0..1023` range, `Duty1`/`Duty2` reading exactly `0.0000` throughout (expected — converter idle, no PWM). `if02` remained fully responsive immediately after the `if00` download (a second `Config/Mode` read succeeded), and `Config/Mode` stayed `0` throughout — no cross-talk, no accidental state change. This is the plan's biggest flagged real-hardware unknown, and it passed.
- **One non-reproducible timing hiccup**: the very first `if00` probe attempt in the session (executed for the first time right after a long `if02` polling loop) timed out (default 1500ms). Five immediate, isolated open→probe→close cycles run afterward each succeeded in 2–5ms, and a full second end-to-end run (arm→trigger→download) also succeeded cleanly — this looks like a one-off USB/serial settle hiccup rather than a systemic if00/if02 concurrency problem, but wasn't reproducible enough to root-cause conclusively in this pass.
- Verification: all 8 unit test files and the previously-touched e2e surface (owntech-actions-panel, owntech-scope-capture) still pass after the path-normalization fix.
- Follow-ups: (1) the one-off probe timeout above is worth a defensive retry (e.g. one automatic re-probe on first timeout) if it recurs in a future hardware session — not added speculatively here since it wasn't reproducible. (2) `POWER_ON`/`POWER_OFF` transitions, leg `wEnable`/duty-cycle writes, and scope decimation/pre-trigger sweeps at `10`/`100` remain unverified against real hardware — these need an operator-supervised session on an isolated, current-limited bench per Core4's own `SCOPE_DUTY_CYCLE_TEST.md`/`automated_test.md` safety discipline, not something to run unattended.

### 2026-08-01 — M6 Docs & test coverage (plan complete)

- Commits: `642a7cb` docs(owntech): add widget docs and index.owntech.json for the new widgets; `a320d9a` test(owntech): add remaining unit tests and bootstrap presence assertions.
- What shipped: `app/docs/widgets/index.owntech.json` with entries for `owntech_actions_panel`/`owntech_scope_capture`, plus READMEs under `app/docs/widgets/owntech/actions/` and `.../scope/`. One deviation from the plan's literal template reference: used the lighter, screenshot-free README format already established for the Buttons-category widgets (`plus-minus-button`, `toggle-button`) rather than `thingset/serial-device-ui/README.md`'s screenshot-heavy one — this environment has no screenshot-capture step wired into this pass, and referencing nonexistent `widget.png`/`widget-edit.png` files would just render broken images. `"widgetDocsIndex"` added to `owntech/manifest.json` now that the content exists. `thingset_value_parse.js` upgraded to the same UMD wrapper `twist_protocol.js`/`thingset_tree_walk.js` already use, purely so `thingset_value_parse.test.js` could `require()` it directly from Node — zero behavior change for the browser-global consumers. `extensions_runtime.test.js` gained the bootstrap presence/absence assertions the plan asked for.
- **A second deviation, decided deliberately rather than by default**: the plan called for a new consolidated `tests/e2e/owntech-thingset.spec.js` mirroring `can-thingset.spec.js`. Every scenario it would have covered — datasource + Actions panel rendering (including the 3-leg case), ThingSet-mode Toggle/+/-/Push-button writes, the sidebar status card, and the scope widget's mocked instant download — already has dedicated, passing e2e coverage landed incrementally with M1-M5 (`owntech-thingset-datasource.spec.js`, `owntech-thingset-value-read.spec.js`, `owntech-thingset-write.spec.js`, `owntech-actions-panel.spec.js`, `owntech-scope-capture.spec.js`). Consolidating them would have meant either duplicating test code across two locations or deleting five focused, already-working files to reassemble one large one, for no functional gain — so no new file was added; this note stands in for the commit the plan's checklist would otherwise expect.
- **A real, expected regression caught and fixed**: wiring `widgetDocsIndex` made `owntech_actions_panel`/`owntech_scope_capture` doc entries appear, which makes the "OwnTech Widgets" Help-menu section reappear by default (it was correctly absent in every M0-M5 progress log entry, back when the extension had no widget docs at all) — `electron-smoke.spec.js`'s default-boot test still asserted it absent and failed until updated.
- Verification: all 9 unit test files pass. Re-ran the full previously-touched e2e surface (33 tests, both parallel and `--workers=1` serial) — the same 4 pre-existing `integrated-plot-editor.spec.js` failures reproduced identically in serial mode (a 5th, `fft_spectrum_plot`, failed only in the parallel run with a different symptom and passed cleanly on the serial re-run, consistent with the cross-test flakiness already noted in the M4 entry); everything else passed, including the newly-fixed `electron-smoke.spec.js`.
- Follow-ups, carried forward as the plan's final state rather than resolved here: (1) real-hardware verification of `POWER_ON`/`POWER_OFF` transitions, leg `wEnable`/duty-cycle writes, and scope decimation sweeps at `10`/`100` (blocked on an operator-supervised powered bench, per the previous entry); (2) a defensive retry for the one-off `if00` probe timeout observed during hardware verification, if it recurs; (3) `thingset_tree_walk.js`'s two-tree-shape handling and the leading-slash path normalization fixed in this migration should be kept in sync if `flattenTree()` or `ThingSetSerialShell.buildTree()` ever change their node shape; (4) widget screenshots for the new OwnTech docs, if this project later adopts a screenshot-capture step (`scripts/capture-widget-screenshots.js` exists but wasn't run here). **All six milestones of this migration plan are now complete.** The new `owntech` extension (datasource, sidebar detection, generalized picker, ThingSet-write button widgets, discovery-driven Actions panel, scope capture) is fully wired, documented, and covered end to end by mock-based tests, with a real-hardware verification pass confirming the core protocol work against an actual Core4/Twist board. `owntech-legacy` remains installed and available (disabled by default) for any dashboard still relying on the old console-protocol widgets.
