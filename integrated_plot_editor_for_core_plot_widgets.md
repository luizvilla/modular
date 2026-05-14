# Integrated Plot Editor for Core Plot Widgets

## Summary
- Replace helper-widget-driven configuration for `owntech_plot_uplot`, `xy_plot_uplot`, and `fast_frame_plot` with a bound editor launched from the widget wrench.
- Keep the current serialized plot setting shapes (`seriesDefs`, `xSourceDef`, `ySourceDef`, CSV source fields, axis/title settings) so dashboards do not need migration.
- Stop auto-spawning `uplot_config_panel`, `uplot_series_manager`, `xy_plot_source_manager`, `fast_frame_plot_ui`, and `fast_frame_channel_manager`; dashboards that already contain those widgets still load.
- Make channel/source identity visible directly on the plot so users do not need a side pane to remember what each series means.

## Key Changes
- Add a plot-editor router in the existing widget-wrench flow. For the three core plot widget types, the wrench opens a dedicated modal instead of the generic `PluginEditor`; all other widgets keep the current editor.
- Chain add flow into first-time configuration: after creating one of the three core plots from the add-widget dialog, automatically open the integrated plot editor for that new widget.
- Remove `helperWidgets` from the user-facing settings schema for the three core plots. The widgets should still tolerate legacy `helperWidgets` values in loaded dashboards, but those values no longer trigger helper-pane creation.
- Extract datasource discovery, variable/device lookup, fast-frame CSV source handling, and settings-commit helpers into shared plain JS utilities. The old helper widgets should call the same shared utilities until they are retired.
- Use one consistent modal structure across the three plot families:
  - `owntech_plot_uplot`: `Channels` section backed by `seriesDefs`, plus `Display` for duration, refresh rate, legend, palette, y-axis label, and bounds.
  - `xy_plot_uplot`: `Sources` section with fixed `X` and `Y` cards backed by `xSourceDef` and `ySourceDef`, plus `Display` for title/history and existing plot display fields.
  - `fast_frame_plot`: `Source` section for CSV mode/file/time column, `Channels` backed by normalized `seriesDefs`, plus `Display` for title, labels, legend, and bounds.
- Make the editor act on the bound widget model directly, not by widget title. This removes the current “Select Target Widget” step and avoids ambiguity with duplicate titles.
- Add consistent in-widget source summaries:
  - `owntech_plot_uplot`: summary strip listing datasource/header or datasource/device/variable per series.
  - `xy_plot_uplot`: status/readout showing `X` and `Y` source identities.
  - `fast_frame_plot`: keep the existing summary strip but include each plotted label together with its raw column name.
- Add keyboard-first behavior in the modal: normal tab order, arrow-key movement in channel/source lists, `Delete/Backspace` to remove the selected channel row, `Ctrl/Cmd+Enter` to save, and `Esc` to cancel.
- Treat right-click editing as phase 2 only. Do not add a context-menu path in this implementation; factor the modal launcher so a future right-click trigger can call the same code.

## Test Plan
- Add Playwright coverage for each core plot type:
  - adding a new plot opens the integrated editor immediately after widget creation;
  - clicking the wrench reopens the same editor for an existing plot;
  - editing sources/channels updates the widget without spawning helper panes;
  - keyboard save/cancel shortcuts work;
  - source summary text on the widget reflects the saved configuration.
- Add regression coverage that dashboards containing legacy helper widgets still render, and that loading a plot with legacy `helperWidgets` no longer injects new panes.
- Keep a focused smoke check that non-plot widgets still use the generic `PluginEditor`.
- Preserve existing fast-frame source behaviors in tests: fixed CSV, latest-in-directory mode, and column discovery from the selected file.

## Interfaces
- No dashboard JSON migration is required.
- Serialized settings for the three core plots stay as they are today; the new editor writes the same fields the helper widgets currently write.
- Helper widget types remain loadable for backwards compatibility, but they are removed from the default configuration flow and normal add-widget taxonomy/docs surface.

## Assumptions
- V1 scope is limited to `owntech_plot_uplot`, `xy_plot_uplot`, and `fast_frame_plot`; `vertical_gauge` follows later on the same pattern.
- The wrench modal is the sole new entry point in v1; right-click is intentionally deferred.
- Legacy helper widgets are compatibility artifacts, not an equal alternative workflow.
