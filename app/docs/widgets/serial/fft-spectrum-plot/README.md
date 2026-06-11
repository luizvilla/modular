# FFT Spectrum Widget

Analyzes a saved fast-frame CSV and renders three coordinated views:

- Time-domain signals
- FFT spectrum with harmonic markers
- Harmonic bar chart plus THD summary

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| Title | text | FFT Spectrum | Label shown in the pane header. |
| CSV File | text | — | Absolute or workspace-relative CSV path. Leave blank to follow the latest CSV in the selected directory. |
| CSV Directory | text | — | Directory scanned for the latest `.csv` when CSV File is blank. Defaults to the app working directory. |
| Signal Columns | text | — | Comma-separated column names to analyze. Leave blank to auto-pick `Vgrid,Igrid` when present, otherwise the first numeric channels. |
| Time Column | text | — | Column used as the time axis. Leave blank to use sample index multiplied by the sampling period. |
| Sampling Period (us) | text | 100 | Sampling period in microseconds. |
| Fundamental Frequency (Hz) | text | 50 | Harmonic reference frequency. |
| Max Frequency (Hz) | text | 1000 | Upper bound for the FFT spectrum plot. |
| Max Harmonic | text | 11 | Highest harmonic included in the markers, bars, and THD calculation. |
| Show Time Domain | boolean | true | Toggle the time-domain plot. |
| Show Spectrum | boolean | true | Toggle the FFT spectrum plot. |
| Show Harmonic Bars | boolean | true | Toggle the harmonic bar chart. |
| Log Scale Spectrum | boolean | true | Use a logarithmic Y scale for the spectrum plot. |

## Notes

Use the toolbar inside the widget to choose a CSV file or force a refresh. When the CSV file setting is blank, the widget polls the directory every two seconds and follows the latest `.csv` file.
