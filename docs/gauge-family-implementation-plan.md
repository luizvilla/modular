# Professional Gauge Family Plan

## Summary
- Implement a first wave of 4 new professional gauges as separate widget types: `horizontal_gauge`, `radial_arc_gauge`, `radial_needle_gauge`, and `donut_gauge`.
- Keep the current `vertical_gauge`, but refactor it into the same shared single-value gauge family so all 5 gauges use the same setup logic, source binding model, styling controls, and integrated wrench/add modal flow.
- Treat the old generic Freeboard `gauge` widget as compatibility-only after the new family ships: existing dashboards keep loading, but it is removed from the normal picker/docs surface.
- Keep the commit sequence in this file so the implementation can be executed as a clean atomic series.

## Implementation Changes
- Create a shared single-value gauge runtime layer used by `vertical_gauge` and all new gauges.
  - Shared live-data contract: one `sourceDef` bound through the integrated editor.
  - Shared core settings: `title`, `sourceDef`, `min`, `max`, `units`, `refreshRate`, `showValue`, `showMinMax`, `colorPalette`, `barColor`, `alarmEnabled`, `alarmDirection`, `warningThreshold`, `criticalThreshold`.
  - Shared zone model: 3-zone, one-sided severity. `alarmDirection` defines whether high values or low values are bad; the renderer derives green/yellow/red bands from `warningThreshold` and `criticalThreshold`.
  - Shared compatibility rule: old `vertical_gauge` settings without units/zones remain valid and default to no units plus a single-color gauge.

- Extend the integrated editor in `app/dashboard/plugins/integrated_plot_editor.js` into a gauge-family editor.
  - New gauge widgets open from the wrench and immediately after add, exactly like the current plot widgets and updated `vertical_gauge`.
  - Common modal sections:
    - `Source`: datasource, CAN device when relevant, variable.
    - `Display`: title, min/max, units, refresh, show value, show min/max.
    - `Zones`: warning threshold, critical threshold, high-is-bad vs low-is-bad.
    - `Style`: palette, active color, gauge-specific presentation options.
  - Gauge-specific options:
    - `horizontal_gauge`: optional compact mode, label position, fill direction.
    - `radial_arc_gauge`: sweep size (`180` or `270` degrees), start angle preset, center readout size.
    - `radial_needle_gauge`: same radial controls plus needle style and optional hub cap.
    - `donut_gauge`: ring thickness and center readout emphasis.
  - Do not introduce helper widgets for any of these gauges.

- Implement the new widget family as separate widget types backed by shared internals.
  - `vertical_gauge`: upgraded to the shared renderer contract, keeps its existing type name.
  - `horizontal_gauge`: linear left-to-right bar gauge for dense dashboards.
  - `radial_arc_gauge`: arc fill without a needle.
  - `radial_needle_gauge`: dial/needle instrument style.
  - `donut_gauge`: circular progress/ring gauge.
  - All gauges render the same source summary format used by the new `vertical_gauge`: datasource, optional CAN device, and resolved signal label.

- Update picker/docs taxonomy and legacy handling.
  - Add the 4 new gauge widget entries to `app/docs/widgets/index.json`.
  - Add new README pages under `app/docs/widgets/gauges/`.
  - Update the current vertical gauge docs so they describe the integrated editor, not helper widgets.
  - Mark `vertical_gauge_manager`, `vertical_gauge_config_panel`, and the old generic `gauge` as compatibility-only in the picker/help surface.
  - Keep those legacy widgets loadable in existing dashboards.

## Commit Sequence
1. `docs(gauges): add professional gauge implementation plan`
   - Create `docs/gauge-family-implementation-plan.md`.
   - Copy the approved plan into that file, including the commit sequence and acceptance criteria.
   - No product behavior changes in this commit.

2. `refactor(gauges): extract shared single-value gauge core`
   - Introduce shared runtime helpers and shared editor helpers for source binding, numeric formatting, thresholds, zone calculation, and summary rendering.
   - Do not add new widgets yet.

3. `feat(gauges): migrate vertical gauge to shared integrated family`
   - Keep `vertical_gauge` type stable.
   - Add units, shared zone model, shared editor sections, and inline summary behavior.
   - Keep legacy saved dashboards working.

4. `feat(gauges): add horizontal gauge widget`
   - Add `horizontal_gauge` using the shared gauge core and integrated editor.
   - Add docs/index entry and picker visibility.

5. `feat(gauges): add radial arc and donut gauges`
   - Add `radial_arc_gauge` and `donut_gauge`.
   - Reuse the shared zone/rendering contract and add the radial-specific display options.

6. `feat(gauges): add radial needle gauge`
   - Add `radial_needle_gauge`.
   - Reuse the same settings model as radial arc, with needle-specific rendering only.

7. `chore(gauges): hide legacy gauge widgets from normal add flow`
   - Mark `vertical_gauge_manager`, `vertical_gauge_config_panel`, and old `gauge` as compatibility-only in picker/docs.
   - Update help/docs wording so the new family is the primary path.

8. `test(gauges): cover integrated gauge flows and compatibility`
   - Add or extend E2E coverage for add-flow auto-open, wrench reopen, source binding, threshold rendering, and picker visibility.
   - Add compatibility checks proving legacy dashboards with the old gauge/helper widgets still load.

## Public Interfaces
- New widget types:
  - `horizontal_gauge`
  - `radial_arc_gauge`
  - `radial_needle_gauge`
  - `donut_gauge`
- Expanded shared settings contract for the professional gauge family:
  - `title`, `sourceDef`, `min`, `max`, `units`, `refreshRate`, `showValue`, `showMinMax`, `colorPalette`, `barColor`, `alarmEnabled`, `alarmDirection`, `warningThreshold`, `criticalThreshold`
  - Optional per-widget display fields for radial sweep, ring thickness, label placement, and needle style
- Legacy types remain loadable but become compatibility-only in the normal UX:
  - `vertical_gauge_manager`
  - `vertical_gauge_config_panel`
  - `gauge`

## Test Plan
- Add-flow coverage for all 5 family members: `vertical_gauge`, `horizontal_gauge`, `radial_arc_gauge`, `radial_needle_gauge`, `donut_gauge`.
- Wrench reopen coverage: saved settings reopen in the integrated editor with the correct source and thresholds.
- Rendering checks:
  - `vertical_gauge` and `horizontal_gauge` update fill direction and value readout correctly.
  - `radial_arc_gauge` and `donut_gauge` render zone bands and center readout.
  - `radial_needle_gauge` renders needle position correctly against min/max and zone colors.
- Zone behavior checks for both `high_is_bad` and `low_is_bad`.
- Picker/help checks that new gauges are visible and legacy helper/generic gauge widgets are hidden from the normal add flow.
- Compatibility checks that dashboards containing `vertical_gauge_manager`, `vertical_gauge_config_panel`, or old `gauge` still load without migration.

## Assumptions
- V1 is the 4-gauge core only; bullet gauge and thermometer/tank gauge are explicitly phase 2.
- New gauges use the same single live source model as the current integrated `vertical_gauge`; no target/reference/setpoint overlay is included in v1.
- The 3-zone model is one-sided in v1: either high values are bad or low values are bad. Dual-sided safe windows are out of scope for this wave.
- The implementation markdown file path is `docs/gauge-family-implementation-plan.md`.
