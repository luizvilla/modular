# Recent dashboard plotting improvements

## Pause control for Time Plot and XY Plot

Both plots now have a Pause/Resume button. Pausing freezes data intake (no new points appended) without tearing down the current view, matching behavior users expect from oscilloscope-style tools. Previously only manual workarounds (e.g. unplugging a datasource) could freeze a live plot.

## Export CSV for Time Plot and XY Plot

Both plots have an "Export CSV" button that saves the currently visible data. Filenames use the same timestamp convention as fast-frame captures (`YYYY-MM-DD_HH-mm-ss-<name>.csv`, local time) for consistency across the app.

## Unified save location: `~/Documents/Modular/`

Previously, exports were scattered across at least 6 different locations: `app/acquire/` (fast-frame captures), `app/headers/` (channel headers), the current working directory (serial "Record" widget CSVs — a bug), `userData/dashboards`, `userData/machines`, and the OS Downloads folder (plot CSV exports). All of these now save under one visible, browsable folder:

```
~/Documents/Modular/
  headers/
  dashboards/
  machines/
  captures/
  time_plot_csv/
  xy_plot_csv/
```

Existing files from the old locations were migrated automatically on first run. This also fixed a packaging bug: the old capture/header directories were based on the app's own install path, which is read-only once packaged — writes there would have silently failed in a shipped build.

Along the way, a latent bug was fixed where the serial "Record" widget's CSV output resolved relative filenames against the app's current working directory instead of a fixed location, occasionally dropping stray CSVs wherever the app happened to be launched from.

## Homogeneous channel color across plots

Fast Frame Plot has always let users manually assign each channel's color via a color picker that auto-suggests the next palette color after every "Add channel" click. Time Plot and XY Plot didn't have this:

- **Time Plot** previously had no per-channel color control at all — only a global 4-palette selector that recolored every series by index. It now has a per-channel color picker in the widget editor, following the same auto-suggest/auto-advance pattern as Fast Frame Plot. Channels without an explicit color still fall back to the palette exactly as before, so existing dashboards are unaffected.
- **XY Plot** previously had its Trail line and Latest-point marker colors hardcoded in source, with no way to change them. Both are now configurable from the widget editor's new "Style" section, defaulting to the previous hardcoded colors.

A pre-existing bug was also fixed along the way: the Time Plot editor's channel-normalization logic silently stripped any `color` field before saving, which would have caused newly-set colors to vanish on the widget's first re-save.
