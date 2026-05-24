# Step 5 - ThingSet And CAN Boundary Plan

## Summary
- Move `ThingSet` and CAN support behind a dedicated extension boundary.
- Relocate extension-owned runtime state out of the repo root and into managed extension storage.
- Lazy-load optional runtime dependencies through the extension rather than assuming they are part of vanilla core.
- Keep local source-loaded development supported.

## Why This Step Exists
- `ThingSet` is the most deeply coupled feature family in the app:
  - `main`-process IPC
  - optional or platform-specific runtime dependencies
  - serial shell workflows
  - CAN transport and aggregation
  - renderer datasources and widgets
  - repo-root persisted state under `thingset/`
- This is the feature family that most benefits from eventually living outside the vanilla repo.
- Completing this boundary proves that a full feature family can contribute both `main` and renderer behavior cleanly, which is the prerequisite for Step 6.

## Goals
- Move CAN and `ThingSet` ownership behind a `thingset` extension manifest.
- Move persisted runtime data from `thingset/` in the repo root to extension-managed storage under `userData`.
- Lazy-load optional runtime dependencies through the extension rather than assuming they are part of vanilla core.

## Non-Goals
- Do not solve trust or sandboxing for arbitrary third-party plugins.
- Do not introduce installable bundle format or extension manager in this step (see Step 6).
- Do not require remote download infrastructure.
- Do not keep generated build artifacts checked into the core repo as a permanent policy.

## Read First
- `app/main.js`
- `app/preload.js`
- `app/js/can_adapter.js`
- `app/js/can_broadcast_aggregator.js`
- `app/js/query_nodes.js`
- `app/js/scan.js`
- `app/js/thingset_bin.js`
- `app/js/thingset_dfu_can.js`
- `app/js/thingset_serial_shell.js`
- `app/dashboard/plugins/can.datasource.js`
- `app/dashboard/plugins/thingset_serial.datasource.js`
- `app/dashboard/plugins/ts_device_ui.widget.js`
- `app/dashboard/plugins/ts_serial_device_ui.widget.js`
- `app/dashboard/plugins/ts_mode.widget.js`
- `app/dashboard/plugins/ts_control.widget.js`
- `app/dashboard/plugins/ts_measurements.widget.js`
- `package.json`
- `tests/e2e/can-thingset.spec.js`
- `tests/e2e/electron-smoke.spec.js`
- `tests/e2e/error-cases.spec.js`

## Current Files Expected To Change
- `app/main.js`
- `app/preload.js`
- `package.json`
- `app/js/*.js` for CAN and ThingSet runtimes
- `app/dashboard/plugins/can.datasource.js`
- `app/dashboard/plugins/thingset_serial.datasource.js`
- `app/dashboard/plugins/ts_*.widget.js`
- Storage paths currently rooted at `thingset/`

## Core Versus Extension Boundary

### Core Should Own
- Extension discovery and loading
- Generic file APIs
- Generic serial APIs
- Generic activity/logging surfaces
- Generic extension storage helpers
- Generic enable/disable controls

### `thingset` Extension Should Own
- CAN transport runtime
- CAN aggregation runtime
- ThingSet over CAN client behavior
- ThingSet serial shell behavior
- CAN datasource
- ThingSet serial datasource
- All `ts_*` widgets
- ThingSet docs, examples, and dashboards
- Its own persisted runtime state

## Methodology To Preserve From Existing Skills
- From `modular-electron-bridge`:
  - Add or change `main` handlers first.
  - Expose narrow preload surfaces and keep mock parity aligned.
  - Keep grouped API domains coherent rather than scattering one-off methods.
- From `modular-widget-authoring`:
  - Keep docs/index entries aligned with shipped widget titles and categories.
  - Preserve compatibility-only behavior through explicit metadata.
- From `modular-playwright-e2e`:
  - Use focused Playwright coverage for extension-owned workflows.
  - Preserve mock-hardware defaults unless a new scenario explicitly needs different flags.

## Implementation Changes

### 1. Move Persisted State To Extension Storage
- Stop reading and writing `thingset/` at the repo root as the runtime source of truth.
- Introduce extension storage helpers rooted at:
  - `app.getPath('userData')/extensions/thingset/`
- Move:
  - `nodes.json`
  - `node_*_tree.json`
  - any future extension-owned cache or diagnostic files
- Keep migration logic from the old repo-root location for developer convenience during transition.

### 2. Lazy-Load Optional Runtime Dependencies
- Remove the assumption that vanilla core always owns CAN/ThingSet runtime imports.
- Load CAN/ThingSet runtime modules only when the extension is enabled.
- Move dependency declarations and capability checks into extension metadata where possible.
- Keep platform-specific failure messages explicit.

### 3. Move `main`-Process IPC Ownership Behind The Extension
- Register CAN and ThingSet handlers from the extension `mainEntry`.
- Preserve the current grouped API model:
  - `can`
  - `thingset`
  - `thingsetSerial`
- If temporary shims are needed in core preload, document them and remove them deliberately after migration.

### 4. Move Renderer Datasources And Widgets
- Register:
  - `can_datasource`
  - `thingset_serial_datasource`
  - `thingset_device_ui`
  - `thingset_serial_device_ui`
  - `thingset_mode_button`
  - `thingset_control_panel`
  - `thingset_measurements`
- Keep extension-owned docs and metadata tied to the merged registry from step 2.

## Test Plan
- Update `tests/e2e/can-thingset.spec.js` for extension-owned runtime and renderer behavior.
- Update `tests/e2e/electron-smoke.spec.js` to assert extension inventory, grouped preload domains, and clean disablement behavior.
- Update `tests/e2e/error-cases.spec.js` for:
  - disabled extension
  - missing optional dependency
  - malformed extension storage state

## Acceptance Criteria
- Vanilla Modular can boot without the `thingset` extension.
- When the extension is enabled, current CAN and ThingSet workflows still function.
- Extension-owned state is stored outside the repo root.
- The core repo does not need checked-in compiled extension output to keep development working.

## Risks
- Storage migration can strand stale data if repo-root and userData roots diverge silently.
- Lazy-loading runtime modules can hide missing dependency errors until late in the flow; diagnostics must stay clear.

## Dependencies
- This step depends on step 1 runtime loading, step 2 metadata merging, and the earlier proof that extension-owned `main` plus renderer contributions work.
- Step 6 (extension installation) should begin only after this step is stable locally.

## Commit Sequence
1. `docs(extensions): add step 5 thingset and CAN boundary plan`
   - Create this markdown plan.
   - Freeze the extraction scope before refactoring.

2. `refactor(storage): move thingset runtime state to extension-managed userData root`
   - Add migration from the old repo-root `thingset/` location.

3. `refactor(main): lazy-load CAN and ThingSet runtime through extension main entry`
   - Remove eager ownership from vanilla core.
   - Preserve clear capability and platform errors.

4. `refactor(preload): expose extension-contributed can and thingset domains with mock parity`
   - Keep grouped domain APIs coherent.
   - Update test mock behavior at the same time.

5. `feat(extension-thingset): move datasources, widgets, docs, and example roots behind manifest`
   - Register all renderer-side ThingSet and CAN contributions through the extension runtime.

6. `test(thingset): cover storage migration and can-thingset regressions`
   - Extend focused Playwright coverage plus smoke and error-path tests.
