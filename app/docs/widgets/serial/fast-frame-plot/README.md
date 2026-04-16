<!-- Widget documentation (auto-generated from widget definitions). -->
# Fast Frame Plot

## What it does
Plots one or more fast-frame CSV channels against a selected X column or sample index.

## Creation (settings)
- Title: Widget title.
- Helper Widgets: Spawn the Fast Frame UI, Channel Manager, or both when the widget is created.

## Usage (in dashboard)
- Use the Fast Frame UI widget to configure title and axes.
- Use the Fast Frame Channel Manager to choose the CSV file, set the X axis column, and add or remove plotted Y channels.
- The plot reloads automatically when the selected CSV file is overwritten or appended with the same variables.
- `k_acquire` is ignored in the selector list, and `V_Low_estim` is added automatically when `duty_cycle` and `V_high` are present.
