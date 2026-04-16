<!-- Widget documentation (auto-generated from widget definitions). -->
# Fast Frame Plot

## What it does
Plots the latest completed fast-frame dataset automatically, grouped into voltage, current, and other signals, similar to the grouping used by `pre_plot_records.py`.

## Creation (settings)
- Datasource Name: Fast Serial Frame datasource to visualize.
- Refresh Rate: Poll interval used to fetch the newest completed dataset.
- Title: Widget title.

## Usage (in dashboard)
- Trigger a fast-frame acquisition with the Fast Frame Control widget.
- The plot refreshes automatically when a new completed dataset is available.
- Signals are grouped into three stacked charts:
  voltages, currents, and other signals.
- `k_acquire` is omitted, and `V_Low_estim` is derived when `duty_cycle` and `V_high` are present.
