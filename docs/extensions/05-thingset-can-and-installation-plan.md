# Step 5 - ThingSet, CAN, And Extension Installation Plan

## Summary
- Move `ThingSet` and CAN support behind a dedicated extension boundary.
- Relocate extension-owned runtime state out of the repo root and into managed extension storage.
- Add the first installable extension bundle format after the local extension boundaries are proven.
- Keep local source-loaded development supported, but do not require checked-in compiled extension output in the core repo.

## Why This Step Exists
- `ThingSet` is the most deeply coupled feature family in the app:
  - `main`-process IPC
  - optional or platform-specific runtime dependencies
  - serial shell workflows
  - CAN transport and aggregation
  - renderer datasources and widgets
  - repo-root persisted state under `thingset/`
- This is also the feature family that most benefits from eventually living outside the vanilla repo.
- Installation and distribution should happen only after the runtime and metadata boundaries are already stable.

## Goals
- Move CAN and `ThingSet` ownership behind a `thingset` extension manifest.
- Move persisted runtime data from `thingset/` in the repo root to extension-managed storage under `userData`.
- Lazy-load optional runtime dependencies through the extension rather than assuming they are part of vanilla core.
- Introduce an installable extension bundle format and a local extension manager path.
- Keep in-repo source-loaded development mode for day-to-day work inside this repository.

## Non-Goals
- Do not solve trust or sandboxing for arbitrary third-party plugins.
- Do not require remote download infrastructure in the first installer pass.
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
- New extension bundle and installation-management files

## Core Versus Extension Boundary

### Core Should Own
- Extension discovery and loading
- Generic file APIs
- Generic serial APIs
- Generic activity/logging surfaces
- Generic extension storage helpers
- Generic enable/disable/install/uninstall controls

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

### 5. Add A Local Extension Installation Format
- Support two modes:
  - source-loaded mode for in-repo development
  - installed-bundle mode for external distribution
- Define a bundle format that includes:
  - `manifest.json`
  - `main.js`
  - renderer assets
  - docs/examples metadata
  - optional integrity metadata
- Install bundles into a managed path such as:
  - `userData/extensions/<id>/<version>/`

### 6. Add A Minimal Extension Manager
- Install a local extension bundle from disk.
- Enable or disable an installed extension.
- Uninstall an extension.
- Surface installation state through `window.api.extensions`.
- Keep the manager local-first; network distribution can come later.

## Source Versus Compiled Output Policy
- During the local refactor, the repo should hold source code, not checked-in compiled extension bundles.
- For eventual external installation:
  - the extension repo should hold source
  - its release process should produce an installable built bundle
  - the core app should load that installed bundle from managed storage
- A checked-in `compiled` directory in the core repo should be avoided unless a short-lived bootstrap proves unavoidable.

## Suggested Bundle Contents
- `manifest.json`
- `bundle-main.js`
- `renderer/`
- `docs/`
- `examples/`
- `checksums.json` or equivalent integrity metadata

## Test Plan
- Update `tests/e2e/can-thingset.spec.js` for extension-owned runtime and renderer behavior.
- Update `tests/e2e/electron-smoke.spec.js` to assert extension inventory, grouped preload domains, and clean disablement behavior.
- Update `tests/e2e/error-cases.spec.js` for:
  - missing bundle
  - disabled extension
  - missing optional dependency
  - malformed extension storage state
- Add focused coverage for install and uninstall flows once the manager exists.

## Acceptance Criteria
- Vanilla Modular can boot without the `thingset` extension.
- When the extension is enabled, current CAN and ThingSet workflows still function.
- Extension-owned state is stored outside the repo root.
- The app can install and enable a local extension bundle from disk.
- The core repo does not need checked-in compiled extension output to keep development working.

## Risks
- Storage migration can strand stale data if repo-root and userData roots diverge silently.
- Lazy-loading runtime modules can hide missing dependency errors until late in the flow; diagnostics must stay clear.
- Installer logic can accidentally overreach if it is designed for arbitrary code trust instead of internal controlled extensions.

## Dependencies
- This step depends on step 1 runtime loading, step 2 metadata merging, and the earlier proof that extension-owned `main` plus renderer contributions work.
- The eventual two-repo split should begin only after this step is stable locally.

## Commit Sequence
1. `docs(extensions): add step 5 thingset, can, and installation plan`
   - Create this markdown plan.
   - Freeze the final extraction and installer scope.

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

6. `build(extensions): define installable bundle format and local disk install path`
   - Add the first bundle schema and loader rules.

7. `feat(extension-manager): add local install, enable, disable, and uninstall flows`
   - Surface installed extension state through `window.api.extensions`.

8. `test(thingset): cover storage migration, install flows, and can-thingset regressions`
   - Extend focused Playwright coverage plus smoke and error-path tests.
