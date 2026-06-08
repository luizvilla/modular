# FFT Spectrum Widget — Implementation Plan

## Context and goal

`fft_analysis.py` is a standalone Python script that reads the latest CSV from
`Data_records/`, computes a real FFT over the columns `Vgrid` and `Igrid`, and
produces three sub-plots:

1. **Time domain** — signals vs time (ms)
2. **FFT spectrum** — log-scale magnitude vs frequency (0–1000 Hz) with
   harmonic markers at h1 … h11 of F0 = 50 Hz
3. **Harmonic bar chart** — amplitude of Vgrid at each harmonic order,
   annotated with its value

It also prints a THD table to the console.

The goal is to bring all of that into the dashboard as a live widget called
**FFT Spectrum Widget** (`type_name: fft_spectrum_plot`), so a user can drop
it into any pane, point it at a saved fast-frame CSV, and see the three
sub-plots plus a THD readout without leaving the application.

---

## Codebase integration points

| Concern | Existing hook |
|---|---|
| CSV file access | `window.FastFrameShared.listCsvFiles()` / `loadCsvDataset()` — already used by `fast_frame_plot.widget.js` |
| Plot rendering | `window.uPlot` — loaded by `uplot.widget.js` at order 30, guaranteed available |
| Widget registration | `app/extensions/core/manifest.json` `rendererScripts` array |
| File chooser | `window.api.serial.chooseCsvFile()` IPC (already in preload) |
| Resize / height persistence | uPlot resize-observer + drag-handle pattern from `fast_frame_plot` |

No new IPC channels, no new third-party libraries, no new shared helpers are
required.

---

## Files to create or modify

```
app/dashboard/plugins/fft_spectrum.widget.js   ← NEW (the entire widget, ~600 lines)
app/extensions/core/manifest.json              ← add one entry at order 165
```

The widget is self-contained: FFT algorithm, three uPlot charts, THD table, and
settings UI all live in the single `.widget.js` file.

---

## Settings schema

| Setting name | Type | Default | Description |
|---|---|---|---|
| `title` | `text` | `"FFT Spectrum"` | Pane title |
| `csvFile` | `text` | `""` | Absolute path to a CSV file. Leave blank to use auto-latest. |
| `csvDirectory` | `text` | `""` | Directory to scan for the latest `.csv`. Used when `csvFile` is blank. Falls back to `FastFrameShared.defaultCsvDirectory()`. |
| `signalColumns` | `text` | `""` | Comma-separated column names to analyse (e.g. `Vgrid,Igrid`). |
| `timeColumn` | `text` | `""` | Column to use as the time axis. Leave blank → sample index × TS. |
| `samplingPeriodUs` | `text` | `"100"` | Sampling period in microseconds (TS). Determines Fs = 1/TS. |
| `fundamentalFreqHz` | `text` | `"50"` | Fundamental frequency F0 (Hz) for harmonic marker spacing. |
| `maxFreqHz` | `text` | `"1000"` | Upper frequency bound of the spectrum plot (Hz). |
| `maxHarmonic` | `text` | `"11"` | Number of harmonics to label and include in the bar chart. |
| `showTimeDomain` | `boolean` | `true` | Toggle the time-domain sub-plot. |
| `showSpectrum` | `boolean` | `true` | Toggle the FFT spectrum sub-plot. |
| `showHarmonicBars` | `boolean` | `true` | Toggle the harmonic bar chart. |
| `logScaleSpectrum` | `boolean` | `true` | Log-scale y-axis on the spectrum sub-plot. |

---

## FFT algorithm (pure JS, no library)

A Cooley-Tukey radix-2 in-place real FFT is implemented inline in the widget
file. It is ~80 lines and handles power-of-two lengths only, so the input is
zero-padded to the next power of two before the transform.

```
function nextPow2(n)           // → smallest 2^k ≥ n
function fftReal(signal)       // → { freqs[], magnitudes[] } (double-sided → single-sided)
```

The magnitude is normalised the same way as numpy's approach:
```
magnitude[k] = 2 * |X[k]| / N     for k > 0
magnitude[0] = |X[0]| / N         (DC bin, excluded from THD)
```

Frequency resolution: `df = Fs / N_padded` Hz/bin.

For each harmonic h = 1 … maxHarmonic, the bin index is:
```
k_h = round(h * F0 / df)
```

THD (h2–hN / h1) is computed in JS and displayed in the readout table.

---

## Widget layout (three stacked uPlot charts)

```
┌────────────────────────────────────────┐
│  [Choose file]  [Refresh]  status msg  │  ← toolbar row
├────────────────────────────────────────┤
│  Time domain (uPlot line chart)        │  ← hidden if showTimeDomain=false
│  [drag resize handle]                  │
├────────────────────────────────────────┤
│  FFT spectrum (uPlot log line chart)   │  ← hidden if showSpectrum=false
│  [drag resize handle]                  │
├────────────────────────────────────────┤
│  Harmonic bar chart (uPlot bars)       │  ← hidden if showHarmonicBars=false
│  [drag resize handle]                  │
├────────────────────────────────────────┤
│  THD readout table                     │
│  Signal  │ h1 (V)  │ THD h2–hN (%)    │
└────────────────────────────────────────┘
```

Each chart is a separate `uPlot` instance. The resize handle pattern is copied
directly from `fast_frame_plot.widget.js` (mouse-drag sets `height` on the
chart host div, then `plot.setSize()` is called).

A single `ResizeObserver` on the widget's root container triggers
`plot.setSize({ width: ... })` on all three plots so they always fill the pane
width.

---

## Harmonic bar chart with uPlot

uPlot does not have a native bar series, but it provides a `drawSeries` hook
that runs after each series is drawn. We use it to render filled rectangles:

```javascript
hooks: {
  drawSeries: [(u, seriesIdx) => {
    const ctx = u.ctx;
    ctx.save();
    // for each data point, draw a filled rect from x-center ± halfWidth to y=0
    ctx.restore();
  }]
}
```

The x-axis ticks are the harmonic numbers (1 through maxHarmonic), and the
series data is `[harmonicNumbers, amplitudes]`. Each signal column gets its
own series with a distinct colour (same colour palette as the spectrum).

---

## Data flow

```
1. Widget renders → calls refresh()
2. refresh() calls FastFrameShared.loadCsvDataset(resolvedPath, lastSignature)
   - if changed: parse CSV → Float64Array per column → run computeFFT()
   - if unchanged: skip (debounced by signature hash)
3. computeFFT(columns, settings):
   - for each selected signal column: zero-pad → fftReal() → extract harmonics
   - returns { timeSeries, spectra, harmonics, thd }
4. renderPlots(result):
   - time domain: setData([timeAxis, ...signals])
   - spectrum:    setData([freqAxis, ...magnitudes])
   - bars:        setData([harmonicNums, ...harmonicAmplitudes])
   - THD table:   update innerHTML
5. Auto-refresh (optional): setInterval(refresh, 2000) when csvFile is blank
   (polling for new files in the directory, like fast_frame_plot)
```

---

## Colour palette

Reuse the same two-colour pair already used in the Python script and
consistently throughout the app:
- Vgrid / first signal: `"#4e9fd4"` (steel blue)
- Igrid / second signal: `"#e6862a"` (orange)
- Third and beyond: cycle through `["#5cb85c", "#d9534f", "#9b59b6", "#1abc9c"]`

Harmonic marker vertical lines on the spectrum plot are drawn as uPlot bands or
as canvas lines in the `draw` hook:
```javascript
hooks: { draw: [(u) => {
  for (let h = 1; h <= maxH; h++) {
    const xpx = u.valToPos(h * F0, 'x', true);
    ctx.strokeStyle = 'rgba(220,80,80,0.4)';
    // vertical line at xpx
    ctx.fillText(`h${h}`, xpx + 2, ...);
  }
}]}
```

---

## Registration in `core/manifest.json`

Add one entry to `rendererScripts` at order 165 (between
`fast_frame_channel_manager` at 160 and `serialfast.datasource` at 200):

```json
{ "path": "plugins/fft_spectrum.widget.js", "order": 165 }
```

Also add a `widgetTypes` entry for the widget picker icon:

```json
{ "type": "fft_spectrum_plot", "icon": "wave-square" }
```

---

## getHeight

The widget reports `getHeight()` as the sum of:
- 2 rows baseline (toolbar + THD table)
- +6 rows per visible sub-plot (time domain, spectrum, bars)

With all three on, the default is `getHeight() → 20`. Users resize plots
individually with the drag handles.

---

## Implementation order (suggested steps)

1. **FFT math** — write and unit-test `nextPow2`, `fftReal`, `extractHarmonics`,
   `computeTHD` in isolation (can run in Node with `--experimental-vm-modules`
   or in a Jest test).

2. **Skeleton widget** — `freeboard.loadWidgetPlugin()` registration, settings,
   `render()`, `onSettingsChanged()`, `onDispose()`. Loads a CSV and logs the
   result to console. No plots yet.

3. **Time-domain sub-plot** — single uPlot with line series per signal.

4. **Spectrum sub-plot** — uPlot with log scale, harmonic markers drawn in
   `draw` hook, frequency axis clipped to `maxFreqHz`.

5. **Harmonic bar chart** — uPlot with `drawSeries` hook for bar rendering and
   harmonic-order x-axis.

6. **THD table** — HTML table rendered below the charts.

7. **Toolbar (file chooser + refresh)** — "Choose CSV" button → IPC dialog,
   "Refresh" button → force re-load, auto-latest logic when no file is set.

8. **Resize observers + drag handles** — copy pattern from `fast_frame_plot`.

9. **Manifest registration** — add the two entries.

10. **Manual smoke test** — drop widget into a pane, point at one of the
    fast-frame CSV fixtures in `tests/fixtures/`, verify all three sub-plots
    render and THD matches the Python script's output for the same file.

---

## Open questions / decisions needed before coding

| Question | Options | Recommendation |
|---|---|---|
| Should the widget accept a live serial buffer as input in addition to CSV files? | CSV-only vs CSV + live streaming | **CSV-only for v1** — the Python script is offline analysis; streaming FFT is a separate feature (would need a ring-buffer and windowing function). |
| Auto-refresh when watching a directory? | Poll every N seconds vs file-system watch (IPC) | **Poll (2 s)** — consistent with `fast_frame_plot`; inotify-over-IPC adds complexity. |
| Should the three sub-plots be separate widgets (like fast_frame_plot_ui)? | Monolithic vs split | **Monolithic for v1** — the Python script is a single analysis unit; splitting into sub-widgets adds settings-sync complexity. |
| Window function before FFT? | None / Hann / Hamming | **Hann window by default** (reduces spectral leakage); expose as a setting. The Python script uses no windowing — match that as the default `"none"` option. |

---

## Non-goals for v1

- Streaming / real-time FFT from a live datasource
- Phase spectrum (only magnitude is shown)
- Export of FFT results to CSV
- Multiple-file comparison
- Auto-detection of F0 from the spectrum peak
