# Tutorials Extension Roadmap and Session Tracker

## Summary
- This file is the canonical tracker for the tutorials program.
- It records the current roadmap, tutorial specs, session rules, completed sessions, planned sessions, validation expectations, and closing commits.
- One tutorial equals one tracked session. Shared runtime work is allowed only when it is required to ship that tutorial.
- The current roadmap wave covers:
  - `core/xy-signal-generator`
  - `core/fast-frame-from-csv`
  - `core/fft-spectrum-from-csv`
  - `core/vertical-gauge-basics`
  - `hardware/spin-serial-basics`
- Already-shipped work has been backfilled here so every finished tutorial session has a recorded `closing_commit`.

## Session Rules
- One tutorial equals one session.
- A session may include shared runtime, schema, controller, or welcome-card work, but only the work required to ship that tutorial.
- Do not create standalone "infrastructure-only" sessions.
- A session is not `done` until all of these are true:
  - the tutorial works end-to-end
  - required automated tests pass
  - required manual validation points are checked
  - this file is updated with status, validation notes, and closing commit
  - a closing git commit exists
- The `status` field is fixed to: `planned`, `in_progress`, `done`, `blocked`.
- Every finished session must record a `closing_commit`.
- Welcome-card button updates for beginner tutorials must land inside the same tutorial session that introduces that tutorial.
- If a session changes tutorial bootstrap or schema loading, it must also run the relevant unit coverage for extension runtime loading.

## Completed Sessions
| session_id | tutorial_id | title | status | assets | runtime_changes | validation | closing_commit | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TUT-001 | `core/dashboard-basics` | Dashboard Basics | done | Local SVG illustrations for panes/widgets and datasource flow | Added the built-in tutorials extension flow for a blank editable dashboard tab, tutorial menu wiring, in-dashboard stepper, base focus resolvers, welcome-card launch integration, and v1 completion kinds for pane count, datasource presence, widget presence, and time-plot binding | Backfilled from shipped history. Original closure validation was not recorded in this tracker. Current baseline coverage for this tutorial family lives in `tests/unit/extensions_runtime.test.js` and `tests/e2e/tutorials.spec.js`. | `557fafa` | First live in-dashboard tutorial session. |
| TUT-002 | `hardware/opposition-testing` | Opposition Testing | done | Tutorial definition only | Added overlay tutorial mode and TWIST-specific focus resolvers for the courseware-driven walkthrough | Backfilled from shipped history. Original closure validation was not recorded in this tracker. Current baseline coverage for tutorial open/resume behavior lives in `tests/e2e/tutorials.spec.js`. | `b26cd6f` | Initially introduced in `2671141`; `b26cd6f` is the closing fix commit. |

### Support Milestones
| milestone_id | title | status | runtime_changes | closing_commit | notes |
| --- | --- | --- | --- | --- | --- |
| SUP-001 | Startup welcome card | done | Added the empty-dashboard welcome card that can launch beginner tutorials and show completed-state buttons that remain clickable | `1a46dcb` | Non-tutorial support milestone; future beginner-tutorial buttons must be added inside the matching tutorial session. |

## Planned Sessions
| session_id | tutorial_id | title | status | assets | runtime_changes | validation | closing_commit | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TUT-003 | `core/xy-signal-generator` | XY Signal Generator | done | No shared file asset required | Added `xy_plot_sources_bound` completion kind; count support on `datasource_type_exists`; focus resolvers `modal.widgetPicker.xyPlot`, `modal.widgetPicker.xySourceManager`, `modal.xyPlotEditor`, `widget.xySourceManager.apply`; step-id handlers for `create-first-datasource` / `create-second-datasource`; welcome-card XY action | 4 E2E tests in `tests/e2e/tutorials-xy.spec.js` (bootstrap, welcome card, tab open, full happy path); `tests/e2e/tutorials.spec.js` updated for 2 welcome actions; `tests/unit/extensions_runtime.test.js` extended with XY tutorial load and completion-kind assertions; `tests/e2e/xy-plot.spec.js` passed unmodified | `01531f6` | 7-step tutorial; uses integrated XY plot editor (not source manager widget) to bind sources. |
| TUT-004 | `core/fast-frame-from-csv` | Fast Frame From CSV | done | Copied `2026-05-22_17-01-17-record.csv` to `app/extensions/tutorials/assets/sample_data.csv` as shared extension asset | Added `normalizeTutorialResources` (extensionRoot-relative CSV path, existence check), `normalizeStepActions` (`apply_tutorial_csv` kind), `fast_frame_plot_configured` completion kind; `executeStepActions` in `tutorials.js`; `window._tutorialPendingCsv` injection in `openFastFramePlotEditor`; focus resolvers `modal.fastFrameEditor`, `modal.widgetPicker.fastFrame`; step-id overrides for `add-fast-frame-widget` and `configure-channels`; welcome-card Fast Frame action | 4 E2E tests in `tests/e2e/tutorials-fast-frame.spec.js` (bootstrap/menu, welcome card, tab open, full happy path); `tests/unit/extensions_runtime.test.js` extended with Fast Frame load, resources.csv, actions, and completion-kind assertions; welcome-card 3-action count updated | `457bd5c` (`feat(tutorials): add fast-frame csv tutorial`) | 5-step tutorial; `configure-channels` step fires `apply_tutorial_csv` action on entry, pre-loading the CSV into the re-opened integrated editor. |
| TUT-005 | `core/fft-spectrum-from-csv` | FFT Spectrum From CSV | planned | Reuse `app/extensions/tutorials/assets/sample_data.csv` from `TUT-004` | Add FFT editor CSV-apply action and `fft_spectrum_configured` | Tutorial happy-path E2E, `tests/e2e/fft-spectrum.spec.js`, relevant integrated editor regression coverage, plus extension-runtime unit coverage if loader/schema code changes | `TBD` (`feat(tutorials): add fft spectrum csv tutorial`) | Blank-dashboard FFT tutorial using the same shared CSV asset and one math channel. |
| TUT-006 | `core/vertical-gauge-basics` | Vertical Gauge Basics | planned | No shared file asset required | Add `gauge_source_bound`, `gauge_runtime_offset_adjusted`, gauge focus resolvers, and the welcome-card button for gauges inside this session | Tutorial happy-path E2E, gauge regression coverage, relevant integrated editor regression coverage, plus extension-runtime unit coverage if loader/schema code changes | `TBD` (`feat(tutorials): add vertical gauge tutorial`) | Blank-dashboard gauge tutorial using one signal generator and the runtime gauge offset control. First gauge tutorial covers `vertical_gauge` only. |
| TUT-007 | `hardware/spin-serial-basics` | SPIN Serial Basics | planned | Ship a tutorial-owned firmware binary copied from [app/extensions/owntech-examples/dashboard/binaries/duty_cycle_setting/duty_cycle_setting.mcuboot.bin](/home/luiz-villa/code/modular/app/extensions/owntech-examples/dashboard/binaries/duty_cycle_setting/duty_cycle_setting.mcuboot.bin) | Add firmware-resource action, `serialport_datasource_connected`, `serial_command_buttons_configured`, `serial_csv_recorder_started`, and `flash_completed` | Tutorial happy-path E2E with `MOCK_HW=1`, `tests/e2e/serial.spec.js`, flash/activity regression coverage if flash completion logic is touched, plus extension-runtime unit coverage if loader/schema code changes | `TBD` (`feat(tutorials): add spin serial basics tutorial`) | Blank-dashboard serial tutorial anchored on the SPIN `duty_cycle_setting` scenario. It must cover board connection, serial-port reader setup, firmware flashing, command sender setup, and CSV recording. |

## Shared Runtime Changes
- Extend `tutorial.json` with top-level `resources`.
  - Needed `kind` values in this roadmap wave: `csv`, `firmware`.
  - Resources must resolve into `bootstrap.tutorials` the same way illustrations resolve now.
- Extend step data with optional `actions[]`.
  - Needed action kinds in this roadmap wave:
    - apply tutorial CSV to the active Fast Frame editor
    - apply tutorial CSV to the active FFT editor
    - apply tutorial firmware to the active serial flasher
- Extend tutorial completion evaluation with optional `count` support on existing datasource/widget completion kinds and add:
  - `xy_plot_sources_bound`
  - `fast_frame_plot_configured`
  - `fft_spectrum_configured`
  - `gauge_source_bound`
  - `gauge_runtime_offset_adjusted`
  - `serialport_datasource_connected`
  - `serial_command_buttons_configured`
  - `serial_csv_recorder_started`
  - `flash_completed`
- Extend the focus resolver map for:
  - XY widget flow
  - Fast Frame widget flow
  - FFT widget flow
  - vertical gauge flow
  - serial flasher
  - serial command buttons
  - serial CSV recorder
  - gauge offset controls
- Keep all roadmap tutorials inside the live in-dashboard tutorial system. Do not add new overlay-mode tutorials in this roadmap.

## Validation Matrix
- Every session must add or update a dedicated tutorial happy-path E2E before closure.
- Any session that changes tutorial bootstrap or schema loading must also run the relevant extension-runtime unit coverage.

| session_id | required_validation |
| --- | --- |
| TUT-003 | Tutorial happy-path E2E; `tests/e2e/xy-plot.spec.js`; relevant integrated editor regression coverage |
| TUT-004 | Tutorial happy-path E2E; `tests/e2e/fast-frame.spec.js`; relevant integrated editor regression coverage |
| TUT-005 | Tutorial happy-path E2E; `tests/e2e/fft-spectrum.spec.js`; relevant integrated editor regression coverage |
| TUT-006 | Tutorial happy-path E2E; gauge regression coverage; relevant integrated editor regression coverage |
| TUT-007 | Tutorial happy-path E2E with `MOCK_HW=1`; `tests/e2e/serial.spec.js`; flash/activity regression coverage if flash completion logic is touched |

## Assumptions
- Advanced tutorials launch with blank dashboards unless their own session explicitly says otherwise.
- The canonical shipped CSV for Fast Frame and FFT is the copied tutorial asset `sample_data.csv`, created from [2026-05-22_17-01-17-record.csv](/home/luiz-villa/code/modular/2026-05-22_17-01-17-record.csv).
- The serial tutorial uses the SPIN `duty_cycle_setting` scenario.
- The first gauge tutorial covers `vertical_gauge` only.
- Tutorial progress remains local and session-based as it works today.
