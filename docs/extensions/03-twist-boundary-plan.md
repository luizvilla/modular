# Step 3 - Vanilla Serial And TWIST Boundary Plan

## Summary
- Separate reusable serial and plotting infrastructure from `TWIST` and other OwnTech-specific workflows.
- Move `TWIST` protocol helpers, control widgets, and OwnTech example material behind a dedicated extension boundary.
- Rename or alias branded core types where necessary so vanilla Modular is not semantically OwnTech-shaped.

## Why This Step Exists
- `twist_*` widgets are clearly feature-specific, but some generic infrastructure is still branded or tuned for OwnTech.
- `serialowntech.datasource.js` implements the generic `serialport_datasource` while still carrying OwnTech-specific naming in the file and UI hints.
- The generic plot widget type is already `time_plot_uplot`.
- Serial port labeling and flasher port preference still look for OwnTech VID/PID in core code.
- `TWIST`, `OWNVERTER`, and `SPIN` examples currently live in core-owned paths.

## Goals
- Keep generic serial, plot, gauge, terminal, recorder, and dashboard behavior in core.
- Move `TWIST` protocol logic and widgets behind a `twist` extension manifest.
- Remove OwnTech branding assumptions from core runtime and UI defaults.
- Preserve backward compatibility for saved dashboards and tests that reference legacy type names.

## Non-Goals
- Do not move `Fast Frame` or `ThingSet` code in this step.
- Do not redesign the serial API contract beyond what is needed to remove hardcoded OwnTech assumptions.
- Do not remove legacy widget type aliases immediately.

## Read First
- `app/dashboard/js/twist_protocol.js`
- `app/dashboard/plugins/twist_control.widget.js`
- `app/dashboard/plugins/twist_setpoints.widget.js`
- `app/dashboard/plugins/twist_calibration.widget.js`
- `app/dashboard/plugins/serialowntech.datasource.js`
- `app/dashboard/plugins/uplot.widget.js`
- `app/dashboard/plugins/uplot.UI.js`
- `app/dashboard/plugins/uplot.series.manager.js`
- `app/main.js`
- `app/dashboard/js/tabs.js`
- `tests/e2e/serial.spec.js`
- `tests/e2e/integrated-plot-editor.spec.js`
- `tests/e2e/plot-gauge.spec.js`

## Current Files Expected To Change
- `app/dashboard/js/twist_protocol.js`
- `app/dashboard/plugins/twist_*.widget.js`
- `app/dashboard/plugins/serialowntech.datasource.js`
- `app/dashboard/plugins/uplot.widget.js`
- `app/dashboard/plugins/uplot.UI.js`
- `app/dashboard/plugins/uplot.series.manager.js`
- `app/dashboard/plugins/integrated_plot_editor.js`
- `app/main.js`
- `app/dashboard/js/tabs.js`
- Example docs and dashboards under `app/dashboard/docs/examples/` and `app/dashboard/dashboards/`

## Core Versus Extension Boundary

### Core Should Own
- Generic serial datasource behavior
- Generic serial terminal and CSV recorder widgets
- Generic plot widget runtime
- Generic plot UI and channel manager helpers
- Generic flasher behavior that does not assume OwnTech devices
- Generic USB metadata exposure in the serial API

### `twist` Extension Should Own
- `twist_protocol.js`
- `twist_actions_panel`
- `twist_setpoints_panel`
- `twist_calibration_panel`
- OwnTech-specific example docs and dashboards
- Any branded defaults, labels, or docs copy tied to `TWIST`, `OWNVERTER`, or `SPIN`

## Methodology To Preserve From Existing Skills
- From `modular-widget-authoring`:
  - Keep widget docs aligned with shipped titles and categories.
  - Update the picker, docs metadata, and fixtures whenever user-visible widgets move.
- From `modular-electron-bridge`:
  - Keep using `window.api.serial` instead of adding renderer shortcuts.
  - If serial metadata grows, update preload mock behavior at the same time.
- From `modular-playwright-e2e`:
  - Validate with focused fixtures and `page.evaluate()` for widget state.
  - Use targeted spec coverage instead of broad suite churn.

## Implementation Changes

### 1. Make The Core Serial Datasource Explicitly Generic
- Rename the implementation file from `serialowntech.datasource.js` to a neutral location or alias it through core metadata.
- Keep the runtime type `serialport_datasource` stable.
- Return generic serial metadata from core:
  - `path`
  - `vendorId`
  - `productId`
  - `manufacturer`
  - `serialNumber`
- Stop adding `(OwnTech)` labels in core UI code.
- Let the `twist` extension decorate port labels if it needs branded presentation.

### 2. De-Brand The Core Plot Widget
- Introduce a neutral canonical plot type such as `plot_uplot` or `uplot_plot`.
- Do not reintroduce `owntech_plot_uplot`; treat stale references as migration debt.
- Update the integrated editor, plot UI controller, and channel manager to target the neutral canonical type while still loading old dashboards.

### 3. Move TWIST Widgets And Protocol Helpers Behind The Extension
- Register `twist_protocol.js` through the `twist` manifest instead of core boot.
- Move `twist_*` widgets into extension-owned renderer script lists.
- Keep their use of `window.api.serial` unchanged so the extension remains thin over core serial capability.

### 4. Move OwnTech Example Material Out Of Core
- Move `TWIST`, `OWNVERTER`, and `SPIN` example roots behind the `twist` extension metadata.
- Move related dashboard roots behind the same extension.
- Keep example IDs stable where possible; if IDs must change, add explicit compatibility mapping.

### 5. Remove OwnTech Preferences From Core Flows
- Review flasher and tab flows that prefer `isOwntech` ports.
- Keep raw USB metadata in core, but move branded selection policy into the extension.
- Ensure core still behaves sensibly when no OwnTech hardware is present.

## Backward Compatibility Rules
- Existing dashboards using `twist_*` widget types must still load when the `twist` extension is enabled.
- Existing plans and tests should use `time_plot_uplot`, which is already the canonical neutral plot type.
- If the `twist` extension is disabled, core should fail gracefully on missing `twist_*` widgets instead of crashing the app.

## Test Plan
- Update `tests/e2e/serial.spec.js` for generic serial behavior without OwnTech-specific assumptions in core.
- Update `tests/e2e/integrated-plot-editor.spec.js` to cover:
  - canonical plot type
  - compatibility alias behavior
- Update `tests/e2e/plot-gauge.spec.js` if picker ordering or visible type names change.
- Update `tests/e2e/tabs-docs.spec.js` or `examples-window.spec.js` to confirm OwnTech example material is extension-contributed.
- Add a focused compatibility test only if a real shipped dashboard still uses a legacy alias; do not preserve an alias that no longer exists in runtime code.

## Acceptance Criteria
- Vanilla Modular can boot without `twist` and still provide generic serial, plotting, gauges, terminal, recorder, and dashboard features.
- `twist` widgets, protocol helpers, examples, and dashboards are extension-owned.
- Core no longer contains branded OwnTech UI hints beyond raw hardware metadata.
- Legacy dashboards remain loadable when the extension is installed.

## Risks
- Plot widget renaming can ripple into helper widgets, docs, and tests if aliases are not added early.
- Example ID changes can break saved links or menu expectations.
- Removing OwnTech-specific port preference from core can alter user convenience; if that policy is still desired, it must move into the extension deliberately.

## Dependencies For Later Steps
- Step 4 depends on the neutral core plot and serial boundary staying stable.
- Step 5 benefits from the same pattern for moving branded discovery and hardware policy out of core.

## Commit Sequence
1. `docs(extensions): add step 3 twist boundary plan`
   - Create this markdown plan.
   - Freeze the scope for the vanilla-versus-OwnTech split.

2. `refactor(serial): make core serial datasource metadata generic`
   - Remove OwnTech-specific labeling from core.
   - Preserve the `serialport_datasource` type contract.

3. `refactor(plot): introduce neutral canonical uPlot widget type with compatibility alias`
   - Keep legacy dashboards loadable through aliasing.
   - Update helper widgets and integrated editor targeting.

4. `feat(extension-twist): move TWIST protocol and widgets behind extension manifest`
   - Register `twist_protocol.js` and `twist_*` widgets through the runtime registry.

5. `feat(extension-twist): move OwnTech examples and dashboards behind extension roots`
   - Contribute example roots, dashboard roots, and docs through extension metadata.

6. `chore(twist): move branded port preference and defaults out of core`
   - Keep raw USB metadata in core.
   - Make branded selection policy extension-owned if it remains desirable.

7. `test(twist): cover generic serial core, plot aliases, and TWIST compatibility`
   - Update focused Playwright regressions for serial, plots, docs, and legacy dashboards.
