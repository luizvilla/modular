<!-- Widget documentation (auto-generated from widget definitions). -->
# Fast Frame Plot

## What it does
Plots one or more fast-frame CSV channels against time or sample index.

## Creation (settings)
- CSV Directory: Directory used to list available `.csv` files in the widget.
- CSV File Path: CSV file to read and watch for updates.
- Refresh Rate: Poll interval used to reload the selected file.
- Time Column: Optional X axis column. If left empty, the widget uses the row index.
- Axis labels and bounds: Optional axis overrides.
- Show Legend: Toggle the legend for multi-channel plots.
- Title: Widget title.

## Usage (in dashboard)
- Use the Fast Frame UI widget to configure the CSV source and plot-level settings.
- Use the Fast Frame Channel Manager to add or remove plotted variables.
- The plot reloads automatically when the selected CSV file is overwritten or appended with the same variables.
- `k_acquire` is ignored in the selector list, and `V_Low_estim` is added automatically when `duty_cycle` and `V_high` are present.
