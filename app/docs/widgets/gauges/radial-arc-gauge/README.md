<!-- Widget documentation (auto-generated from widget definitions). -->
# Radial Arc Gauge

## What it does
Single-channel radial arc gauge with integrated source binding, warning and critical zones, and optional alarm state.

## Creation (settings)
- Title: Widget title shown above the gauge.
- Source: Choose the datasource, CAN device when needed, and variable directly in the integrated editor.
- Display: Configure range, units, value visibility, min/max labels, and refresh rate.
- Zones: Configure warning and critical thresholds plus whether high values or low values are considered bad.
- Style: Configure palette, active color, sweep size, and center value size.

## Usage (in dashboard)
- Arc sweep: Shows the current value across the configured range.
- Source summary: Shows the active datasource, optional CAN device, and resolved signal label.
- Min/Max labels: Show configured bounds when enabled.
- Center value: Numeric readout of the current value with units when enabled.
- Zones: Warning and critical segments use the shared gauge-family colors.
- Alarm styling: Red highlight when the critical zone is active and alarms are enabled.
