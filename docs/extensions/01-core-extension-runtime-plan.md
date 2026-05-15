# Step 1 - Core Extension Runtime Plan

## Summary
- The runtime split for step 1 is `core`, `owntech`, and `thingset`.
- `Fast Frame` stays inside `core`; it is not an extension target.
- Step 1 is a runtime/bootstrap refactor only. Existing privileged IPC ownership remains in `app/main.js`.

## Scope
- Add manifest discovery under `app/extensions`.
- Treat `core` as always enabled and data-only.
- Treat `owntech` and `thingset` as enabled/disabled extension manifests with thin `mainEntry` adapters.
- Replace the renderer’s static feature script ownership with `window.api.extensions.getBootstrap()`.
- Keep foundational static includes in `app/dashboard/index.html` unchanged.

## Runtime Contract
- `window.api.extensions.list()`
- `window.api.extensions.isEnabled(id)`
- `window.api.extensions.getBootstrap()`

`getBootstrap()` should provide:
- ordered `rendererScripts`
- merged `flags`
- extension inventory
- enabled `widgetDocsRoots`
- enabled `exampleRoots`
- enabled `dashboardRoots`

## Ownership
- `core`
  - `time_plot_uplot`
  - `xy_plot_uplot`
  - gauges
  - `fast_frame_*`
  - `fast_frame_datasource`
  - `serialport_datasource`
  - `signal_generator_datasource`
  - serial terminal / recorder / commands / flasher
  - shared editor and manager scripts
- `owntech`
  - `js/twist_protocol.js`
  - `twist_*` widgets
  - `serialowntech_datasource`
  - branded docs/examples/dashboards for `TWIST`, `OWNVERTER`, and `SPIN`
- `thingset`
  - `thingset_serial_datasource`
  - `can_datasource`
  - `ts_*` widgets
  - ThingSet widget docs and menus

## Constraints
- Preserve the `0.9.3` widget-picker and integrated-editor UX exactly.
- Preserve current script order by seeding manifest `rendererScripts` from the working `index.html` sequence.
- Remove renderer-side `thingsetEnabled` filtering from `index.html`.
- Keep `ENABLE_THINGSET` as a compatibility override feeding the registry.

## Test Expectations
- `window.api.extensions` exists in Electron smoke coverage.
- Invalid manifests are skipped without crashing the app.
- `core` remains enabled even when explicitly overridden.
- Disabling `owntech` removes `twist_*` bootstrap contributions.
- Disabling `thingset` removes ThingSet/CAN bootstrap contributions.

## Commit Sequence
1. `chore(baseline): align stale plot type references with time_plot_uplot`
2. `feat(extension-runtime): add manifest schema and discovery for core owntech thingset`
3. `feat(extension-runtime): add initial manifests with fast-frame contributions under core`
4. `refactor(main): add extension registry and thin extension main-entry adapter API`
5. `refactor(preload): expose additive window.api.extensions surface with mock parity`
6. `refactor(renderer): replace static feature boot list with ordered extension bootstrap`
7. `chore(runtime): route ENABLE_THINGSET through registry enablement`
8. `docs(runtime): document extension bootstrap contract and v0.9.3 invariants`
9. `test(extension-runtime): cover inventory bootstrap invalid manifests and picker/editor smoke`
